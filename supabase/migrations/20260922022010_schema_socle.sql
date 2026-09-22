-- =====================================================================
-- SCHÉMA SOCLE - SaaS de gestion scolaire multi-écoles
-- PostgreSQL 15+
--
-- Principes :
--  1. Multi-tenant : chaque table métier porte school_id.
--  2. Intégrité des tenants : FK composites (x_id, school_id) pour qu'une
--     ligne ne puisse jamais pointer vers une autre école.
--  3. Un utilisateur (users) est global ; son rôle dépend de l'école
--     (school_members). Un parent peut avoir des enfants dans 2 écoles.
--  4. Modules activables par école (school_modules).
--  5. Colonnes jsonb (settings / metadata / external_refs) pour enrichir
--     sans migration (ex : code Massar).
--  6. Structure scolaire = ARBRE générique (curriculum_nodes) : cycle >
--     niveau > filière > option. Chaque école l'instancie depuis un modèle
--     de programme. Heures, tarifs et ciblage se définissent sur un nœud
--     et s'appliquent à tous ses descendants.
--  7. Emploi du temps VERSIONNÉ par classe : changer l'horaire à partir
--     d'une date = nouvelle version (brouillon -> publiée). L'historique
--     reste intact et les dates passées gardent l'ancien horaire.
--  8. Changements d'UN jour (absence, remplaçant, cours annulé, sortie,
--     jour férié) = timetable_exceptions, sans toucher à la trame.
--  9. Année scolaire : les classes, les heures par matière, les tarifs et
--     les horaires sont PAR année (le passé ne bouge jamais quand on
--     prépare l'année suivante). La structure (arbre des niveaux) est stable
--     d'une année à l'autre. roll_over_academic_year() prépare l'année N+1.
-- 11. Salles : une salle est affectée à une CLASSE (sa salle habituelle) ou à une
--     MATIÈRE (salle de sport, d'informatique...). Le créneau n'indique une salle
--     que pour déroger ; sinon : matière > classe. room_double_bookings() détecte
--     les salles utilisées en double.
-- 12. Heures par défaut : un modèle de programme peut embarquer des volumes
--     horaires (curriculum_template_hours) que apply_curriculum_template_hours()
--     recopie pour une année. Chaque ligne porte un statut (confirmed / proposed /
--     to_verify) : ce que l'école n'a pas encore validé reste visible comme tel.
-- 10. Changer de professeur en cours d'année : replace_class_teacher() vérifie
--     les conflits du nouveau prof, versionne l'horaire et date les affectations.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Utilitaires
-- ---------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS btree_gist;   -- contrainte anti-chevauchement des versions

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------
-- 1. Écoles et modules
-- ---------------------------------------------------------------------
CREATE TABLE schools (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  slug            text NOT NULL UNIQUE,
  country_code    char(2) NOT NULL DEFAULT 'MA',
  timezone        text NOT NULL DEFAULT 'Africa/Casablanca',
  default_locale  text NOT NULL DEFAULT 'fr',
  currency        char(3) NOT NULL DEFAULT 'MAD',
  settings        jsonb NOT NULL DEFAULT '{}',
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Feature flags : 'timetable', 'homework', 'announcements', 'payments_tracking'
-- Plus tard : 'grades', 'attendance', 'invoicing', 'massar', 'student_access'
CREATE TABLE school_modules (
  school_id   uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  module      text NOT NULL,
  is_enabled  boolean NOT NULL DEFAULT true,
  config      jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (school_id, module)
);

-- ---------------------------------------------------------------------
-- 2. Utilisateurs et appartenance aux écoles
-- ---------------------------------------------------------------------
CREATE TABLE users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email           text,
  phone           text,                       -- format E.164 (+2126...)
  full_name       text NOT NULL,
  locale          text NOT NULL DEFAULT 'fr',
  status          text NOT NULL DEFAULT 'invited'
                  CHECK (status IN ('invited', 'active', 'disabled')),
  auth_provider_id text,                      -- id chez Supabase Auth / Firebase / ...
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (email IS NOT NULL OR phone IS NOT NULL)
);
CREATE UNIQUE INDEX users_email_uq ON users (lower(email)) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX users_phone_uq ON users (phone) WHERE phone IS NOT NULL;

CREATE TABLE school_members (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id   uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        text NOT NULL
              CHECK (role IN ('admin', 'teacher', 'parent', 'student', 'staff')),
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, user_id, role),
  UNIQUE (id, school_id, role)      -- cible des FK composites (tenant + rôle)
);
CREATE INDEX school_members_user_idx ON school_members (user_id);

-- ---------------------------------------------------------------------
-- 3. Structure académique
-- ---------------------------------------------------------------------
CREATE TABLE academic_years (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id   uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name        text NOT NULL,                  -- '2026-2027'
  starts_on   date NOT NULL,
  ends_on     date NOT NULL,
  is_current  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_on > starts_on),
  UNIQUE (school_id, name),
  UNIQUE (id, school_id),
  EXCLUDE USING gist (school_id WITH =, daterange(starts_on, ends_on, '[]') WITH &&)
);
CREATE UNIQUE INDEX academic_years_one_current_uq
  ON academic_years (school_id) WHERE is_current;

-- Arbre de la structure scolaire (par école). Exemple :
--   Préscolaire > Petite / Moyenne / Grande section
--   Lycée > 1ère Bac > Sciences mathématiques
-- `path` = chaîne des ancêtres (racine -> soi-même), maintenue par trigger :
-- « X est-il sous Y ? » devient `Y = ANY(x.path)`, sans requête récursive.
CREATE TABLE curriculum_nodes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id   uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  parent_id   uuid,
  kind        text NOT NULL CHECK (kind IN ('cycle', 'level', 'track', 'option')),
  code        text,
  name        text NOT NULL,
  name_ar     text,
  position    int NOT NULL DEFAULT 0,
  path        uuid[] NOT NULL DEFAULT '{}',
  metadata    jsonb NOT NULL DEFAULT '{}',
  FOREIGN KEY (parent_id, school_id) REFERENCES curriculum_nodes (id, school_id),
  UNIQUE (id, school_id)
);
CREATE UNIQUE INDEX curriculum_nodes_name_uq ON curriculum_nodes (
  school_id, COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), name
);
CREATE UNIQUE INDEX curriculum_nodes_code_uq ON curriculum_nodes (school_id, code) WHERE code IS NOT NULL;
CREATE INDEX curriculum_nodes_path_idx ON curriculum_nodes USING gin (path);
CREATE INDEX curriculum_nodes_parent_idx ON curriculum_nodes (school_id, parent_id, position);

-- Calcule le chemin à l'insertion / au changement de parent, refuse les cycles
CREATE OR REPLACE FUNCTION curriculum_nodes_set_path() RETURNS trigger AS $$
DECLARE
  v_parent_path uuid[];
BEGIN
  IF NEW.parent_id IS NULL THEN
    NEW.path := ARRAY[NEW.id];
  ELSE
    SELECT path INTO v_parent_path FROM curriculum_nodes WHERE id = NEW.parent_id;
    IF NEW.id = ANY(v_parent_path) THEN
      RAISE EXCEPTION 'cycle dans l''arbre de la structure scolaire (noeud %)', NEW.id;
    END IF;
    NEW.path := v_parent_path || NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_curriculum_nodes_set_path
  BEFORE INSERT OR UPDATE OF parent_id ON curriculum_nodes
  FOR EACH ROW EXECUTE FUNCTION curriculum_nodes_set_path();

-- Déplacer un nœud déplace toute sa sous-branche : on recalcule les chemins
CREATE OR REPLACE FUNCTION curriculum_nodes_cascade_path() RETURNS trigger AS $$
BEGIN
  UPDATE curriculum_nodes c
     SET path = NEW.path || c.path[array_position(c.path, NEW.id) + 1:]
   WHERE c.path @> ARRAY[NEW.id] AND c.id <> NEW.id;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_curriculum_nodes_cascade_path
  AFTER UPDATE OF parent_id ON curriculum_nodes
  FOR EACH ROW WHEN (OLD.parent_id IS DISTINCT FROM NEW.parent_id)
  EXECUTE FUNCTION curriculum_nodes_cascade_path();

-- Passage à l'année suivante : de quel nœud vers quel(s) nœud(s)
-- (ex : 1ère Bac Sciences maths -> 2ème Bac Sciences maths A ou B)
CREATE TABLE node_progressions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id    uuid NOT NULL,
  from_node_id uuid NOT NULL,
  to_node_id   uuid NOT NULL,
  is_default   boolean NOT NULL DEFAULT true,
  CHECK (from_node_id <> to_node_id),
  FOREIGN KEY (from_node_id, school_id) REFERENCES curriculum_nodes (id, school_id) ON DELETE CASCADE,
  FOREIGN KEY (to_node_id, school_id) REFERENCES curriculum_nodes (id, school_id) ON DELETE CASCADE,
  UNIQUE (from_node_id, to_node_id)
);

-- Modèles de programme (globaux, pas par école) : l'onboarding en instancie un.
-- tree = [{"kind":"cycle","code":"PRESCO","name":"...","children":[...]}, ...]
CREATE TABLE curriculum_templates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code          text NOT NULL UNIQUE,          -- 'ma_public', 'fr_mission', ...
  name          text NOT NULL,
  country_code  char(2),
  tree          jsonb NOT NULL
);

