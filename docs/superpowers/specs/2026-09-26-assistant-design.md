# Assistant: intent → action (design)

Date: 2026-09-26 · Status: approved to build (the user asked for analysis and design, then straight into implementation)

## Goal

The office (admin and staff) types what they want in plain French, Arabic or Darija-in-Latin-letters, and the app turns it into an action:
- **Anywhere, starting from the dashboard input:** a card appears in the chat, holding the app's own form with the fields already filled in. The person checks it and saves. The AI never writes school data on its own.
- **On a draft timetable:** the AI changes the draft directly, because a draft carries no risk and there is undo. When a change isn't possible, it explains why, with a mini-grid that shows the conflict.

## Decisions

| Question | Choice | Why |
|---|---|---|
| Framework | CopilotKit v2 (`@copilotkit/react-core/v2`, `@copilotkit/runtime/v2`), MIT, self-hosted | Frontend tools, rendering of tool calls in the chat and human-in-the-loop are all built in. No Copilot Cloud, so the pricing tiers don't apply. |
| Model | `openai/gpt-5-mini` through the runtime's `BuiltInAgent` (minimal reasoning effort), overridable with `ASSISTANT_MODEL` (e.g. `openai/gpt-5`); key in `OPENAI_API_KEY` (server only) | Claude at first, then OpenAI; gpt-5-mini costs about 5× less than gpt-5 (estimate: ~$3–4 per 1,000 timetable requests, versus ~$15–20). |
| Roles in v1 | admin and staff | The user chose them. The provider and panel only mount for office roles. |
| Where tools run | **All tools are frontend tools**, running in the browser with the Supabase client that carries the user's JWT | RLS stays the only data gate (D-006). The server agent has no database access at all. |
| Writes outside the timetable | Human-in-the-loop: the prefilled form is rendered inside the chat, and the person clicks save | Real data such as students, prospects, appointments and announcements needs a human check. |
| Writes to the timetable | Applied directly when the change is valid, with an undo button on the card. Nothing is written when any change in the batch is refused. | The user described the draft timetable as low risk. |
| Conflict detection | Deterministic code, reusing the Builder's `check()` (the DB trigger remains the backstop) | The LLM only explains a structured result; it never decides whether something is valid. |
| Chat UI | Custom MUI panel on top of the headless hooks (`useAgent`, `useRenderToolCall`) | CopilotKit's default UI is Tailwind-styled and doesn't follow the MUI theme or RTL. |
| Chat history | In memory, for the browser session | Nothing to persist in v1. |

## Use cases (office)

### A. Intent → card, from anywhere

| # | The person types… | Tool(s) | Card / result |
|---|---|---|---|
| A1 | "Inscris Yasmine Alaoui, née le 3/3/2021, en petite section" | `enrollStudent` | Enrolment form: name, date of birth, gender, class resolved from its name, fees if the person has access to them |
| A2 | "M. Bennani 0661… veut inscrire son fils Adam en CP pour la rentrée" | `createPreregistration` | Pre-registration form: parent, phone, child, level, notes |
| A3 | "RDV avec M. Bennani samedi à 10h pour une visite" | `scheduleAppointment` | Appointment form: kind, date, time, person, phone, notes |
| A4 | A2 and A3 in one sentence | both tools | Two cards, one after the other |
| A5 | "Annonce aux parents : école fermée vendredi (fête du trône)" | `draftAnnouncement` | Announcement form with title, body and priority, saved as a draft. Publishing and WhatsApp stay on the page. |
| A6 | "Ajoute Nadia Fassi comme prof, nadia@…" (admin only) | `inviteMember` | Invitation form: name, e-mail or phone, role |
| A7 | "Où en est Adam Bennani ?", "trouve les élèves Alaoui" | `findStudents` | Result card: name, class, a link that opens the student's page |
| A8 | "Montre les impayés", "ouvre l'emploi du temps de la PS" | `openPage` | The app navigates, and the chat stays open |
| A9 | A request that's ambiguous (two classes match, no date given) | none, or the card with empty fields | The agent asks a short question, or leaves the field empty on the card. It never invents a value. |
| A10 | Something no tool covers (grades, MASSAR…) | none | A short reply saying what it can do, and the nearest page |

Values the model can't resolve reliably, such as class names or dates, are resolved by code: the card receives `className` and the form matches it against real classes, falling back to empty. The context gives the model today's date, the classes, the school year, the person's role, and the current page.

