-- Anniversaires des élèves : l'administration et le secrétariat voient ceux
-- de la semaine à venir et notent, pour chaque anniversaire (élève + année),
-- s'il est à organiser, pas organisé ou organisé. Pas de ligne = à organiser.
CREATE TABLE birthday_plans (
  school_id     uuid NOT NULL,
  student_id    uuid NOT NULL,
  year          int  NOT NULL CHECK (year BETWEEN 2000 AND 2200),  -- année de l'anniversaire fêté
  status        text NOT NULL DEFAULT 'to_organize'
                CHECK (status IN ('to_organize', 'not_organizing', 'organized')),
  by_member_id  uuid REFERENCES school_members(id),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (student_id, year),
  FOREIGN KEY (student_id, school_id) REFERENCES students (id, school_id) ON DELETE CASCADE
);
CREATE INDEX birthday_plans_school_idx ON birthday_plans (school_id, year);

-- Qui a changé le statut en dernier, et quand
CREATE OR REPLACE FUNCTION private.birthday_plan_touch() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  NEW.by_member_id := COALESCE(private.my_member_id_in(NEW.school_id, ARRAY['staff', 'admin']), NEW.by_member_id);
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.birthday_plan_touch() FROM public, anon;
CREATE TRIGGER trg_birthday_plans_touch BEFORE INSERT OR UPDATE ON birthday_plans
  FOR EACH ROW EXECUTE FUNCTION private.birthday_plan_touch();

GRANT SELECT, INSERT, UPDATE, DELETE ON birthday_plans TO authenticated;
ALTER TABLE birthday_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY birthday_plans_office ON birthday_plans FOR ALL TO authenticated
  USING ((SELECT private.is_office(school_id)))
  WITH CHECK ((SELECT private.is_office(school_id)));