-- Volumes horaires hebdomadaires par défaut d'un modèle, par nœud (code du nœud)
-- et par matière. Même héritage que node_subject_hours : une ligne sur un nœud
-- vaut pour ses descendants ; weekly_minutes = 0 retire la matière plus bas.
--   status 'proposed'  : valeur proposée, à faire confirmer par l'école
--   status 'to_verify' : valeur incertaine, à vérifier avant usage
-- source : d'où vient la valeur (texte libre).
CREATE TABLE curriculum_template_hours (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_code         text NOT NULL REFERENCES curriculum_templates(code) ON DELETE CASCADE,
  node_code             text NOT NULL,
  subject_code          text NOT NULL,
  subject_name          text NOT NULL,
  weekly_minutes        int NOT NULL CHECK (weekly_minutes >= 0),
  min_session_minutes   int CHECK (min_session_minutes > 0),
  max_session_minutes   int CHECK (max_session_minutes > 0),
  max_sessions_per_day  smallint NOT NULL DEFAULT 1 CHECK (max_sessions_per_day > 0),
  status                text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'to_verify')),
  source                text,
  CHECK (min_session_minutes IS NULL OR max_session_minutes IS NULL
         OR min_session_minutes <= max_session_minutes),
  UNIQUE (template_code, node_code, subject_code)
);

CREATE OR REPLACE FUNCTION _insert_curriculum_children(
  p_school_id uuid, p_parent_id uuid, p_nodes jsonb
) RETURNS int AS $$
DECLARE
  n       jsonb;
  v_id    uuid;
  v_count int := 0;
  v_pos   int := 0;
BEGIN
  FOR n IN SELECT value FROM jsonb_array_elements(p_nodes) LOOP
    INSERT INTO curriculum_nodes (school_id, parent_id, kind, code, name, name_ar, position)
    VALUES (p_school_id, p_parent_id, n->>'kind', n->>'code', n->>'name', n->>'name_ar', v_pos)
    RETURNING id INTO v_id;
    v_count := v_count + 1;
    v_pos := v_pos + 1;
    IF n ? 'children' THEN
      v_count := v_count + _insert_curriculum_children(p_school_id, v_id, n->'children');
    END IF;
  END LOOP;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- Copie un modèle dans l'école ; retourne le nombre de nœuds créés
CREATE OR REPLACE FUNCTION instantiate_curriculum_template(
  p_school_id uuid, p_template_code text
) RETURNS int AS $$
DECLARE
  v_tree jsonb;
BEGIN
  SELECT tree INTO v_tree FROM curriculum_templates WHERE code = p_template_code;
  IF v_tree IS NULL THEN
    RAISE EXCEPTION 'modèle de programme % introuvable', p_template_code;
  END IF;
  RETURN _insert_curriculum_children(p_school_id, NULL, v_tree);
END;
$$ LANGUAGE plpgsql;

-- Salles de l'école. Une salle sert de salle habituelle d'une classe
-- (classes.home_room_id) ou de salle d'une matière (subjects.room_id).
CREATE TABLE rooms (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id   uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name        text NOT NULL,
  capacity    int,
  UNIQUE (school_id, name),
  UNIQUE (id, school_id)
);

CREATE TABLE subjects (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id   uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name        text NOT NULL,
  code        text,
  room_id     uuid,                      -- salle de la matière (ex : Sport -> salle de sport)
  UNIQUE (school_id, name),
  UNIQUE (id, school_id),
  FOREIGN KEY (room_id, school_id) REFERENCES rooms (id, school_id) ON DELETE SET NULL (room_id)
);

CREATE TABLE classes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id         uuid NOT NULL,
  academic_year_id  uuid NOT NULL,
  node_id           uuid NOT NULL,            -- nœud le plus bas de sa branche
  name              text NOT NULL,            -- 'Petite section A'
  capacity          int,
  home_room_id      uuid,                     -- salle habituelle de la classe (cette année)
  metadata          jsonb NOT NULL DEFAULT '{}',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE,
  FOREIGN KEY (academic_year_id, school_id) REFERENCES academic_years (id, school_id),
  FOREIGN KEY (node_id, school_id) REFERENCES curriculum_nodes (id, school_id),
  FOREIGN KEY (home_room_id, school_id) REFERENCES rooms (id, school_id) ON DELETE SET NULL (home_room_id),
  UNIQUE (academic_year_id, name),
  UNIQUE (id, school_id),
  UNIQUE (id, academic_year_id, school_id)
);
CREATE INDEX classes_node_idx ON classes (node_id);

-- Classes d'une année scolaire (par défaut l'année en cours) situées sous un nœud
-- (le nœud lui-même inclus).
-- Sert au ciblage : une annonce, un événement ou un tarif pointant sur
-- 'Lycée' ou '2ème Bac' atteint toutes les classes de cette branche.
CREATE OR REPLACE FUNCTION classes_under_node(
  p_node_id uuid, p_academic_year_id uuid DEFAULT NULL
) RETURNS TABLE (class_id uuid) AS $$
  SELECT c.id
  FROM curriculum_nodes n
  JOIN classes c ON c.node_id = n.id AND c.school_id = n.school_id
  JOIN academic_years ay ON ay.id = c.academic_year_id AND ay.school_id = c.school_id
  WHERE n.path @> ARRAY[p_node_id]
    AND CASE WHEN p_academic_year_id IS NULL THEN ay.is_current
             ELSE ay.id = p_academic_year_id END;
$$ LANGUAGE sql STABLE;

-- ---------------------------------------------------------------------
-- 4. Élèves, parents, inscriptions
-- ---------------------------------------------------------------------
CREATE TABLE students (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id     uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  first_name    text NOT NULL,
  last_name     text NOT NULL,
  birth_date    date,
  gender        text CHECK (gender IN ('female', 'male')),
  status        text NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'graduated', 'left')),
  -- Accès élève (futur) : compte optionnel, rôle 'student' garanti
  member_id     uuid,
  member_role   text NOT NULL DEFAULT 'student' CHECK (member_role = 'student'),
  external_refs jsonb NOT NULL DEFAULT '{}',  -- ex : {"massar_code": "R1234567"}
  metadata      jsonb NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (member_id, school_id, member_role)
    REFERENCES school_members (id, school_id, role),
  UNIQUE (id, school_id)
);
CREATE INDEX students_name_idx ON students (school_id, last_name, first_name);

-- Lien parent <-> élève (plusieurs-à-plusieurs : fratries, deux parents)
CREATE TABLE student_guardians (
  school_id           uuid NOT NULL,
  student_id          uuid NOT NULL,
  guardian_member_id  uuid NOT NULL,
  guardian_role       text NOT NULL DEFAULT 'parent' CHECK (guardian_role = 'parent'),
  relationship        text CHECK (relationship IN ('mother', 'father', 'guardian', 'other')),
  is_primary          boolean NOT NULL DEFAULT false,
  is_payer            boolean NOT NULL DEFAULT false,
  can_pick_up         boolean NOT NULL DEFAULT true,
  PRIMARY KEY (student_id, guardian_member_id),
  FOREIGN KEY (student_id, school_id) REFERENCES students (id, school_id) ON DELETE CASCADE,
  FOREIGN KEY (guardian_member_id, school_id, guardian_role)
    REFERENCES school_members (id, school_id, role) ON DELETE CASCADE
);
CREATE INDEX student_guardians_guardian_idx ON student_guardians (guardian_member_id);

-- Un élève est dans au plus une classe par année scolaire
CREATE TABLE enrollments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id         uuid NOT NULL,
  student_id        uuid NOT NULL,
  class_id          uuid NOT NULL,
  academic_year_id  uuid NOT NULL,
  status            text NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'withdrawn', 'completed')),
  started_on        date,
  ended_on          date,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (student_id, school_id) REFERENCES students (id, school_id) ON DELETE CASCADE,
  FOREIGN KEY (class_id, academic_year_id, school_id)
    REFERENCES classes (id, academic_year_id, school_id),
  UNIQUE (student_id, academic_year_id),
  CHECK (ended_on IS NULL OR started_on IS NULL OR ended_on >= started_on)
);
CREATE INDEX enrollments_class_idx ON enrollments (class_id);

-- ---------------------------------------------------------------------
-- 5. Professeurs et planning
-- ---------------------------------------------------------------------
-- Affectation prof <-> classe, DATÉE (matière optionnelle : en maternelle, une
-- maîtresse principale n'a pas de matière). Plusieurs profs possibles pour une
-- même classe et matière (principal, assistant, spécialiste), y compris l'un
-- après l'autre : changer de prof en cours d'année = clore l'ancienne ligne
-- (valid_to) et en ouvrir une nouvelle (valid_from), voir replace_class_teacher().
-- NULL / NULL = toute l'année. C'est l'intention de planification (entrée du
-- solveur) ; la vérité de « qui enseigne quand » reste l'emploi du temps.
CREATE TABLE teaching_assignments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id         uuid NOT NULL,
  class_id          uuid NOT NULL,
  subject_id        uuid,
  teacher_member_id uuid NOT NULL,
  teacher_role      text NOT NULL DEFAULT 'teacher' CHECK (teacher_role = 'teacher'),
  kind              text NOT NULL DEFAULT 'main'
                    CHECK (kind IN ('main', 'assistant', 'specialist')),
  valid_from        date,
  valid_to          date,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from),
  FOREIGN KEY (class_id, school_id) REFERENCES classes (id, school_id) ON DELETE CASCADE,
  FOREIGN KEY (subject_id, school_id) REFERENCES subjects (id, school_id),
  FOREIGN KEY (teacher_member_id, school_id, teacher_role)
    REFERENCES school_members (id, school_id, role),
  -- même prof, même classe, même matière : les périodes ne se chevauchent pas
  EXCLUDE USING gist (
    class_id WITH =,
    (COALESCE(subject_id, '00000000-0000-0000-0000-000000000000'::uuid)) WITH =,
    teacher_member_id WITH =,
    daterange(valid_from, valid_to, '[]') WITH &&
  )
);
CREATE INDEX teaching_assignments_class_idx ON teaching_assignments (class_id);
CREATE INDEX teaching_assignments_teacher_idx ON teaching_assignments (teacher_member_id);

-- Les dates d'une affectation restent dans l'année scolaire de la classe
CREATE OR REPLACE FUNCTION teaching_assignments_validate() RETURNS trigger AS $$
DECLARE
  v_start date;
  v_end   date;
