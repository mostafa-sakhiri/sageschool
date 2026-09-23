-- Changer le rôle d'un membre du personnel (admin, secrétariat, professeur).
-- Le rôle fait partie de l'identité de l'adhésion : les affectations, séances,
-- remplacements, devoirs et indisponibilités pointent vers (membre, 'teacher').
-- Donc :
--   - adhésion sans usage  -> le rôle est remplacé sur place ('replaced') ;
--   - la personne a déjà ce rôle (même inactif) -> il est réactivé et l'ancien
--     désactivé ('merged') ;
--   - professeur encore utilisé -> il garde ce rôle et reçoit le nouveau en
--     plus ('added') : rien de l'emploi du temps n'est perdu.
-- Il reste toujours au moins un administrateur actif.
CREATE OR REPLACE FUNCTION public.change_member_role(p_member_id uuid, p_role text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  m        public.school_members;
  v_other  public.school_members;
  v_in_use boolean := false;
BEGIN
  SELECT * INTO m FROM public.school_members WHERE id = p_member_id FOR UPDATE;
  IF m.id IS NULL THEN
    RAISE EXCEPTION 'membre introuvable' USING ERRCODE = 'P0002';
  END IF;
  IF NOT private.has_role(m.school_id, 'admin') THEN
    RAISE EXCEPTION 'réservé à l''administration' USING ERRCODE = '42501';
  END IF;
  IF p_role NOT IN ('admin', 'staff', 'teacher') OR m.role NOT IN ('admin', 'staff', 'teacher') THEN
    RAISE EXCEPTION 'seuls les rôles du personnel se changent ici' USING ERRCODE = '22023';
  END IF;
  IF m.role = p_role THEN
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
  WHERE school_id = m.school_id AND user_id = m.user_id AND role = p_role;

  IF v_in_use THEN
    INSERT INTO public.school_members (school_id, user_id, role, status)
    VALUES (m.school_id, m.user_id, p_role, 'active')
    ON CONFLICT (school_id, user_id, role) DO UPDATE SET status = 'active', updated_at = now();
    RETURN 'added';
  END IF;

  IF v_other.id IS NOT NULL THEN
    UPDATE public.school_members SET status = 'active', updated_at = now() WHERE id = v_other.id;
    UPDATE public.school_members SET status = 'inactive', updated_at = now() WHERE id = m.id;
    RETURN 'merged';
  END IF;

  UPDATE public.school_members SET role = p_role, updated_at = now() WHERE id = m.id;
  RETURN 'replaced';
END;
$$;
REVOKE ALL ON FUNCTION public.change_member_role(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.change_member_role(uuid, text) TO authenticated;
