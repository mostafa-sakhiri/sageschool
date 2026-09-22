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

## Layout

- `supabase/migrations/`
  - `…_schema_socle.sql`: the validated schema, verbatim.
  - `…_auth_rls_modules.sql`: auth link, RLS helpers and policies, absences, cases, and the notification outbox.
- `supabase/seeds/`: the Moroccan curriculum template and default weekly hours.
- `src/routes/_app/*`: one file per screen: dashboard, setup, team, classes, students, timetable, attendance, homework, announcements, fees, cases.
- `src/features/*`: queries and larger components (timetable builder, week grid, setup sections).
- `src/i18n/{fr,ar}.json`: dictionaries. Add keys with `scripts/i18n_add.py`.

See `DECISIONS.md` for the calls made during the build, and `SESSION_SUMMARY.md` for what works and what doesn't.