BEGIN
  SELECT ay.starts_on, ay.ends_on INTO v_start, v_end
  FROM classes c
  JOIN academic_years ay ON ay.id = c.academic_year_id AND ay.school_id = c.school_id
  WHERE c.id = NEW.class_id;
  IF (NEW.valid_from IS NOT NULL AND (NEW.valid_from < v_start OR NEW.valid_from > v_end))
     OR (NEW.valid_to IS NOT NULL AND (NEW.valid_to < v_start OR NEW.valid_to > v_end)) THEN
    RAISE EXCEPTION 'les dates de l''affectation doivent rester dans l''année scolaire de la classe (% au %)', v_start, v_end;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_teaching_assignments_validate
  BEFORE INSERT OR UPDATE OF class_id, valid_from, valid_to ON teaching_assignments
  FOR EACH ROW EXECUTE FUNCTION teaching_assignments_validate();

-- Qui est affecté à la classe à une date donnée
CREATE OR REPLACE FUNCTION teaching_assignments_on(p_class_id uuid, p_date date)
RETURNS SETOF teaching_assignments AS $$
  SELECT a.*
  FROM teaching_assignments a
  WHERE a.class_id = p_class_id
    AND (a.valid_from IS NULL OR a.valid_from <= p_date)
    AND (a.valid_to IS NULL OR a.valid_to >= p_date);
$$ LANGUAGE sql STABLE;

-- Indisponibilités récurrentes des profs (par défaut : disponible partout).
--  'blocked' = contrainte dure, jamais violée par le solveur
--  'avoid'   = préférence, respectée si possible (pénalité sinon)
-- Par défaut ends_at = 24:00 => toute la journée.
CREATE TABLE teacher_unavailability (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id         uuid NOT NULL,
  teacher_member_id uuid NOT NULL,
  teacher_role      text NOT NULL DEFAULT 'teacher' CHECK (teacher_role = 'teacher'),
  weekday           smallint NOT NULL CHECK (weekday BETWEEN 1 AND 7),  -- ISO : 1 = lundi
  starts_at         time NOT NULL DEFAULT '00:00',
  ends_at           time NOT NULL DEFAULT '24:00',
  kind              text NOT NULL DEFAULT 'blocked' CHECK (kind IN ('blocked', 'avoid')),
  valid_from        date,
  valid_to          date,
  reason            text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from),
  FOREIGN KEY (teacher_member_id, school_id, teacher_role)
    REFERENCES school_members (id, school_id, role) ON DELETE CASCADE
);
CREATE INDEX teacher_unavailability_teacher_idx
  ON teacher_unavailability (teacher_member_id, weekday);

-- Volume horaire hebdomadaire par nœud de l'arbre et par matière/activité.
-- Dit au solveur combien de créneaux placer (ex : Moyenne section, Sport, 2 h/sem).
-- PAR ANNÉE SCOLAIRE : les heures d'une année n'affectent jamais les autres ;
-- roll_over_academic_year() recopie celles de l'année précédente.
-- HÉRITAGE : une ligne posée sur 'Lycée' ou 'Tronc commun' vaut pour tous les
-- descendants ; un nœud enfant peut la surcharger (autres heures) ou la retirer
-- (weekly_minutes = 0). Une filière ajoute ainsi ses matières propres sans
-- répéter le tronc commun.
-- En maternelle, les activités de la routine (accueil, sieste, goûter...)
-- sont simplement des lignes de `subjects`.
CREATE TABLE node_subject_hours (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id             uuid NOT NULL,
  academic_year_id      uuid NOT NULL,
  node_id               uuid NOT NULL,
  subject_id            uuid NOT NULL,
  weekly_minutes        int NOT NULL CHECK (weekly_minutes >= 0),  -- 0 = matière retirée ici
  min_session_minutes   int CHECK (min_session_minutes > 0),
  max_session_minutes   int CHECK (max_session_minutes > 0),
  max_sessions_per_day  smallint NOT NULL DEFAULT 1 CHECK (max_sessions_per_day > 0),
  -- confirmed : saisi ou validé par l'école ; proposed : proposé (modèle, IA) ;
  -- to_verify : valeur incertaine. Modifier les heures = les confirmer (trigger).
  status                text NOT NULL DEFAULT 'confirmed'
                        CHECK (status IN ('confirmed', 'proposed', 'to_verify')),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CHECK (min_session_minutes IS NULL OR max_session_minutes IS NULL
         OR min_session_minutes <= max_session_minutes),
  FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE,
  FOREIGN KEY (academic_year_id, school_id) REFERENCES academic_years (id, school_id) ON DELETE CASCADE,
  FOREIGN KEY (node_id, school_id) REFERENCES curriculum_nodes (id, school_id) ON DELETE CASCADE,
  FOREIGN KEY (subject_id, school_id) REFERENCES subjects (id, school_id) ON DELETE CASCADE,
  UNIQUE (academic_year_id, node_id, subject_id)
);

CREATE OR REPLACE FUNCTION node_subject_hours_autoconfirm() RETURNS trigger AS $$
BEGIN
  IF NEW.status = OLD.status
     AND (NEW.weekly_minutes, NEW.min_session_minutes, NEW.max_session_minutes, NEW.max_sessions_per_day)
         IS DISTINCT FROM
         (OLD.weekly_minutes, OLD.min_session_minutes, OLD.max_session_minutes, OLD.max_sessions_per_day)
  THEN
    NEW.status := 'confirmed';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_node_subject_hours_autoconfirm
  BEFORE UPDATE ON node_subject_hours
  FOR EACH ROW EXECUTE FUNCTION node_subject_hours_autoconfirm();

-- Heures effectives d'un nœud pour une année : pour chaque matière, la
-- définition du descendant le plus profond gagne. À interroger avec un filtre
-- sur academic_year_id et node_id.
CREATE VIEW resolved_node_subject_hours AS
SELECT * FROM (
  SELECT DISTINCT ON (h.academic_year_id, n.id, h.subject_id)
    n.school_id,
    h.academic_year_id,
    n.id                AS node_id,
    h.node_id           AS defined_on_node_id,
    h.subject_id,
    h.weekly_minutes,
    h.min_session_minutes,
    h.max_session_minutes,
    h.max_sessions_per_day
  FROM curriculum_nodes n
  JOIN node_subject_hours h
    ON h.school_id = n.school_id AND h.node_id = ANY (n.path)
  ORDER BY h.academic_year_id, n.id, h.subject_id, array_position(n.path, h.node_id) DESC
) r
WHERE r.weekly_minutes > 0;

-- Ce que le solveur doit placer pour chaque classe (heures de SON année)
CREATE VIEW class_required_hours AS
SELECT
  c.id AS class_id,
  c.school_id,
  c.academic_year_id,
  r.subject_id,
  r.weekly_minutes,
  r.min_session_minutes,
  r.max_session_minutes,
  r.max_sessions_per_day
FROM classes c
JOIN resolved_node_subject_hours r
  ON r.node_id = c.node_id
 AND r.school_id = c.school_id
 AND r.academic_year_id = c.academic_year_id;

-- Emploi du temps versionné.
-- Une version = un horaire hebdomadaire complet d'une classe, valable sur une
-- période. Cas d'usage :
--   * Rentrée               -> version 'base' ouverte (effective_to NULL)
--   * Changement dès le 11/01 jusqu'à la fin de l'année
--                            -> nouvelle version 'base' dès le 11/01 ; la
--                               précédente est close au 10/01 à la publication
--   * Ramadan, examens (période limitée)
--                            -> version 'seasonal' bornée ; elle prime sur la
--                               'base' pendant sa période, puis la base reprend
-- Les brouillons peuvent se chevaucher (travail en cours) ; les versions
-- publiées d'un même type ne le peuvent jamais (contrainte d'exclusion).
CREATE TABLE timetable_versions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id             uuid NOT NULL,
  class_id              uuid NOT NULL,
  kind                  text NOT NULL DEFAULT 'base' CHECK (kind IN ('base', 'seasonal')),
  name                  text NOT NULL,               -- 'Rentrée 2026', 'Ramadan 2027'
  status                text NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft', 'published', 'archived')),
  effective_from        date NOT NULL,
  effective_to          date,                        -- NULL = jusqu'à nouvel ordre
  created_by_member_id  uuid REFERENCES school_members(id),
  published_at          timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  FOREIGN KEY (class_id, school_id) REFERENCES classes (id, school_id) ON DELETE CASCADE,
  UNIQUE (id, class_id, school_id),
  EXCLUDE USING gist (
    class_id WITH =,
    kind WITH =,
    daterange(effective_from, effective_to, '[]') WITH &&
  ) WHERE (status = 'published')
);
CREATE INDEX timetable_versions_class_idx ON timetable_versions (class_id, status, effective_from);

-- Une version doit rester dans l'année scolaire de sa classe
CREATE OR REPLACE FUNCTION timetable_versions_validate() RETURNS trigger AS $$
DECLARE
  v_start date;
  v_end   date;
BEGIN
  SELECT ay.starts_on, ay.ends_on INTO v_start, v_end
  FROM classes c
  JOIN academic_years ay ON ay.id = c.academic_year_id AND ay.school_id = c.school_id
  WHERE c.id = NEW.class_id;
  IF NEW.effective_from < v_start OR NEW.effective_from > v_end
     OR (NEW.effective_to IS NOT NULL AND NEW.effective_to > v_end) THEN
    RAISE EXCEPTION 'les dates de la version doivent rester dans l''année scolaire de la classe (% au %)', v_start, v_end;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_timetable_versions_validate
  BEFORE INSERT OR UPDATE OF class_id, effective_from, effective_to ON timetable_versions
  FOR EACH ROW EXECUTE FUNCTION timetable_versions_validate();

