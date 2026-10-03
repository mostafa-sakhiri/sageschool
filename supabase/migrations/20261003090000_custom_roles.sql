-- Access management: roles created by the school, with a level per module.
--
-- A custom role is built on a base role (staff or teacher). The member keeps
-- that base role in school_members.role, so everything the base role gives
-- (a teacher's own classes...) is unchanged; the role's modules add access to
-- the whole school, at the level chosen: none / read / write.
--
-- Built-in roles keep the access they had: admin everything; staff every
-- office module (fees behind settings.staff_fees_access); teacher, parent and
-- student no module (their access is scoped to their classes / children).
--
-- School-wide settings (school, structure, rooms, years, classes, subjects
-- and hours, timetable building, members and roles) stay admin only: no
-- module grants them.

CREATE TABLE school_roles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id   uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (btrim(name) <> ''),
  base_role   text NOT NULL CHECK (base_role IN ('staff', 'teacher')),
  permissions jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(permissions) = 'object'),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, name),
  UNIQUE (id, school_id)
);
CREATE INDEX school_roles_school_idx ON school_roles (school_id);

ALTER TABLE school_members ADD COLUMN custom_role_id uuid;
ALTER TABLE school_members
  ADD CONSTRAINT school_members_custom_role_fkey
  FOREIGN KEY (custom_role_id, school_id) REFERENCES school_roles (id, school_id) ON DELETE SET NULL (custom_role_id);
CREATE INDEX school_members_custom_role_idx ON school_members (custom_role_id) WHERE custom_role_id IS NOT NULL;

-- Module keys and their highest level (classes: read only; their editing is a
-- school setting).
CREATE FUNCTION private.module_max(p_module text) RETURNS int
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE p_module
    WHEN 'classes' THEN 1
    WHEN 'students' THEN 2 WHEN 'attendance' THEN 2 WHEN 'staff_presence' THEN 2
    WHEN 'preregistrations' THEN 2 WHEN 'agenda' THEN 2 WHEN 'events' THEN 2
    WHEN 'announcements' THEN 2 WHEN 'messages' THEN 2 WHEN 'fees' THEN 2
    WHEN 'timetable' THEN 2
    ELSE NULL END;
$$;

-- Permissions are validated on write: known modules, known levels.
CREATE FUNCTION private.school_roles_validate() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  k text;
  v jsonb;
BEGIN
  FOR k, v IN SELECT * FROM jsonb_each(NEW.permissions) LOOP
    IF private.module_max(k) IS NULL THEN
      RAISE EXCEPTION 'module inconnu : %', k USING ERRCODE = '22023';
    END IF;
    IF v NOT IN ('"none"', '"read"', '"write"') THEN
      RAISE EXCEPTION 'niveau d''accès invalide pour %', k USING ERRCODE = '22023';
    END IF;
    IF v = '"write"' AND private.module_max(k) < 2 THEN
      RAISE EXCEPTION 'le module % se consulte seulement', k USING ERRCODE = '22023';
    END IF;
  END LOOP;
  NEW.name := btrim(NEW.name);
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER school_roles_validate BEFORE INSERT OR UPDATE ON school_roles
  FOR EACH ROW EXECUTE FUNCTION private.school_roles_validate();

-- A member's custom role must be built on the member's role; changing the
-- role drops a custom role that no longer fits.
CREATE FUNCTION private.member_custom_role_check() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_base text;
BEGIN
  IF NEW.custom_role_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT base_role INTO v_base FROM public.school_roles WHERE id = NEW.custom_role_id;
  IF v_base IS DISTINCT FROM NEW.role THEN
    IF TG_OP = 'UPDATE' AND NEW.role IS DISTINCT FROM OLD.role AND NEW.custom_role_id IS NOT DISTINCT FROM OLD.custom_role_id THEN
      NEW.custom_role_id := NULL;
    ELSE
      RAISE EXCEPTION 'ce rôle est prévu pour un autre type de membre' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER school_members_custom_role_check BEFORE INSERT OR UPDATE OF role, custom_role_id ON school_members
  FOR EACH ROW EXECUTE FUNCTION private.member_custom_role_check();

