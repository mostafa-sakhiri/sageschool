-- =====================================================================
-- RLS isolation tests (pgTAP). Run: npx supabase test db
-- One transaction, rolled back at the end.
--
-- Fixtures
--   School A: admin, staff, teacher T1 (class A1), teacher T2 (class A2),
--     parent PA (child S1 in A1), parent PB (child S2 in A2),
--     S1 has a student login; S3 (also A1) has none.
--   School B: admin B, student S9 in class B1, parent P9.
--
-- ID scheme (hex): a1..NN auth users, b1..NN members, c1 students, d1 classes,
-- e1 years, f1 nodes, 71 versions, 72 slots, 73 announcements, 74 installments,
-- 75 attendance, 76 cases, 77 homework, 78 subjects.
-- =====================================================================
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;

SELECT plan(48);

-- Impersonate a user: JWT claims + the authenticated role (RESET ROLE first).
CREATE FUNCTION pg_temp.login(p_email text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', (SELECT id FROM auth.users WHERE email = p_email),
                      'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.login(text) TO authenticated;

-- ---------------------------------------------------------------------
-- Fixtures (as postgres: RLS bypassed)
-- ---------------------------------------------------------------------
INSERT INTO auth.users (id, email, aud, role, raw_user_meta_data) VALUES
  ('a1000000-0000-0000-0000-000000000001', 'admin.a@test.ma', 'authenticated', 'authenticated', '{"full_name":"Admin A"}'),
  ('a1000000-0000-0000-0000-000000000002', 'staff.a@test.ma', 'authenticated', 'authenticated', '{"full_name":"Staff A"}'),
  ('a1000000-0000-0000-0000-000000000003', 't1@test.ma',      'authenticated', 'authenticated', '{"full_name":"Teacher One"}'),
  ('a1000000-0000-0000-0000-000000000004', 't2@test.ma',      'authenticated', 'authenticated', '{"full_name":"Teacher Two"}'),
  ('a1000000-0000-0000-0000-000000000005', 'pa@test.ma',      'authenticated', 'authenticated', '{"full_name":"Parent A"}'),
  ('a1000000-0000-0000-0000-000000000006', 'pb@test.ma',      'authenticated', 'authenticated', '{"full_name":"Parent B"}'),
  ('a1000000-0000-0000-0000-000000000007', 's1@test.ma',      'authenticated', 'authenticated', '{"full_name":"Student One"}'),
  ('a1000000-0000-0000-0000-000000000011', 'admin.b@test.ma', 'authenticated', 'authenticated', '{"full_name":"Admin B"}'),
  ('a1000000-0000-0000-0000-000000000012', 'p9@test.ma',      'authenticated', 'authenticated', '{"full_name":"Parent Nine"}');

INSERT INTO schools (id, name, slug) VALUES
  ('5c000000-0000-0000-0000-00000000000a', 'École A', 'ecole-a'),
  ('5c000000-0000-0000-0000-00000000000b', 'École B', 'ecole-b');

INSERT INTO school_members (id, school_id, user_id, role)
SELECT m.id::uuid, m.school::uuid, u.id, m.role
FROM (VALUES
  ('b1000000-0000-0000-0000-000000000001', '5c000000-0000-0000-0000-00000000000a', 'admin.a@test.ma', 'admin'),
  ('b1000000-0000-0000-0000-000000000002', '5c000000-0000-0000-0000-00000000000a', 'staff.a@test.ma', 'staff'),
  ('b1000000-0000-0000-0000-000000000003', '5c000000-0000-0000-0000-00000000000a', 't1@test.ma',      'teacher'),
  ('b1000000-0000-0000-0000-000000000004', '5c000000-0000-0000-0000-00000000000a', 't2@test.ma',      'teacher'),
  ('b1000000-0000-0000-0000-000000000005', '5c000000-0000-0000-0000-00000000000a', 'pa@test.ma',      'parent'),
  ('b1000000-0000-0000-0000-000000000006', '5c000000-0000-0000-0000-00000000000a', 'pb@test.ma',      'parent'),
  ('b1000000-0000-0000-0000-000000000007', '5c000000-0000-0000-0000-00000000000a', 's1@test.ma',      'student'),
  ('b1000000-0000-0000-0000-000000000011', '5c000000-0000-0000-0000-00000000000b', 'admin.b@test.ma', 'admin'),
  ('b1000000-0000-0000-0000-000000000012', '5c000000-0000-0000-0000-00000000000b', 'p9@test.ma',      'parent')
) AS m(id, school, email, role)
JOIN users u ON u.email = m.email;

INSERT INTO academic_years (id, school_id, name, starts_on, ends_on, is_current) VALUES
  ('e1000000-0000-0000-0000-00000000000a', '5c000000-0000-0000-0000-00000000000a', '2026-2027', '2026-09-07', '2027-06-30', true),
  ('e1000000-0000-0000-0000-00000000000b', '5c000000-0000-0000-0000-00000000000b', '2026-2027', '2026-09-07', '2027-06-30', true);

INSERT INTO curriculum_nodes (id, school_id, parent_id, kind, code, name) VALUES
  ('f1000000-0000-0000-0000-000000000001', '5c000000-0000-0000-0000-00000000000a', NULL, 'cycle', 'PRIM', 'Primaire'),
  ('f1000000-0000-0000-0000-000000000009', '5c000000-0000-0000-0000-00000000000b', NULL, 'cycle', 'PRIM', 'Primaire');
INSERT INTO curriculum_nodes (id, school_id, parent_id, kind, code, name) VALUES
  ('f1000000-0000-0000-0000-000000000002', '5c000000-0000-0000-0000-00000000000a', 'f1000000-0000-0000-0000-000000000001', 'level', 'PRIM_1', '1ère année'),
  ('f1000000-0000-0000-0000-000000000003', '5c000000-0000-0000-0000-00000000000a', 'f1000000-0000-0000-0000-000000000001', 'level', 'PRIM_2', '2ème année'),
  ('f1000000-0000-0000-0000-00000000000a', '5c000000-0000-0000-0000-00000000000b', 'f1000000-0000-0000-0000-000000000009', 'level', 'PRIM_1', '1ère année');

INSERT INTO subjects (id, school_id, name, code) VALUES
  ('78000000-0000-0000-0000-00000000000a', '5c000000-0000-0000-0000-00000000000a', 'Mathématiques', 'MATH'),
  ('78000000-0000-0000-0000-00000000000b', '5c000000-0000-0000-0000-00000000000b', 'Mathématiques', 'MATH');

INSERT INTO classes (id, school_id, academic_year_id, node_id, name) VALUES
  ('d1000000-0000-0000-0000-000000000001', '5c000000-0000-0000-0000-00000000000a', 'e1000000-0000-0000-0000-00000000000a', 'f1000000-0000-0000-0000-000000000002', '1ère A'),
  ('d1000000-0000-0000-0000-000000000002', '5c000000-0000-0000-0000-00000000000a', 'e1000000-0000-0000-0000-00000000000a', 'f1000000-0000-0000-0000-000000000003', '2ème A'),
  ('d1000000-0000-0000-0000-000000000009', '5c000000-0000-0000-0000-00000000000b', 'e1000000-0000-0000-0000-00000000000b', 'f1000000-0000-0000-0000-00000000000a', '1ère B');

INSERT INTO students (id, school_id, first_name, last_name, member_id) VALUES
  ('c1000000-0000-0000-0000-000000000001', '5c000000-0000-0000-0000-00000000000a', 'Salma', 'Un',    'b1000000-0000-0000-0000-000000000007'),
  ('c1000000-0000-0000-0000-000000000002', '5c000000-0000-0000-0000-00000000000a', 'Omar',  'Deux',  NULL),
  ('c1000000-0000-0000-0000-000000000003', '5c000000-0000-0000-0000-00000000000a', 'Rania', 'Trois', NULL),
  ('c1000000-0000-0000-0000-000000000009', '5c000000-0000-0000-0000-00000000000b', 'Adam',  'Neuf',  NULL);

INSERT INTO student_guardians (school_id, student_id, guardian_member_id, relationship, is_primary, is_payer) VALUES
  ('5c000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000005', 'mother', true, true),
  ('5c000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000006', 'father', true, true),
  ('5c000000-0000-0000-0000-00000000000b', 'c1000000-0000-0000-0000-000000000009', 'b1000000-0000-0000-0000-000000000012', 'mother', true, true);

INSERT INTO enrollments (school_id, student_id, class_id, academic_year_id) VALUES
  ('5c000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-00000000000a'),
  ('5c000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000002', 'd1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-00000000000a'),
  ('5c000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000003', 'd1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-00000000000a'),
  ('5c000000-0000-0000-0000-00000000000b', 'c1000000-0000-0000-0000-000000000009', 'd1000000-0000-0000-0000-000000000009', 'e1000000-0000-0000-0000-00000000000b');

INSERT INTO teaching_assignments (school_id, class_id, subject_id, teacher_member_id) VALUES
  ('5c000000-0000-0000-0000-00000000000a', 'd1000000-0000-0000-0000-000000000001', '78000000-0000-0000-0000-00000000000a', 'b1000000-0000-0000-0000-000000000003'),
  ('5c000000-0000-0000-0000-00000000000a', 'd1000000-0000-0000-0000-000000000002', '78000000-0000-0000-0000-00000000000a', 'b1000000-0000-0000-0000-000000000004');

INSERT INTO timetable_versions (id, school_id, class_id, name, effective_from) VALUES
  ('71000000-0000-0000-0000-000000000001', '5c000000-0000-0000-0000-00000000000a', 'd1000000-0000-0000-0000-000000000001', 'Rentrée', '2026-09-07'),
  ('71000000-0000-0000-0000-000000000002', '5c000000-0000-0000-0000-00000000000a', 'd1000000-0000-0000-0000-000000000002', 'Rentrée', '2026-09-07'),
  ('71000000-0000-0000-0000-000000000003', '5c000000-0000-0000-0000-00000000000a', 'd1000000-0000-0000-0000-000000000001', 'Brouillon', '2027-01-04');
INSERT INTO timetable_slots (id, school_id, version_id, class_id, subject_id, teacher_member_id, weekday, starts_at, ends_at) VALUES
  ('72000000-0000-0000-0000-000000000001', '5c000000-0000-0000-0000-00000000000a', '71000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', '78000000-0000-0000-0000-00000000000a', 'b1000000-0000-0000-0000-000000000003', 1, '08:30', '09:30'),
  ('72000000-0000-0000-0000-000000000002', '5c000000-0000-0000-0000-00000000000a', '71000000-0000-0000-0000-000000000002', 'd1000000-0000-0000-0000-000000000002', '78000000-0000-0000-0000-00000000000a', 'b1000000-0000-0000-0000-000000000004', 1, '08:30', '09:30'),
  ('72000000-0000-0000-0000-000000000003', '5c000000-0000-0000-0000-00000000000a', '71000000-0000-0000-0000-000000000003', 'd1000000-0000-0000-0000-000000000001', '78000000-0000-0000-0000-00000000000a', 'b1000000-0000-0000-0000-000000000003', 2, '08:30', '09:30');
SELECT publish_timetable_version('71000000-0000-0000-0000-000000000001');
SELECT publish_timetable_version('71000000-0000-0000-0000-000000000002');

-- One-day exception on A1: substitute teacher on Monday 2026-10-05
INSERT INTO timetable_exceptions (school_id, class_id, exception_date, kind, slot_id, teacher_member_id, reason_code) VALUES
  ('5c000000-0000-0000-0000-00000000000a', 'd1000000-0000-0000-0000-000000000001', '2026-10-05', 'changed',
   '72000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000004', 'teacher_absent');

INSERT INTO homework (id, school_id, class_id, subject_id, author_member_id, title, body) VALUES
  ('77000000-0000-0000-0000-000000000001', '5c000000-0000-0000-0000-00000000000a', 'd1000000-0000-0000-0000-000000000001', '78000000-0000-0000-0000-00000000000a', 'b1000000-0000-0000-0000-000000000003', 'Exercices p.12', 'Faire 1 à 4'),
  ('77000000-0000-0000-0000-000000000002', '5c000000-0000-0000-0000-00000000000a', 'd1000000-0000-0000-0000-000000000002', '78000000-0000-0000-0000-00000000000a', 'b1000000-0000-0000-0000-000000000004', 'Exercices p.30', 'Faire 5 à 8');

-- Announcements: whole school, class A1, node "2ème année" (A2), draft
INSERT INTO announcements (id, school_id, author_member_id, title, body, status) VALUES
  ('73000000-0000-0000-0000-000000000001', '5c000000-0000-0000-0000-00000000000a', 'b1000000-0000-0000-0000-000000000001', 'Toute l''école', '...', 'published'),
  ('73000000-0000-0000-0000-000000000002', '5c000000-0000-0000-0000-00000000000a', 'b1000000-0000-0000-0000-000000000001', 'Classe 1ère A', '...', 'published'),
  ('73000000-0000-0000-0000-000000000003', '5c000000-0000-0000-0000-00000000000a', 'b1000000-0000-0000-0000-000000000001', 'Niveau 2ème année', '...', 'published'),
  ('73000000-0000-0000-0000-000000000004', '5c000000-0000-0000-0000-00000000000a', 'b1000000-0000-0000-0000-000000000001', 'Brouillon', '...', 'draft'),
  ('73000000-0000-0000-0000-000000000009', '5c000000-0000-0000-0000-00000000000b', 'b1000000-0000-0000-0000-000000000011', 'École B', '...', 'published');
INSERT INTO announcement_targets (school_id, announcement_id, class_id, node_id) VALUES
  ('5c000000-0000-0000-0000-00000000000a', '73000000-0000-0000-0000-000000000002', 'd1000000-0000-0000-0000-000000000001', NULL),
  ('5c000000-0000-0000-0000-00000000000a', '73000000-0000-0000-0000-000000000003', NULL, 'f1000000-0000-0000-0000-000000000003');

INSERT INTO fee_installments (id, school_id, student_id, academic_year_id, label, amount_due, due_on) VALUES
  ('74000000-0000-0000-0000-000000000001', '5c000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-00000000000a', 'Septembre', 1500, '2026-09-10'),
  ('74000000-0000-0000-0000-000000000002', '5c000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-00000000000a', 'Septembre', 1500, '2026-09-10'),
  ('74000000-0000-0000-0000-000000000009', '5c000000-0000-0000-0000-00000000000b', 'c1000000-0000-0000-0000-000000000009', 'e1000000-0000-0000-0000-00000000000b', 'Septembre', 2000, '2026-09-10');
INSERT INTO payments (school_id, installment_id, amount) VALUES
  ('5c000000-0000-0000-0000-00000000000a', '74000000-0000-0000-0000-000000000001', 500),
  ('5c000000-0000-0000-0000-00000000000a', '74000000-0000-0000-0000-000000000002', 1500);

INSERT INTO attendance_records (id, school_id, class_id, student_id, session_date, slot_id, status) VALUES
  ('75000000-0000-0000-0000-000000000001', '5c000000-0000-0000-0000-00000000000a', 'd1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', '2026-10-05', '72000000-0000-0000-0000-000000000001', 'absent'),
  ('75000000-0000-0000-0000-000000000002', '5c000000-0000-0000-0000-00000000000a', 'd1000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000002', '2026-10-05', '72000000-0000-0000-0000-000000000002', 'late'),
  ('75000000-0000-0000-0000-000000000003', '5c000000-0000-0000-0000-00000000000a', 'd1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000003', '2026-10-05', '72000000-0000-0000-0000-000000000001', 'absent');

INSERT INTO cases (id, school_id, direction, subject, parent_member_id, opened_by_member_id, student_id) VALUES
  ('76000000-0000-0000-0000-000000000001', '5c000000-0000-0000-0000-00000000000a', 'parent_to_school', 'Cantine', 'b1000000-0000-0000-0000-000000000005', 'b1000000-0000-0000-0000-000000000005', 'c1000000-0000-0000-0000-000000000001'),
  ('76000000-0000-0000-0000-000000000002', '5c000000-0000-0000-0000-00000000000a', 'parent_to_school', 'Transport', 'b1000000-0000-0000-0000-000000000006', 'b1000000-0000-0000-0000-000000000006', 'c1000000-0000-0000-0000-000000000002'),
  ('76000000-0000-0000-0000-000000000009', '5c000000-0000-0000-0000-00000000000b', 'parent_to_school', 'Uniforme', 'b1000000-0000-0000-0000-000000000012', 'b1000000-0000-0000-0000-000000000012', 'c1000000-0000-0000-0000-000000000009');
INSERT INTO case_messages (school_id, case_id, author_member_id, body) VALUES
  ('5c000000-0000-0000-0000-00000000000a', '76000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000005', 'Question sur la cantine'),
  ('5c000000-0000-0000-0000-00000000000a', '76000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000006', 'Question sur le transport');

-- ---------------------------------------------------------------------
-- anon: no table access at all
-- ---------------------------------------------------------------------
SET LOCAL ROLE anon;
SELECT throws_ok('SELECT count(*) FROM students', '42501', NULL, 'anon cannot read students');
RESET ROLE;

-- ---------------------------------------------------------------------
-- Parent A
-- ---------------------------------------------------------------------
SELECT pg_temp.login('pa@test.ma');
SELECT results_eq('SELECT id FROM students', $$VALUES ('c1000000-0000-0000-0000-000000000001'::uuid)$$,
  'parent A sees only their own child');
SELECT is((SELECT count(*) FROM students WHERE id = 'c1000000-0000-0000-0000-000000000002')::int, 0,
  'parent A cannot select parent B''s child');
SELECT results_eq('SELECT id FROM attendance_records', $$VALUES ('75000000-0000-0000-0000-000000000001'::uuid)$$,
  'parent A sees only their child''s absences (not classmates'', not parent B''s)');
SELECT results_eq('SELECT id FROM cases', $$VALUES ('76000000-0000-0000-0000-000000000001'::uuid)$$,
  'parent A sees only their own cases');
SELECT is((SELECT count(*) FROM case_messages WHERE case_id = '76000000-0000-0000-0000-000000000002')::int, 0,
  'parent A cannot read messages of parent B''s case');
SELECT results_eq('SELECT id FROM installment_balances', $$VALUES ('74000000-0000-0000-0000-000000000001'::uuid)$$,
  'parent A sees only their child''s fee installments (view is security_invoker)');
SELECT is((SELECT payment_status FROM installment_balances), 'overdue',
  'installment status computed from partial payment (500/1500, due date passed)');
SELECT results_eq('SELECT id FROM announcements ORDER BY id',
  $$VALUES ('73000000-0000-0000-0000-000000000001'::uuid), ('73000000-0000-0000-0000-000000000002'::uuid)$$,
  'parent A sees whole-school + class A1 announcements, not the A2-node one nor the draft');
SELECT results_eq('SELECT id FROM timetable_slots', $$VALUES ('72000000-0000-0000-0000-000000000001'::uuid)$$,
  'parent A sees their child''s published timetable only (no draft, no other class)');
SELECT is((SELECT count(*) FROM timetable_exceptions)::int, 1, 'parent A sees the exception on their child''s class');
SELECT is((SELECT count(*) FROM classes)::int, 1, 'parent A sees only their child''s class');
SELECT throws_ok($$INSERT INTO cases (school_id, direction, subject, parent_member_id, opened_by_member_id)
                  VALUES ('5c000000-0000-0000-0000-00000000000a', 'parent_to_school', 'x',
                          'b1000000-0000-0000-0000-000000000006', 'b1000000-0000-0000-0000-000000000006')$$,
  '42501', NULL, 'parent A cannot open a case on behalf of parent B');
SELECT lives_ok($$INSERT INTO cases (school_id, direction, subject, parent_member_id, opened_by_member_id, student_id)
                  VALUES ('5c000000-0000-0000-0000-00000000000a', 'parent_to_school', 'Bus',
                          'b1000000-0000-0000-0000-000000000005', 'b1000000-0000-0000-0000-000000000005',
                          'c1000000-0000-0000-0000-000000000001')$$,
  'parent A can open a case for their own child');
SELECT throws_ok($$INSERT INTO attendance_records (school_id, class_id, student_id, session_date, status)
                  VALUES ('5c000000-0000-0000-0000-00000000000a', 'd1000000-0000-0000-0000-000000000001',
                          'c1000000-0000-0000-0000-000000000001', '2026-10-06', 'present')$$,
  '42501', NULL, 'parent A cannot record attendance');
SELECT lives_ok($$SELECT justify_absence('75000000-0000-0000-0000-000000000001', 'Rendez-vous médical')$$,
  'parent A can justify their child''s absence');
SELECT is((SELECT status FROM attendance_records WHERE id = '75000000-0000-0000-0000-000000000001'), 'excused',
  'justified absence becomes excused');
SELECT throws_ok($$SELECT justify_absence('75000000-0000-0000-0000-000000000002', 'x')$$,
  '42501', NULL, 'parent A cannot justify parent B''s child absence');
SELECT is((SELECT count(*) FROM students WHERE school_id = '5c000000-0000-0000-0000-00000000000b')::int, 0,
  'cross-school: parent A reads zero students of school B');
RESET ROLE;

-- ---------------------------------------------------------------------
-- Parent B: the node-targeted announcement reaches descendants
-- ---------------------------------------------------------------------
SELECT pg_temp.login('pb@test.ma');
SELECT results_eq('SELECT id FROM announcements ORDER BY id',
  $$VALUES ('73000000-0000-0000-0000-000000000001'::uuid), ('73000000-0000-0000-0000-000000000003'::uuid)$$,
  'parent B sees whole-school + "2ème année" node announcements (not class A1)');
SELECT is((SELECT count(*) FROM announcement_targets WHERE announcement_id = '73000000-0000-0000-0000-000000000002')::int, 0,
  'parent B cannot read targets of an announcement they are not reached by');
RESET ROLE;

-- ---------------------------------------------------------------------
-- Teacher T1 (assigned to A1 only)
-- ---------------------------------------------------------------------
SELECT pg_temp.login('t1@test.ma');
SELECT results_eq('SELECT id FROM classes', $$VALUES ('d1000000-0000-0000-0000-000000000001'::uuid)$$,
  'teacher T1 sees only their assigned class');
SELECT is((SELECT count(*) FROM classes WHERE id = 'd1000000-0000-0000-0000-000000000002')::int, 0,
  'teacher T1 cannot select a class they are not assigned to');
SELECT results_eq('SELECT id FROM students ORDER BY id',
  $$VALUES ('c1000000-0000-0000-0000-000000000001'::uuid), ('c1000000-0000-0000-0000-000000000003'::uuid)$$,
  'teacher T1 sees only students enrolled in A1');
SELECT is((SELECT count(*) FROM attendance_records WHERE class_id = 'd1000000-0000-0000-0000-000000000002')::int, 0,
  'teacher T1 cannot read attendance of class A2');
SELECT lives_ok($$INSERT INTO attendance_records (school_id, class_id, student_id, session_date, slot_id, status)
                  VALUES ('5c000000-0000-0000-0000-00000000000a', 'd1000000-0000-0000-0000-000000000001',
                          'c1000000-0000-0000-0000-000000000001', '2026-10-12',
                          '72000000-0000-0000-0000-000000000001', 'present')$$,
  'teacher T1 can mark attendance in their class');
SELECT is((SELECT recorded_by_member_id FROM attendance_records WHERE session_date = '2026-10-12'),
  'b1000000-0000-0000-0000-000000000003'::uuid, 'recorded_by is set to the teacher');
SELECT throws_ok($$INSERT INTO attendance_records (school_id, class_id, student_id, session_date, status)
                  VALUES ('5c000000-0000-0000-0000-00000000000a', 'd1000000-0000-0000-0000-000000000002',
                          'c1000000-0000-0000-0000-000000000002', '2026-10-12', 'absent')$$,
  '42501', NULL, 'teacher T1 cannot mark attendance in class A2');
SELECT throws_ok($$INSERT INTO attendance_records (school_id, class_id, student_id, session_date, status)
                  VALUES ('5c000000-0000-0000-0000-00000000000a', 'd1000000-0000-0000-0000-000000000001',
                          'c1000000-0000-0000-0000-000000000002', '2026-10-12', 'absent')$$,
  '23514', NULL, 'attendance rejected for a student not enrolled in the class');
SELECT is((SELECT count(*) FROM fee_installments)::int, 0, 'teacher T1 sees no fee installments');
SELECT is((SELECT count(*) FROM cases)::int, 0, 'teacher T1 sees no family cases');
SELECT is((SELECT count(*) FROM timetable_versions WHERE status = 'draft')::int, 0, 'teacher T1 sees no draft timetables');
RESET ROLE;

-- ---------------------------------------------------------------------
-- Student S1 (login linked through students.member_id)
-- ---------------------------------------------------------------------
SELECT pg_temp.login('s1@test.ma');
SELECT results_eq('SELECT id FROM students', $$VALUES ('c1000000-0000-0000-0000-000000000001'::uuid)$$,
  'student sees only their own record');
SELECT results_eq('SELECT id FROM timetable_slots', $$VALUES ('72000000-0000-0000-0000-000000000001'::uuid)$$,
  'student reads only their own class''s published timetable');
SELECT is((SELECT count(*) FROM attendance_records WHERE student_id <> 'c1000000-0000-0000-0000-000000000001')::int, 0,
  'student reads only their own attendance (not classmate S3''s)');
SELECT results_eq('SELECT id FROM homework', $$VALUES ('77000000-0000-0000-0000-000000000001'::uuid)$$,
  'student reads their class''s homework only');
SELECT is((SELECT count(*) FROM fee_installments)::int, 0, 'student sees no fee installments');
SELECT is((SELECT count(*) FROM cases)::int, 0, 'student sees no cases');
SELECT is_empty($$UPDATE students SET first_name = 'Hack' RETURNING id$$, 'student cannot update their record');
SELECT throws_ok($$INSERT INTO homework (school_id, class_id, author_member_id, title, body)
                  VALUES ('5c000000-0000-0000-0000-00000000000a', 'd1000000-0000-0000-0000-000000000001',
                          'b1000000-0000-0000-0000-000000000003', 'x', 'y')$$,
  '42501', NULL, 'student cannot create homework');
RESET ROLE;

-- ---------------------------------------------------------------------
-- Staff A replies to parent A's case; parent A sees the reply
-- ---------------------------------------------------------------------
SELECT pg_temp.login('staff.a@test.ma');
SELECT is((SELECT count(*) FROM cases WHERE school_id = '5c000000-0000-0000-0000-00000000000a')::int, 3,
  'staff sees every case of their school');
SELECT lives_ok($$INSERT INTO case_messages (school_id, case_id, author_member_id, body)
                  VALUES ('5c000000-0000-0000-0000-00000000000a', '76000000-0000-0000-0000-000000000001',
                          'b1000000-0000-0000-0000-000000000002', 'Nous regardons cela.')$$,
  'staff can reply to a case');
RESET ROLE;
SELECT is((SELECT status FROM cases WHERE id = '76000000-0000-0000-0000-000000000001'), 'answered',
  'a staff reply marks the case answered');
SELECT is((SELECT count(*) FROM notification_outbox WHERE kind = 'case_reply')::int, 1,
  'the reply is stubbed to the parent in the outbox');
SELECT pg_temp.login('pa@test.ma');
SELECT is((SELECT count(*) FROM case_messages WHERE case_id = '76000000-0000-0000-0000-000000000001')::int, 2,
  'parent A sees the staff reply in their thread');
RESET ROLE;

-- ---------------------------------------------------------------------
-- Admin B: cross-school reads return zero rows
-- ---------------------------------------------------------------------
SELECT pg_temp.login('admin.b@test.ma');
SELECT is((SELECT count(*) FROM students WHERE school_id = '5c000000-0000-0000-0000-00000000000a')::int, 0,
  'cross-school: admin B reads zero students of school A');
SELECT is((
  (SELECT count(*) FROM classes WHERE school_id = '5c000000-0000-0000-0000-00000000000a')
  + (SELECT count(*) FROM announcements WHERE school_id = '5c000000-0000-0000-0000-00000000000a')
  + (SELECT count(*) FROM cases WHERE school_id = '5c000000-0000-0000-0000-00000000000a')
  + (SELECT count(*) FROM payments WHERE school_id = '5c000000-0000-0000-0000-00000000000a')
  + (SELECT count(*) FROM attendance_records WHERE school_id = '5c000000-0000-0000-0000-00000000000a')
  + (SELECT count(*) FROM schools WHERE id = '5c000000-0000-0000-0000-00000000000a'))::int, 0,
  'cross-school: admin B reads zero classes/announcements/cases/payments/attendance/school of A');
SELECT is_empty($$UPDATE schools SET name = 'x' WHERE id = '5c000000-0000-0000-0000-00000000000a' RETURNING id$$,
  'cross-school: admin B cannot update school A');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