-- Créneaux d'une version (routine hebdomadaire récurrente)
CREATE TABLE timetable_slots (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id         uuid NOT NULL,
  version_id        uuid NOT NULL,
  class_id          uuid NOT NULL,
  subject_id        uuid,
  teacher_member_id uuid,
  teacher_role      text NOT NULL DEFAULT 'teacher' CHECK (teacher_role = 'teacher'),
  room_id           uuid,                       -- dérogation seulement : sinon salle de la matière, puis de la classe
  title             text,                       -- libre : 'Atelier peinture', 'Sieste'
  weekday           smallint NOT NULL CHECK (weekday BETWEEN 1 AND 7),  -- ISO : 1 = lundi
  starts_at         time NOT NULL,
  ends_at           time NOT NULL,
  is_locked         boolean NOT NULL DEFAULT false,  -- verrou : la régénération n'y touche pas
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  UNIQUE (id, class_id, school_id),
  FOREIGN KEY (version_id, class_id, school_id)
    REFERENCES timetable_versions (id, class_id, school_id) ON DELETE CASCADE,
  FOREIGN KEY (subject_id, school_id) REFERENCES subjects (id, school_id),
  FOREIGN KEY (room_id, school_id) REFERENCES rooms (id, school_id),
  FOREIGN KEY (teacher_member_id, school_id, teacher_role)
    REFERENCES school_members (id, school_id, role)
);
CREATE INDEX timetable_slots_version_idx ON timetable_slots (version_id, weekday, starts_at);
CREATE INDEX timetable_slots_teacher_idx ON timetable_slots (teacher_member_id, weekday);

-- Créneaux dont le professeur n'est pas affecté à la classe (et à la matière)
-- pendant tout ou partie de la période de la version. Une ligne par période
-- non couverte (gap_from -> gap_to, dates incluses). Une affectation sans
-- matière couvre toutes les matières de la classe. Vide = tout est cohérent.
-- Inclut les brouillons (version_status) pour vérifier avant publication.
CREATE VIEW timetable_assignment_gaps AS
SELECT
  s.id                AS slot_id,
  s.version_id,
  v.status            AS version_status,
  s.class_id,
  s.subject_id,
  s.teacher_member_id,
  s.weekday,
  s.starts_at,
  s.ends_at,
  lower(g.gap)        AS gap_from,
  upper(g.gap) - 1    AS gap_to
FROM timetable_slots s
JOIN timetable_versions v ON v.id = s.version_id
JOIN classes c ON c.id = s.class_id AND c.school_id = s.school_id
JOIN academic_years ay ON ay.id = c.academic_year_id AND ay.school_id = c.school_id
CROSS JOIN LATERAL (
  SELECT datemultirange(daterange(v.effective_from, COALESCE(v.effective_to, ay.ends_on), '[]'))
         - COALESCE((
             SELECT range_agg(daterange(a.valid_from, a.valid_to, '[]'))
             FROM teaching_assignments a
             WHERE a.class_id = s.class_id
               AND a.teacher_member_id = s.teacher_member_id
               AND (a.subject_id IS NULL OR a.subject_id = s.subject_id)
           ), '{}'::datemultirange) AS gaps
) x
CROSS JOIN LATERAL unnest(x.gaps) AS g(gap)
WHERE s.teacher_member_id IS NOT NULL
  AND v.status IN ('draft', 'published');

-- Salle effective d'un créneau : salle propre au créneau (dérogation), sinon
-- salle de la matière, sinon salle habituelle de la classe.
-- source : 'slot' | 'subject' | 'class' (NULL = aucune salle définie)
CREATE VIEW timetable_slot_rooms AS
SELECT
  s.id AS slot_id,
  s.version_id,
  s.class_id,
  COALESCE(s.room_id, sb.room_id, c.home_room_id) AS room_id,
  CASE WHEN s.room_id IS NOT NULL THEN 'slot'
       WHEN sb.room_id IS NOT NULL THEN 'subject'
       WHEN c.home_room_id IS NOT NULL THEN 'class' END AS source
FROM timetable_slots s
JOIN classes c ON c.id = s.class_id AND c.school_id = s.school_id
LEFT JOIN subjects sb ON sb.id = s.subject_id AND sb.school_id = s.school_id;

-- Version en vigueur pour une classe à une date (la saisonnière prime sur la base).
-- Les brouillons ne sont jamais visibles, et hors de l'année de la classe : rien.
CREATE OR REPLACE FUNCTION timetable_version_on(p_class_id uuid, p_date date)
RETURNS uuid AS $$
  SELECT v.id
  FROM timetable_versions v
  JOIN classes c ON c.id = v.class_id AND c.school_id = v.school_id
  JOIN academic_years ay ON ay.id = c.academic_year_id AND ay.school_id = c.school_id
  WHERE v.class_id = p_class_id
    AND v.status = 'published'
    AND v.effective_from <= p_date
    AND (v.effective_to IS NULL OR v.effective_to >= p_date)
    AND p_date BETWEEN ay.starts_on AND ay.ends_on
  ORDER BY (v.kind = 'seasonal') DESC
  LIMIT 1;
$$ LANGUAGE sql STABLE;

-- Horaire hebdomadaire d'une classe tel qu'il s'applique à une date
CREATE OR REPLACE FUNCTION timetable_on(p_class_id uuid, p_date date)
RETURNS SETOF timetable_slots AS $$
  SELECT s.*
  FROM timetable_slots s
  WHERE s.version_id = timetable_version_on(p_class_id, p_date)
  ORDER BY s.weekday, s.starts_at;
$$ LANGUAGE sql STABLE;

-- Exceptions datées : ce qui change UN jour précis, sans toucher à la trame.
--   cancelled : le cours de ce jour n'a pas lieu
--   changed   : le cours a lieu mais autrement (remplaçant, salle, horaire...)
--               les colonnes NULL = inchangé
--   added     : séance en plus (fête, rattrapage) ; slot_id NULL
--   day_off   : classe fermée toute la journée (férié, grève) ; slot_id NULL
-- Un remplaçant = 'changed' avec teacher_member_id. Les parents prévenus
-- peuvent être reliés via announcement_id ; une sortie via event_id.
CREATE TABLE timetable_exceptions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id             uuid NOT NULL,
  class_id              uuid NOT NULL,
  exception_date        date NOT NULL,
  kind                  text NOT NULL CHECK (kind IN ('cancelled', 'changed', 'added', 'day_off')),
  slot_id               uuid,
  -- surcharges (changed) ou contenu (added)
  subject_id            uuid,
  teacher_member_id     uuid,
  teacher_role          text NOT NULL DEFAULT 'teacher' CHECK (teacher_role = 'teacher'),
  room_id               uuid,
  title                 text,
  starts_at             time,
  ends_at               time,
  reason_code           text CHECK (reason_code IN
                          ('teacher_absent', 'event', 'holiday', 'room_unavailable', 'weather', 'other')),
  reason                text,
  event_id              uuid,
  announcement_id       uuid,
  created_by_member_id  uuid REFERENCES school_members(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CHECK ((starts_at IS NULL) = (ends_at IS NULL)),
  CHECK (starts_at IS NULL OR ends_at > starts_at),
  CHECK (
    CASE kind
      WHEN 'cancelled' THEN slot_id IS NOT NULL
      WHEN 'changed'   THEN slot_id IS NOT NULL AND (
                              subject_id IS NOT NULL OR teacher_member_id IS NOT NULL
                              OR room_id IS NOT NULL OR title IS NOT NULL OR starts_at IS NOT NULL)
      WHEN 'added'     THEN slot_id IS NULL AND starts_at IS NOT NULL
      WHEN 'day_off'   THEN slot_id IS NULL
    END
  ),
  FOREIGN KEY (class_id, school_id) REFERENCES classes (id, school_id) ON DELETE CASCADE,
  FOREIGN KEY (slot_id, class_id, school_id)
    REFERENCES timetable_slots (id, class_id, school_id) ON DELETE CASCADE,
  FOREIGN KEY (subject_id, school_id) REFERENCES subjects (id, school_id),
  FOREIGN KEY (room_id, school_id) REFERENCES rooms (id, school_id),
  FOREIGN KEY (teacher_member_id, school_id, teacher_role)
    REFERENCES school_members (id, school_id, role),
  UNIQUE (slot_id, exception_date)   -- FK vers events / announcements ajoutées plus bas
);
CREATE UNIQUE INDEX timetable_exceptions_day_off_uq
  ON timetable_exceptions (class_id, exception_date) WHERE kind = 'day_off';
CREATE INDEX timetable_exceptions_class_idx ON timetable_exceptions (class_id, exception_date);
CREATE INDEX timetable_exceptions_school_idx ON timetable_exceptions (school_id, exception_date);
CREATE INDEX timetable_exceptions_teacher_idx
  ON timetable_exceptions (teacher_member_id, exception_date) WHERE teacher_member_id IS NOT NULL;

-- Une exception sur un créneau doit tomber le bon jour de la semaine et
-- viser le créneau réellement en vigueur ce jour-là (bonne version).
CREATE OR REPLACE FUNCTION timetable_exceptions_validate() RETURNS trigger AS $$
DECLARE
  v_weekday smallint;
  v_version uuid;
  v_start   date;
  v_end     date;
BEGIN
  SELECT ay.starts_on, ay.ends_on INTO v_start, v_end
  FROM classes c
  JOIN academic_years ay ON ay.id = c.academic_year_id AND ay.school_id = c.school_id
  WHERE c.id = NEW.class_id;
  IF NEW.exception_date < v_start OR NEW.exception_date > v_end THEN
    RAISE EXCEPTION 'le % est hors de l''année scolaire de la classe (% au %)', NEW.exception_date, v_start, v_end;
  END IF;

  IF NEW.slot_id IS NOT NULL THEN
    SELECT weekday, version_id INTO v_weekday, v_version
    FROM timetable_slots WHERE id = NEW.slot_id;
    IF v_weekday <> extract(isodow FROM NEW.exception_date) THEN
      RAISE EXCEPTION 'le % ne tombe pas le bon jour de la semaine pour ce créneau', NEW.exception_date;
    END IF;
    IF v_version IS DISTINCT FROM timetable_version_on(NEW.class_id, NEW.exception_date) THEN
      RAISE EXCEPTION 'ce créneau n''est pas en vigueur le % (autre version d''horaire)', NEW.exception_date;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_timetable_exceptions_validate
  BEFORE INSERT OR UPDATE OF slot_id, class_id, exception_date ON timetable_exceptions
  FOR EACH ROW EXECUTE FUNCTION timetable_exceptions_validate();

