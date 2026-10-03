-- Roles and permissions, replacing the per-module levels of 20261003090000.
--
-- A permission is one explicit action ("publier une annonce", "encaisser un
-- paiement"...). Each school has its roles in school_roles:
--   * the built-in secrétariat and professeur (builtin_key 'staff' /
--     'teacher'), editable, created with the access they always had;
--   * roles created by the school, built on one of the two (base_role), given
--     to a member through school_members.custom_role_id.
-- The admin has every permission, always. Parents and students have none:
-- their access is their children / themselves.
--
-- School-wide settings (school, structure, rooms, years, classes, subjects
-- and hours, timetable building, members and roles) are no permission: they
-- stay admin only (has_role(..., 'admin')).

-- -------------------------------------------------------------- catalog
CREATE FUNCTION private.permission_keys() RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT ARRAY[
    'students.view', 'students.create', 'students.edit', 'students.families', 'students.delete',
    'attendance.take_own', 'attendance.view_all', 'attendance.take_all', 'attendance.alerts',
    'staff_presence.view', 'staff_presence.record',
    'preregistrations.view', 'preregistrations.manage',
    'agenda.view', 'agenda.manage',
    'events.birthdays', 'events.manage',
    'announcements.view_all', 'announcements.create', 'announcements.publish', 'announcements.edit_all',
    'messages.view', 'messages.reply',
    'fees.view', 'fees.collect', 'fees.remind', 'fees.plans',
    'timetable.view_all', 'timetable.exceptions',
    'classes.view_all',
    'homework.own'
  ];
$$;

-- What the built-in roles could do before (the secrétariat's fees followed
-- settings.staff_fees_access)
CREATE FUNCTION private.default_permissions(p_key text, p_fees boolean) RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE p_key
    WHEN 'staff' THEN ARRAY[
      'students.view', 'students.create', 'students.edit', 'students.families',
      'attendance.view_all', 'attendance.take_all', 'attendance.alerts',
      'staff_presence.view', 'staff_presence.record',
      'preregistrations.view', 'preregistrations.manage',
      'agenda.view', 'agenda.manage',
      'events.birthdays', 'events.manage',
      'announcements.view_all', 'announcements.create', 'announcements.publish', 'announcements.edit_all',
      'messages.view', 'messages.reply',
      'timetable.view_all', 'timetable.exceptions',
      'classes.view_all']
      || CASE WHEN p_fees THEN ARRAY['fees.view', 'fees.collect', 'fees.remind', 'fees.plans'] ELSE ARRAY[]::text[] END
    WHEN 'teacher' THEN ARRAY['attendance.take_own', 'homework.own']
    ELSE ARRAY[]::text[]
  END;
$$;

-- ------------------------------------------------- school_roles, reshaped
-- No role had been created yet when this was written; stop rather than
-- guess how levels would map to actions.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM school_roles WHERE permissions <> '{}'::jsonb) THEN
    RAISE EXCEPTION 'school_roles has per-module levels to convert: extend this migration';
  END IF;
END;
$$;

DROP POLICY IF EXISTS school_roles_write ON school_roles;
DROP TRIGGER IF EXISTS school_roles_validate ON school_roles;
ALTER TABLE school_roles ALTER COLUMN permissions DROP DEFAULT;
ALTER TABLE school_roles DROP CONSTRAINT IF EXISTS school_roles_permissions_check;
ALTER TABLE school_roles ALTER COLUMN permissions TYPE text[] USING ARRAY[]::text[];
ALTER TABLE school_roles ALTER COLUMN permissions SET DEFAULT '{}';
ALTER TABLE school_roles ALTER COLUMN name DROP NOT NULL;
ALTER TABLE school_roles DROP CONSTRAINT IF EXISTS school_roles_name_check;
ALTER TABLE school_roles ADD COLUMN builtin_key text CHECK (builtin_key IN ('staff', 'teacher'));
-- built-in: no name of its own (translated in the app), base = itself
ALTER TABLE school_roles ADD CONSTRAINT school_roles_builtin_or_named CHECK ((builtin_key IS NULL) = (name IS NOT NULL));
ALTER TABLE school_roles ADD CONSTRAINT school_roles_builtin_base CHECK (builtin_key IS NULL OR base_role = builtin_key);
ALTER TABLE school_roles ADD CONSTRAINT school_roles_name_check CHECK (name IS NULL OR btrim(name) <> '');
ALTER TABLE school_roles ADD CONSTRAINT school_roles_school_id_builtin_key_key UNIQUE (school_id, builtin_key);

