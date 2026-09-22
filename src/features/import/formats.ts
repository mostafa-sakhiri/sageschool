import * as XLSX from 'xlsx'

// Suggested Excel formats for importing people. Headers are matched loosely
// (case, accents and punctuation ignored, a few synonyms accepted), so a file
// exported from another system usually works after renaming a column or two.

export type ImportKind = 'teachers' | 'administration' | 'students'

type Column = {
  key: string
  label: string
  required?: boolean
  aliases?: string[]
  example: string
  help: string
}

export const FORMATS: Record<ImportKind, { file: string; sheet: string; columns: Column[] }> = {
  teachers: {
    file: 'professeurs.xlsx',
    sheet: 'Professeurs',
    columns: [
      { key: 'fullName', label: 'Nom complet', required: true, aliases: ['nom', 'nom et prenom', 'professeur', 'الاسم الكامل'], example: 'Nadia Fassi', help: 'Prénom et nom, tels qu’ils apparaîtront aux parents.' },
      { key: 'email', label: 'E-mail', required: true, aliases: ['email', 'mail', 'courriel', 'adresse e-mail', 'البريد الإلكتروني'], example: 'nadia.fassi@ecole.ma', help: 'Sert d’identifiant de connexion.' },
      { key: 'phone', label: 'Téléphone', aliases: ['tel', 'telephone', 'gsm', 'mobile', 'whatsapp', 'الهاتف'], example: '+212 6 12 34 56 78', help: 'Facultatif — au format marocain ou international.' },
    ],
  },
  administration: {
    file: 'administration.xlsx',
    sheet: 'Administration',
    columns: [
      { key: 'fullName', label: 'Nom complet', required: true, aliases: ['nom', 'nom et prenom', 'الاسم الكامل'], example: 'Samira Alaoui', help: 'Prénom et nom.' },
      { key: 'email', label: 'E-mail', required: true, aliases: ['email', 'mail', 'courriel', 'البريد الإلكتروني'], example: 'samira.alaoui@ecole.ma', help: 'Sert d’identifiant de connexion.' },
      { key: 'phone', label: 'Téléphone', aliases: ['tel', 'telephone', 'gsm', 'mobile', 'الهاتف'], example: '+212 6 98 76 54 32', help: 'Facultatif.' },
      { key: 'function', label: 'Fonction', aliases: ['poste', 'role', 'rôle', 'الوظيفة'], example: 'Secrétariat', help: '« Direction » donne l’accès administrateur ; Secrétariat, Comptabilité, Surveillance… donnent l’accès secrétariat.' },
    ],
  },
  students: {
    file: 'eleves.xlsx',
    sheet: 'Élèves',
    columns: [
      { key: 'firstName', label: 'Prénom', required: true, aliases: ['prenom eleve', 'الاسم'], example: 'Yasmine', help: '' },
      { key: 'lastName', label: 'Nom', required: true, aliases: ['nom eleve', 'nom de famille', 'النسب'], example: 'Alaoui', help: '' },
      { key: 'birthDate', label: 'Date de naissance', aliases: ['naissance', 'date naissance', 'ne le', 'تاريخ الازدياد'], example: '14/03/2021', help: 'JJ/MM/AAAA (ou une cellule date Excel).' },
      { key: 'gender', label: 'Sexe', aliases: ['genre', 'الجنس'], example: 'F', help: 'F ou M (Fille / Garçon).' },
      { key: 'massar', label: 'Code Massar', aliases: ['massar', 'code eleve', 'رمز مسار'], example: 'R123456789', help: 'Facultatif. Un code déjà connu de l’école n’est pas réimporté.' },
      { key: 'level', label: 'Niveau', aliases: ['niveau scolaire', 'المستوى'], example: 'Petite section', help: 'Nom du niveau (voir l’onglet « Classes »). Sert à créer la classe si elle n’existe pas encore.' },
      { key: 'className', label: 'Classe', aliases: ['groupe', 'section', 'القسم'], example: 'Petite section A', help: 'Nom exact de la classe de l’année, ou vide pour placer l’élève plus tard.' },
      { key: 'p1Name', label: 'Parent 1 — nom', aliases: ['parent 1', 'nom parent 1', 'responsable', 'tuteur', 'nom du parent'], example: 'Fatima Alaoui', help: 'Le parent qui paie (payeur).' },
      { key: 'p1Relation', label: 'Parent 1 — lien', aliases: ['lien parent 1', 'lien'], example: 'Mère', help: 'Mère, Père, Tuteur ou Autre.' },
      { key: 'p1Email', label: 'Parent 1 — e-mail', aliases: ['email parent 1', 'e-mail parent', 'email parent'], example: 'fatima.alaoui@gmail.com', help: 'Avec un e-mail, le parent reçoit un compte de connexion.' },
      { key: 'p1Phone', label: 'Parent 1 — téléphone', aliases: ['telephone parent 1', 'tel parent 1', 'telephone parent', 'gsm parent'], example: '+212 6 11 22 33 44', help: 'Sans e-mail, le téléphone suffit pour créer la fiche (WhatsApp).' },
      { key: 'p2Name', label: 'Parent 2 — nom', aliases: ['parent 2', 'nom parent 2'], example: 'Karim Alaoui', help: 'Facultatif.' },
      { key: 'p2Relation', label: 'Parent 2 — lien', aliases: ['lien parent 2'], example: 'Père', help: '' },
      { key: 'p2Email', label: 'Parent 2 — e-mail', aliases: ['email parent 2'], example: '', help: '' },
      { key: 'p2Phone', label: 'Parent 2 — téléphone', aliases: ['telephone parent 2', 'tel parent 2'], example: '+212 6 55 66 77 88', help: '' },
    ],
  },
}