-- Changer l'horaire à partir d'une date : crée un BROUILLON copié de la version
-- en vigueur ce jour-là (créneaux et verrous compris). On l'édite librement,
-- puis publish_timetable_version(). p_to NULL = jusqu'à nouvel ordre.
CREATE OR REPLACE FUNCTION fork_timetable_version(
  p_class_id uuid, p_from date, p_name text,
  p_kind text DEFAULT 'base', p_to date DEFAULT NULL
) RETURNS uuid AS $$
DECLARE
  v_school uuid;
  v_src    uuid;
  v_new    uuid;
BEGIN
  SELECT school_id INTO v_school FROM classes WHERE id = p_class_id;
  IF v_school IS NULL THEN
    RAISE EXCEPTION 'classe % introuvable', p_class_id;
  END IF;

  v_src := timetable_version_on(p_class_id, p_from);

  INSERT INTO timetable_versions (school_id, class_id, kind, name, effective_from, effective_to)
  VALUES (v_school, p_class_id, p_kind, p_name, p_from, p_to)
  RETURNING id INTO v_new;

  IF v_src IS NOT NULL THEN
    INSERT INTO timetable_slots (school_id, version_id, class_id, subject_id, teacher_member_id,
                                 room_id, title, weekday, starts_at, ends_at, is_locked)
    SELECT school_id, v_new, class_id, subject_id, teacher_member_id,
           room_id, title, weekday, starts_at, ends_at, is_locked
    FROM timetable_slots WHERE version_id = v_src;
  END IF;
  RETURN v_new;
END;
$$ LANGUAGE plpgsql;

-- Publie un brouillon dans une seule transaction : la version précédente du
-- même type est close la veille de la nouvelle date, puis la nouvelle est
-- publiée. Le passé reste intact. Refuse ce qui casserait l'historique.
CREATE OR REPLACE FUNCTION publish_timetable_version(p_version_id uuid)
RETURNS void AS $$
DECLARE
  v timetable_versions%ROWTYPE;
BEGIN
  SELECT * INTO v FROM timetable_versions WHERE id = p_version_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'version % introuvable', p_version_id;
  END IF;
  IF v.status <> 'draft' THEN
    RAISE EXCEPTION 'seul un brouillon peut être publié (statut actuel : %)', v.status;
  END IF;

  -- Une version publiée du même type commence déjà à cette date ou après
  IF EXISTS (
    SELECT 1 FROM timetable_versions o
    WHERE o.class_id = v.class_id AND o.kind = v.kind AND o.status = 'published'
      AND o.id <> v.id AND o.effective_from >= v.effective_from
      AND daterange(o.effective_from, o.effective_to, '[]')
          && daterange(v.effective_from, v.effective_to, '[]')
  ) THEN
    RAISE EXCEPTION 'une version publiée commence déjà à partir de cette date : archive-la ou change la date';
  END IF;

  -- La nouvelle version couperait une version existante en deux
  IF v.effective_to IS NOT NULL AND EXISTS (
    SELECT 1 FROM timetable_versions o
    WHERE o.class_id = v.class_id AND o.kind = v.kind AND o.status = 'published'
      AND o.id <> v.id AND o.effective_from < v.effective_from
      AND (o.effective_to IS NULL OR o.effective_to > v.effective_to)
  ) THEN
    RAISE EXCEPTION 'cette période couperait une version existante en deux : utilise une version saisonnière pour une période limitée';
  END IF;

  -- Clôture la version précédente la veille
  UPDATE timetable_versions o
     SET effective_to = v.effective_from - 1
   WHERE o.class_id = v.class_id AND o.kind = v.kind AND o.status = 'published'
     AND o.id <> v.id AND o.effective_from < v.effective_from
     AND (o.effective_to IS NULL OR o.effective_to >= v.effective_from);

  UPDATE timetable_versions
     SET status = 'published', published_at = now()
   WHERE id = v.id;

  -- Des exceptions datées visent-elles des créneaux qui ne seront plus en vigueur ?
  IF EXISTS (
    SELECT 1
    FROM timetable_exceptions e
    JOIN timetable_slots s ON s.id = e.slot_id
    WHERE e.class_id = v.class_id
      AND s.version_id IS DISTINCT FROM timetable_version_on(e.class_id, e.exception_date)
  ) THEN
    RAISE EXCEPTION 'des exceptions datées visent des créneaux qui ne seront plus en vigueur : supprime-les ou recrée-les sur la nouvelle version';
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Journée réelle d'une classe : trame de la version en vigueur + exceptions.
-- status : scheduled | cancelled | changed | added | day_off
-- room_id = salle effective : exception > créneau > salle de la matière > salle de la classe.
CREATE OR REPLACE FUNCTION timetable_day(p_class_id uuid, p_date date)
RETURNS TABLE (
  slot_id uuid, exception_id uuid, status text,
  subject_id uuid, teacher_member_id uuid, room_id uuid, title text,
  starts_at time, ends_at time, reason_code text, reason text
) AS $$
  SELECT * FROM (
    -- séances de la trame (éventuellement annulées ou modifiées)
    SELECT s.id AS slot_id, e.id AS exception_id,
           CASE e.kind WHEN 'cancelled' THEN 'cancelled'
                       WHEN 'changed'   THEN 'changed'
                       ELSE 'scheduled' END AS status,
           COALESCE(e.subject_id, s.subject_id)             AS subject_id,
           COALESCE(e.teacher_member_id, s.teacher_member_id) AS teacher_member_id,
           COALESCE(e.room_id, s.room_id, sb.room_id, cl.home_room_id) AS room_id,
           COALESCE(e.title, s.title)                       AS title,
           COALESCE(e.starts_at, s.starts_at)               AS starts_at,
           COALESCE(e.ends_at, s.ends_at)                   AS ends_at,
           e.reason_code, e.reason
    FROM timetable_slots s
    JOIN classes cl ON cl.id = s.class_id AND cl.school_id = s.school_id
    LEFT JOIN timetable_exceptions e
           ON e.slot_id = s.id AND e.exception_date = p_date
    LEFT JOIN subjects sb
           ON sb.id = COALESCE(e.subject_id, s.subject_id) AND sb.school_id = s.school_id
    WHERE s.version_id = timetable_version_on(p_class_id, p_date)
      AND s.weekday = extract(isodow FROM p_date)
      AND NOT EXISTS (SELECT 1 FROM timetable_exceptions d
                      WHERE d.class_id = p_class_id AND d.exception_date = p_date
                        AND d.kind = 'day_off')
    UNION ALL
    -- séances ajoutées
    SELECT NULL::uuid, e.id, 'added', e.subject_id, e.teacher_member_id,
           COALESCE(e.room_id, sb.room_id, cl.home_room_id),
           e.title, e.starts_at, e.ends_at, e.reason_code, e.reason
    FROM timetable_exceptions e
    JOIN classes cl ON cl.id = e.class_id AND cl.school_id = e.school_id
    LEFT JOIN subjects sb ON sb.id = e.subject_id AND sb.school_id = e.school_id
    WHERE e.class_id = p_class_id AND e.exception_date = p_date AND e.kind = 'added'
      AND NOT EXISTS (SELECT 1 FROM timetable_exceptions d
                      WHERE d.class_id = p_class_id AND d.exception_date = p_date
                        AND d.kind = 'day_off')
    UNION ALL
    -- classe fermée toute la journée
    SELECT NULL::uuid, e.id, 'day_off', NULL::uuid, NULL::uuid, NULL::uuid,
           e.title, NULL::time, NULL::time, e.reason_code, e.reason
    FROM timetable_exceptions e
    WHERE e.class_id = p_class_id AND e.exception_date = p_date AND e.kind = 'day_off'
  ) t
  ORDER BY t.starts_at NULLS FIRST, t.slot_id;
$$ LANGUAGE sql STABLE;