CREATE OR REPLACE FUNCTION private.school_roles_validate() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  bad text[];
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.builtin_key IS DISTINCT FROM OLD.builtin_key OR NEW.base_role <> OLD.base_role
                           OR NEW.school_id <> OLD.school_id) THEN
    RAISE EXCEPTION 'le type d''un rôle ne change pas' USING ERRCODE = '23514';
  END IF;
  SELECT array_agg(p) INTO bad FROM unnest(NEW.permissions) p WHERE p <> ALL (private.permission_keys());
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'permission inconnue : %', array_to_string(bad, ', ') USING ERRCODE = '22023';
  END IF;
  NEW.permissions := ARRAY(SELECT DISTINCT p FROM unnest(NEW.permissions) p ORDER BY p);
  NEW.name := NULLIF(btrim(NEW.name), '');
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER school_roles_validate BEFORE INSERT OR UPDATE ON school_roles
  FOR EACH ROW EXECUTE FUNCTION private.school_roles_validate();

-- Every school gets its two built-in roles, with what they could do
INSERT INTO school_roles (school_id, builtin_key, base_role, permissions)
SELECT s.id, k, k, private.default_permissions(k, COALESCE((s.settings ->> 'staff_fees_access')::boolean, false))
FROM schools s, unnest(ARRAY['staff', 'teacher']) k;

CREATE FUNCTION private.school_builtin_roles() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.school_roles (school_id, builtin_key, base_role, permissions)
  SELECT NEW.id, k, k, private.default_permissions(k, false) FROM unnest(ARRAY['staff', 'teacher']) k;
  RETURN NEW;
END;
$$;
CREATE TRIGGER schools_builtin_roles AFTER INSERT ON schools
  FOR EACH ROW EXECUTE FUNCTION private.school_builtin_roles();

-- A member's created role: built on the member's role, never a built-in one
CREATE OR REPLACE FUNCTION private.member_custom_role_check() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  r public.school_roles;
BEGIN
  IF NEW.custom_role_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT * INTO r FROM public.school_roles WHERE id = NEW.custom_role_id;
  IF r.builtin_key IS NOT NULL THEN
    RAISE EXCEPTION 'un rôle intégré ne se donne pas ainsi' USING ERRCODE = '23514';
  END IF;
  IF r.base_role IS DISTINCT FROM NEW.role THEN
    -- The member's role changed under a created role: it no longer fits
    IF TG_OP = 'UPDATE' AND NEW.role IS DISTINCT FROM OLD.role AND NEW.custom_role_id IS NOT DISTINCT FROM OLD.custom_role_id THEN
      NEW.custom_role_id := NULL;
    ELSE
      RAISE EXCEPTION 'ce rôle est prévu pour un autre type de membre' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------- the checks
CREATE FUNCTION private.member_permissions(p_member_id uuid) RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE
    WHEN m.role = 'admin' THEN private.permission_keys()
    ELSE COALESCE((
      SELECT r.permissions FROM public.school_roles r
      WHERE r.school_id = m.school_id
        AND (r.id = m.custom_role_id OR (m.custom_role_id IS NULL AND r.builtin_key = m.role))
      LIMIT 1), ARRAY[]::text[])
  END
  FROM public.school_members m
  WHERE m.id = p_member_id;
$$;

-- Does the current user hold this permission in the school (through any of
-- their active memberships)?
CREATE FUNCTION private.can(p_school_id uuid, p_permission text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.school_members m
    JOIN public.schools s ON s.id = m.school_id AND s.is_active
    WHERE m.school_id = p_school_id AND m.user_id = private.current_user_id() AND m.status = 'active'
      AND p_permission = ANY (private.member_permissions(m.id)));
