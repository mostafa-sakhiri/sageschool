# SageSchool

A school management SaaS for new private schools in Morocco (préscolaire → lycée). The UI is in French and Arabic (RTL).

**Stack:** Supabase (Postgres, Auth, RLS), TanStack Start, TanStack Query, MUI v9.

## Run locally

Requires Node 22 and Docker.

```bash
npm install
npx supabase start          # local stack; applies migrations and seeds on first start
npx supabase db reset       # optional: fresh database (migrations + curriculum seeds)
npm run dev                 # http://localhost:3000
```

`.env.local` holds the local keys and is never committed. See `.env.example`, and get the values from `npx supabase status -o env`.

## Checks

```bash
npm run typecheck                 # TypeScript
npm run test:rls                  # pgTAP: 48 RLS isolation assertions (supabase/tests/rls.test.sql)
node scripts/walkthrough.mjs      # full core loop on a fresh school, as real users → WALKTHROUGH.md
npm run i18n:check                # every t('key') exists in fr.json and ar.json
npm run test:import               # Excel import formats: templates, parsing, validation
npm run build                     # production build
```

## Test accounts (created during the session)

All passwords are `password123`.

| Role | E-mail |
|---|---|
| Admin (founder) | directeur@laureats.test |
| Teacher | nadia.fassi@laureats.test |
| Parent | fatima.alaoui@parents.test |
| Student | yasmine@eleves.test |

These exist only in the current local database. After `db reset`, sign up again, or run `node scripts/walkthrough.mjs`, which creates a complete school with its own accounts: `<role>.<run>@walkthrough.test`, where `<role>` is directeur, secretariat, prof1, prof2, parent.a, parent.b or eleve and `<run>` is the id shown at the top of `WALKTHROUGH.md`; all use password `password123`.

### Demo preschool

`node scripts/seed_preschool.mjs` creates **Ptichou Preschool**, built from its real 2026-2027 petite section timetable, with `directeur@laureats.test` as admin (switch schools from the account menu):
- The préscolaire day as the cycle's horaire: accueil, goûter, déjeuner, sieste, change + goûter and préparation à la sortie are pauses, not subjects. Friday ends at 12:30. Roll call is once a day.
- Petite, Moyenne and Grande section: one class each, 16/17/17 children, for 50 children in total.
- The préscolaire activities: 14 activities (rituel, motricité, pâte à modeler, organisation de la pensée, éveil à l'anglais…), 16 h/week, all confirmed.
- 4 teachers, all with password `password123`: salma.idrissi@ptichou.test, houda.bennani@ptichou.test and nora.elfassi@ptichou.test are the class teachers; sarah.lahlou@ptichou.test teaches English in all three classes.
- 44 parent accounts (6 sibling pairs).
- PS follows the PDF slot for slot. MS and GS keep the same mornings, but their afternoons are rotated so the English teacher is never double-booked. All three timetables are published.

### School hours per cycle

Réglages › Horaires, or wizard step 2. Each cycle has its own day:
- Days open, opening hours, and pauses (récréation, déjeuner, sieste, goûter, accueil, sortie…), with an optional label.
- Any weekday can override the typical day, for example a shorter Friday or a later récréation on Wednesday.
- Pauses show in every class timetable of the cycle and don't count as teachable time.
- The timetable builder warns when a session overlaps a pause or falls outside the day.

### Importing people (Excel)

Onboarding step 6 "Données", Équipe › Importer, Élèves › Importer, or the "+ Nouveau" menu. Download a template, fill it in, and drop it back:
- `professeurs.xlsx`: one teacher account per row.
- `administration.xlsx`: "Direction" gives admin access; any other function gives secrétariat access.
- `eleves.xlsx`: students, their class, and up to two parents. Siblings are recognized by the parent's e-mail or phone.

Nothing is saved before the per-row preview is confirmed. Temporary passwords come back as `identifiants.xlsx`.

## Layout

- `supabase/migrations/`
  - `…_schema_socle.sql`: the validated schema, verbatim.
  - `…_auth_rls_modules.sql`: auth link, RLS helpers and policies, absences, cases, and the notification outbox.
- `supabase/seeds/`: the Moroccan curriculum template and default weekly hours.
- `src/routes/_app/*`: one file per screen: dashboard, setup, team, classes, students, timetable, attendance, homework, announcements, fees, cases.
- `src/features/*`: queries and larger components (timetable builder, week grid, setup sections).
- `src/i18n/{fr,ar}.json`: dictionaries. Add keys with `scripts/i18n_add.py`.

See `DECISIONS.md` for the calls made during the build, and `SESSION_SUMMARY.md` for what works and what doesn't.