### B. Draft timetable (`/timetable?mode=edit`, draft version)

| # | The person types… | Tool | Result |
|---|---|---|---|
| B1 | "Déplace les maths du lundi 9h au jeudi 10h" | `changeTimetable` [move] | Applied. The card shows a mini-grid with the old position faded and the new one highlighted, plus an Undo button. |
| B2 | "Échange la séance d'anglais de mardi avec celle de mercredi" | `changeTimetable` [move, move] | Applied as a batch, checked against the state after each move |
| B3 | "Ajoute 1h d'éveil mardi après-midi" | `findFreeSlots` then `changeTimetable` [add] | Placed in the first free slot that matches |
| B4 | "Supprime la séance de 16h vendredi" | `changeTimetable` [remove] | Applied, with undo |
| B5 | "Mets Mme Idrissi sur la séance de lundi 10h" / "change la salle" | `changeTimetable` [update] | Teacher or room changed, and the teacher's availability is checked |
| B6 | Impossible move: the teacher is busy in another class, the session overlaps another, it falls outside school hours, or the day is closed | `changeTimetable` | **Nothing is applied.** The card shows the grid with the conflict in red and the reason ("Sarah Lahlou enseigne en MS à ce moment"). The agent explains and proposes free slots (`findFreeSlots`). |
| B7 | The session covers a pause (récréation, sieste…) | `changeTimetable` | Applied with a warning, the same rule as a manual drag |
| B8 | "Pourquoi je ne peux pas mettre l'anglais mardi à 10h ?" | `checkTimetable` | The same card, but nothing is applied (dry run) |
| B9 | The version is published | `changeTimetable` | The change is first checked on the version shown. If it is valid, the tool creates the draft (or reopens the one that exists), opens it in the editor, finds the sessions again by their content, and applies the change: one tool call, with no confirmation asked. Nothing is created for a refused change. An archived version stays read-only. |
| B10 | "Undo" / "annule" | the card's Undo button, or `undoTimetableChange` | Reverts the last batch that was applied |

## Architecture

```
Browser (office role)                                         Server (TanStack Start)
┌──────────────────────────────────────────────┐          ┌───────────────────────────────┐
│ _app.tsx  AppLayout                           │          │ routes/api/copilotkit.$.ts     │
│  └ AssistantProvider  (CopilotKitProvider,    │  AG-UI   │  onRequest: getClaims() → 401  │
│     runtimeUrl=/api/copilotkit)               │ ───SSE──▶│  CopilotRuntime               │
│      ├ global tools   (features/assistant/)   │          │   └ BuiltInAgent default       │
│      ├ context        (school, year, role,    │          │      model gpt-5-mini (OpenAI) │
│      │                 classes, page, today)  │          │      system prompt (FR/AR)     │
│      ├ AssistantPanel (MUI chat, fixed side)  │          │  no DB access                  │
│      └ <Outlet/>                              │          └───────────────────────────────┘
│          ├ Dashboard: AssistantInput          │
│          └ Timetable › VersionEditor          │
│              └ timetable tools + context      │
│                (mounted only on a draft)      │
└──────────────────────────────────────────────┘
```

### Units