$$;

-- "Office": the school's directory (students and families, classes,
-- timetables, members, outgoing messages). The admin, and any member holding
-- a school-wide permission (every page of the office shows names).
CREATE OR REPLACE FUNCTION private.is_office(p_school_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.school_members m
    JOIN public.schools s ON s.id = m.school_id AND s.is_active
    WHERE m.school_id = p_school_id AND m.user_id = private.current_user_id() AND m.status = 'active'
      AND (m.role = 'admin'
           OR EXISTS (SELECT 1 FROM unnest(private.member_permissions(m.id)) p
                      WHERE p NOT IN ('attendance.take_own', 'homework.own'))));
$$;

CREATE OR REPLACE FUNCTION private.can_manage_fees(p_school_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT private.can(p_school_id, 'fees.plans');
$$;

REVOKE ALL ON FUNCTION private.permission_keys(), private.default_permissions(text, boolean),
  private.member_permissions(uuid), private.can(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION private.permission_keys(), private.default_permissions(text, boolean),
  private.member_permissions(uuid), private.can(uuid, text) TO authenticated;

-- For the app: one of my memberships' permissions (menus, buttons)
CREATE FUNCTION public.member_permissions(p_member_id uuid) RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT private.member_permissions(m.id) FROM public.school_members m
  WHERE m.id = p_member_id AND m.user_id = private.current_user_id();
$$;
-- For server functions (invitations, imports), as the caller
CREATE FUNCTION public.can_access(p_school_id uuid, p_permission text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT private.can(p_school_id, p_permission);
$$;
-- A built-in role's defaults, for "Rétablir par défaut"
CREATE FUNCTION public.default_role_permissions(p_key text) RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT private.default_permissions(p_key, false);
$$;
REVOKE ALL ON FUNCTION public.member_permissions(uuid), public.can_access(uuid, text), public.default_role_permissions(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.member_permissions(uuid), public.can_access(uuid, text), public.default_role_permissions(text) TO authenticated;

-- ---------------------------------------------------------- school_roles
CREATE POLICY school_roles_insert ON school_roles FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.has_role(school_id, 'admin')) AND builtin_key IS NULL);
CREATE POLICY school_roles_update ON school_roles FOR UPDATE TO authenticated
  USING ((SELECT private.has_role(school_id, 'admin')))
  WITH CHECK ((SELECT private.has_role(school_id, 'admin')));
CREATE POLICY school_roles_delete ON school_roles FOR DELETE TO authenticated
  USING ((SELECT private.has_role(school_id, 'admin')) AND builtin_key IS NULL);

-- ------------------------------------------------------- announcements
-- A draft can be changed by its author (create), any announcement by
-- edit_all; publishing goes through publish_announcement (publish).
CREATE FUNCTION private.can_edit_announcement(p_announcement_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.announcements a
    WHERE a.id = p_announcement_id
      AND (private.can(a.school_id, 'announcements.edit_all')
           OR (a.status = 'draft' AND private.can(a.school_id, 'announcements.create')
               AND a.author_member_id IN (SELECT private.my_member_ids()))));
$$;
REVOKE ALL ON FUNCTION private.can_edit_announcement(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION private.can_edit_announcement(uuid) TO authenticated;

DROP POLICY IF EXISTS announcement_targets_select ON announcement_targets;
DROP POLICY IF EXISTS announcement_targets_write ON announcement_targets;
CREATE POLICY announcement_targets_select ON announcement_targets FOR SELECT TO authenticated
  USING ((SELECT private.can(school_id, 'announcements.view_all')) OR private.announcement_visible(announcement_id)
         OR private.can_edit_announcement(announcement_id));
CREATE POLICY announcement_targets_write ON announcement_targets FOR ALL TO authenticated
  USING (private.can_edit_announcement(announcement_id))
  WITH CHECK (private.can_edit_announcement(announcement_id));

DROP POLICY IF EXISTS announcements_select ON announcements;
DROP POLICY IF EXISTS announcements_insert ON announcements;
DROP POLICY IF EXISTS announcements_update ON announcements;
DROP POLICY IF EXISTS announcements_delete ON announcements;
CREATE POLICY announcements_select ON announcements FOR SELECT TO authenticated
  USING ((SELECT private.can(school_id, 'announcements.view_all')) OR private.announcement_visible(id)
         OR author_member_id IN (SELECT private.my_member_ids()));
CREATE POLICY announcements_insert ON announcements FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.can(school_id, 'announcements.create')) AND status = 'draft'
              AND author_member_id IN (SELECT private.my_member_ids()));
CREATE POLICY announcements_update ON announcements FOR UPDATE TO authenticated
  USING (private.can_edit_announcement(id))
  WITH CHECK (status = 'draft' OR (SELECT private.can(school_id, 'announcements.edit_all')));
CREATE POLICY announcements_delete ON announcements FOR DELETE TO authenticated
  USING (private.can_edit_announcement(id));

CREATE OR REPLACE FUNCTION private.announcement_visible(p_announcement_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.announcements a
    WHERE a.id = p_announcement_id
      AND (
        private.can(a.school_id, 'announcements.view_all')
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

DO $$
DECLARE
  def text;
BEGIN
  def := pg_get_functiondef('public.publish_announcement(uuid)'::regprocedure);
  IF position('private.can(a.school_id, ''announcements'', ''write'')' IN def) = 0 THEN
    RAISE EXCEPTION 'publish_announcement changed: review this migration';
  END IF;
  EXECUTE replace(def, 'private.can(a.school_id, ''announcements'', ''write'')', 'private.can(a.school_id, ''announcements.publish'')');
END;
$$;

-- --------------------------------------------------------------- agenda
DROP POLICY IF EXISTS appointments_select ON appointments;
DROP POLICY IF EXISTS appointments_write ON appointments;
CREATE POLICY appointments_select ON appointments FOR SELECT TO authenticated
  USING ((SELECT private.can(school_id, 'agenda.view')));
CREATE POLICY appointments_write ON appointments FOR ALL TO authenticated
  USING ((SELECT private.can(school_id, 'agenda.manage')))
  WITH CHECK ((SELECT private.can(school_id, 'agenda.manage')));

-- ----------------------------------------------------------- attendance
DROP POLICY IF EXISTS attendance_records_select ON attendance_records;
DROP POLICY IF EXISTS attendance_records_insert ON attendance_records;
DROP POLICY IF EXISTS attendance_records_update ON attendance_records;
DROP POLICY IF EXISTS attendance_records_delete ON attendance_records;
CREATE POLICY attendance_records_select ON attendance_records FOR SELECT TO authenticated
  USING ((SELECT private.can(school_id, 'attendance.view_all'))
         OR ((SELECT private.can(school_id, 'attendance.take_own')) AND class_id IN (SELECT private.teacher_class_ids()))
         OR student_id IN (SELECT private.family_student_ids()));
CREATE POLICY attendance_records_insert ON attendance_records FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.can(school_id, 'attendance.take_all'))
              OR ((SELECT private.can(school_id, 'attendance.take_own')) AND class_id IN (SELECT private.teacher_class_ids())));
CREATE POLICY attendance_records_update ON attendance_records FOR UPDATE TO authenticated
  USING ((SELECT private.can(school_id, 'attendance.take_all'))
         OR ((SELECT private.can(school_id, 'attendance.take_own')) AND class_id IN (SELECT private.teacher_class_ids())))
  WITH CHECK ((SELECT private.can(school_id, 'attendance.take_all'))
              OR ((SELECT private.can(school_id, 'attendance.take_own')) AND class_id IN (SELECT private.teacher_class_ids())));
CREATE POLICY attendance_records_delete ON attendance_records FOR DELETE TO authenticated
  USING ((SELECT private.can(school_id, 'attendance.take_all')));

DROP POLICY IF EXISTS student_alerts_select ON student_alerts;
DROP POLICY IF EXISTS student_alerts_write ON student_alerts;
CREATE POLICY student_alerts_select ON student_alerts FOR SELECT TO authenticated
  USING ((SELECT private.can(school_id, 'attendance.view_all')) OR (SELECT private.can(school_id, 'attendance.alerts')));
CREATE POLICY student_alerts_write ON student_alerts FOR ALL TO authenticated
  USING ((SELECT private.can(school_id, 'attendance.alerts')))
  WITH CHECK ((SELECT private.can(school_id, 'attendance.alerts')));

-- -------------------------------------------------------------- events
DROP POLICY IF EXISTS events_write ON events;
CREATE POLICY events_write ON events FOR ALL TO authenticated
  USING ((SELECT private.can(school_id, 'events.manage')))
  WITH CHECK ((SELECT private.can(school_id, 'events.manage')));
DROP POLICY IF EXISTS event_targets_write ON event_targets;
CREATE POLICY event_targets_write ON event_targets FOR ALL TO authenticated
  USING ((SELECT private.can(school_id, 'events.manage')))
  WITH CHECK ((SELECT private.can(school_id, 'events.manage')));
DROP POLICY IF EXISTS birthday_plans_select ON birthday_plans;
DROP POLICY IF EXISTS birthday_plans_write ON birthday_plans;
CREATE POLICY birthday_plans_select ON birthday_plans FOR SELECT TO authenticated
  USING ((SELECT private.can(school_id, 'events.birthdays')));
CREATE POLICY birthday_plans_write ON birthday_plans FOR ALL TO authenticated
  USING ((SELECT private.can(school_id, 'events.manage')))
  WITH CHECK ((SELECT private.can(school_id, 'events.manage')));

-- ------------------------------------------------------------ messages
DROP POLICY IF EXISTS cases_select ON cases;
DROP POLICY IF EXISTS cases_insert ON cases;
DROP POLICY IF EXISTS cases_update ON cases;
CREATE POLICY cases_select ON cases FOR SELECT TO authenticated
  USING ((SELECT private.can(school_id, 'messages.view')) OR parent_member_id IN (SELECT private.my_member_ids('parent')));
CREATE POLICY cases_insert ON cases FOR INSERT TO authenticated
  WITH CHECK (
    status = 'open' AND resolved_at IS NULL AND (
      (direction = 'parent_to_school' AND channel = 'app'
        AND parent_member_id IN (SELECT private.my_member_ids('parent'))
        AND opened_by_member_id = parent_member_id
        AND (student_id IS NULL OR student_id IN (SELECT private.guardian_student_ids())))
      OR (direction = 'parent_to_school' AND channel <> 'app'
        AND (SELECT private.can(school_id, 'messages.reply'))
        AND opened_by_member_id IN (SELECT private.my_member_ids()))
      OR (direction = 'school_to_parent'
        AND (SELECT private.can(school_id, 'messages.reply'))
        AND opened_by_member_id IN (SELECT private.my_member_ids()))));
CREATE POLICY cases_update ON cases FOR UPDATE TO authenticated
  USING ((SELECT private.can(school_id, 'messages.reply')))
  WITH CHECK ((SELECT private.can(school_id, 'messages.reply')));

DROP POLICY IF EXISTS case_messages_insert ON case_messages;
CREATE POLICY case_messages_insert ON case_messages FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM cases c JOIN school_members m ON m.id = case_messages.author_member_id
    WHERE c.id = case_messages.case_id
      AND m.id IN (SELECT private.my_member_ids())
      AND m.school_id = c.school_id
      AND (m.id = c.parent_member_id OR private.can(c.school_id, 'messages.reply'))));