-- 0 none, 1 read, 2 write: one member, one module.
CREATE FUNCTION private.member_level(p_member_id uuid, p_module text) RETURNS int
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE
    WHEN m.role = 'admin' THEN private.module_max(p_module)
    WHEN r.id IS NOT NULL THEN
      LEAST(private.module_max(p_module),
            CASE r.permissions ->> p_module WHEN 'write' THEN 2 WHEN 'read' THEN 1 ELSE 0 END)
    WHEN m.role = 'staff' THEN
      CASE p_module
        WHEN 'fees' THEN CASE WHEN COALESCE((s.settings ->> 'staff_fees_access')::boolean, false) THEN 2 ELSE 0 END
        ELSE private.module_max(p_module)
      END
    ELSE 0
  END
  FROM public.school_members m
  JOIN public.schools s ON s.id = m.school_id
  LEFT JOIN public.school_roles r ON r.id = m.custom_role_id
  WHERE m.id = p_member_id;
$$;

-- Does the current user reach `p_level` ('read' | 'write') on a module of
-- the school, through any of their active memberships?
CREATE FUNCTION private.can(p_school_id uuid, p_module text, p_level text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.school_members m
    JOIN public.schools s ON s.id = m.school_id AND s.is_active
    WHERE m.school_id = p_school_id AND m.user_id = private.current_user_id() AND m.status = 'active'
      AND COALESCE(private.member_level(m.id, p_module), 0) >= CASE p_level WHEN 'write' THEN 2 ELSE 1 END);
$$;

-- "Office": the school's directory (students, families, classes, timetables,
-- the outgoing messages) — admin, staff, and any member whose custom role
-- opens at least one module.
CREATE OR REPLACE FUNCTION private.is_office(p_school_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.school_members m
    JOIN public.schools s ON s.id = m.school_id AND s.is_active
    LEFT JOIN public.school_roles r ON r.id = m.custom_role_id
    WHERE m.school_id = p_school_id AND m.user_id = private.current_user_id() AND m.status = 'active'
      AND (m.role IN ('admin', 'staff')
           OR EXISTS (SELECT 1 FROM jsonb_each_text(r.permissions) p WHERE p.value IN ('read', 'write'))));
$$;

