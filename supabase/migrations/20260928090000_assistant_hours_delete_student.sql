-- =====================================================================
-- 1. Professeur assistant
-- ---------------------------------------------------------------------
-- Un assistant a exactement les droits d'un professeur : c'est une adhésion
-- 'teacher' marquée is_assistant. Les affectations, séances, devoirs et
-- indisponibilités pointent vers (membre, 'teacher') ; un rôle séparé les
-- aurait tous exclus.
-- =====================================================================
ALTER TABLE school_members
  ADD COLUMN is_assistant boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT school_members_assistant_is_teacher CHECK (NOT is_assistant OR role = 'teacher');

-- change_member_role accepte aussi 'assistant' (= 'teacher' + is_assistant).
-- Professeur <-> assistant : seul le marqueur change, rien d'autre ne bouge.
CREATE OR REPLACE FUNCTION public.change_member_role(p_member_id uuid, p_role text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  m          public.school_members;
  v_other    public.school_members;
  v_in_use   boolean := false;
  v_assist   boolean := p_role = 'assistant';
  v_role     text := CASE WHEN p_role = 'assistant' THEN 'teacher' ELSE p_role END;
BEGIN
  SELECT * INTO m FROM public.school_members WHERE id = p_member_id FOR UPDATE;
  IF m.id IS NULL THEN
    RAISE EXCEPTION 'membre introuvable' USING ERRCODE = 'P0002';
  END IF;
  IF NOT private.has_role(m.school_id, 'admin') THEN
    RAISE EXCEPTION 'réservé à l''administration' USING ERRCODE = '42501';
  END IF;
  IF v_role NOT IN ('admin', 'staff', 'teacher') OR m.role NOT IN ('admin', 'staff', 'teacher') THEN
    RAISE EXCEPTION 'seuls les rôles du personnel se changent ici' USING ERRCODE = '22023';
  END IF;
  IF m.role = v_role THEN
    IF m.role = 'teacher' AND m.is_assistant IS DISTINCT FROM v_assist THEN
      UPDATE public.school_members SET is_assistant = v_assist, updated_at = now() WHERE id = m.id;
      RETURN 'replaced';
    END IF;
    RETURN 'unchanged';
  END IF;
  IF m.role = 'admin' AND m.status = 'active' AND NOT EXISTS (
    SELECT 1 FROM public.school_members o
    WHERE o.school_id = m.school_id AND o.role = 'admin' AND o.status = 'active' AND o.user_id <> m.user_id
  ) THEN
    RAISE EXCEPTION 'l''école doit garder au moins un administrateur actif' USING ERRCODE = 'P0001';
  END IF;

  IF m.role = 'teacher' THEN
    v_in_use :=
         EXISTS (SELECT 1 FROM public.teaching_assignments x WHERE x.teacher_member_id = m.id)
      OR EXISTS (SELECT 1 FROM public.timetable_slots x WHERE x.teacher_member_id = m.id)
      OR EXISTS (SELECT 1 FROM public.timetable_exceptions x WHERE x.teacher_member_id = m.id)
      OR EXISTS (SELECT 1 FROM public.homework x WHERE x.author_member_id = m.id)
      OR EXISTS (SELECT 1 FROM public.teacher_unavailability x WHERE x.teacher_member_id = m.id);
  END IF;

  SELECT * INTO v_other FROM public.school_members
  WHERE school_id = m.school_id AND user_id = m.user_id AND role = v_role;

  IF v_in_use THEN
    INSERT INTO public.school_members (school_id, user_id, role, status, is_assistant)
    VALUES (m.school_id, m.user_id, v_role, 'active', v_assist)
    ON CONFLICT (school_id, user_id, role) DO UPDATE
      SET status = 'active', is_assistant = EXCLUDED.is_assistant, updated_at = now();
    RETURN 'added';
  END IF;

  IF v_other.id IS NOT NULL THEN
    UPDATE public.school_members SET status = 'active', is_assistant = v_assist, updated_at = now() WHERE id = v_other.id;
    UPDATE public.school_members SET status = 'inactive', updated_at = now() WHERE id = m.id;
    RETURN 'merged';
  END IF;

  UPDATE public.school_members SET role = v_role, is_assistant = v_assist, updated_at = now() WHERE id = m.id;
  RETURN 'replaced';
END;
$$;

-- =====================================================================
-- 2. Horaires habituels d'un professeur
-- ---------------------------------------------------------------------
-- Par jour de la semaine (1 = lundi) : l'heure d'arrivée et de départ
-- attendues. Quand un jour est renseigné, il remplace le premier et le dernier
-- cours de l'emploi du temps pour juger la présence (retard, départ anticipé).
-- =====================================================================
CREATE TABLE staff_hours (
  school_id   uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  member_id   uuid NOT NULL REFERENCES school_members(id) ON DELETE CASCADE,
  weekday     smallint NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  starts_at   time NOT NULL,
  ends_at     time NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (member_id, weekday),
  CHECK (ends_at > starts_at)
);
CREATE INDEX staff_hours_school_idx ON staff_hours (school_id);
CREATE TRIGGER trg_staff_hours_updated_at BEFORE UPDATE ON staff_hours
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON staff_hours TO authenticated;
ALTER TABLE staff_hours ENABLE ROW LEVEL SECURITY;

CREATE POLICY staff_hours_select ON staff_hours FOR SELECT TO authenticated
  USING ((SELECT private.is_office(school_id)) OR member_id IN (SELECT private.my_member_ids('teacher')));
-- Le membre doit appartenir à l'école de la ligne
CREATE POLICY staff_hours_write ON staff_hours FOR ALL TO authenticated
  USING ((SELECT private.is_office(school_id)))
  WITH CHECK (
    (SELECT private.is_office(school_id))
    AND EXISTS (SELECT 1 FROM school_members m WHERE m.id = member_id AND m.school_id = staff_hours.school_id)
  );

-- =====================================================================
-- 3. Supprimer un élève définitivement
-- ---------------------------------------------------------------------
-- Efface l'élève et, en cascade, son inscription, ses absences, ses échéances
-- et paiements, ses alertes et ses liens parents. Les dossiers, rendez-vous et
-- pré-inscriptions restent, sans l'élève. Son accès élève (s'il en avait un)
-- est retiré. Réservé au secrétariat et à l'administration.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.delete_student(p_student_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  s public.students;
BEGIN
  SELECT * INTO s FROM public.students WHERE id = p_student_id FOR UPDATE;
  IF s.id IS NULL THEN
    RAISE EXCEPTION 'élève introuvable' USING ERRCODE = 'P0002';
  END IF;
  IF NOT private.is_office(s.school_id) THEN
    RAISE EXCEPTION 'réservé au secrétariat' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.students WHERE id = s.id;
  IF s.member_id IS NOT NULL THEN
    DELETE FROM public.school_members WHERE id = s.member_id AND role = 'student';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.delete_student(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.delete_student(uuid) TO authenticated;
