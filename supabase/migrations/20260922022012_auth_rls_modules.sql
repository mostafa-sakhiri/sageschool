-- =====================================================================
-- Auth <-> users, helpers RLS, modules ajoutés (absences, réclamations,
-- boîte d'envoi des notifications simulées) et politiques RLS.
--
-- Le schéma socle (migration précédente) n'est PAS modifié : tout ici est
-- additif (nouvelles tables, nouvelles fonctions, ALTER VIEW security_invoker,
-- ENABLE RLS). Voir DECISIONS.md.
--
-- Modèle de droits (RLS = source de vérité) :
--   admin   : tout dans son école (structure, équipe, emplois du temps...)
--   staff   : secrétariat — élèves, parents, inscriptions, paiements,
--             exceptions, annonces, réclamations, absences ; lecture du reste
--   teacher : ses classes (affectation ou créneau publié) et leurs élèves
--   parent  : ses enfants (student_guardians) et leurs classes
--   student : lui-même (students.member_id) et sa classe, lecture seule
-- =====================================================================

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM public;
GRANT USAGE ON SCHEMA private TO authenticated;

-- ---------------------------------------------------------------------
-- 1. Lien Supabase Auth -> public.users
-- ---------------------------------------------------------------------
-- users.auth_provider_id porte auth.users.id. Si l'école a pré-créé la fiche
-- (même e-mail), le compte s'y rattache au lieu d'en créer une seconde.
CREATE OR REPLACE FUNCTION private.handle_new_auth_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.users (email, full_name, locale, status, auth_provider_id)
  VALUES (
    NEW.email,
    COALESCE(NULLIF(NEW.raw_user_meta_data->>'full_name', ''), split_part(NEW.email, '@', 1)),
    COALESCE(NULLIF(NEW.raw_user_meta_data->>'locale', ''), 'fr'),
    'active',
    NEW.id::text
  )
  ON CONFLICT ((lower(email))) WHERE email IS NOT NULL
  DO UPDATE SET auth_provider_id = EXCLUDED.auth_provider_id, status = 'active';
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION private.handle_new_auth_user();

CREATE UNIQUE INDEX users_auth_provider_uq ON public.users (auth_provider_id)
  WHERE auth_provider_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- 2. Helpers (SECURITY DEFINER, schéma non exposé : évitent la récursion RLS)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.current_user_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT u.id FROM public.users u
  WHERE u.auth_provider_id = (SELECT auth.uid())::text AND u.status <> 'disabled';
$$;

-- Adhésions actives de l'utilisateur courant (école active), filtrables par rôle
CREATE OR REPLACE FUNCTION private.my_member_ids(p_role text DEFAULT NULL) RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT m.id
  FROM public.school_members m
  JOIN public.schools s ON s.id = m.school_id AND s.is_active
  WHERE m.user_id = private.current_user_id()
    AND m.status = 'active'
    AND (p_role IS NULL OR m.role = p_role);
$$;

CREATE OR REPLACE FUNCTION private.is_school_member(p_school_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.school_members m
    JOIN public.schools s ON s.id = m.school_id AND s.is_active
    WHERE m.school_id = p_school_id AND m.user_id = private.current_user_id()
      AND m.status = 'active');
$$;

CREATE OR REPLACE FUNCTION private.has_role(p_school_id uuid, p_role text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.school_members m
    JOIN public.schools s ON s.id = m.school_id AND s.is_active
    WHERE m.school_id = p_school_id AND m.user_id = private.current_user_id()
      AND m.status = 'active' AND m.role = p_role);
$$;

-- Administration ou secrétariat
CREATE OR REPLACE FUNCTION private.is_office(p_school_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT private.has_role(p_school_id, 'admin') OR private.has_role(p_school_id, 'staff');
$$;

-- Adhésion de l'utilisateur courant dans une école, rôle préféré en premier
CREATE OR REPLACE FUNCTION private.my_member_id_in(p_school_id uuid, p_roles text[]) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT m.id FROM public.school_members m
  WHERE m.school_id = p_school_id AND m.user_id = private.current_user_id()
    AND m.status = 'active' AND m.role = ANY (p_roles)
  ORDER BY array_position(p_roles, m.role)
  LIMIT 1;
$$;

-- Classes d'un professeur : affectation (teaching_assignments) ou créneau publié
CREATE OR REPLACE FUNCTION private.teacher_class_ids() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT a.class_id FROM public.teaching_assignments a
  WHERE a.teacher_member_id IN (SELECT private.my_member_ids('teacher'))
  UNION
  SELECT s.class_id FROM public.timetable_slots s
  JOIN public.timetable_versions v ON v.id = s.version_id AND v.status = 'published'
  WHERE s.teacher_member_id IN (SELECT private.my_member_ids('teacher'));
$$;

-- Enfants d'un parent
CREATE OR REPLACE FUNCTION private.guardian_student_ids() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT g.student_id FROM public.student_guardians g
  WHERE g.guardian_member_id IN (SELECT private.my_member_ids('parent'));
$$;

-- Fiche(s) élève de l'utilisateur connecté en tant qu'élève
CREATE OR REPLACE FUNCTION private.self_student_ids() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT s.id FROM public.students s
  WHERE s.member_id IN (SELECT private.my_member_ids('student'));
$$;

CREATE OR REPLACE FUNCTION private.family_student_ids() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT private.guardian_student_ids()
  UNION
  SELECT private.self_student_ids();
$$;

-- Élèves inscrits (actifs) dans les classes d'un professeur
CREATE OR REPLACE FUNCTION private.teacher_student_ids() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT e.student_id FROM public.enrollments e
  WHERE e.class_id IN (SELECT private.teacher_class_ids()) AND e.status = 'active';
$$;

-- Classes visibles hors secrétariat : celles du professeur + celles de la famille
CREATE OR REPLACE FUNCTION private.visible_class_ids() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT private.teacher_class_ids()
  UNION
  SELECT e.class_id FROM public.enrollments e
  WHERE e.student_id IN (SELECT private.family_student_ids()) AND e.status = 'active';
$$;

-- Utilisateurs dont on peut voir la fiche (nom, contact)
CREATE OR REPLACE FUNCTION private.visible_user_ids() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT private.current_user_id()
  UNION
  SELECT m.user_id FROM public.school_members m
  WHERE private.is_school_member(m.school_id)
    AND (m.role IN ('admin', 'teacher', 'staff') OR private.is_office(m.school_id));
$$;

-- Une annonce atteint-elle l'utilisateur courant ?
-- Aucune cible = toute l'école ; cible classe ; cible nœud (descendants inclus).
CREATE OR REPLACE FUNCTION private.announcement_visible(p_announcement_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.announcements a
    WHERE a.id = p_announcement_id
      AND (
        private.is_office(a.school_id)
        OR (a.status = 'published' AND private.is_school_member(a.school_id) AND (
              NOT EXISTS (SELECT 1 FROM public.announcement_targets t WHERE t.announcement_id = a.id)
              OR EXISTS (
                SELECT 1
                FROM public.announcement_targets t
                JOIN public.classes c ON c.school_id = t.school_id
                JOIN public.curriculum_nodes n ON n.id = c.node_id
                WHERE t.announcement_id = a.id
                  AND c.id IN (SELECT private.visible_class_ids())
                  AND (t.class_id = c.id OR t.node_id = ANY (n.path)))
            ))
      ));
$$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA private FROM public, anon;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA private TO authenticated;

-- ---------------------------------------------------------------------
-- 3. Nouveaux modules
-- ---------------------------------------------------------------------

-- 3a. Absences / présences, par élève et par séance (ou par journée si slot_id NULL)
CREATE TABLE attendance_records (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id             uuid NOT NULL,
  class_id              uuid NOT NULL,
  student_id            uuid NOT NULL,
  session_date          date NOT NULL,
  slot_id               uuid,                        -- séance de la trame ; NULL = journée
  status                text NOT NULL CHECK (status IN ('present', 'absent', 'late', 'excused')),
  minutes_late          int CHECK (minutes_late > 0),
  justification         text,
  justified_at          timestamptz,
  recorded_by_member_id uuid REFERENCES school_members(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE,
  FOREIGN KEY (class_id, school_id) REFERENCES classes (id, school_id) ON DELETE CASCADE,
  FOREIGN KEY (student_id, school_id) REFERENCES students (id, school_id) ON DELETE CASCADE,
  -- une séance qui a un historique de présence ne se supprime pas (spec 07)
  FOREIGN KEY (slot_id, class_id, school_id) REFERENCES timetable_slots (id, class_id, school_id),
  -- un seul relevé par élève, jour et séance : re-saisir = mettre à jour (spec 06)
  CONSTRAINT attendance_records_one_per_session UNIQUE NULLS NOT DISTINCT (student_id, session_date, slot_id)
);
CREATE INDEX attendance_records_class_idx ON attendance_records (class_id, session_date);
CREATE INDEX attendance_records_student_idx ON attendance_records (student_id, session_date DESC);

CREATE TRIGGER trg_attendance_records_updated_at BEFORE UPDATE ON attendance_records
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- L'élève doit être inscrit (actif) dans cette classe à cette date ; la séance
-- doit être celle de cette classe ce jour-là. Pose l'auteur du relevé.
CREATE OR REPLACE FUNCTION private.attendance_records_validate() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_weekday smallint;
  v_version uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.enrollments e
    WHERE e.student_id = NEW.student_id AND e.class_id = NEW.class_id
      AND e.status = 'active'
      AND (e.started_on IS NULL OR e.started_on <= NEW.session_date)
      AND (e.ended_on IS NULL OR e.ended_on >= NEW.session_date)
  ) THEN
    RAISE EXCEPTION 'l''élève n''est pas inscrit (actif) dans cette classe le %', NEW.session_date
      USING ERRCODE = '23514';
  END IF;

  IF NEW.slot_id IS NOT NULL THEN
    SELECT weekday, version_id INTO v_weekday, v_version
    FROM public.timetable_slots WHERE id = NEW.slot_id;
    IF v_weekday <> extract(isodow FROM NEW.session_date)
       OR v_version IS DISTINCT FROM public.timetable_version_on(NEW.class_id, NEW.session_date) THEN
      RAISE EXCEPTION 'cette séance n''a pas lieu le %', NEW.session_date USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.status <> 'late' THEN
    NEW.minutes_late := NULL;
  END IF;

  IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.recorded_by_member_id := COALESCE(
      private.my_member_id_in(NEW.school_id, ARRAY['teacher', 'staff', 'admin']),
      NEW.recorded_by_member_id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_attendance_records_validate
  BEFORE INSERT OR UPDATE ON attendance_records
  FOR EACH ROW EXECUTE FUNCTION private.attendance_records_validate();

-- 3b. Réclamations / échanges école <-> famille
CREATE TABLE cases (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id             uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  direction             text NOT NULL CHECK (direction IN ('parent_to_school', 'school_to_parent')),
  subject               text NOT NULL CHECK (length(btrim(subject)) > 0),
  status                text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'answered', 'resolved')),
  student_id            uuid,                          -- enfant concerné (optionnel)
  parent_member_id      uuid NOT NULL,                 -- la famille partie à l'échange
  parent_role           text NOT NULL DEFAULT 'parent' CHECK (parent_role = 'parent'),
  opened_by_member_id   uuid NOT NULL REFERENCES school_members(id),
  resolved_at           timestamptz,
  resolved_by_member_id uuid REFERENCES school_members(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (student_id, school_id) REFERENCES students (id, school_id) ON DELETE SET NULL (student_id),
  FOREIGN KEY (parent_member_id, school_id, parent_role)
    REFERENCES school_members (id, school_id, role),
  CHECK ((status = 'resolved') = (resolved_at IS NOT NULL)),
  UNIQUE (id, school_id)
);
CREATE INDEX cases_school_idx ON cases (school_id, status, updated_at DESC);
CREATE INDEX cases_parent_idx ON cases (parent_member_id);

CREATE TRIGGER trg_cases_updated_at BEFORE UPDATE ON cases
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE case_messages (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id         uuid NOT NULL,
  case_id           uuid NOT NULL,
  author_member_id  uuid NOT NULL REFERENCES school_members(id),
  body              text NOT NULL CHECK (length(btrim(body)) > 0),
  created_at        timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (case_id, school_id) REFERENCES cases (id, school_id) ON DELETE CASCADE
);
CREATE INDEX case_messages_case_idx ON case_messages (case_id, created_at);

-- 3c. Boîte d'envoi : les envois WhatsApp/SMS sont SIMULÉS (aucun fournisseur).
-- Une ligne = un message qui aurait été envoyé.
CREATE TABLE notification_outbox (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id          uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  channel            text NOT NULL DEFAULT 'whatsapp'
                     CHECK (channel IN ('whatsapp', 'sms', 'email', 'push', 'in_app')),
  recipient_user_id  uuid REFERENCES users(id) ON DELETE CASCADE,
  kind               text NOT NULL CHECK (kind IN ('announcement', 'case_reply', 'absence')),
  ref_id             uuid,
  body               text NOT NULL,
  status             text NOT NULL DEFAULT 'stubbed' CHECK (status IN ('stubbed', 'sent', 'failed')),
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notification_outbox_school_idx ON notification_outbox (school_id, created_at DESC);

-- Un message sur un échange : met à jour le statut ; réponse de l'école =
-- notification (simulée) au parent. Refuse d'écrire dans un échange clos.
CREATE OR REPLACE FUNCTION private.case_messages_after_insert() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  c public.cases%ROWTYPE;
  v_author_role text;
  v_parent_user uuid;
BEGIN
  SELECT * INTO c FROM public.cases WHERE id = NEW.case_id FOR UPDATE;
  IF c.status = 'resolved' THEN
    RAISE EXCEPTION 'cet échange est clos' USING ERRCODE = '23514';
  END IF;
  SELECT role INTO v_author_role FROM public.school_members WHERE id = NEW.author_member_id;

  IF v_author_role IN ('admin', 'staff') THEN
    UPDATE public.cases SET status = 'answered' WHERE id = c.id;
    SELECT user_id INTO v_parent_user FROM public.school_members WHERE id = c.parent_member_id;
    INSERT INTO public.notification_outbox (school_id, recipient_user_id, kind, ref_id, body)
    VALUES (c.school_id, v_parent_user, 'case_reply', c.id,
            'Réponse de l''école — ' || c.subject || ' : ' || left(NEW.body, 280));
  ELSE
    UPDATE public.cases SET status = 'open' WHERE id = c.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_case_messages_after_insert
  AFTER INSERT ON case_messages
  FOR EACH ROW EXECUTE FUNCTION private.case_messages_after_insert();

-- Publication d'une annonce : un message simulé par parent concerné
CREATE OR REPLACE FUNCTION private.announcements_fanout() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.status = 'published' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'published') THEN
    IF NEW.published_at IS NULL THEN
      NEW.published_at := now();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_announcements_published_at
  BEFORE INSERT OR UPDATE OF status ON announcements
  FOR EACH ROW EXECUTE FUNCTION private.announcements_fanout();

-- La diffusion se fait par RPC après pose des cibles (les cibles sont insérées
-- après l'annonce) : publish_announcement().
CREATE OR REPLACE FUNCTION public.publish_announcement(p_announcement_id uuid) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a public.announcements%ROWTYPE;
  v_count int;
BEGIN
  SELECT * INTO a FROM public.announcements WHERE id = p_announcement_id;
  IF NOT FOUND OR NOT private.is_office(a.school_id) THEN
    RAISE EXCEPTION 'annonce introuvable ou droits insuffisants' USING ERRCODE = '42501';
  END IF;

  UPDATE public.announcements SET status = 'published' WHERE id = a.id AND status <> 'published';

  INSERT INTO public.notification_outbox (school_id, recipient_user_id, kind, ref_id, body)
  SELECT DISTINCT a.school_id, m.user_id, 'announcement', a.id,
         '[' || a.priority || '] ' || a.title || ' — ' || left(a.body, 280)
  FROM public.student_guardians g
  JOIN public.school_members m ON m.id = g.guardian_member_id AND m.status = 'active'
  JOIN public.enrollments e ON e.student_id = g.student_id AND e.status = 'active'
  JOIN public.classes c ON c.id = e.class_id
  JOIN public.curriculum_nodes n ON n.id = c.node_id
  JOIN public.academic_years ay ON ay.id = c.academic_year_id AND ay.is_current
  WHERE g.school_id = a.school_id
    AND (
      NOT EXISTS (SELECT 1 FROM public.announcement_targets t WHERE t.announcement_id = a.id)
      OR EXISTS (SELECT 1 FROM public.announcement_targets t
                 WHERE t.announcement_id = a.id
                   AND (t.class_id = c.id OR t.node_id = ANY (n.path)))
    )
    AND NOT EXISTS (SELECT 1 FROM public.notification_outbox o
                    WHERE o.ref_id = a.id AND o.kind = 'announcement' AND o.recipient_user_id = m.user_id);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- Absence / retard : message simulé aux parents
CREATE OR REPLACE FUNCTION private.attendance_notify() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.status IN ('absent', 'late')
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    INSERT INTO public.notification_outbox (school_id, recipient_user_id, kind, ref_id, body)
    SELECT NEW.school_id, m.user_id, 'absence', NEW.id,
           s.first_name || ' ' || s.last_name || ' : '
           || CASE NEW.status WHEN 'absent' THEN 'absent(e)' ELSE 'en retard' END
           || ' le ' || to_char(NEW.session_date, 'DD/MM/YYYY')
    FROM public.student_guardians g
    JOIN public.school_members m ON m.id = g.guardian_member_id
    JOIN public.students s ON s.id = g.student_id
    WHERE g.student_id = NEW.student_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_attendance_notify
  AFTER INSERT OR UPDATE OF status ON attendance_records
  FOR EACH ROW EXECUTE FUNCTION private.attendance_notify();

-- Un parent justifie une absence de son enfant -> 'excused' (spec 06)
CREATE OR REPLACE FUNCTION public.justify_absence(p_record_id uuid, p_justification text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF coalesce(btrim(p_justification), '') = '' THEN
    RAISE EXCEPTION 'le motif est obligatoire' USING ERRCODE = '22023';
  END IF;
  UPDATE public.attendance_records r
     SET status = 'excused', justification = btrim(p_justification), justified_at = now()
   WHERE r.id = p_record_id
     AND r.status IN ('absent', 'late')
     AND r.student_id IN (SELECT private.guardian_student_ids());
  IF NOT FOUND THEN
    RAISE EXCEPTION 'absence introuvable ou déjà justifiée' USING ERRCODE = '42501';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------
-- 4. RPC d'amorçage et de structure
-- ---------------------------------------------------------------------
-- Créer une école : le créateur en devient administrateur. Seul chemin
-- d'insertion dans schools (pas de politique INSERT sur la table).
CREATE OR REPLACE FUNCTION public.create_school(
  p_name text, p_slug text, p_settings jsonb DEFAULT '{}'
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_user   uuid := private.current_user_id();
  v_school uuid;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'non authentifié' USING ERRCODE = '28000';
  END IF;
  IF coalesce(btrim(p_name), '') = '' THEN
    RAISE EXCEPTION 'le nom de l''école est obligatoire' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(coalesce(p_settings->'levels_offered', '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'choisissez au moins un cycle' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.schools (name, slug, settings)
  VALUES (btrim(p_name), p_slug, coalesce(p_settings, '{}'))
  RETURNING id INTO v_school;

  INSERT INTO public.school_members (school_id, user_id, role) VALUES (v_school, v_user, 'admin');

  INSERT INTO public.school_modules (school_id, module)
  SELECT v_school, m FROM unnest(ARRAY['timetable', 'homework', 'announcements',
                                       'payments_tracking', 'attendance', 'student_access', 'cases']) m;
  RETURN v_school;
END;
$$;

-- N'instancie que les cycles choisis par l'école (sous-ensemble du modèle).
-- SECURITY INVOKER : la RLS exige d'être admin de l'école.
CREATE OR REPLACE FUNCTION public.instantiate_curriculum_cycles(
  p_school_id uuid, p_template_code text, p_cycle_codes text[]
) RETURNS int
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_tree jsonb;
BEGIN
  IF NOT private.has_role(p_school_id, 'admin') THEN
    RAISE EXCEPTION 'réservé à l''administration de l''école' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM curriculum_nodes WHERE school_id = p_school_id) THEN
    RAISE EXCEPTION 'la structure de cette école est déjà installée' USING ERRCODE = '23505';
  END IF;
  SELECT coalesce(jsonb_agg(x.e ORDER BY x.ord), '[]'::jsonb) INTO v_tree
  FROM curriculum_templates t,
       jsonb_array_elements(t.tree) WITH ORDINALITY AS x(e, ord)
  WHERE t.code = p_template_code
    AND (p_cycle_codes IS NULL OR x.e->>'code' = ANY (p_cycle_codes));
  IF jsonb_array_length(v_tree) = 0 THEN
    RAISE EXCEPTION 'aucun cycle retenu dans le modèle %', p_template_code USING ERRCODE = '22023';
  END IF;
  RETURN _insert_curriculum_children(p_school_id, NULL, v_tree);
END;
$$;

-- Conflits d'un créneau (spec 07) : même classe qui se chevauche dans la même
-- version ; professeur ou salle effective déjà pris par une autre classe dans
-- une version publiée ou brouillon dont la période chevauche.
CREATE OR REPLACE FUNCTION private.timetable_slots_conflicts() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_from date; v_to date;
  v_room uuid;
  v_other text;
BEGIN
  SELECT effective_from, effective_to INTO v_from, v_to
  FROM public.timetable_versions WHERE id = NEW.version_id;

  IF EXISTS (SELECT 1 FROM public.timetable_slots o
             WHERE o.version_id = NEW.version_id AND o.id <> NEW.id
               AND o.weekday = NEW.weekday
               AND o.starts_at < NEW.ends_at AND NEW.starts_at < o.ends_at) THEN
    RAISE EXCEPTION 'conflit : la classe a déjà une séance sur ce créneau' USING ERRCODE = '23P01';
  END IF;

  IF NEW.teacher_member_id IS NOT NULL THEN
    SELECT c.name INTO v_other
    FROM public.timetable_slots o
    JOIN public.timetable_versions v ON v.id = o.version_id AND v.status = 'published'
    JOIN public.classes c ON c.id = o.class_id
    WHERE o.teacher_member_id = NEW.teacher_member_id AND o.class_id <> NEW.class_id
      AND o.weekday = NEW.weekday
      AND o.starts_at < NEW.ends_at AND NEW.starts_at < o.ends_at
      AND daterange(v.effective_from, v.effective_to, '[]') && daterange(v_from, v_to, '[]')
    LIMIT 1;
    IF v_other IS NOT NULL THEN
      RAISE EXCEPTION 'conflit professeur : déjà en cours avec % sur ce créneau', v_other USING ERRCODE = '23P01';
    END IF;
  END IF;

  SELECT COALESCE(NEW.room_id, sb.room_id, c.home_room_id) INTO v_room
  FROM public.classes c
  LEFT JOIN public.subjects sb ON sb.id = NEW.subject_id
  WHERE c.id = NEW.class_id;
  IF v_room IS NOT NULL THEN
    SELECT c.name INTO v_other
    FROM public.timetable_slots o
    JOIN public.timetable_versions v ON v.id = o.version_id AND v.status = 'published'
    JOIN public.classes c ON c.id = o.class_id
    LEFT JOIN public.subjects sb ON sb.id = o.subject_id
    WHERE o.class_id <> NEW.class_id
      AND COALESCE(o.room_id, sb.room_id, c.home_room_id) = v_room
      AND o.weekday = NEW.weekday
      AND o.starts_at < NEW.ends_at AND NEW.starts_at < o.ends_at
      AND daterange(v.effective_from, v.effective_to, '[]') && daterange(v_from, v_to, '[]')
    LIMIT 1;
    IF v_other IS NOT NULL THEN
      RAISE EXCEPTION 'conflit de salle : déjà occupée par % sur ce créneau', v_other USING ERRCODE = '23P01';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_timetable_slots_conflicts
  BEFORE INSERT OR UPDATE OF weekday, starts_at, ends_at, teacher_member_id, room_id, subject_id
  ON timetable_slots
  FOR EACH ROW EXECUTE FUNCTION private.timetable_slots_conflicts();

REVOKE ALL ON FUNCTION public.create_school(text, text, jsonb) FROM public, anon;
REVOKE ALL ON FUNCTION public.publish_announcement(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.justify_absence(uuid, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.instantiate_curriculum_cycles(uuid, text, text[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_school(text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.publish_announcement(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.justify_absence(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.instantiate_curriculum_cycles(uuid, text, text[]) TO authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA private FROM public, anon;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA private TO authenticated;

-- ---------------------------------------------------------------------
-- 5. Vues : exécutées avec les droits de l'appelant (sinon elles contournent la RLS)
-- ---------------------------------------------------------------------
ALTER VIEW resolved_node_subject_hours SET (security_invoker = true);
ALTER VIEW class_required_hours       SET (security_invoker = true);
ALTER VIEW timetable_assignment_gaps  SET (security_invoker = true);
ALTER VIEW timetable_slot_rooms       SET (security_invoker = true);
ALTER VIEW installment_balances       SET (security_invoker = true);

-- ---------------------------------------------------------------------
-- 6. Droits d'accès Data API : rien pour anon, CRUD pour authenticated
--    (la RLS décide ensuite ligne par ligne)
-- ---------------------------------------------------------------------
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;

-- ---------------------------------------------------------------------
-- 7. RLS : activée partout
-- ---------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- Raccourcis de lecture dans les politiques (évalués une fois par requête)
-- (SELECT private.fn()) plutôt que private.fn() : initPlan au lieu d'appel par ligne.

-- schools ------------------------------------------------------------
CREATE POLICY schools_select ON schools FOR SELECT TO authenticated
  USING ((SELECT private.is_school_member(id)));
CREATE POLICY schools_update ON schools FOR UPDATE TO authenticated
  USING ((SELECT private.has_role(id, 'admin')))
  WITH CHECK ((SELECT private.has_role(id, 'admin')));

-- school_modules ----------------------------------------------------
CREATE POLICY school_modules_select ON school_modules FOR SELECT TO authenticated
  USING ((SELECT private.is_school_member(school_id)));
CREATE POLICY school_modules_write ON school_modules FOR ALL TO authenticated
  USING ((SELECT private.has_role(school_id, 'admin')))
  WITH CHECK ((SELECT private.has_role(school_id, 'admin')));

-- users -------------------------------------------------------------
CREATE POLICY users_select ON users FOR SELECT TO authenticated
  USING (id IN (SELECT private.visible_user_ids()));
CREATE POLICY users_update_self ON users FOR UPDATE TO authenticated
  USING (id = (SELECT private.current_user_id()))
  WITH CHECK (id = (SELECT private.current_user_id()));

-- school_members ----------------------------------------------------
CREATE POLICY school_members_select ON school_members FOR SELECT TO authenticated
  USING (
    user_id = (SELECT private.current_user_id())
    OR (SELECT private.is_office(school_id))
    OR (role IN ('admin', 'teacher', 'staff') AND (SELECT private.is_school_member(school_id)))
  );
CREATE POLICY school_members_write ON school_members FOR ALL TO authenticated
  USING ((SELECT private.has_role(school_id, 'admin')))
  WITH CHECK ((SELECT private.has_role(school_id, 'admin')));

-- Référentiels de l'école : lisibles par tout membre, modifiables par l'admin
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['academic_years', 'curriculum_nodes', 'node_progressions', 'rooms',
                           'subjects', 'node_subject_hours'] LOOP
    EXECUTE format($f$
      CREATE POLICY %1$s_select ON public.%1$I FOR SELECT TO authenticated
        USING ((SELECT private.is_school_member(school_id)));
      CREATE POLICY %1$s_write ON public.%1$I FOR ALL TO authenticated
        USING ((SELECT private.has_role(school_id, 'admin')))
        WITH CHECK ((SELECT private.has_role(school_id, 'admin')));
    $f$, t);
  END LOOP;
END $$;

-- Modèles de programme : catalogue global en lecture seule
CREATE POLICY curriculum_templates_select ON curriculum_templates FOR SELECT TO authenticated USING (true);
CREATE POLICY curriculum_template_hours_select ON curriculum_template_hours FOR SELECT TO authenticated USING (true);

-- classes -----------------------------------------------------------
CREATE POLICY classes_select ON classes FOR SELECT TO authenticated
  USING ((SELECT private.is_office(school_id)) OR id IN (SELECT private.visible_class_ids()));
CREATE POLICY classes_write ON classes FOR ALL TO authenticated
  USING ((SELECT private.has_role(school_id, 'admin')))
  WITH CHECK ((SELECT private.has_role(school_id, 'admin')));

-- students ----------------------------------------------------------
CREATE POLICY students_select ON students FOR SELECT TO authenticated
  USING (
    (SELECT private.is_office(school_id))
    OR id IN (SELECT private.family_student_ids())
    OR id IN (SELECT private.teacher_student_ids())
  );
CREATE POLICY students_write ON students FOR ALL TO authenticated
  USING ((SELECT private.is_office(school_id)))
  WITH CHECK ((SELECT private.is_office(school_id)));

-- student_guardians -------------------------------------------------
CREATE POLICY student_guardians_select ON student_guardians FOR SELECT TO authenticated
  USING ((SELECT private.is_office(school_id)) OR student_id IN (SELECT private.guardian_student_ids()));
CREATE POLICY student_guardians_write ON student_guardians FOR ALL TO authenticated
  USING ((SELECT private.is_office(school_id)))
  WITH CHECK ((SELECT private.is_office(school_id)));

-- enrollments -------------------------------------------------------
CREATE POLICY enrollments_select ON enrollments FOR SELECT TO authenticated
  USING (
    (SELECT private.is_office(school_id))
    OR student_id IN (SELECT private.family_student_ids())
    OR class_id IN (SELECT private.teacher_class_ids())
  );
CREATE POLICY enrollments_write ON enrollments FOR ALL TO authenticated
  USING ((SELECT private.is_office(school_id)))
  WITH CHECK ((SELECT private.is_office(school_id)));

-- teaching_assignments ----------------------------------------------
CREATE POLICY teaching_assignments_select ON teaching_assignments FOR SELECT TO authenticated
  USING ((SELECT private.is_office(school_id)) OR class_id IN (SELECT private.visible_class_ids()));
CREATE POLICY teaching_assignments_write ON teaching_assignments FOR ALL TO authenticated
  USING ((SELECT private.has_role(school_id, 'admin')))
  WITH CHECK ((SELECT private.has_role(school_id, 'admin')));

-- teacher_unavailability --------------------------------------------
CREATE POLICY teacher_unavailability_select ON teacher_unavailability FOR SELECT TO authenticated
  USING ((SELECT private.is_office(school_id)) OR teacher_member_id IN (SELECT private.my_member_ids('teacher')));
CREATE POLICY teacher_unavailability_write ON teacher_unavailability FOR ALL TO authenticated
  USING ((SELECT private.has_role(school_id, 'admin')) OR teacher_member_id IN (SELECT private.my_member_ids('teacher')))
  WITH CHECK ((SELECT private.has_role(school_id, 'admin')) OR teacher_member_id IN (SELECT private.my_member_ids('teacher')));

-- timetable_versions : hors secrétariat, seules les versions publiées se voient
CREATE POLICY timetable_versions_select ON timetable_versions FOR SELECT TO authenticated
  USING (
    (SELECT private.is_office(school_id))
    OR (status = 'published' AND class_id IN (SELECT private.visible_class_ids()))
  );
CREATE POLICY timetable_versions_write ON timetable_versions FOR ALL TO authenticated
  USING ((SELECT private.has_role(school_id, 'admin')))
  WITH CHECK ((SELECT private.has_role(school_id, 'admin')));

-- timetable_slots ---------------------------------------------------
CREATE POLICY timetable_slots_select ON timetable_slots FOR SELECT TO authenticated
  USING (
    (SELECT private.is_office(school_id))
    OR (class_id IN (SELECT private.visible_class_ids())
        AND EXISTS (SELECT 1 FROM timetable_versions v
                    WHERE v.id = version_id AND v.status = 'published'))
  );
CREATE POLICY timetable_slots_write ON timetable_slots FOR ALL TO authenticated
  USING ((SELECT private.has_role(school_id, 'admin')))
  WITH CHECK ((SELECT private.has_role(school_id, 'admin')));

-- timetable_exceptions : saisies par le secrétariat (absence prof, remplaçant...)
CREATE POLICY timetable_exceptions_select ON timetable_exceptions FOR SELECT TO authenticated
  USING ((SELECT private.is_office(school_id)) OR class_id IN (SELECT private.visible_class_ids()));
CREATE POLICY timetable_exceptions_write ON timetable_exceptions FOR ALL TO authenticated
  USING ((SELECT private.is_office(school_id)))
  WITH CHECK ((SELECT private.is_office(school_id)));

-- homework ----------------------------------------------------------
CREATE POLICY homework_select ON homework FOR SELECT TO authenticated
  USING ((SELECT private.is_office(school_id)) OR class_id IN (SELECT private.visible_class_ids()));
CREATE POLICY homework_write ON homework FOR ALL TO authenticated
  USING (
    (SELECT private.has_role(school_id, 'admin'))
    OR (class_id IN (SELECT private.teacher_class_ids())
        AND author_member_id IN (SELECT private.my_member_ids('teacher')))
  )
  WITH CHECK (
    (SELECT private.has_role(school_id, 'admin'))
    OR (class_id IN (SELECT private.teacher_class_ids())
        AND author_member_id IN (SELECT private.my_member_ids('teacher')))
  );

-- events / event_targets : calendrier de l'école, lisible par ses membres
CREATE POLICY events_select ON events FOR SELECT TO authenticated
  USING ((SELECT private.is_school_member(school_id)));
CREATE POLICY events_write ON events FOR ALL TO authenticated
  USING ((SELECT private.is_office(school_id)))
  WITH CHECK ((SELECT private.is_office(school_id)));
CREATE POLICY event_targets_select ON event_targets FOR SELECT TO authenticated
  USING ((SELECT private.is_school_member(school_id)));
CREATE POLICY event_targets_write ON event_targets FOR ALL TO authenticated
  USING ((SELECT private.is_office(school_id)))
  WITH CHECK ((SELECT private.is_office(school_id)));

-- announcements : ciblage vérifié en base (classe ou nœud, descendants inclus)
CREATE POLICY announcements_select ON announcements FOR SELECT TO authenticated
  USING ((SELECT private.is_office(school_id)) OR private.announcement_visible(id));
CREATE POLICY announcements_write ON announcements FOR ALL TO authenticated
  USING ((SELECT private.is_office(school_id)))
  WITH CHECK ((SELECT private.is_office(school_id))
              AND author_member_id IN (SELECT private.my_member_ids()));
CREATE POLICY announcement_targets_select ON announcement_targets FOR SELECT TO authenticated
  USING ((SELECT private.is_office(school_id)) OR private.announcement_visible(announcement_id));
CREATE POLICY announcement_targets_write ON announcement_targets FOR ALL TO authenticated
  USING ((SELECT private.is_office(school_id)))
  WITH CHECK ((SELECT private.is_office(school_id)));

-- notifications (table socle) : le destinataire, ou le secrétariat
CREATE POLICY notifications_select ON notifications FOR SELECT TO authenticated
  USING (recipient_user_id = (SELECT private.current_user_id()) OR (SELECT private.is_office(school_id)));
CREATE POLICY notifications_update_self ON notifications FOR UPDATE TO authenticated
  USING (recipient_user_id = (SELECT private.current_user_id()))
  WITH CHECK (recipient_user_id = (SELECT private.current_user_id()));

-- Paiements : secrétariat ; les parents voient ce qui concerne leurs enfants
CREATE POLICY fee_plans_select ON fee_plans FOR SELECT TO authenticated
  USING ((SELECT private.is_office(school_id)));
CREATE POLICY fee_plans_write ON fee_plans FOR ALL TO authenticated
  USING ((SELECT private.is_office(school_id)))
  WITH CHECK ((SELECT private.is_office(school_id)));
CREATE POLICY fee_installments_select ON fee_installments FOR SELECT TO authenticated
  USING ((SELECT private.is_office(school_id)) OR student_id IN (SELECT private.guardian_student_ids()));
CREATE POLICY fee_installments_write ON fee_installments FOR ALL TO authenticated
  USING ((SELECT private.is_office(school_id)))
  WITH CHECK ((SELECT private.is_office(school_id)));
CREATE POLICY payments_select ON payments FOR SELECT TO authenticated
  USING (
    (SELECT private.is_office(school_id))
    OR EXISTS (SELECT 1 FROM fee_installments i
               WHERE i.id = installment_id AND i.student_id IN (SELECT private.guardian_student_ids()))
  );
CREATE POLICY payments_insert ON payments FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.is_office(school_id))
              AND recorded_by_member_id IN (SELECT private.my_member_ids()));
CREATE POLICY payments_delete ON payments FOR DELETE TO authenticated
  USING ((SELECT private.has_role(school_id, 'admin')));

-- attendance_records ------------------------------------------------
CREATE POLICY attendance_records_select ON attendance_records FOR SELECT TO authenticated
  USING (
    (SELECT private.is_office(school_id))
    OR class_id IN (SELECT private.teacher_class_ids())
    OR student_id IN (SELECT private.family_student_ids())
  );
CREATE POLICY attendance_records_insert ON attendance_records FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.is_office(school_id)) OR class_id IN (SELECT private.teacher_class_ids()));
CREATE POLICY attendance_records_update ON attendance_records FOR UPDATE TO authenticated
  USING ((SELECT private.is_office(school_id)) OR class_id IN (SELECT private.teacher_class_ids()))
  WITH CHECK ((SELECT private.is_office(school_id)) OR class_id IN (SELECT private.teacher_class_ids()));
CREATE POLICY attendance_records_delete ON attendance_records FOR DELETE TO authenticated
  USING ((SELECT private.is_office(school_id)));

-- cases -------------------------------------------------------------
CREATE POLICY cases_select ON cases FOR SELECT TO authenticated
  USING ((SELECT private.is_office(school_id)) OR parent_member_id IN (SELECT private.my_member_ids('parent')));
CREATE POLICY cases_insert ON cases FOR INSERT TO authenticated
  WITH CHECK (
    status = 'open' AND resolved_at IS NULL AND (
      -- la famille ouvre un échange, pour elle-même et ses enfants
      (direction = 'parent_to_school'
       AND parent_member_id IN (SELECT private.my_member_ids('parent'))
       AND opened_by_member_id = parent_member_id
       AND (student_id IS NULL OR student_id IN (SELECT private.guardian_student_ids())))
      OR
      -- l'école écrit à une famille
      (direction = 'school_to_parent'
       AND (SELECT private.is_office(school_id))
       AND opened_by_member_id IN (SELECT private.my_member_ids()))
    )
  );
CREATE POLICY cases_update ON cases FOR UPDATE TO authenticated
  USING ((SELECT private.is_office(school_id)))
  WITH CHECK ((SELECT private.is_office(school_id)));

-- case_messages -----------------------------------------------------
CREATE POLICY case_messages_select ON case_messages FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM cases c WHERE c.id = case_id));   -- RLS de cases
CREATE POLICY case_messages_insert ON case_messages FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM cases c
      JOIN school_members m ON m.id = author_member_id
      WHERE c.id = case_id
        AND m.id IN (SELECT private.my_member_ids())
        AND m.school_id = c.school_id
        AND (m.role IN ('admin', 'staff') OR m.id = c.parent_member_id)
    )
  );

-- notification_outbox : lecture seule (secrétariat, ou destinataire)
CREATE POLICY notification_outbox_select ON notification_outbox FOR SELECT TO authenticated
  USING ((SELECT private.is_office(school_id)) OR recipient_user_id = (SELECT private.current_user_id()));

-- ---------------------------------------------------------------------
-- 8. search_path figé sur les fonctions du socle (avertissement advisors) :
--    ALTER seulement, corps inchangés.
-- ---------------------------------------------------------------------
DO $$
DECLARE f regprocedure;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f'
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
      AND (p.proconfig IS NULL OR NOT EXISTS (
            SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%'))
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, pg_temp', f);
  END LOOP;
END $$;