- `src/routes/api/copilotkit.$.ts`: a server route. It checks the Supabase session with `getClaims()`, then hands the request to `createCopilotRuntimeHandler({ runtime, basePath: '/api/copilotkit' })`. The runtime and agent are created once per server.
- `src/features/assistant/agent.ts` (server): the system prompt and the `BuiltInAgent` configuration.
- `src/features/assistant/shell.tsx` (light, always loaded): the open/closed state (`useAssistantUi()`: `open`, `setOpen`, `ask(text)`, `busy`…), a queue for messages sent before the chat has loaded, and the "slots" through which a page publishes **plain data** to the assistant (`useAssistantSlot('timetable', …)`). It is mounted only for office roles.
- `src/features/assistant/root.tsx` (**lazy** chunk): the `CopilotKitProvider`, the agent run, the general context, `GlobalTools`, the page tools (read from the slots), and `AssistantPanel`. Why the split: the v2 entry point of `@copilotkit/react-core` pulls in its whole chat UI (KaTeX, shiki, mermaid…) and can't be tree-shaken. Once lazy, the AppShell chunk goes from 1.8 MB back to 220 KB, and roles without the assistant never download it.
- `src/features/assistant/AssistantPanel.tsx`: the chat UI. It shows the messages, lets tool calls render through `useRenderToolCall`, and has an input, a stop button and suggestion chips. It sits fixed on the inline-end side (a full-screen drawer on mobile), and the main area of `AppShell` makes room for it on large screens.
- `src/features/assistant/AssistantInput.tsx`: the input on the dashboard ("Que voulez-vous faire ?"). It opens the panel and sends the message.
- `src/features/assistant/tools/*.tsx`: one file per action. Each defines a `useHumanInTheLoop` whose render shows an `ActionCard` around the existing form, with `surface="card"`.
- `src/components/Surface.tsx`: `SurfaceDialog`, `SurfaceTitle`, `SurfaceContent` and `SurfaceActions`. They render MUI `Dialog*` normally, and an inline `Paper` block when a `SurfaceContext` says `card`. The existing forms swap their `Dialog*` imports for these, so no logic is duplicated.
- The page dialogs that aren't yet in `features/` move there, keeping their code: `AppointmentDialog` → `features/agenda/`, `PreregDialog` → `features/preregistrations/`, `AnnouncementForm` → `features/announcements/`.
- `src/features/timetable/assistant.tsx`: `TimetableAssistant`, rendered by `root.tsx` from the data that `VersionEditor` publishes (slot `timetable`). It gives the agent the version's context (days, hours, pauses, sessions, teachers, busy slots elsewhere) and registers `changeTimetable`, `checkTimetable`, `findFreeSlots` and `undoTimetableChange`. Validation reuses `check()`, and writes reuse `insert`/`update`/`remove`.
- `src/features/timetable/MiniWeek.tsx`: a compact grid for cards. It shows the sessions of the affected days, with an `added`, `moved-from`, `conflict` or `warn` state on each block.

### Timetable operations

```ts
type Op =
  | { op: 'move';   slotId: string; weekday: number; start: 'HH:MM'; end?: 'HH:MM' } // end defaults to the same length
  | { op: 'add';    subject: string; weekday: number; start: string; end: string; teacher?: string; room?: string; title?: string }
  | { op: 'remove'; slotId: string }
  | { op: 'update'; slotId: string; teacher?: string | null; room?: string | null; title?: string | null }
```
Subjects, teachers and rooms are given **by name** and resolved by code (case- and accent-insensitive). An unknown name produces a `not_found` issue, not a guess.

The result returned to the agent (and shown on the card):
```ts
{ applied: boolean, changes: [{ op, label, from?, to? }], issues: [{ opIndex, level: 'bad'|'warn', code, message }] }
```
Codes: `closed_day`, `outside_hours`, `overlap`, `teacher_busy`, `pause`, `not_found`, `invalid`, `db_error`.
The batch is validated against a simulated state, with the operations applied in order. If any issue is `bad`, nothing is written. If the database refuses (the trigger), the operations already applied are rolled back and the result carries `db_error`.

### Security

- The runtime endpoint refuses any request without valid claims (401). The agent can do nothing beyond what the browser can already do.
- Tools run with the user's JWT, so RLS applies. They are registered only for `isOffice`; `inviteMember` only for `isAdmin`; the fees fields only when `canFees`.
- The API key stays on the server (a non-`VITE_` variable).
- The context sent to the model is limited to what the office already sees: class names, names of people in the timetable, today's date. Student lists are sent only through `findStudents`, when asked.

### Errors

- No key, or the runtime is down: the panel shows "Assistant indisponible" and the rest of the app works normally.
- A tool whose card is closed without saving returns `{status:'cancelled'}`, and the agent says it plainly.
- A form that fails to save shows its usual error inside the card.

## Out of scope for v1

Teacher, parent and student roles; payments (the agent opens `/fees` instead); publishing announcements (the agent saves a draft only); chat history across sessions; voice input; server-side agents.

## Testing

- `npm run typecheck`, `npm run i18n:check`, `npm run build`.
- Pure functions (`resolveName`, `planTimetableOps`), tested with `tsx` like `scripts/test_import_formats.ts`: `scripts/test_assistant.ts` covers the move / swap / overlap / teacher busy / pause / closed day / not found cases.
- Manual run with a key: A1, A3, A5, B1, B6, B10 on the Ptichou demo.