-- Salles utilisées par deux classes en même temps, sur une période (max 366 jours,
-- au-delà : erreur explicite plutôt qu'un résultat vide trompeur).
-- S'appuie sur les salles effectives (timetable_day) : horaires, exceptions et
-- salles de matière comprises. Une ligne par conflit récurrent (même salle, mêmes
-- classes, même jour de semaine et même créneau), avec ses dates extrêmes.
CREATE OR REPLACE FUNCTION room_double_bookings(p_school_id uuid, p_from date, p_to date)
RETURNS TABLE (
  room_id uuid, class_a uuid, class_b uuid, weekday smallint,
  starts_at time, ends_at time, first_date date, last_date date, occurrences int
) AS $$
#variable_conflict use_column
BEGIN
  IF p_to - p_from > 366 THEN
    RAISE EXCEPTION 'période trop longue (maximum 366 jours)';
  END IF;
  RETURN QUERY
  WITH dates AS (
    SELECT g::date AS on_date FROM generate_series(p_from, p_to, interval '1 day') AS g
  ),
  day AS (
    SELECT dt.on_date, c.id AS class_id, x.room_id, x.starts_at, x.ends_at
    FROM dates dt
    JOIN classes c ON c.school_id = p_school_id
    CROSS JOIN LATERAL timetable_day(c.id, dt.on_date) x
    WHERE x.room_id IS NOT NULL AND x.status IN ('scheduled', 'changed', 'added')
  )
  SELECT a.room_id, a.class_id, b.class_id,
         extract(isodow FROM a.on_date)::smallint,
         GREATEST(a.starts_at, b.starts_at), LEAST(a.ends_at, b.ends_at),
         min(a.on_date), max(a.on_date), count(*)::int
  FROM day a
  JOIN day b ON b.on_date = a.on_date AND b.room_id = a.room_id
            AND a.class_id < b.class_id
            AND a.starts_at < b.ends_at AND b.starts_at < a.ends_at
  GROUP BY a.room_id, a.class_id, b.class_id, extract(isodow FROM a.on_date),
           GREATEST(a.starts_at, b.starts_at), LEAST(a.ends_at, b.ends_at)
  ORDER BY 4, 5, 1;
END;
$$ LANGUAGE plpgsql STABLE;

-- Journée d'un professeur (remplacements compris, séances annulées exclues).
-- Sert aussi à vérifier qu'un remplaçant n'enseigne pas déjà ailleurs.
CREATE OR REPLACE FUNCTION teacher_day(p_teacher_member_id uuid, p_date date)
RETURNS TABLE (
  class_id uuid, slot_id uuid, exception_id uuid, status text,
  subject_id uuid, room_id uuid, title text, starts_at time, ends_at time
) AS $$
  SELECT c.id, d.slot_id, d.exception_id, d.status,
         d.subject_id, d.room_id, d.title, d.starts_at, d.ends_at
  FROM school_members m
  JOIN classes c ON c.school_id = m.school_id
  CROSS JOIN LATERAL timetable_day(c.id, p_date) d
  WHERE m.id = p_teacher_member_id
    AND d.teacher_member_id = p_teacher_member_id
    AND d.status IN ('scheduled', 'changed', 'added')
  ORDER BY d.starts_at;
$$ LANGUAGE sql STABLE;

-- Fermeture de toute l'école un jour donné (férié, grève...) :
-- un 'day_off' par classe de l'année scolaire qui contient cette date
-- (l'année en cours ou la suivante). Retourne le nombre créé.
CREATE OR REPLACE FUNCTION close_school_on(
  p_school_id uuid, p_date date, p_reason text DEFAULT NULL,
  p_reason_code text DEFAULT 'holiday'
) RETURNS int AS $$
DECLARE
  v_count int;
BEGIN
  INSERT INTO timetable_exceptions (school_id, class_id, exception_date, kind, reason_code, reason)
  SELECT c.school_id, c.id, p_date, 'day_off', p_reason_code, p_reason
  FROM classes c
  JOIN academic_years ay
    ON ay.id = c.academic_year_id AND ay.school_id = c.school_id
   AND p_date BETWEEN ay.starts_on AND ay.ends_on
  WHERE c.school_id = p_school_id
  ON CONFLICT (class_id, exception_date) WHERE kind = 'day_off' DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------
-- 6. Devoirs (texte pur pour l'instant)
-- ---------------------------------------------------------------------
CREATE TABLE homework (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id         uuid NOT NULL,
  class_id          uuid NOT NULL,
  subject_id        uuid,
  author_member_id  uuid NOT NULL,
  author_role       text NOT NULL DEFAULT 'teacher' CHECK (author_role = 'teacher'),
  title             text NOT NULL,
  body              text NOT NULL,
  assigned_on       date NOT NULL DEFAULT current_date,
  due_on            date,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (due_on IS NULL OR due_on >= assigned_on),
  FOREIGN KEY (class_id, school_id) REFERENCES classes (id, school_id) ON DELETE CASCADE,
  FOREIGN KEY (subject_id, school_id) REFERENCES subjects (id, school_id),
  FOREIGN KEY (author_member_id, school_id, author_role)
    REFERENCES school_members (id, school_id, role)
);
CREATE INDEX homework_class_idx ON homework (class_id, assigned_on DESC);

-- ---------------------------------------------------------------------
-- 7. Événements et annonces aux parents
-- ---------------------------------------------------------------------
CREATE TABLE events (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id             uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  title                 text NOT NULL,
  description           text,
  kind                  text NOT NULL DEFAULT 'other'
                        CHECK (kind IN ('outing', 'party', 'meeting', 'holiday', 'exam', 'other')),
  starts_at             timestamptz NOT NULL,
  ends_at               timestamptz,
  all_day               boolean NOT NULL DEFAULT false,
  location              text,
  needs_preparation     boolean NOT NULL DEFAULT false,  -- tenue, goûter, etc.
  preparation_notes     text,                            -- 'Tenue de sport + casquette'
  created_by_member_id  uuid REFERENCES school_members(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at IS NULL OR ends_at >= starts_at),
  UNIQUE (id, school_id)
);
CREATE INDEX events_school_start_idx ON events (school_id, starts_at);

-- Ciblage : aucune ligne = toute l'école ; sinon une ligne par classe OU nœud
-- (résolution en classes : classes_under_node)
CREATE TABLE event_targets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id   uuid NOT NULL,
  event_id    uuid NOT NULL,
  class_id    uuid,
  node_id     uuid,                             -- inclut tous les descendants
  CHECK ((class_id IS NOT NULL)::int + (node_id IS NOT NULL)::int = 1),
  FOREIGN KEY (event_id, school_id) REFERENCES events (id, school_id) ON DELETE CASCADE,
  FOREIGN KEY (class_id, school_id) REFERENCES classes (id, school_id) ON DELETE CASCADE,
  FOREIGN KEY (node_id, school_id) REFERENCES curriculum_nodes (id, school_id) ON DELETE CASCADE,
  UNIQUE (event_id, class_id),
  UNIQUE (event_id, node_id)
);

CREATE TABLE announcements (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id         uuid NOT NULL,
  author_member_id  uuid NOT NULL REFERENCES school_members(id),
  event_id          uuid,                         -- annonce liée à un événement (optionnel)
  title             text NOT NULL,
  body              text NOT NULL,
  priority          text NOT NULL DEFAULT 'normal'
                    CHECK (priority IN ('normal', 'important', 'urgent')),
  status            text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  published_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE,
  FOREIGN KEY (event_id, school_id) REFERENCES events (id, school_id) ON DELETE SET NULL (event_id),
  UNIQUE (id, school_id)
);
CREATE INDEX announcements_school_pub_idx ON announcements (school_id, published_at DESC);

-- Liens des exceptions d'horaire vers l'événement (sortie) et l'annonce aux
-- parents (tables définies après timetable_exceptions, d'où l'ALTER)
ALTER TABLE timetable_exceptions
  ADD FOREIGN KEY (event_id, school_id)
    REFERENCES events (id, school_id) ON DELETE SET NULL (event_id),
  ADD FOREIGN KEY (announcement_id, school_id)
    REFERENCES announcements (id, school_id) ON DELETE SET NULL (announcement_id);

CREATE TABLE announcement_targets (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id        uuid NOT NULL,
  announcement_id  uuid NOT NULL,
  class_id         uuid,
  node_id          uuid,                        -- inclut tous les descendants
  CHECK ((class_id IS NOT NULL)::int + (node_id IS NOT NULL)::int = 1),
  FOREIGN KEY (announcement_id, school_id)
    REFERENCES announcements (id, school_id) ON DELETE CASCADE,
  FOREIGN KEY (class_id, school_id) REFERENCES classes (id, school_id) ON DELETE CASCADE,
  FOREIGN KEY (node_id, school_id) REFERENCES curriculum_nodes (id, school_id) ON DELETE CASCADE,
  UNIQUE (announcement_id, class_id),
  UNIQUE (announcement_id, node_id)
);

-- Une ligne par destinataire et par canal : ajouter un canal = ajouter une valeur
CREATE TABLE notifications (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id            uuid NOT NULL,
  announcement_id      uuid NOT NULL,
  recipient_user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel              text NOT NULL
                       CHECK (channel IN ('in_app', 'push', 'whatsapp', 'sms', 'email')),
  status               text NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'sent', 'delivered', 'read', 'failed')),
  provider_message_id  text,
  error                text,
  sent_at              timestamptz,
  read_at              timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (announcement_id, school_id)
    REFERENCES announcements (id, school_id) ON DELETE CASCADE,
  UNIQUE (announcement_id, recipient_user_id, channel)
);
CREATE INDEX notifications_recipient_idx ON notifications (recipient_user_id, status);

-- ---------------------------------------------------------------------
-- 8. Suivi des paiements (sans facturation ni paiement en ligne)
-- ---------------------------------------------------------------------
-- Tarifs (modèles) : sert à générer les échéances
CREATE TABLE fee_plans (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id         uuid NOT NULL,
  academic_year_id  uuid NOT NULL,
  node_id           uuid,                         -- NULL = toute l'école ; sinon ce nœud et ses descendants
  name              text NOT NULL,                -- 'Scolarité mensuelle'
  amount            numeric(12,2) NOT NULL CHECK (amount >= 0),
  frequency         text NOT NULL
                    CHECK (frequency IN ('monthly', 'quarterly', 'yearly', 'one_time')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE,
  FOREIGN KEY (academic_year_id, school_id) REFERENCES academic_years (id, school_id),
  FOREIGN KEY (node_id, school_id) REFERENCES curriculum_nodes (id, school_id),
  UNIQUE (id, school_id)
);

-- Échéances par élève : ce qui doit être payé
CREATE TABLE fee_installments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id         uuid NOT NULL,
  student_id        uuid NOT NULL,
  academic_year_id  uuid NOT NULL,
  fee_plan_id       uuid,
  label             text NOT NULL,                -- 'Septembre 2026'
  amount_due        numeric(12,2) NOT NULL CHECK (amount_due >= 0),
  due_on            date NOT NULL,
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (student_id, school_id) REFERENCES students (id, school_id) ON DELETE CASCADE,
  FOREIGN KEY (academic_year_id, school_id) REFERENCES academic_years (id, school_id),
  FOREIGN KEY (fee_plan_id, school_id) REFERENCES fee_plans (id, school_id),
  UNIQUE (id, school_id)
);
CREATE INDEX fee_installments_student_idx ON fee_installments (student_id);
CREATE INDEX fee_installments_due_idx ON fee_installments (school_id, due_on);

