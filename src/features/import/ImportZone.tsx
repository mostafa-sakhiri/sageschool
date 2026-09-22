import { useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  Collapse,
  Dialog,
  DialogContent,
  DialogTitle,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import UploadFileOutlined from '@mui/icons-material/UploadFileOutlined'
import DownloadOutlined from '@mui/icons-material/DownloadOutlined'
import GroupsOutlined from '@mui/icons-material/GroupsOutlined'
import BadgeOutlined from '@mui/icons-material/BadgeOutlined'
import FaceOutlined from '@mui/icons-material/FaceOutlined'
import { useI18n } from '#/i18n/i18n'
import { useSchool } from '#/lib/session'
import { errorMessage } from '#/lib/errors'
import { importMembers, type ImportResult } from '#/lib/imports'
import { Tag } from '#/components/ui'
import { leafNodes, nodeName, nodesQuery } from '#/features/structure/api'
import { classesQuery } from '#/features/classes/api'
import { studentsQuery } from '#/features/students/api'
import { membersQuery } from '#/features/team/api'
import { tokens } from '#/theme/theme'
import {
  FORMATS,
  buildTemplate,
  credentialsWorkbook,
  downloadWorkbook,
  norm,
  parseFile,
  type ImportKind,
  type Issue,
  type ParseResult,
} from './formats'

const ICONS: Record<ImportKind, React.ReactNode> = {
  teachers: <GroupsOutlined />,
  administration: <BadgeOutlined />,
  students: <FaceOutlined />,
}

type Row = { line: number; label: string; issues: Issue[] }

// One drop zone (mockup W4): download the template, drop the filled file, see
// what was read, fix or accept, then import. Nothing is written before
// "Importer".
export function ImportZone({ kind }: { kind: ImportKind }) {
  const { t } = useI18n()
  const ctx = useSchool()
  const queryClient = useQueryClient()
  const input = useRef<HTMLInputElement>(null)
  const nodes = useQuery(nodesQuery(ctx.school.id))
  const classes = useQuery({ ...classesQuery(ctx.school.id, ctx.year?.id ?? ''), enabled: !!ctx.year })
  const students = useQuery({ ...studentsQuery(ctx.school.id), enabled: kind === 'students' })
  const members = useQuery({ ...membersQuery(ctx.school.id), enabled: kind !== 'students' })
  const [file, setFile] = useState<File | null>(null)
  const [parsed, setParsed] = useState<ParseResult | null>(null)
  const [parseError, setParseError] = useState<unknown>(null)
  const [showDetail, setShowDetail] = useState(false)
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [importError, setImportError] = useState<unknown>(null)
  const [dragOver, setDragOver] = useState(false)

  const levels = useMemo(() => leafNodes(nodes.data ?? []), [nodes.data])
  const needsYear = kind === 'students' && !ctx.year

  const template = () => {
    const levelName = (id: string) => nodeName(levels.find((l) => l.id === id) ?? { name: '', name_ar: null }, 'fr')
    downloadWorkbook(
      buildTemplate(kind, {
        schoolName: ctx.school.name,
        levels: levels.map((l) => l.name),
        classes: (classes.data ?? []).map((c) => ({ name: c.name, level: levelName(c.node_id) })),
      }),
      FORMATS[kind].file,
    )
  }

  // Checks that need the school's data: classes, levels, people already known.
  const rows: Row[] = useMemo(() => {
    if (!parsed) return []
    if (parsed.kind === 'students') {
      const classNames = new Set((classes.data ?? []).map((c) => norm(c.name)))
      const levelNames = new Set(levels.flatMap((l) => [norm(l.name), norm(l.name_ar ?? ''), norm(l.code ?? '')]).filter(Boolean))
      const known = new Set(
        (students.data ?? []).map((s) => `${norm(s.first_name)}|${norm(s.last_name)}|${s.birth_date ?? ''}`),
      )
      return parsed.rows.map((r) => {
        const issues = [...r.issues]
        if (r.className && !classNames.has(norm(r.className))) {
          if (levelNames.has(norm(r.level)))
            issues.push(ctx.isAdmin ? { level: 'warning', code: 'classWillBeCreated', vars: { name: r.className } } : { level: 'error', code: 'unknownClassStaff', vars: { name: r.className } })
          else issues.push({ level: 'error', code: 'unknownClass', vars: { name: r.className } })
        }
        if (!r.className) issues.push({ level: 'warning', code: 'noClass' })
        if (known.has(`${norm(r.firstName)}|${norm(r.lastName)}|${r.birthDate ?? ''}`)) issues.push({ level: 'warning', code: 'alreadyStudent' })
        return { line: r.line, label: `${r.firstName} ${r.lastName}`.trim(), issues }
      })
    }
    const team = members.data ?? []
    return parsed.rows.map((r) => {
      const issues = [...r.issues]
      if (r.email && team.some((m) => m.user?.email?.toLowerCase() === r.email && m.role === r.role))
        issues.push({ level: 'warning', code: 'alreadyMember' })
      if (parsed.kind === 'administration') issues.unshift({ level: 'info', code: 'accessAs', vars: { role: t(`role.${r.role}`) } })
      return { line: r.line, label: `${r.fullName}${r.email ? ` · ${r.email}` : ''}`, issues }
    })
  }, [parsed, classes.data, levels, students.data, members.data, ctx.isAdmin, t])

  // Rows already known are shown but not sent (the server would skip them too).
  const SKIP = ['alreadyStudent', 'alreadyMember']
  const valid = rows.filter((r) => !r.issues.some((i) => i.level === 'error' || SKIP.includes(i.code)))
  const errors = rows.filter((r) => r.issues.some((i) => i.level === 'error')).length
  const known = rows.filter((r) => !r.issues.some((i) => i.level === 'error') && r.issues.some((i) => SKIP.includes(i.code))).length
  const warnings = valid.filter((r) => r.issues.some((i) => i.level === 'warning')).length

  const onFile = async (f: File | undefined) => {
    if (!f) return
    setFile(f)
    setResult(null)
    setImportError(null)
    setParseError(null)
    try {
      setParsed(await parseFile(f, kind))
    } catch (e) {
      setParsed(null)
      setParseError(e)
    }
  }

  const reset = () => {
    setFile(null)
    setParsed(null)
    setResult(null)
    setShowDetail(false)
    if (input.current) input.current.value = ''
  }

  const run = async () => {
    if (!parsed) return
    setImporting(true)
    setImportError(null)
    const ok = new Set(valid.map((r) => r.line))
    try {
      const res =
        parsed.kind === 'students'
          ? await importMembers({
              data: {
                schoolId: ctx.school.id,
                yearId: ctx.year?.id,
                kind: 'students',
                students: parsed.rows.filter((r) => ok.has(r.line)).map(({ issues: _, ...r }) => r),
              },
            })
          : await importMembers({
              data: {
                schoolId: ctx.school.id,
                kind: parsed.kind,
                staff: parsed.rows.filter((r) => ok.has(r.line)).map(({ issues: _, ...r }) => r),
              },
            })
      setResult(res)
      await queryClient.invalidateQueries({ queryKey: ['school', ctx.school.id] })
    } catch (e) {
      setImportError(e)
    } finally {
      setImporting(false)
    }
  }

  const done = result && {
    created: result.results.filter((r) => r.status === 'created').length,
    linked: result.results.filter((r) => r.status === 'linked').length,
    exists: result.results.filter((r) => r.status === 'exists').length,
    failed: result.results.filter((r) => r.status === 'error'),
  }
  const issueText = (i: Issue) => t(`import.issue.${i.code}`, i.vars)

  return (
    <Paper
      variant="outlined"
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        onFile(e.dataTransfer.files?.[0])
      }}
      sx={{
        p: 2.5,
        borderColor: dragOver ? tokens.accent : parsed ? tokens.accentLine : tokens.lineSoft,
        bgcolor: parsed ? '#F4F9F7' : '#fff',
      }}
    >
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { sm: 'flex-start' } }}>
        <Box sx={{ width: 40, height: 40, borderRadius: '11px', display: 'grid', placeItems: 'center', bgcolor: parsed ? tokens.accentSoft : '#F2EEE4', color: parsed ? tokens.accentDark : tokens.inkMuted, flexShrink: 0 }}>
          {ICONS[kind]}
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="h5">{t(`import.${kind}.title`)}</Typography>
          <Typography sx={{ fontSize: 13.5, color: tokens.inkSoft }}>{t(`import.${kind}.detail`)}</Typography>
        </Box>
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
          <Button size="small" startIcon={<DownloadOutlined />} onClick={template} disabled={nodes.isPending}>
            {t('import.template')}
          </Button>
          {parsed && !result && (
            <Button size="small" variant="contained" onClick={run} loading={importing} disabled={!valid.length || needsYear}>
              {t('import.run', { n: valid.length })}
            </Button>
          )}
        </Stack>
      </Stack>

      <input
        ref={input}
        type="file"
        hidden
        accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
        onChange={(e) => onFile(e.target.files?.[0])}
      />

      {needsYear && <Alert severity="info" sx={{ mt: 2 }}>{t('import.needsYear')}</Alert>}

      {!file ? (
        <Box
          sx={{
            mt: 2,
            p: 2.5,
            border: `1.5px dashed ${dragOver ? tokens.accent : tokens.lineStrong}`,
            borderRadius: 3,
            textAlign: 'center',
          }}
        >
          <UploadFileOutlined sx={{ color: tokens.inkMuted }} />
          <Typography sx={{ fontSize: 14, mt: 0.5 }}>{t('import.drop')}</Typography>
          <Button size="small" variant="outlined" sx={{ mt: 1 }} onClick={() => input.current?.click()}>
            {t('import.browse')}
          </Button>
        </Box>
      ) : (
        <Stack spacing={1.25} sx={{ mt: 2 }}>
          <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <Typography sx={{ fontWeight: 600, fontSize: 14 }} dir="auto">
              {file.name}
            </Typography>
            {parsed && (
              <Typography sx={{ fontSize: 13.5, color: tokens.inkSoft }}>
                {t(`import.${kind}.read`, { n: rows.length })}
                {errors ? ` · ${t('import.toFix', { n: errors })}` : ''}
                {known ? ` · ${t('import.alreadyKnown', { n: known })}` : ''}
                {warnings ? ` · ${t('import.withWarnings', { n: warnings })}` : ''}
              </Typography>
            )}
            <Box sx={{ flex: 1 }} />
            {parsed && rows.length > 0 && (
              <Button size="small" onClick={() => setShowDetail((v) => !v)}>
                {showDetail ? t('import.hideDetail') : t('import.showDetail')}
              </Button>
            )}
            <Button size="small" color="inherit" onClick={reset}>
              {t('import.remove')}
            </Button>
          </Stack>

          {!!parseError && <Alert severity="error">{t('import.unreadable')}</Alert>}
          {parsed?.missingColumns.length ? (
            <Alert severity="error">{t('import.missingColumns', { cols: parsed.missingColumns.join(', ') })}</Alert>
          ) : null}
          {parsed && rows.length === 0 && !parsed.missingColumns.length && <Alert severity="warning">{t('import.empty')}</Alert>}
          {!result && parsed && rows.length > 0 && <Typography sx={{ fontSize: 12.5, color: tokens.inkMuted }}>{t('import.notYet')}</Typography>}

          <Collapse in={showDetail && !!parsed} unmountOnExit>
            <Box sx={{ maxHeight: 320, overflow: 'auto', border: `1px solid ${tokens.lineSoft}`, borderRadius: 2, bgcolor: '#fff' }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell>{t('import.line')}</TableCell>
                    <TableCell>{t('common.name')}</TableCell>
                    <TableCell>{t('import.check')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((r) => {
                    const res = result?.results.find((x) => x.line === r.line)
                    return (
                      <TableRow key={r.line}>
                        <TableCell sx={{ color: tokens.inkMuted }}>{r.line}</TableCell>
                        <TableCell dir="auto" sx={{ fontWeight: 500 }}>
                          {r.label || '—'}
                        </TableCell>
                        <TableCell>
                          <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: 'wrap' }}>
                            {res ? (
                              <>
                                <Tag tone={res.status === 'error' ? 'danger' : res.status === 'exists' ? 'neutral' : 'ok'} label={t(`import.status.${res.status}`)} />
                                {res.notes.map((n, i) => (
                                  <Typography key={i} component="span" sx={{ fontSize: 12.5, color: tokens.inkSoft }}>
                                    {t(`import.note.${n}`) === `import.note.${n}` ? n : t(`import.note.${n}`)}
                                  </Typography>
                                ))}
                              </>
                            ) : (
                              <>
                                {!r.issues.some((i) => i.level !== 'info') && <Tag tone="ok" label={t('import.ok')} />}
                                {r.issues.map((i, k) => (
                                  <Tag key={k} tone={i.level === 'error' ? 'danger' : i.level === 'info' ? 'info' : 'warn'} label={issueText(i)} />
                                ))}
                              </>
                            )}
                          </Stack>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </Box>
          </Collapse>

          {!!importError && <Alert severity="error">{errorMessage(importError, t)}</Alert>}
          {done && (
            <Alert
              severity={done.failed.length ? 'warning' : 'success'}
              action={
                result!.credentials.length > 0 && (
                  <Button color="inherit" size="small" startIcon={<DownloadOutlined />} onClick={() => downloadWorkbook(credentialsWorkbook(result!.credentials.map((c) => ({ ...c, role: t(`role.${c.role}`) }))), 'identifiants.xlsx')}>
                    {t('import.credentials', { n: result!.credentials.length })}
                  </Button>
                )
              }
            >
              {t('import.done', { created: done.created, linked: done.linked, exists: done.exists })}
              {done.failed.length ? ` ${t('import.failed', { n: done.failed.length })}` : ''}
              {result!.credentials.length > 0 && <Box sx={{ fontSize: 12.5, mt: 0.5 }}>{t('import.credentialsHint')}</Box>}
            </Alert>
          )}
        </Stack>
      )}
    </Paper>
  )
}

export function ImportPanel({ kinds }: { kinds: ImportKind[] }) {
  const { t } = useI18n()
  const ctx = useSchool()
  return (
    <Stack spacing={1.5}>
      <Alert severity="info" icon={false} sx={{ bgcolor: tokens.accentSoft, color: tokens.accentDark }}>
        {t('import.destination', { school: ctx.school.name, year: ctx.year?.name ?? '—' })}
      </Alert>
      {kinds.map((k) => (
        <ImportZone key={k} kind={k} />
      ))}
    </Stack>
  )
}

export function ImportDialog({ open, onClose, kinds, title }: { open: boolean; onClose: () => void; kinds: ImportKind[]; title: string }) {
  const { t } = useI18n()
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle sx={{ display: 'flex', alignItems: 'center' }}>
        <Box sx={{ flex: 1 }}>{title}</Box>
        <Button onClick={onClose}>{t('common.close')}</Button>
      </DialogTitle>
      <DialogContent>
        <Typography sx={{ fontSize: 14, color: tokens.inkSoft, mb: 2 }}>{t('import.dialogHint')}</Typography>
        {open && <ImportPanel kinds={kinds} />}
      </DialogContent>
    </Dialog>
  )
}