// ---------------------------------------------------------------- templates

export type TemplateContext = {
  schoolName: string
  levels: string[] // leaf levels of the school (names)
  classes: { name: string; level: string }[] // classes of the viewed year
}

// The template has the columns to fill, an example sheet, a how-to sheet and,
// for students, the school's own levels and classes so names match exactly.
export function buildTemplate(kind: ImportKind, ctx: TemplateContext) {
  const f = FORMATS[kind]
  const wb = XLSX.utils.book_new()

  const main = XLSX.utils.aoa_to_sheet([f.columns.map((c) => c.label)])
  main['!cols'] = f.columns.map((c) => ({ wch: Math.max(14, c.label.length + 4) }))
  XLSX.utils.book_append_sheet(wb, main, f.sheet)

  const example = XLSX.utils.aoa_to_sheet([f.columns.map((c) => c.label), f.columns.map((c) => c.example)])
  example['!cols'] = main['!cols']
  XLSX.utils.book_append_sheet(wb, example, 'Exemple')

  const howto = XLSX.utils.aoa_to_sheet([
    [`${ctx.schoolName} — import « ${f.sheet} »`],
    ['Remplissez l’onglet « ' + f.sheet + ' », une ligne par personne, sans modifier la première ligne.'],
    ['L’onglet « Exemple » montre une ligne remplie ; il n’est jamais importé.'],
    ['Rien n’est enregistré au dépôt : l’application montre ce qu’elle a lu avant d’importer.'],
    [],
    ['Colonne', 'Obligatoire', 'Explication'],
    ...f.columns.map((c) => [c.label, c.required ? 'oui' : '', c.help]),
  ])
  howto['!cols'] = [{ wch: 26 }, { wch: 12 }, { wch: 90 }]
  XLSX.utils.book_append_sheet(wb, howto, 'Mode d’emploi')

  if (kind === 'students') {
    const rows: string[][] = [['Niveau', 'Classes existantes (année en cours)']]
    for (const level of ctx.levels)
      rows.push([level, ctx.classes.filter((c) => c.level === level).map((c) => c.name).join(', ')])
    const ref = XLSX.utils.aoa_to_sheet(rows)
    ref['!cols'] = [{ wch: 32 }, { wch: 60 }]
    XLSX.utils.book_append_sheet(wb, ref, 'Classes')
  }
  return wb
}

