-- Supprimer un élève définitivement : réservé à l'administration (plus au
-- secrétariat). Même effet que dans 20260928090000.
CREATE OR REPLACE FUNCTION public.delete_student(p_student_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  s public.students;
BEGIN
  SELECT * INTO s FROM public.students WHERE id = p_student_id FOR UPDATE;
  IF s.id IS NULL THEN
    RAISE EXCEPTION 'élève introuvable' USING ERRCODE = 'P0002';
  END IF;
  IF NOT private.has_role(s.school_id, 'admin') THEN
    RAISE EXCEPTION 'réservé à l''administration' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.students WHERE id = s.id;
  IF s.member_id IS NOT NULL THEN
    DELETE FROM public.school_members WHERE id = s.member_id AND role = 'student';
  END IF;
END;
$$;