-- Encaissements : permet paiements partiels et plusieurs versements
CREATE TABLE payments (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id             uuid NOT NULL,
  installment_id        uuid NOT NULL,
  amount                numeric(12,2) NOT NULL CHECK (amount > 0),
  paid_on               date NOT NULL DEFAULT current_date,
  method                text NOT NULL DEFAULT 'cash'
                        CHECK (method IN ('cash', 'bank_transfer', 'cheque', 'card', 'other')),
  reference             text,                     -- n° de chèque, de virement...
  note                  text,
  recorded_by_member_id uuid REFERENCES school_members(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (installment_id, school_id)
    REFERENCES fee_installments (id, school_id) ON DELETE CASCADE
);
CREATE INDEX payments_installment_idx ON payments (installment_id);

-- Vue : qui a payé ou pas (statut calculé, jamais stocké)
CREATE VIEW installment_balances AS
SELECT
  i.id,
  i.school_id,
  i.student_id,
  i.academic_year_id,
  i.label,
  i.due_on,
  i.amount_due,
  COALESCE(SUM(p.amount), 0)                       AS amount_paid,
  i.amount_due - COALESCE(SUM(p.amount), 0)        AS amount_remaining,
  CASE
    WHEN i.status = 'cancelled'                    THEN 'cancelled'
    WHEN COALESCE(SUM(p.amount), 0) >= i.amount_due THEN 'paid'
    WHEN i.due_on < current_date                   THEN 'overdue'
    WHEN COALESCE(SUM(p.amount), 0) > 0            THEN 'partial'
    ELSE 'pending'
  END AS payment_status
FROM fee_installments i
LEFT JOIN payments p ON p.installment_id = i.id
GROUP BY i.id;

-- ---------------------------------------------------------------------
-- 8ter. Remplacer le professeur d'une classe pour le reste de l'année
-- ---------------------------------------------------------------------
-- Aperçu (lecture seule) : qu'est-ce qui poserait problème si p_new_teacher
-- reprenait, à partir de p_from, les créneaux de p_old_teacher dans la classe ?
--   busy        : il/elle enseigne déjà dans une autre classe à ce moment  (bloquant)
--   unavailable : indisponibilité 'blocked' (bloquant) ou 'avoid' (avertissement)
-- Conservateur : peut signaler un conflit qui n'existerait que sous un horaire
-- saisonnier masqué. p_subject_id NULL = toutes les matières de l'ancien prof.
CREATE OR REPLACE FUNCTION teacher_replacement_conflicts(
  p_class_id uuid, p_old_teacher uuid, p_new_teacher uuid, p_from date,
  p_subject_id uuid DEFAULT NULL
) RETURNS TABLE (
  conflict text, severity text, slot_id uuid, weekday smallint,
  starts_at time, ends_at time, other_class_id uuid, detail text
) AS $$
  WITH affected AS (
    SELECT s.id AS slot_id, s.weekday, s.starts_at, s.ends_at,
           daterange(GREATEST(v.effective_from, p_from), v.effective_to, '[]') AS win
    FROM timetable_slots s
    JOIN timetable_versions v ON v.id = s.version_id
    WHERE s.class_id = p_class_id
      AND v.status = 'published'
      AND s.teacher_member_id = p_old_teacher
      AND (p_subject_id IS NULL OR s.subject_id = p_subject_id)
      AND COALESCE(v.effective_to, 'infinity'::date) >= p_from
  )
  SELECT * FROM (
    SELECT 'busy'::text AS conflict, 'blocking'::text AS severity,
           a.slot_id, a.weekday, a.starts_at, a.ends_at, o.class_id AS other_class_id,
           ('enseigne déjà à ' || c.name || ' de ' || to_char(o.starts_at, 'HH24:MI')
            || ' à ' || to_char(o.ends_at, 'HH24:MI'))::text AS detail
    FROM affected a
    JOIN timetable_slots o
      ON o.teacher_member_id = p_new_teacher
     AND o.class_id <> p_class_id
     AND o.weekday = a.weekday
     AND o.starts_at < a.ends_at AND a.starts_at < o.ends_at
    JOIN timetable_versions ov
      ON ov.id = o.version_id AND ov.status = 'published'
     AND daterange(ov.effective_from, ov.effective_to, '[]') && a.win
    JOIN classes c ON c.id = o.class_id
    UNION ALL
    SELECT 'unavailable'::text,
           (CASE u.kind WHEN 'blocked' THEN 'blocking' ELSE 'warning' END)::text,
           a.slot_id, a.weekday, a.starts_at, a.ends_at, NULL::uuid,
           (CASE u.kind WHEN 'blocked' THEN 'indisponible sur ce créneau'
                        ELSE 'préfère éviter ce créneau' END
            || COALESCE(' (' || u.reason || ')', ''))::text
    FROM affected a
    JOIN teacher_unavailability u
      ON u.teacher_member_id = p_new_teacher
     AND u.weekday = a.weekday
     AND u.starts_at < a.ends_at AND a.starts_at < u.ends_at
     AND daterange(u.valid_from, u.valid_to, '[]') && a.win
  ) t
  ORDER BY t.weekday, t.starts_at, t.conflict;
$$ LANGUAGE sql STABLE;

-- Remplace p_old_teacher par p_new_teacher dans la classe à partir de p_from,
-- en une transaction (tout ou rien). Retourne le nombre de créneaux repris.
--  * refuse s'il y a des conflits bloquants (sauf p_ignore_conflicts) ;
--  * horaire en vigueur qui chevauche p_from : nouvelle version dès p_from,
--    l'ancienne est close la veille (le passé garde l'ancien prof) ;
--  * horaire entièrement postérieur (ex : Ramadan à venir) : créneaux mis à jour ;
--  * affectations : ancienne ligne close la veille, nouvelle ouverte dès p_from ;
--  * refuse si des exceptions datées visent les anciens créneaux (à recréer).
-- p_subject_id : ne remplacer que cette matière.
-- Ne notifie pas les parents : c'est à l'application de créer l'annonce.
CREATE OR REPLACE FUNCTION replace_class_teacher(
  p_class_id uuid, p_old_teacher uuid, p_new_teacher uuid, p_from date,
  p_subject_id uuid DEFAULT NULL, p_ignore_conflicts boolean DEFAULT false
) RETURNS int AS $$
DECLARE
  v_school      uuid;
  v_start       date;
  v_end         date;
  v_blocking    int;
  v_affected    int;
  v_changed     int := 0;
  v_n           int;
  v             timetable_versions%ROWTYPE;
  v_new_version uuid;
  a             teaching_assignments%ROWTYPE;
  v_new_from    date;
BEGIN
  IF p_old_teacher = p_new_teacher THEN
    RAISE EXCEPTION 'l''ancien et le nouveau professeur sont identiques';
  END IF;

  SELECT c.school_id, ay.starts_on, ay.ends_on INTO v_school, v_start, v_end
  FROM classes c
  JOIN academic_years ay ON ay.id = c.academic_year_id AND ay.school_id = c.school_id
  WHERE c.id = p_class_id;
  IF v_school IS NULL THEN
    RAISE EXCEPTION 'classe % introuvable', p_class_id;
  END IF;
  IF p_from < v_start OR p_from > v_end THEN
    RAISE EXCEPTION 'le % est hors de l''année scolaire de la classe (% au %)', p_from, v_start, v_end;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM school_members
                 WHERE id = p_old_teacher AND school_id = v_school AND role = 'teacher') THEN
    RAISE EXCEPTION 'l''ancien professeur n''est pas un professeur de cette école';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM school_members
                 WHERE id = p_new_teacher AND school_id = v_school AND role = 'teacher') THEN
    RAISE EXCEPTION 'le nouveau professeur n''est pas un professeur de cette école';
  END IF;

  SELECT count(*) INTO v_affected
  FROM timetable_slots s
  JOIN timetable_versions tv ON tv.id = s.version_id
  WHERE s.class_id = p_class_id AND tv.status = 'published'
    AND s.teacher_member_id = p_old_teacher
    AND (p_subject_id IS NULL OR s.subject_id = p_subject_id)
    AND COALESCE(tv.effective_to, 'infinity'::date) >= p_from;
  IF v_affected = 0 THEN
    RAISE EXCEPTION 'aucun créneau de ce professeur à remplacer à partir du %', p_from;
  END IF;

  IF NOT p_ignore_conflicts THEN
    SELECT count(*) INTO v_blocking
    FROM teacher_replacement_conflicts(p_class_id, p_old_teacher, p_new_teacher, p_from, p_subject_id)
    WHERE severity = 'blocking';
    IF v_blocking > 0 THEN
      RAISE EXCEPTION '% conflit(s) bloquant(s) pour le nouveau professeur : voir teacher_replacement_conflicts(), ou forcer avec p_ignore_conflicts', v_blocking;
    END IF;
  END IF;

  -- Horaires publiés concernés, du plus ancien au plus récent
  FOR v IN
    SELECT tv.* FROM timetable_versions tv
    WHERE tv.class_id = p_class_id AND tv.status = 'published'
      AND COALESCE(tv.effective_to, 'infinity'::date) >= p_from
      AND EXISTS (SELECT 1 FROM timetable_slots s
                  WHERE s.version_id = tv.id AND s.teacher_member_id = p_old_teacher
                    AND (p_subject_id IS NULL OR s.subject_id = p_subject_id))
    ORDER BY tv.effective_from
  LOOP
    SELECT count(*) INTO v_n
    FROM timetable_slots s
    WHERE s.version_id = v.id AND s.teacher_member_id = p_old_teacher
      AND (p_subject_id IS NULL OR s.subject_id = p_subject_id);

    IF v.effective_from >= p_from THEN
      -- version entièrement dans la période : on met simplement les créneaux à jour
      UPDATE timetable_slots
         SET teacher_member_id = p_new_teacher
       WHERE version_id = v.id AND teacher_member_id = p_old_teacher
         AND (p_subject_id IS NULL OR subject_id = p_subject_id);
    ELSE
      -- version à cheval sur p_from : copie dès p_from avec le nouveau prof
      INSERT INTO timetable_versions (school_id, class_id, kind, name, effective_from, effective_to)
      VALUES (v.school_id, v.class_id, v.kind,
              'Changement de professeur dès le ' || to_char(p_from, 'DD/MM/YYYY'),
              p_from, v.effective_to)
      RETURNING id INTO v_new_version;

      INSERT INTO timetable_slots (school_id, version_id, class_id, subject_id, teacher_member_id,
                                   room_id, title, weekday, starts_at, ends_at, is_locked)
      SELECT s.school_id, v_new_version, s.class_id, s.subject_id,
             CASE WHEN s.teacher_member_id = p_old_teacher
                   AND (p_subject_id IS NULL OR s.subject_id = p_subject_id)
                  THEN p_new_teacher ELSE s.teacher_member_id END,
             s.room_id, s.title, s.weekday, s.starts_at, s.ends_at, s.is_locked
      FROM timetable_slots s WHERE s.version_id = v.id;

      PERFORM publish_timetable_version(v_new_version);
    END IF;
    v_changed := v_changed + v_n;
  END LOOP;

  -- Affectations : l'ancien prof s'arrête la veille, le nouveau commence à p_from
  FOR a IN
    SELECT * FROM teaching_assignments
    WHERE class_id = p_class_id AND teacher_member_id = p_old_teacher
      AND (p_subject_id IS NULL OR subject_id = p_subject_id)
      AND (valid_to IS NULL OR valid_to >= p_from)
  LOOP
    IF a.valid_from < p_from OR (a.valid_from IS NULL AND p_from > v_start) THEN
      UPDATE teaching_assignments SET valid_to = p_from - 1 WHERE id = a.id;
      v_new_from := p_from;
    ELSE
      DELETE FROM teaching_assignments WHERE id = a.id;
      v_new_from := a.valid_from;
    END IF;
    INSERT INTO teaching_assignments (school_id, class_id, subject_id, teacher_member_id,
                                      kind, valid_from, valid_to)
    VALUES (a.school_id, a.class_id, a.subject_id, p_new_teacher, a.kind, v_new_from, a.valid_to)
    ON CONFLICT DO NOTHING;   -- le nouveau prof est déjà affecté sur cette période
  END LOOP;

  RETURN v_changed;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------