-- ------------------------------------------------------------- students
-- (the directory stays readable by the office: is_office)
DROP POLICY IF EXISTS students_write ON students;
CREATE POLICY students_insert ON students FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.can(school_id, 'students.create')));
CREATE POLICY students_update ON students FOR UPDATE TO authenticated
  USING ((SELECT private.can(school_id, 'students.edit')))
  WITH CHECK ((SELECT private.can(school_id, 'students.edit')));
CREATE POLICY students_delete ON students FOR DELETE TO authenticated
  USING ((SELECT private.can(school_id, 'students.delete')));

DROP POLICY IF EXISTS enrollments_write ON enrollments;
CREATE POLICY enrollments_insert ON enrollments FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.can(school_id, 'students.create')) OR (SELECT private.can(school_id, 'students.edit')));
CREATE POLICY enrollments_update ON enrollments FOR UPDATE TO authenticated
  USING ((SELECT private.can(school_id, 'students.edit')))
  WITH CHECK ((SELECT private.can(school_id, 'students.edit')));
CREATE POLICY enrollments_delete ON enrollments FOR DELETE TO authenticated
  USING ((SELECT private.can(school_id, 'students.edit')));

DROP POLICY IF EXISTS student_guardians_write ON student_guardians;
CREATE POLICY student_guardians_write ON student_guardians FOR ALL TO authenticated
  USING ((SELECT private.can(school_id, 'students.families')))
  WITH CHECK ((SELECT private.can(school_id, 'students.families')));