export function downloadWorkbook(wb: XLSX.WorkBook, filename: string) {
  XLSX.writeFile(wb, filename, { compression: true })
}

// ---------------------------------------------------------------- parsing

export const norm = (s: unknown) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9؀-ۿ]+/g, ' ')
    .trim()

export type Issue = { level: 'error' | 'warning' | 'info'; code: string; vars?: Record<string, string | number> }

export type StaffRow = { line: number; fullName: string; email: string; phone: string; role: 'teacher' | 'staff' | 'admin'; issues: Issue[] }
export type ParentIn = { fullName: string; email: string; phone: string; relationship: 'mother' | 'father' | 'guardian' | 'other' | null }
export type StudentRow = {
  line: number
  firstName: string
  lastName: string
  birthDate: string | null
  gender: 'female' | 'male' | null
  massar: string
  level: string
  className: string
  parents: ParentIn[]
  issues: Issue[]
}

export type ParseResult =
  | { kind: 'teachers' | 'administration'; rows: StaffRow[]; missingColumns: string[] }
  | { kind: 'students'; rows: StudentRow[]; missingColumns: string[] }

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

function pickSheet(wb: XLSX.WorkBook, kind: ImportKind) {
  const wanted = norm(FORMATS[kind].sheet)
  const name =
    wb.SheetNames.find((n) => norm(n) === wanted) ??
    wb.SheetNames.find((n) => !['exemple', 'mode d emploi', 'classes'].includes(norm(n))) ??
    wb.SheetNames[0]
  return wb.Sheets[name]
}

function toIsoDate(v: unknown): string | null | 'invalid' {
  if (v == null || v === '') return null
  if (v instanceof Date && !isNaN(v.getTime()))
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
  const s = String(v).trim()
  let m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/) // JJ/MM/AAAA
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (m) return s
  return 'invalid'
}

function phone(v: unknown) {
  let s = String(v ?? '').replace(/[^\d+]/g, '')
  if (!s) return ''
  if (s.startsWith('00')) s = `+${s.slice(2)}`
  if (/^0[5-7]\d{8}$/.test(s)) s = `+212${s.slice(1)}` // 06/07/05 xx xx xx xx
  return s
}

const RELATION: Record<string, ParentIn['relationship']> = {
  mere: 'mother', maman: 'mother', mother: 'mother', 'الام': 'mother', 'الأم': 'mother',
  pere: 'father', papa: 'father', father: 'father', 'الاب': 'father', 'الأب': 'father',
  tuteur: 'guardian', tutrice: 'guardian', guardian: 'guardian', 'الوصي': 'guardian',
  autre: 'other', other: 'other',
}

