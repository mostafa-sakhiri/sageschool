import { BuiltInAgent, CopilotRuntime, createCopilotRuntimeHandler } from '@copilotkit/runtime/v2'
import { createClient } from '#/lib/supabase/server'

// Server side of the assistant (spec: docs/superpowers/specs/2026-09-26-assistant-design.md).
// The agent has no database access: every tool is a frontend tool that runs in
// the browser with the user's JWT, so RLS stays the only data gate (D-006).

// "provider/model" as the CopilotKit runtime reads it; ASSISTANT_MODEL overrides
// it without a code change (e.g. openai/gpt-5 for harder requests). gpt-5-mini
// by default: ~5× cheaper, and the work here is simple (the code checks the
// conflicts, the forms are checked by a person).
export const ASSISTANT_MODEL = process.env.ASSISTANT_MODEL || 'openai/gpt-5-mini'
// GPT-5 and o-series are reasoning models: they take no temperature, and the
// least effort keeps the chat fast (the tool calls here are simple; the code,
// not the model, checks conflicts). GPT-5 accepts "minimal", o-series "low".
const reasoning = /^openai\/(gpt-5|o\d)/.test(ASSISTANT_MODEL)
const effort = /^openai\/gpt-5/.test(ASSISTANT_MODEL) ? 'minimal' : 'low'
// The key of the model's provider: OPENAI_API_KEY, ANTHROPIC_API_KEY, GOOGLE_API_KEY…
const KEY_NAME = `${ASSISTANT_MODEL.split('/')[0].toUpperCase()}_API_KEY`
const BASE_PATH = '/api/copilotkit'

const PROMPT = `Tu es l'assistant de SageSchool, le logiciel de gestion d'une école privée au Maroc.
Tu aides le secrétariat et la direction à agir vite : tu traduis une demande en action de l'application.

Règles :
- Réponds dans la langue de l'utilisateur (français, arabe ou darija). Sois bref : une ou deux phrases.
- Pour créer quelque chose (élève, préinscription, rendez-vous, annonce, membre de l'équipe), appelle l'outil correspondant avec les champs que tu as compris. Une fiche pré-remplie s'affiche : c'est l'utilisateur qui vérifie et enregistre. N'invente jamais une valeur : laisse vide ce que tu ne sais pas.
- Les dates vont au format AAAA-MM-JJ et les heures au format HH:MM. Calcule les dates relatives ("samedi", "demain") à partir de la date du jour donnée dans le contexte.
- Les classes, matières, professeurs et salles se donnent par leur nom exact tel qu'il figure dans le contexte.
- Emploi du temps : utilise changeTimetable directement, même sur une version publiée (il crée ou rouvre lui-même le brouillon) ; ne demande pas de confirmation. Le code vérifie les conflits ; toi, tu expliques simplement le résultat et tu proposes une alternative (outil findFreeSlots) quand un changement est refusé. Tu ne décides jamais seul qu'un créneau est libre.
- Les heures d'ouverture et les pauses (accueil, goûter, récréation, sieste, sortie…) sont des réglages de l'école, pas des séances : tu ne peux pas les modifier. Dis-le et propose d'ouvrir Réglages › Horaires (openPage settings, section schedule ; si isAdmin).
- Permissions : le contexte donne le rôle de l'utilisateur et ses permissions (liste "permissions"). isAdmin = true veut dire que l'utilisateur EST la direction (rôle « Administration ») : il a tous les droits, y compris ce qui est « réservé à la direction ». Sinon, ne propose que ce que ses permissions permettent et dis à qui c'est réservé.
- Agis avec les outils : dès qu'un outil correspond à la demande, appelle-le au lieu de répondre en texte. Ne dis jamais « j'ouvre la page » sans appeler openPage, ni « je prépare la fiche » sans appeler l'outil de la fiche. Exemples :
  « ouvre les réclamations », « les messages des parents » → openPage {page: "cases"}
  « montre les impayés », « les paiements », « qui n'a pas payé » → openPage {page: "fees"}
  « ouvre les horaires » → openPage {page: "settings", section: "schedule"}
  « les présences des profs » → openPage {page: "attendance"}
- Les pages et leurs noms actuels : « Demandes » (des parents : questions, réclamations), « Paiements » (scolarité, impayés), « Présences » (élèves et professeurs). Réglages a des sections : infos de l'école, équipe, rôles, structure (cycles, niveaux), horaires, salles, matières et horaires, années.
- Absences d'un élève (combien, justifiées ou non) : outil studentAbsences. Arrivée, départ ou absence d'un professeur : outil recordTeacherPresence (fiche pré-remplie, l'utilisateur valide). Ouvrir un cycle ou un niveau (« ouvre le collège », « ouvre le primaire ») : outil openCycle (si isAdmin).
- Si un outil renvoie "cancelled", ne relance pas : dis simplement que c'est annulé.
- Si la demande sort de ce que tu sais faire, dis-le et indique la page la plus proche (outil openPage).
- N'affiche jamais d'identifiants techniques (uuid) à l'utilisateur.`

let handler: ((request: Request) => Promise<Response>) | null = null

function getHandler() {
  if (handler) return handler
  const runtime = new CopilotRuntime({
    agents: {
      default: new BuiltInAgent({
        model: ASSISTANT_MODEL,
        apiKey: process.env[KEY_NAME],
        prompt: PROMPT,
        // Reasoning tokens count as output: room for them and the reply
        maxOutputTokens: 4096,
        ...(reasoning ? { providerOptions: { openai: { reasoningEffort: effort } } } : { temperature: 0.2 }),
      }),
    },
  })
  handler = createCopilotRuntimeHandler({
    runtime,
    basePath: BASE_PATH,
    hooks: {
      // Office members only (v1 scope): the check runs on every request, with
      // the caller's own session, so RLS decides which memberships are visible.
      onRequest: async () => {
        const supabase = createClient()
        const { data, error } = await supabase.auth.getClaims()
        if (error || !data?.claims) throw new Response('Unauthorized', { status: 401 })
        const { data: rows } = await supabase
          .from('school_members')
          .select('id, user:users!inner(auth_provider_id)')
          .eq('user.auth_provider_id', data.claims.sub)
          .eq('status', 'active')
          .in('role', ['admin', 'staff'])
          .limit(1)
        if (!rows?.length) throw new Response('Forbidden', { status: 403 })
      },
    },
  })
  return handler
}

export async function handleAssistant(request: Request) {
  if (!process.env[KEY_NAME]) return new Response(`Assistant not configured (${KEY_NAME})`, { status: 503 })
  return getHandler()(request)
}