DO $$
DECLARE
  def text;
BEGIN
  def := pg_get_functiondef('public.delete_student(uuid)'::regprocedure);
  IF position('private.has_role(s.school_id, ''admin'')' IN def) = 0 THEN
    RAISE EXCEPTION 'delete_student changed: review this migration';
  END IF;
  EXECUTE replace(def, 'private.has_role(s.school_id, ''admin'')', 'private.can(s.school_id, ''students.delete'')');

  def := pg_get_functiondef('public.update_member_contact(uuid, text, text)'::regprocedure);
  IF position('private.can(m.school_id, ''students'', ''write'')' IN def) = 0 THEN
    RAISE EXCEPTION 'update_member_contact changed: review this migration';
  END IF;
  EXECUTE replace(def, 'private.can(m.school_id, ''students'', ''write'')', 'private.can(m.school_id, ''students.families'')');
END;
$$;

-- ----------------------------------------------------------------- fees
DROP POLICY IF EXISTS fee_plans_select ON fee_plans;
DROP POLICY IF EXISTS fee_plans_write ON fee_plans;
CREATE POLICY fee_plans_select ON fee_plans FOR SELECT TO authenticated
  USING ((SELECT private.can(school_id, 'fees.view')));
CREATE POLICY fee_plans_write ON fee_plans FOR ALL TO authenticated
  USING ((SELECT private.can(school_id, 'fees.plans')))
  WITH CHECK ((SELECT private.can(school_id, 'fees.plans')));