export async function parseFile(file: File, kind: ImportKind): Promise<ParseResult> {
  const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true })
  const sheet = pickSheet(wb, kind)
  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false, defval: '' })
  const header = (grid[0] ?? []).map(norm)
  const cols = FORMATS[kind].columns
  const index: Record<string, number> = {}
  for (const c of cols) {
    const names = [c.label, ...(c.aliases ?? [])].map(norm)
    const i = header.findIndex((h) => names.includes(h))
    if (i >= 0) index[c.key] = i
  }
  const missingColumns = cols.filter((c) => c.required && index[c.key] == null).map((c) => c.label)
  const get = (row: unknown[], key: string) => (index[key] == null ? '' : row[index[key]])
  const text = (row: unknown[], key: string) => String(get(row, key) ?? '').trim()
  const body = grid.slice(1).map((row, i) => ({ row, line: i + 2 })).filter(({ row }) => row.some((c) => String(c).trim() !== ''))

  if (kind === 'students') {
    const rows: StudentRow[] = body.map(({ row, line }) => {
      const issues: Issue[] = []
      const birth = toIsoDate(get(row, 'birthDate'))
      if (birth === 'invalid') issues.push({ level: 'warning', code: 'badDate' })
      const g = norm(get(row, 'gender'))
      const gender = ['f', 'fille', 'feminin', 'female', 'انثى', 'أنثى'].includes(g) ? 'female' : ['m', 'g', 'garcon', 'masculin', 'male', 'ذكر'].includes(g) ? 'male' : null
      if (g && !gender) issues.push({ level: 'warning', code: 'badGender' })
      const parents: ParentIn[] = []
      for (const p of ['p1', 'p2']) {
        const fullName = text(row, `${p}Name`)
        const email = text(row, `${p}Email`).toLowerCase()
        const tel = phone(get(row, `${p}Phone`))
        if (!fullName && !email && !tel) continue
        if (!fullName) issues.push({ level: 'error', code: 'parentNoName', vars: { n: p.slice(1) } })
        if (email && !EMAIL.test(email)) issues.push({ level: 'error', code: 'badEmail', vars: { value: email } })
        if (!email && !tel) issues.push({ level: 'error', code: 'parentNoContact', vars: { n: p.slice(1) } })
        parents.push({ fullName, email, phone: tel, relationship: RELATION[norm(get(row, `${p}Relation`))] ?? null })
      }
      const r: StudentRow = {
        line,
        firstName: text(row, 'firstName'),
        lastName: text(row, 'lastName'),
        birthDate: birth === 'invalid' ? null : birth,
        gender,
        massar: text(row, 'massar').toUpperCase(),
        level: text(row, 'level'),
        className: text(row, 'className'),
        parents,
        issues,
      }
      if (!r.firstName || !r.lastName) issues.push({ level: 'error', code: 'noName' })
      if (!parents.length) issues.push({ level: 'warning', code: 'noParent' })
      return r
    })
    const seen = new Map<string, number>()
    for (const r of rows) {
      if (!r.massar) continue
      if (seen.has(r.massar)) r.issues.push({ level: 'error', code: 'dupInFile', vars: { line: seen.get(r.massar)! } })
      else seen.set(r.massar, r.line)
    }
    return { kind, rows, missingColumns }
  }

  const rows: StaffRow[] = body.map(({ row, line }) => {
    const issues: Issue[] = []
    const email = text(row, 'email').toLowerCase()
    const fn = norm(get(row, 'function'))
    const role: StaffRow['role'] = kind === 'teachers' ? 'teacher' : /direct|admin|proviseur|principal|fondat|مدير/.test(fn) ? 'admin' : 'staff'
    const r: StaffRow = { line, fullName: text(row, 'fullName'), email, phone: phone(get(row, 'phone')), role, issues }
    if (!r.fullName) issues.push({ level: 'error', code: 'noName' })
    if (!email) issues.push({ level: 'error', code: 'noEmail' })
    else if (!EMAIL.test(email)) issues.push({ level: 'error', code: 'badEmail', vars: { value: email } })
    return r
  })
  const seen = new Map<string, number>()
  for (const r of rows) {
    if (!r.email) continue
    if (seen.has(r.email)) r.issues.push({ level: 'error', code: 'dupInFile', vars: { line: seen.get(r.email)! } })
    else seen.set(r.email, r.line)
  }
  return { kind, rows, missingColumns }
}

// Credentials of the accounts created by an import, to hand over.
export function credentialsWorkbook(rows: { name: string; email: string; password: string; role: string }[]) {
  const ws = XLSX.utils.aoa_to_sheet([['Nom', 'E-mail (identifiant)', 'Mot de passe provisoire', 'Rôle'], ...rows.map((r) => [r.name, r.email, r.password, r.role])])
  ws['!cols'] = [{ wch: 28 }, { wch: 34 }, { wch: 22 }, { wch: 16 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Identifiants')
  return wb
}
