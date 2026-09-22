# Decisions

Calls I made on my own during the build session (2026-09-22), whenever the brief, specs, schema and mockups didn't settle a question. Each entry says what I chose and why.

## D-001 — The schema wins over the functional specs, and the brief's roles win over the specs' roles
The specs in `specs/functional/` describe an `organizations` layer, the roles `director/secretary/accountant/hr`, subject `default_coefficient`, `requires_massar_sync`, subscriptions, and so on. The brief says the schema is validated and must not be redesigned, and it fixes the roles as **admin/teacher/parent/student/staff**. I mapped the specs onto it like this:
- *director* → `admin`; *secretary / accountant / hr* → `staff`.
- No organization or group level: each school is a tenant, and a user can belong to several schools through `school_members` (spec 02's multi-school parent case works).
- `levels_offered` and similar school-level facts go in `schools.settings` (jsonb), which the schema provides for exactly this.
- Coefficients, subscriptions, MASSAR and admissions are out of scope for this session.

## D-002 — The curriculum seed files didn't exist, so I rebuilt them
`seed_curriculum_maroc.sql` and `seed_curriculum_hours_maroc.sql` appear nowhere in the repo or on the machine. I wrote both under `supabase/seeds/`:
- **Tree (`ma_public`):** Préscolaire (PS/MS/GS) › Primaire (1–6) › Collège (1–3) › Lycée (Tronc commun with tracks, 1ère Bac with tracks, 2ème Bac with tracks and options). Every node has an Arabic name.
- **Hours:** partial coverage, as the brief describes. Préscolaire, primaire and collège are covered. Lycée covers only the tronc commun, and all lycée rows are marked `to_verify`; nothing is `confirmed`. 1ère and 2ème Bac have no hours.
If the original files turn up, drop them in place of these. The node codes are the only contract between the tree and the hours.

## D-003 — Linking Supabase Auth to `public.users`
`users.auth_provider_id` stores `auth.users.id`, filled by an `AFTER INSERT` trigger on `auth.users`. If a `users` row already exists with the same e-mail (because the school created it first), the new login attaches to it instead of creating a duplicate.

## D-004 — RLS design
- Helper functions live in a **non-exposed `private` schema** as `SECURITY DEFINER`, so policies can call them without recursing into each other: `is_school_member(school)`, `has_role(school, role)`, `is_office(school)` (admin or staff), `teacher_class_ids()`, `guardian_student_ids()`, `self_student_ids()`, `visible_class_ids()`, and `announcement_visible(id)`.
- **Teacher scope:** a teacher's classes are those with a `teaching_assignments` row, plus those where they have a slot in a *published* timetable. A teacher sees only those classes and their actively enrolled students.
- **Parent scope:** a parent's children come from `student_guardians`. They see those children's classes, published timetables, exceptions, homework, absences, fees, and their own cases.
- **Student scope:** comes from `students.member_id`, the same way. Read-only: a student has no write policy anywhere and no access to fees or cases.
- Admins and staff see all rows in their own school, and nothing in any other school.
- The schema's views were created without `security_invoker`, which means they bypass RLS. I switched them to `security_invoker = true` with `ALTER VIEW`, which changes their permissions but not their definitions.
- The `anon` role has no table grants at all. `authenticated` gets CRUD grants, and RLS then decides row by row.
- **Why RPCs for some operations:** `create_school` bootstraps the first admin, and there is no INSERT policy on `schools`. `publish_announcement` sends the stubbed announcement messages to parents. `justify_absence` lets a parent excuse an absence without being given UPDATE rights on attendance records. All three are `SECURITY DEFINER`, check the caller's identity or role in their body, and are not executable by `anon`.

## D-005 — Tables added beside the schema (additive only)
- `attendance_records`: one record per student, date and slot (`slot_id` NULL means the whole day). A `UNIQUE NULLS NOT DISTINCT` constraint means re-entering an absence updates the existing record, as spec 06 requires. A trigger rejects students not actively enrolled in the class. The slot foreign key has no cascade, so a slot with attendance history can't be deleted (spec 07).
- `cases` and `case_messages`: the case direction is `parent_to_school` or `school_to_parent`. Status goes open → answered (after a staff reply) → resolved. Writing to a resolved case is refused.
- `notification_outbox`: every WhatsApp message (announcement, case reply, absence) is **stubbed** as a row here with status `stubbed`. The schema's own `notifications` table requires an `announcement_id`, so it couldn't hold case replies or absence alerts.
- `instantiate_curriculum_cycles()`: a thin wrapper around the schema's `_insert_curriculum_children`. It instantiates only the cycles the school picks in the wizard, whereas `instantiate_curriculum_template` always copies the whole tree.
- `timetable_slots` conflict trigger (spec 07): rejects a slot that overlaps another in the same version, or that double-books a teacher or the effective room against a published version whose dates overlap.
- `search_path` pinned on the schema's functions with `ALTER FUNCTION` (fixes the advisor warnings; function bodies unchanged).

## D-006 — Rendering model
TanStack Start renders the document shell on the server: `<html lang dir>` comes from the `lang` cookie, so there's no flash of the wrong direction. Routes render on the client (`defaultSsr: false`). This keeps SSR simple for Emotion/MUI with RTL and for TanStack Query, and it keeps RLS as the only data gate: every read and write goes through the browser Supabase client carrying the user's JWT.
- **Auth:** the protected layout's `beforeLoad` calls the `fetchClaims` server function, which runs `supabase.auth.getClaims()` on the server. `getSession()` is never called on the server.
- **Service key:** privileged server functions (creating team logins, enabling student access) run `getClaims()` themselves, then check the caller's admin role through RLS before using the secret key.

## D-007 — The RLS test lives under `supabase/tests/`
`supabase test db` runs pgTAP files from `supabase/tests/`. The brief asks for `tests/rls.sql`, so that path is a symlink to `supabase/tests/rls.test.sql`. Run it with `npm run test:rls`.