DROP POLICY IF EXISTS fee_installments_select ON fee_installments;
DROP POLICY IF EXISTS fee_installments_write ON fee_installments;
CREATE POLICY fee_installments_select ON fee_installments FOR SELECT TO authenticated
  USING ((SELECT private.can(school_id, 'fees.view')) OR student_id IN (SELECT private.guardian_student_ids()));
CREATE POLICY fee_installments_write ON fee_installments FOR ALL TO authenticated
  USING ((SELECT private.can(school_id, 'fees.plans')))
  WITH CHECK ((SELECT private.can(school_id, 'fees.plans')));
DROP POLICY IF EXISTS payments_select ON payments;
DROP POLICY IF EXISTS payments_insert ON payments;
CREATE POLICY payments_select ON payments FOR SELECT TO authenticated
  USING ((SELECT private.can(school_id, 'fees.view'))
         OR EXISTS (SELECT 1 FROM fee_installments i WHERE i.id = payments.installment_id AND i.student_id IN (SELECT private.guardian_student_ids())));
CREATE POLICY payments_insert ON payments FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.can(school_id, 'fees.collect')) AND recorded_by_member_id IN (SELECT private.my_member_ids()));
DROP POLICY IF EXISTS payment_reminders_select ON payment_reminders;
DROP POLICY IF EXISTS payment_reminders_insert ON payment_reminders;
CREATE POLICY payment_reminders_select ON payment_reminders FOR SELECT TO authenticated
  USING ((SELECT private.can(school_id, 'fees.view')));
CREATE POLICY payment_reminders_insert ON payment_reminders FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.can(school_id, 'fees.remind')));

-- ------------------------------------------------------------- homework
DROP POLICY IF EXISTS homework_select ON homework;
DROP POLICY IF EXISTS homework_write ON homework;
CREATE POLICY homework_select ON homework FOR SELECT TO authenticated
  USING ((SELECT private.is_office(school_id)) OR class_id IN (SELECT private.visible_class_ids()));
