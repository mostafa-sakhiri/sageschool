// Checks the Excel import formats end to end (template → fill → parse).
// Run: node --experimental-strip-types scripts/test_import_formats.ts
import * as XLSX from 'xlsx'
import assert from 'node:assert/strict'
import { FORMATS, buildTemplate, parseFile, type ImportKind } from '../src/features/import/formats.ts'

const ctx = {
  schoolName: 'École Test',
  levels: ['Petite section', 'Moyenne section'],
  classes: [{ name: 'Petite section A', level: 'Petite section' }],
}
let passed = 0
const ok = (msg: string) => {
  passed++
  console.log(`✓ ${msg}`)
}
const fileFrom = (wb: XLSX.WorkBook, name: string) =>
  new File([XLSX.write(wb, { type: 'array', bookType: name.endsWith('.csv') ? 'csv' : 'xlsx' })], name)

// 1. Templates: expected sheets, headers in the main sheet, examples never parsed
for (const kind of Object.keys(FORMATS) as ImportKind[]) {
  const wb = buildTemplate(kind, ctx)
  const expected = [FORMATS[kind].sheet, 'Exemple', 'Mode d’emploi', ...(kind === 'students' ? ['Classes'] : [])]
  assert.deepEqual(wb.SheetNames, expected)
  const header = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[FORMATS[kind].sheet], { header: 1 })[0]
  assert.deepEqual(header, FORMATS[kind].columns.map((c) => c.label))
  const parsed = await parseFile(fileFrom(wb, 'modele.xlsx'), kind)
  assert.equal(parsed.rows.length, 0, 'an untouched template imports nothing (examples are not imported)')
  assert.deepEqual(parsed.missingColumns, [])
  ok(`${kind}: template sheets + headers, empty template parses to 0 rows`)
}
{
  const ref = XLSX.utils.sheet_to_json<string[]>(buildTemplate('students', ctx).Sheets['Classes'], { header: 1 })
  assert.deepEqual(ref[1], ['Petite section', 'Petite section A'])
  ok('students template lists the school’s levels and classes')
}

// 2. Teachers: loose headers (other order, synonyms, case), validation, duplicates, phones
{
  const ws = XLSX.utils.aoa_to_sheet([
    ['TÉLÉPHONE', 'Nom et prénom', 'Courriel'],
    ['06 61 23 45 67', 'Leila Chraibi', 'Leila.Chraibi@Ecole.ma'],
    ['', 'Sans Email', ''],
    ['0033612345678', 'Doublon', 'leila.chraibi@ecole.ma'],
    ['', 'Mauvais', 'pas-un-email'],
    ['', '', ''],
  ])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Feuil1')
  const r = await parseFile(fileFrom(wb, 'profs.xlsx'), 'teachers')
  assert.equal(r.kind, 'teachers')
  assert.equal(r.rows.length, 4, 'blank rows are skipped')
  const [a, b, c, d] = r.rows as Extract<typeof r, { kind: 'teachers' }>['rows']
  assert.equal(a.email, 'leila.chraibi@ecole.ma')
  assert.equal(a.phone, '+212661234567')
  assert.equal(a.role, 'teacher')
  assert.deepEqual(a.issues, [])
  assert.ok(b.issues.some((i) => i.code === 'noEmail'))
  assert.ok(c.issues.some((i) => i.code === 'dupInFile' && i.vars?.line === 2))
  assert.equal(c.phone, '+33612345678')
  assert.ok(d.issues.some((i) => i.code === 'badEmail'))
  ok('teachers: loose headers, e-mail normalisation, Moroccan/international phones, duplicate and invalid e-mails')
}

// 3. Administration: function → role
{
  const ws = XLSX.utils.aoa_to_sheet([
    ['Nom complet', 'E-mail', 'Fonction'],
    ['A', 'a@x.ma', 'Directrice pédagogique'],
    ['B', 'b@x.ma', 'Secrétariat'],
    ['C', 'c@x.ma', ''],
  ])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Administration')
  const r = await parseFile(fileFrom(wb, 'admin.xlsx'), 'administration')
  assert.deepEqual(r.rows.map((x) => (x as { role: string }).role), ['admin', 'staff', 'staff'])
  ok('administration: « Direction… » → admin, other functions → staff')
}

// 4. Students: dates (text and Excel date), gender, relations, parents, missing columns, CSV
{
  const ws = XLSX.utils.aoa_to_sheet(
    [
      ['Prénom', 'Nom', 'Date de naissance', 'Sexe', 'Code Massar', 'Niveau', 'Classe', 'Parent 1 — nom', 'Parent 1 — lien', 'Parent 1 — e-mail', 'Parent 1 — téléphone', 'Parent 2 — nom', 'Parent 2 — lien', 'Parent 2 — téléphone'],
      ['Lina', 'Ziani', '12/05/2023', 'fille', 'r1', 'Petite section', 'Petite section A', 'Nadia Ziani', 'Maman', 'nadia@x.ma', '', 'Youssef Ziani', 'père', '0613131313'],
      ['Anas', 'Ziani', new Date(2022, 1, 3), 'M', 'R1', '', '', '', '', '', '', '', '', ''],
      ['Rita', '', 'demain', 'x', '', '', '', 'Amal', '', '', '', '', '', ''],
    ],
    { cellDates: true },
  )
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Élèves')
  const r = await parseFile(fileFrom(wb, 'eleves.xlsx'), 'students')
  const [lina, anas, rita] = r.rows as Extract<typeof r, { kind: 'students' }>['rows']
  assert.equal(lina.birthDate, '2023-05-12')
  assert.equal(lina.gender, 'female')
  assert.equal(lina.massar, 'R1')
  assert.deepEqual(lina.parents.map((p) => [p.relationship, p.email, p.phone]), [
    ['mother', 'nadia@x.ma', ''],
    ['father', '', '+212613131313'],
  ])
  assert.deepEqual(lina.issues, [])
  assert.equal(anas.birthDate, '2022-02-03')
  assert.equal(anas.gender, 'male')
  assert.ok(anas.issues.some((i) => i.code === 'noParent'))
  assert.ok(anas.issues.some((i) => i.code === 'dupInFile'), 'same Massar code twice in the file')
  assert.ok(rita.issues.some((i) => i.code === 'noName' && i.level === 'error'))
  assert.ok(rita.issues.some((i) => i.code === 'badDate'))
  assert.ok(rita.issues.some((i) => i.code === 'badGender'))
  assert.ok(rita.issues.some((i) => i.code === 'parentNoContact'))
  ok('students: text and Excel dates, gender and relation synonyms, two parents, Massar duplicates, row errors')

  const csv = new File(['Prénom;Nom\nOmar;Tahiri\n'], 'eleves.csv')
  const rc = await parseFile(csv, 'students')
  assert.equal(rc.rows.length, 1)
  assert.equal((rc.rows[0] as { lastName: string }).lastName, 'Tahiri')
  ok('students: CSV with semicolons')

  const bad = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(bad, XLSX.utils.aoa_to_sheet([['Élève', 'Classe'], ['X', 'Y']]), 'Feuil1')
  const rb = await parseFile(fileFrom(bad, 'autre.xlsx'), 'students')
  assert.deepEqual(rb.missingColumns, ['Prénom', 'Nom'])
  ok('students: missing required columns are reported')
}

console.log(`\n${passed} checks passed`)