-- 8bis. Année scolaire : bascule et préparation de l'année suivante
-- ---------------------------------------------------------------------
-- Applique à une année scolaire les heures par défaut d'un modèle de programme
-- (l'école doit déjà avoir instancié l'arbre du même modèle).
--  * les matières manquantes sont créées ; une matière existante est retrouvée
--    par son code, sinon par son nom (pas de doublon) ;
--  * les heures déjà présentes pour (année, nœud, matière) ne sont jamais écrasées ;
--  * p_only_under : codes de nœuds à traiter avec leurs descendants (ex : {PRESCO,PRIM}),
--    NULL = tout le modèle.
-- Les lignes créées gardent le statut du modèle (proposed / to_verify) : l'école les confirme.
-- Retourne le nombre de lignes d'heures créées.
-- Lignes du modèle qui s'appliquent à une école : nœud retrouvé par son code,
-- limité aux branches demandées (p_only_under = codes de nœuds, descendants inclus).
CREATE OR REPLACE FUNCTION _template_hours_selection(
  p_school_id uuid, p_template_code text, p_only_under text[]
) RETURNS TABLE (
  node_id uuid, subject_code text, subject_name text, weekly_minutes int,
  min_session_minutes int, max_session_minutes int, max_sessions_per_day smallint, status text
) AS $$
  SELECT n.id, h.subject_code, h.subject_name, h.weekly_minutes,
         h.min_session_minutes, h.max_session_minutes, h.max_sessions_per_day, h.status
  FROM curriculum_template_hours h
  JOIN curriculum_nodes n ON n.school_id = p_school_id AND n.code = h.node_code
  WHERE h.template_code = p_template_code
    AND (p_only_under IS NULL OR EXISTS (
          SELECT 1 FROM curriculum_nodes r
          WHERE r.school_id = p_school_id AND r.code = ANY (p_only_under) AND r.id = ANY (n.path)));
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION apply_curriculum_template_hours(
  p_school_id uuid, p_academic_year_id uuid, p_template_code text,
  p_only_under text[] DEFAULT NULL
) RETURNS int AS $$
DECLARE
  v_count int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM academic_years
                 WHERE id = p_academic_year_id AND school_id = p_school_id) THEN
    RAISE EXCEPTION 'année scolaire % introuvable pour cette école', p_academic_year_id;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM curriculum_template_hours WHERE template_code = p_template_code) THEN
    RAISE EXCEPTION 'aucune heure par défaut pour le modèle %', p_template_code;
  END IF;

  -- matières utilisées par les lignes retenues et absentes de l'école
  INSERT INTO subjects (school_id, name, code)
  SELECT DISTINCT ON (sel.subject_code) p_school_id, sel.subject_name, sel.subject_code
  FROM _template_hours_selection(p_school_id, p_template_code, p_only_under) sel
  WHERE NOT EXISTS (SELECT 1 FROM subjects s
                    WHERE s.school_id = p_school_id
                      AND (s.code = sel.subject_code OR s.name = sel.subject_name))
  ORDER BY sel.subject_code;

  INSERT INTO node_subject_hours (school_id, academic_year_id, node_id, subject_id,
                                  weekly_minutes, min_session_minutes, max_session_minutes,
                                  max_sessions_per_day, status)
  SELECT p_school_id, p_academic_year_id, sel.node_id, sb.id,
         sel.weekly_minutes, sel.min_session_minutes, sel.max_session_minutes,
         sel.max_sessions_per_day, sel.status
  FROM _template_hours_selection(p_school_id, p_template_code, p_only_under) sel
  JOIN LATERAL (
    SELECT s.id FROM subjects s
    WHERE s.school_id = p_school_id
      AND (s.code = sel.subject_code OR s.name = sel.subject_name)
    ORDER BY (s.code = sel.subject_code) DESC
    LIMIT 1
  ) sb ON true
  ON CONFLICT (academic_year_id, node_id, subject_id) DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- Passe une année en « année en cours » (l'ancienne cesse de l'être, atomiquement)
CREATE OR REPLACE FUNCTION set_current_academic_year(p_year_id uuid) RETURNS void AS $$
DECLARE
  v_school uuid;
BEGIN
  SELECT school_id INTO v_school FROM academic_years WHERE id = p_year_id;
  IF v_school IS NULL THEN
    RAISE EXCEPTION 'année scolaire % introuvable', p_year_id;
  END IF;
  UPDATE academic_years SET is_current = false
   WHERE school_id = v_school AND is_current AND id <> p_year_id;
  UPDATE academic_years SET is_current = true WHERE id = p_year_id;
END;
$$ LANGUAGE plpgsql;

-- Prépare l'année N+1 à partir d'une année existante : recopie les heures par
-- matière, les tarifs et (option) les classes, sans toucher à l'année source.
-- Ne copie PAS les inscriptions (passage des élèves = étape séparée, guidée
-- par node_progressions), ni les horaires (à régénérer pour la nouvelle année).
-- La nouvelle année n'est pas « en cours » : voir set_current_academic_year().
CREATE OR REPLACE FUNCTION roll_over_academic_year(
  p_from_year_id uuid, p_name text, p_starts_on date, p_ends_on date,
  p_copy_classes boolean DEFAULT true
) RETURNS uuid AS $$
DECLARE
  v_school uuid;
  v_new    uuid;
BEGIN
  SELECT school_id INTO v_school FROM academic_years WHERE id = p_from_year_id;
  IF v_school IS NULL THEN
    RAISE EXCEPTION 'année scolaire % introuvable', p_from_year_id;
  END IF;

  INSERT INTO academic_years (school_id, name, starts_on, ends_on)
  VALUES (v_school, p_name, p_starts_on, p_ends_on)
  RETURNING id INTO v_new;

  INSERT INTO node_subject_hours (school_id, academic_year_id, node_id, subject_id,
                                  weekly_minutes, min_session_minutes,
                                  max_session_minutes, max_sessions_per_day, status)
  SELECT school_id, v_new, node_id, subject_id,
         weekly_minutes, min_session_minutes, max_session_minutes, max_sessions_per_day, status
  FROM node_subject_hours WHERE academic_year_id = p_from_year_id;

  INSERT INTO fee_plans (school_id, academic_year_id, node_id, name, amount, frequency)
  SELECT school_id, v_new, node_id, name, amount, frequency
  FROM fee_plans WHERE academic_year_id = p_from_year_id;

  IF p_copy_classes THEN
    INSERT INTO classes (school_id, academic_year_id, node_id, name, capacity, home_room_id, metadata)
    SELECT school_id, v_new, node_id, name, capacity, home_room_id, metadata
    FROM classes WHERE academic_year_id = p_from_year_id;
  END IF;

  RETURN v_new;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------
-- 9. Triggers updated_at (appliqués automatiquement à toute table qui a la colonne)
-- ---------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables tb
      ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND c.column_name = 'updated_at'
      AND tb.table_type = 'BASE TABLE'
  LOOP
    EXECUTE format(
      'CREATE TRIGGER trg_%I_updated_at BEFORE UPDATE ON %I
       FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t, t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 10. Sécurité multi-tenant (à activer selon ton backend)
-- Exemple RLS pour Supabase / Postgres : chaque requête pose l'école courante
--   SET app.current_school_id = '<uuid>';
--
-- ALTER TABLE students ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY tenant_isolation ON students
--   USING (school_id = current_setting('app.current_school_id')::uuid);
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- 11. Extensions prévues (pas dans le MVP maternelle)
--   attendance_records     absences / retards par élève et par séance
--   assessments, grades    évaluations et notes (collège / lycée)
--   invoices, invoice_items facturation (s'appuie sur fee_installments)
--   attachments            pièces jointes (devoirs, annonces) via stockage objet
--   user_channels          préférences de canal par utilisateur (WhatsApp > push)
--   student_groups         sous-groupes d'élèves dans une classe (LV2, options)
--   teacher_absences       absences ponctuelles de profs (datées) + remplaçant
--   teacher_profiles       matières maîtrisées et heures max par semaine (solveur)
--   audit_log              qui a modifié quoi
--   -> activer chaque module via school_modules
-- ---------------------------------------------------------------------