CREATE OR REPLACE FUNCTION private.can_manage_fees(p_school_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT private.can(p_school_id, 'fees', 'write');
$$;

REVOKE ALL ON FUNCTION private.module_max(text), private.member_level(uuid, text), private.can(uuid, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION private.module_max(text), private.member_level(uuid, text), private.can(uuid, text, text) TO authenticated;

-- What one of my memberships may do, module by module (the app's menus and
-- buttons follow it; the policies below enforce it).
CREATE FUNCTION public.member_access(p_member_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_object_agg(k, CASE COALESCE(private.member_level(m.id, k), 0) WHEN 2 THEN 'write' WHEN 1 THEN 'read' ELSE 'none' END)
  FROM public.school_members m,
       unnest(ARRAY['students', 'attendance', 'staff_presence', 'preregistrations', 'agenda', 'events',
                    'announcements', 'messages', 'fees', 'timetable', 'classes']) k
  WHERE m.id = p_member_id AND m.user_id = private.current_user_id();
$$;
REVOKE ALL ON FUNCTION public.member_access(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.member_access(uuid) TO authenticated;

-- ---------------------------------------------------------------- school_roles
ALTER TABLE school_roles ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON school_roles TO authenticated;
CREATE POLICY school_roles_select ON school_roles FOR SELECT TO authenticated
  USING ((SELECT private.is_school_member(school_id)));
CREATE POLICY school_roles_write ON school_roles FOR ALL TO authenticated
  USING ((SELECT private.has_role(school_id, 'admin')))
  WITH CHECK ((SELECT private.has_role(school_id, 'admin')));

-- ------------------------------------------------------- policies, by module
-- announcements
DROP POLICY announcement_targets_select ON announcement_targets;
DROP POLICY announcement_targets_write ON announcement_targets;
CREATE POLICY announcement_targets_select ON announcement_targets FOR SELECT TO authenticated
  USING ((SELECT private.can(school_id, 'announcements', 'read')) OR private.announcement_visible(announcement_id));
CREATE POLICY announcement_targets_write ON announcement_targets FOR ALL TO authenticated
  USING ((SELECT private.can(school_id, 'announcements', 'write')))
  WITH CHECK ((SELECT private.can(school_id, 'announcements', 'write')));

DROP POLICY announcements_select ON announcements;
DROP POLICY announcements_insert ON announcements;
DROP POLICY announcements_update ON announcements;
DROP POLICY announcements_delete ON announcements;
CREATE POLICY announcements_select ON announcements FOR SELECT TO authenticated
  USING ((SELECT private.can(school_id, 'announcements', 'read')) OR private.announcement_visible(id));
CREATE POLICY announcements_insert ON announcements FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.can(school_id, 'announcements', 'write')) AND author_member_id IN (SELECT private.my_member_ids()));
CREATE POLICY announcements_update ON announcements FOR UPDATE TO authenticated
  USING ((SELECT private.can(school_id, 'announcements', 'write')))
  WITH CHECK ((SELECT private.can(school_id, 'announcements', 'write')));
CREATE POLICY announcements_delete ON announcements FOR DELETE TO authenticated
  USING ((SELECT private.can(school_id, 'announcements', 'write')));

CREATE OR REPLACE FUNCTION private.announcement_visible(p_announcement_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.announcements a
    WHERE a.id = p_announcement_id
      AND (
        private.can(a.school_id, 'announcements', 'read')
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
  -- publish_announcement: same body, the module's write level instead of "office"
  def := pg_get_functiondef('public.publish_announcement(uuid)'::regprocedure);
  IF position('private.is_office(a.school_id)' IN def) = 0 THEN
    RAISE EXCEPTION 'publish_announcement changed: review this migration';
  END IF;
  EXECUTE replace(def, 'private.is_office(a.school_id)', 'private.can(a.school_id, ''announcements'', ''write'')');
END;
$$;

-- agenda
DROP POLICY appointments_office ON appointments;
CREATE POLICY appointments_select ON appointments FOR SELECT TO authenticated
  USING ((SELECT private.can(school_id, 'agenda', 'read')));
CREATE POLICY appointments_write ON appointments FOR ALL TO authenticated
  USING ((SELECT private.can(school_id, 'agenda', 'write')))
  WITH CHECK ((SELECT private.can(school_id, 'agenda', 'write')));

-- attendance (students') — a teacher keeps their own classes
DROP POLICY attendance_records_select ON attendance_records;
DROP POLICY attendance_records_insert ON attendance_records;
DROP POLICY attendance_records_update ON attendance_records;
DROP POLICY attendance_records_delete ON attendance_records;
CREATE POLICY attendance_records_select ON attendance_records FOR SELECT TO authenticated
  USING ((SELECT private.can(school_id, 'attendance', 'read'))
         OR class_id IN (SELECT private.teacher_class_ids())
         OR student_id IN (SELECT private.family_student_ids()));
CREATE POLICY attendance_records_insert ON attendance_records FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.can(school_id, 'attendance', 'write')) OR class_id IN (SELECT private.teacher_class_ids()));
CREATE POLICY attendance_records_update ON attendance_records FOR UPDATE TO authenticated
  USING ((SELECT private.can(school_id, 'attendance', 'write')) OR class_id IN (SELECT private.teacher_class_ids()))
  WITH CHECK ((SELECT private.can(school_id, 'attendance', 'write')) OR class_id IN (SELECT private.teacher_class_ids()));
CREATE POLICY attendance_records_delete ON attendance_records FOR DELETE TO authenticated
  USING ((SELECT private.can(school_id, 'attendance', 'write')));

DROP POLICY student_alerts_office ON student_alerts;
CREATE POLICY student_alerts_select ON student_alerts FOR SELECT TO authenticated
  USING ((SELECT private.can(school_id, 'attendance', 'read')));
CREATE POLICY student_alerts_write ON student_alerts FOR ALL TO authenticated
  USING ((SELECT private.can(school_id, 'attendance', 'write')))
  WITH CHECK ((SELECT private.can(school_id, 'attendance', 'write')));

-- events (and birthdays)
DROP POLICY events_write ON events;
CREATE POLICY events_write ON events FOR ALL TO authenticated
  USING ((SELECT private.can(school_id, 'events', 'write')))
  WITH CHECK ((SELECT private.can(school_id, 'events', 'write')));
DROP POLICY event_targets_write ON event_targets;
CREATE POLICY event_targets_write ON event_targets FOR ALL TO authenticated
  USING ((SELECT private.can(school_id, 'events', 'write')))
  WITH CHECK ((SELECT private.can(school_id, 'events', 'write')));
DROP POLICY birthday_plans_office ON birthday_plans;
CREATE POLICY birthday_plans_select ON birthday_plans FOR SELECT TO authenticated
  USING ((SELECT private.can(school_id, 'events', 'read')));
CREATE POLICY birthday_plans_write ON birthday_plans FOR ALL TO authenticated
  USING ((SELECT private.can(school_id, 'events', 'write')))
  WITH CHECK ((SELECT private.can(school_id, 'events', 'write')));

-- messages (cases with parents)
DROP POLICY cases_select ON cases;
DROP POLICY cases_insert ON cases;
DROP POLICY cases_update ON cases;
CREATE POLICY cases_select ON cases FOR SELECT TO authenticated
  USING ((SELECT private.can(school_id, 'messages', 'read')) OR parent_member_id IN (SELECT private.my_member_ids('parent')));
CREATE POLICY cases_insert ON cases FOR INSERT TO authenticated
  WITH CHECK (
    status = 'open' AND resolved_at IS NULL AND (
      (direction = 'parent_to_school' AND channel = 'app'
        AND parent_member_id IN (SELECT private.my_member_ids('parent'))
        AND opened_by_member_id = parent_member_id
        AND (student_id IS NULL OR student_id IN (SELECT private.guardian_student_ids())))
      OR (direction = 'parent_to_school' AND channel <> 'app'
        AND (SELECT private.can(school_id, 'messages', 'write'))
        AND opened_by_member_id IN (SELECT private.my_member_ids()))
      OR (direction = 'school_to_parent'
        AND (SELECT private.can(school_id, 'messages', 'write'))
        AND opened_by_member_id IN (SELECT private.my_member_ids()))));
CREATE POLICY cases_update ON cases FOR UPDATE TO authenticated
  USING ((SELECT private.can(school_id, 'messages', 'write')))
  WITH CHECK ((SELECT private.can(school_id, 'messages', 'write')));

DROP POLICY case_messages_insert ON case_messages;
CREATE POLICY case_messages_insert ON case_messages FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM cases c JOIN school_members m ON m.id = case_messages.author_member_id
    WHERE c.id = case_messages.case_id
      AND m.id IN (SELECT private.my_member_ids())
      AND m.school_id = c.school_id
      AND (m.id = c.parent_member_id OR private.can(c.school_id, 'messages', 'write'))));

-- The school answers = anyone but the parent of the case writes
CREATE OR REPLACE FUNCTION private.case_messages_after_insert() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  c public.cases%ROWTYPE;
  v_parent_user uuid;
BEGIN
  SELECT * INTO c FROM public.cases WHERE id = NEW.case_id FOR UPDATE;
  IF c.status = 'resolved' THEN
    RAISE EXCEPTION 'cet échange est clos' USING ERRCODE = '23514';
  END IF;

  IF c.direction = 'parent_to_school' AND c.channel <> 'app'
     AND NOT EXISTS (SELECT 1 FROM public.case_messages x WHERE x.case_id = c.id AND x.id <> NEW.id) THEN
    UPDATE public.cases SET status = 'open' WHERE id = c.id;
  ELSIF NEW.author_member_id IS DISTINCT FROM c.parent_member_id THEN
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

-- students (the directory stays readable by the office: every module shows names)
DROP POLICY students_write ON students;
CREATE POLICY students_write ON students FOR ALL TO authenticated
  USING ((SELECT private.can(school_id, 'students', 'write')))
  WITH CHECK ((SELECT private.can(school_id, 'students', 'write')));
DROP POLICY student_guardians_write ON student_guardians;
CREATE POLICY student_guardians_write ON student_guardians FOR ALL TO authenticated
  USING ((SELECT private.can(school_id, 'students', 'write')))
  WITH CHECK ((SELECT private.can(school_id, 'students', 'write')));
DROP POLICY enrollments_write ON enrollments;
CREATE POLICY enrollments_write ON enrollments FOR ALL TO authenticated
  USING ((SELECT private.can(school_id, 'students', 'write')))
  WITH CHECK ((SELECT private.can(school_id, 'students', 'write')));

CREATE OR REPLACE FUNCTION public.update_member_contact(p_member_id uuid, p_full_name text, p_phone text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  m public.school_members;
  v_phone text := NULLIF(btrim(p_phone), '');
BEGIN
  SELECT * INTO m FROM public.school_members WHERE id = p_member_id;
  IF m.id IS NULL THEN
    RAISE EXCEPTION 'membre introuvable' USING ERRCODE = 'P0002';
  END IF;
  IF NOT (
    m.user_id = private.current_user_id()
    OR private.has_role(m.school_id, 'admin')
    OR (private.can(m.school_id, 'students', 'write') AND m.role IN ('parent', 'student'))
  ) THEN
    RAISE EXCEPTION 'droits insuffisants' USING ERRCODE = '42501';
  END IF;
  IF v_phone IS NOT NULL AND v_phone !~ '^\+?[0-9 .-]{6,20}$' THEN
    RAISE EXCEPTION 'numéro de téléphone invalide' USING ERRCODE = '22023';
  END IF;
  IF v_phone IS NULL AND NOT EXISTS (SELECT 1 FROM public.users WHERE id = m.user_id AND email IS NOT NULL) THEN
    RAISE EXCEPTION 'il faut au moins un e-mail ou un téléphone' USING ERRCODE = '23514';
  END IF;
  UPDATE public.users
     SET phone = regexp_replace(v_phone, '[ .-]', '', 'g'),
         full_name = COALESCE(NULLIF(btrim(p_full_name), ''), full_name)
   WHERE id = m.user_id;
END;
$$;

-- fees: reading the plans and installments needs the module, writing too
DROP POLICY fee_plans_select ON fee_plans;
CREATE POLICY fee_plans_select ON fee_plans FOR SELECT TO authenticated
  USING ((SELECT private.can(school_id, 'fees', 'read')));
DROP POLICY fee_installments_select ON fee_installments;
CREATE POLICY fee_installments_select ON fee_installments FOR SELECT TO authenticated
  USING ((SELECT private.can(school_id, 'fees', 'read')) OR student_id IN (SELECT private.guardian_student_ids()));
DROP POLICY payments_select ON payments;
CREATE POLICY payments_select ON payments FOR SELECT TO authenticated
  USING ((SELECT private.can(school_id, 'fees', 'read'))
         OR EXISTS (SELECT 1 FROM fee_installments i WHERE i.id = payments.installment_id AND i.student_id IN (SELECT private.guardian_student_ids())));
DROP POLICY payment_reminders_select ON payment_reminders;
CREATE POLICY payment_reminders_select ON payment_reminders FOR SELECT TO authenticated
  USING ((SELECT private.can(school_id, 'fees', 'read')));

-- pre-registrations
DROP POLICY preinscriptions_office ON preinscriptions;
CREATE POLICY preinscriptions_select ON preinscriptions FOR SELECT TO authenticated
  USING ((SELECT private.can(school_id, 'preregistrations', 'read')));
CREATE POLICY preinscriptions_write ON preinscriptions FOR ALL TO authenticated
  USING ((SELECT private.can(school_id, 'preregistrations', 'write')))
  WITH CHECK ((SELECT private.can(school_id, 'preregistrations', 'write')));
DROP POLICY preinscription_followups_office ON preinscription_followups;
CREATE POLICY preinscription_followups_select ON preinscription_followups FOR SELECT TO authenticated
  USING ((SELECT private.can(school_id, 'preregistrations', 'read')));
CREATE POLICY preinscription_followups_write ON preinscription_followups FOR ALL TO authenticated
  USING ((SELECT private.can(school_id, 'preregistrations', 'write')))
  WITH CHECK ((SELECT private.can(school_id, 'preregistrations', 'write')));

-- staff presence and usual hours; everyone keeps their own
DROP POLICY staff_hours_select ON staff_hours;
DROP POLICY staff_hours_write ON staff_hours;
CREATE POLICY staff_hours_select ON staff_hours FOR SELECT TO authenticated
  USING ((SELECT private.can(school_id, 'staff_presence', 'read')) OR member_id IN (SELECT private.my_member_ids()));
CREATE POLICY staff_hours_write ON staff_hours FOR ALL TO authenticated
  USING ((SELECT private.can(school_id, 'staff_presence', 'write')))
  WITH CHECK ((SELECT private.can(school_id, 'staff_presence', 'write'))
              AND EXISTS (SELECT 1 FROM school_members m WHERE m.id = staff_hours.member_id AND m.school_id = staff_hours.school_id));
DROP POLICY staff_presence_select ON staff_presence;
DROP POLICY staff_presence_write ON staff_presence;
CREATE POLICY staff_presence_select ON staff_presence FOR SELECT TO authenticated
  USING ((SELECT private.can(school_id, 'staff_presence', 'read')) OR member_id IN (SELECT private.my_member_ids()));
CREATE POLICY staff_presence_write ON staff_presence FOR ALL TO authenticated
  USING ((SELECT private.can(school_id, 'staff_presence', 'write')))
  WITH CHECK ((SELECT private.can(school_id, 'staff_presence', 'write')));

-- timetable: day-to-day exceptions (absent teacher, replacement); building
-- the timetable stays admin only
DROP POLICY timetable_exceptions_write ON timetable_exceptions;
CREATE POLICY timetable_exceptions_write ON timetable_exceptions FOR ALL TO authenticated
  USING ((SELECT private.can(school_id, 'timetable', 'write')))
  WITH CHECK ((SELECT private.can(school_id, 'timetable', 'write')));

-- The same check for server functions (invitations, imports), as the caller
CREATE FUNCTION public.can_access(p_school_id uuid, p_module text, p_level text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT private.can(p_school_id, p_module, p_level);
$$;
REVOKE ALL ON FUNCTION public.can_access(uuid, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.can_access(uuid, text, text) TO authenticated;