CREATE POLICY homework_write ON homework FOR ALL TO authenticated
  USING ((SELECT private.has_role(school_id, 'admin'))
         OR ((SELECT private.can(school_id, 'homework.own')) AND class_id IN (SELECT private.teacher_class_ids())
             AND author_member_id IN (SELECT private.my_member_ids())))
  WITH CHECK ((SELECT private.has_role(school_id, 'admin'))
         OR ((SELECT private.can(school_id, 'homework.own')) AND class_id IN (SELECT private.teacher_class_ids())
             AND author_member_id IN (SELECT private.my_member_ids())));

-- ---------------------------------------------------- pre-registrations
DROP POLICY IF EXISTS preinscriptions_select ON preinscriptions;
DROP POLICY IF EXISTS preinscriptions_write ON preinscriptions;
CREATE POLICY preinscriptions_select ON preinscriptions FOR SELECT TO authenticated
  USING ((SELECT private.can(school_id, 'preregistrations.view')));
CREATE POLICY preinscriptions_write ON preinscriptions FOR ALL TO authenticated
  USING ((SELECT private.can(school_id, 'preregistrations.manage')))
  WITH CHECK ((SELECT private.can(school_id, 'preregistrations.manage')));
DROP POLICY IF EXISTS preinscription_followups_select ON preinscription_followups;
DROP POLICY IF EXISTS preinscription_followups_write ON preinscription_followups;
CREATE POLICY preinscription_followups_select ON preinscription_followups FOR SELECT TO authenticated
  USING ((SELECT private.can(school_id, 'preregistrations.view')));
CREATE POLICY preinscription_followups_write ON preinscription_followups FOR ALL TO authenticated
  USING ((SELECT private.can(school_id, 'preregistrations.manage')))
  WITH CHECK ((SELECT private.can(school_id, 'preregistrations.manage')));

-- ------------------------------------------------------- staff presence
DROP POLICY IF EXISTS staff_hours_select ON staff_hours;
DROP POLICY IF EXISTS staff_hours_write ON staff_hours;
CREATE POLICY staff_hours_select ON staff_hours FOR SELECT TO authenticated
  USING ((SELECT private.can(school_id, 'staff_presence.view')) OR member_id IN (SELECT private.my_member_ids()));
CREATE POLICY staff_hours_write ON staff_hours FOR ALL TO authenticated
  USING ((SELECT private.can(school_id, 'staff_presence.record')))
  WITH CHECK ((SELECT private.can(school_id, 'staff_presence.record'))
              AND EXISTS (SELECT 1 FROM school_members m WHERE m.id = staff_hours.member_id AND m.school_id = staff_hours.school_id));
DROP POLICY IF EXISTS staff_presence_select ON staff_presence;
DROP POLICY IF EXISTS staff_presence_write ON staff_presence;
CREATE POLICY staff_presence_select ON staff_presence FOR SELECT TO authenticated
  USING ((SELECT private.can(school_id, 'staff_presence.view')) OR member_id IN (SELECT private.my_member_ids()));
CREATE POLICY staff_presence_write ON staff_presence FOR ALL TO authenticated
  USING ((SELECT private.can(school_id, 'staff_presence.record')))
  WITH CHECK ((SELECT private.can(school_id, 'staff_presence.record')));

-- ------------------------------------------------------------ timetable
-- Day-to-day exceptions; building the timetable stays admin only
DROP POLICY IF EXISTS timetable_exceptions_write ON timetable_exceptions;
CREATE POLICY timetable_exceptions_write ON timetable_exceptions FOR ALL TO authenticated
  USING ((SELECT private.can(school_id, 'timetable.exceptions')))
  WITH CHECK ((SELECT private.can(school_id, 'timetable.exceptions')));

-- ------------------------------------------- the per-module version, gone
DROP FUNCTION public.member_access(uuid);
DROP FUNCTION public.can_access(uuid, text, text);
DROP FUNCTION private.can(uuid, text, text);
DROP FUNCTION private.member_level(uuid, text);
DROP FUNCTION private.module_max(text);
