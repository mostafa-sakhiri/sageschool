import { useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  InputAdornment,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import SearchOutlined from '@mui/icons-material/SearchOutlined'
import { AppShell } from '#/components/AppShell'
import { PageIntro, StatCard, Tag, fullName, type Tone } from '#/components/ui'
import { EmptyState, QueryState } from '#/components/states'
import { useSchool } from '#/lib/session'
import { useI18n } from '#/i18n/i18n'
import { supabase } from '#/lib/supabase/client'
import { errorMessage, must } from '#/lib/errors'
import { formatDate, formatDateTime, formatMoney, formatPhone, todayIso } from '#/lib/format'
import { nodeLabel, nodesQuery } from '#/features/structure/api'
import { classesQuery } from '#/features/classes/api'
import { currentEnrollment, studentsQuery, type Guardian } from '#/features/students/api'
import { WhatsAppButton } from '#/components/WhatsApp'
import { tokens } from '#/theme/theme'
import { balancesQuery, type Balance } from '#/features/queries'


export const Route = createFileRoute('/_app/fees')({ component: FeesPage })

const STATUS_TONE: Record<Balance['payment_status'], Tone> = {
  paid: 'ok',
  partial: 'info',
  pending: 'neutral',
  overdue: 'danger',
  cancelled: 'neutral',
}

function FeesPage() {
  const { t, locale } = useI18n()
  const ctx = useSchool()
  const balances = useQuery({ ...balancesQuery(ctx.school.id, ctx.year?.id ?? ''), enabled: !!ctx.year && (ctx.canFees || !ctx.isOffice) })
  const students = useQuery(studentsQuery(ctx.school.id))
  const [filter, setFilter] = useState<'all' | 'open' | 'overdue' | 'toRemind'>('all')
  const [search, setSearch] = useState('')
  const [paying, setPaying] = useState<Balance | null>(null)
  const [reminding, setReminding] = useState<Balance | null>(null)
  const [rating, setRating] = useState<Balance | null>(null)
  const reminders = useQuery({
    queryKey: ['school', ctx.school.id, 'reminders', ctx.year?.id],
    enabled: !!ctx.year && ctx.canFees,
    queryFn: async () =>
      Object.fromEntries(
        must(await supabase.from('installment_reminders').select('installment_id, last_reminded_at, reminder_count')).map((r) => [r.installment_id, r]),
      ) as Record<string, { last_reminded_at: string | null; reminder_count: number | null }>,
  })
  const [planOpen, setPlanOpen] = useState(false)

  const name = (id: string) => fullName(students.data?.find((s) => s.id === id))
  // Search by the student's name or the month's label
  const q = search.trim().toLowerCase()
  const rows = (balances.data ?? []).filter((b) =>
    (!q || name(b.student_id).toLowerCase().includes(q) || b.label.toLowerCase().includes(q)) &&
    (filter === 'all'
      ? true
      : filter === 'overdue'
        ? b.payment_status === 'overdue'
        : filter === 'toRemind'
          ? b.payment_status === 'overdue' && !reminders.data?.[b.id]
          : ['pending', 'partial', 'overdue'].includes(b.payment_status)),
  )
  const totals = useMemo(() => {
    const all = balances.data ?? []
    return {
      due: all.reduce((s, b) => s + Number(b.amount_due), 0),
      paid: all.reduce((s, b) => s + Number(b.amount_paid), 0),
      overdue: all.filter((b) => b.payment_status === 'overdue').length,
    }
  }, [balances.data])

  if (ctx.isOffice && !ctx.canFees)
    return (
      <AppShell title={t('nav.fees')}>
        <EmptyState title={t('fees.noAccess')} hint={t('fees.noAccessHint')} />
      </AppShell>
    )
  if (!ctx.year)
    return (
      <AppShell title={t('nav.fees')}>
        <EmptyState title={t('year.none')} />
      </AppShell>
    )

  return (
    <AppShell title={t('nav.fees')}>
      <PageIntro
        title={ctx.canFees ? t('fees.title') : t('fees.titleParent')}
        subtitle={ctx.canFees ? t('fees.subtitle') : t('fees.subtitleParent')}
        actions={
          ctx.canFees && (
            <Button variant="contained" onClick={() => setPlanOpen(true)}>
              {t('fees.generate')}
            </Button>
          )
        }
      />
      <Stack direction="row" spacing={1.25} useFlexGap sx={{ flexWrap: 'wrap', mb: 2.5 }}>
        <StatCard value={formatMoney(totals.due, locale)} label={t('fees.totalDue')} />
        <StatCard value={formatMoney(totals.paid, locale)} label={t('fees.totalPaid')} />
        <StatCard value={formatMoney(totals.due - totals.paid, locale)} label={t('fees.totalRemaining')} />
        <StatCard value={totals.overdue} label={t('fees.overdueCount')} />
      </Stack>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mb: 2, alignItems: { sm: 'center' } }}>
      <TextField
        size="small"
        placeholder={t('fees.search')}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        sx={{ width: { xs: '100%', sm: 300 } }}
        slotProps={{
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <SearchOutlined fontSize="small" />
              </InputAdornment>
            ),
          },
          htmlInput: { 'aria-label': t('fees.search') },
        }}
      />
      <ToggleButtonGroup exclusive size="small" value={filter} onChange={(_, v) => v && setFilter(v)}>
        <ToggleButton value="all">{t('common.all')}</ToggleButton>
        <ToggleButton value="open">{t('fees.open')}</ToggleButton>
        <ToggleButton value="overdue">{t('fees.overdue')}</ToggleButton>
        {ctx.canFees && <ToggleButton value="toRemind">{t('fees.toRemind')}</ToggleButton>}
      </ToggleButtonGroup>
      </Stack>
      <QueryState
        query={balances}
        rows={5}
        empty={(d) => (d.length === 0 ? <EmptyState title={t('fees.empty')} hint={ctx.canFees ? t('fees.emptyHint') : undefined} /> : null)}
      >
        {() => (
          <Paper variant="outlined" sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('students.student')}</TableCell>
                  <TableCell>{t('fees.label')}</TableCell>
                  <TableCell>{t('fees.dueOn')}</TableCell>
                  <TableCell align="right">{t('fees.amountDue')}</TableCell>
                  <TableCell align="right">{t('fees.paid')}</TableCell>
                  <TableCell align="right">{t('fees.remaining')}</TableCell>
                  <TableCell>{t('common.status')}</TableCell>
                  {ctx.canFees && <TableCell />}
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell sx={{ fontWeight: 600 }}>{name(b.student_id)}</TableCell>
                    <TableCell>{b.label}</TableCell>
                    <TableCell>{formatDate(b.due_on, locale)}</TableCell>
                    <TableCell align="right">{formatMoney(b.amount_due, locale)}</TableCell>
                    <TableCell align="right">{formatMoney(b.amount_paid, locale)}</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600 }}>
                      {formatMoney(b.amount_remaining, locale)}
                    </TableCell>
                    <TableCell>
                      {(() => {
                        const r = ctx.canFees ? reminders.data?.[b.id] : undefined
                        const open = ['overdue', 'partial', 'pending'].includes(b.payment_status)
                        if (r && open)
                          return (
                            <Stack spacing={0.25}>
                              <Tag tone="warn" label={t('fees.status.reminded')} />
                              <Typography sx={{ fontSize: 12, color: tokens.inkMuted, whiteSpace: 'nowrap' }}>
                                {t('fees.remindedOn', { date: formatDate(r.last_reminded_at, locale), n: r.reminder_count ?? 1 })}
                              </Typography>
                            </Stack>
                          )
                        return <Tag tone={STATUS_TONE[b.payment_status]} label={t(`fees.status.${b.payment_status}`)} />
                      })()}
                    </TableCell>
                    {ctx.canFees && (
                      <TableCell align="right">
                        <Stack direction="row" spacing={0.5} sx={{ justifyContent: 'flex-end' }}>
                          {b.payment_status === 'overdue' && (
                            <Button size="small" color="warning" onClick={() => setReminding(b)}>
                              {t('fees.remind')}
                            </Button>
                          )}
                          <Button size="small" color="inherit" onClick={() => setRating(b)}>
                            {t('fees.rate')}
                          </Button>
                          {Number(b.amount_remaining) > 0 && b.payment_status !== 'cancelled' && (
                            <Button size="small" onClick={() => setPaying(b)}>
                              {t('fees.record')}
                            </Button>
                          )}
                        </Stack>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Paper>
        )}
      </QueryState>
      {!ctx.canFees && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
          {t('fees.parentNote')}
        </Typography>
      )}
      {paying && <PaymentDialog balance={paying} studentName={name(paying.student_id)} onClose={() => setPaying(null)} />}
      {planOpen && <PlanDialog onClose={() => setPlanOpen(false)} />}
      {rating && (
        <RateDialog
          balance={rating}
          studentName={name(rating.student_id)}
          paidById={Object.fromEntries((balances.data ?? []).map((b) => [b.id, Number(b.amount_paid)]))}
          onClose={() => setRating(null)}
        />
      )}
      {reminding && (
        <ReminderDialog
          balance={reminding}
          studentName={name(reminding.student_id)}
          payers={students.data?.find((s) => s.id === reminding.student_id)?.guardians ?? []}
          onClose={() => setReminding(null)}
        />
      )}
    </AppShell>
  )
}

function PaymentDialog({ balance, studentName, onClose }: { balance: Balance; studentName: string; onClose: () => void }) {
  const { t, locale } = useI18n()
  const ctx = useSchool()
  const queryClient = useQueryClient()
  const [amount, setAmount] = useState(String(balance.amount_remaining))
  const [method, setMethod] = useState<'cash' | 'bank_transfer' | 'cheque' | 'card' | 'other'>('cash')
  const [reference, setReference] = useState('')
  const [paidOn, setPaidOn] = useState(todayIso())
  const pay = useMutation({
    mutationFn: async () =>
      must(
        await supabase.from('payments').insert({
          school_id: ctx.school.id,
          installment_id: balance.id,
          amount: Number(amount),
          method,
          reference: reference || null,
          paid_on: paidOn,
          recorded_by_member_id: ctx.member.id,
        }),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['school', ctx.school.id, 'balances'] })
      onClose()
    },
  })
  const n = Number(amount)
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          pay.mutate()
        }}
      >
        <DialogTitle>{t('fees.recordTitle')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Typography>
              <strong>{studentName}</strong> · {balance.label} · {t('fees.remainingAmount', { amount: formatMoney(balance.amount_remaining, locale) })}
            </Typography>
            <TextField
              label={t('fees.amount')}
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              slotProps={{ htmlInput: { min: 0.01, step: 0.01 } }}
              helperText={n > 0 && n < Number(balance.amount_remaining) ? t('fees.partialHint') : undefined}
              required
            />
            <TextField select label={t('fees.method')} value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
              {(['cash', 'bank_transfer', 'cheque', 'card', 'other'] as const).map((m) => (
                <MenuItem key={m} value={m}>
                  {t(`fees.methods.${m}`)}
                </MenuItem>
              ))}
            </TextField>
            <TextField label={t('fees.reference')} value={reference} onChange={(e) => setReference(e.target.value)} />
            <TextField type="date" label={t('fees.paidOn')} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
            {n > Number(balance.amount_remaining) && <Alert severity="warning">{t('fees.overpay')}</Alert>}
            {pay.isError && <Alert severity="error">{errorMessage(pay.error, t)}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="contained" loading={pay.isPending} disabled={!(n > 0)}>
            {t('fees.record')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}

// One child's monthly fee (reduction, half day, end of a reduction...): the
// plan's installments of the year change for one month, from a month on, or
// for the whole year. A month keeps its amount only when more than the new
// amount was already paid for it (it would be overpaid); a partly paid month
// changes (800 due, 750 paid, new 750 -> paid).
function RateDialog({
  balance,
  studentName,
  paidById,
  onClose,
}: {
  balance: Balance
  studentName: string
  paidById: Record<string, number>
  onClose: () => void
}) {
  const { t, locale } = useI18n()
  const ctx = useSchool()
  const queryClient = useQueryClient()
  const months = useQuery({
    queryKey: ['school', ctx.school.id, 'monthly-of', balance.student_id, ctx.year!.id],
    queryFn: async () =>
      must(
        await supabase
          .from('fee_installments')
          .select('id, label, due_on, amount_due')
          .eq('student_id', balance.student_id)
          .eq('academic_year_id', ctx.year!.id)
          .eq('status', 'active')
          .not('fee_plan_id', 'is', null)
          .order('due_on'),
      ),
  })
  const [scope, setScope] = useState<'month' | 'from' | 'year'>('from')
  const [from, setFrom] = useState('')
  const [amount, setAmount] = useState('')
  const list = months.data ?? []
  // Starts on the month that was clicked, else the first one not yet paid
  const start = from || list.find((m) => m.id === balance.id)?.due_on || list.find((m) => !paidById[m.id])?.due_on || list[0]?.due_on || ''
  const shown = amount || (list.length ? String(list[list.length - 1].amount_due) : '')
  const after = list.filter((m) => (scope === 'year' ? true : scope === 'month' ? m.due_on === start : m.due_on >= start))
  const n = Number(shown)
  const overpaid = after.filter((m) => (paidById[m.id] ?? 0) > n)
  const changed = after.filter((m) => (paidById[m.id] ?? 0) <= n && Number(m.amount_due) !== n)
  const kept = overpaid.length
  const save = useMutation({
    mutationFn: async () =>
      must(await supabase.from('fee_installments').update({ amount_due: n }).in('id', changed.map((m) => m.id))),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['school', ctx.school.id] })
      onClose()
    },
  })
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{t('fees.rateTitle')}</DialogTitle>
      <DialogContent>
        <QueryState query={months} rows={2} empty={(d) => (d.length === 0 ? <Alert severity="info">{t('fees.rateNone')}</Alert> : null)}>
          {() => (
            <Stack spacing={2} sx={{ pt: 1 }}>
              <Typography>
                <strong>{studentName}</strong>
              </Typography>
              <ToggleButtonGroup exclusive size="small" fullWidth value={scope} onChange={(_, v) => v && setScope(v)}>
                <ToggleButton value="month">{t('fees.rateScope.month')}</ToggleButton>
                <ToggleButton value="from">{t('fees.rateScope.from')}</ToggleButton>
                <ToggleButton value="year">{t('fees.rateScope.year')}</ToggleButton>
              </ToggleButtonGroup>
              {scope !== 'year' && (
                <TextField select label={scope === 'month' ? t('fees.rateMonth') : t('fees.rateFrom')} value={start} onChange={(e) => setFrom(e.target.value)}>
                  {list.map((m) => (
                    <MenuItem key={m.id} value={m.due_on}>
                      {m.label} · {formatMoney(m.amount_due, locale)}
                    </MenuItem>
                  ))}
                </TextField>
              )}
              <TextField
                label={t('fees.rateNew')}
                type="number"
                value={shown}
                onChange={(e) => setAmount(e.target.value)}
                slotProps={{ htmlInput: { min: 0, step: 1 } }}
                required
              />
              <Box sx={{ p: 1.5, bgcolor: tokens.fill, borderRadius: 2 }}>
                <Typography sx={{ fontSize: 14 }}>{t('fees.ratePreview', { n: changed.length, amount: formatMoney(n || 0, locale) })}</Typography>
                {kept > 0 && <Typography sx={{ fontSize: 13, color: tokens.inkMuted }}>{t('fees.rateKeepPaid', { n: kept })}</Typography>}
              </Box>
              {save.isError && <Alert severity="error">{errorMessage(save.error, t)}</Alert>}
            </Stack>
          )}
        </QueryState>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant="contained" onClick={() => save.mutate()} loading={save.isPending} disabled={!(n >= 0) || shown === '' || changed.length === 0}>
          {t('fees.rateSave')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

// A fee plan on a node (or the whole school) generates monthly installments
// for every student currently enrolled in a class under that node.
function PlanDialog({ onClose }: { onClose: () => void }) {
  const { t, locale } = useI18n()
  const ctx = useSchool()
  const queryClient = useQueryClient()
  const nodes = useQuery(nodesQuery(ctx.school.id))
  const classes = useQuery({ ...classesQuery(ctx.school.id, ctx.year!.id) })
  const students = useQuery(studentsQuery(ctx.school.id))
  const [name, setName] = useState(t('fees.defaultPlanName'))
  const [amount, setAmount] = useState('1500')
  const [nodeId, setNodeId] = useState('')
  const [frequency, setFrequency] = useState<'monthly' | 'one_time'>('monthly')
  const [months, setMonths] = useState('10')

  const targets = useMemo(() => {
    const underNode = new Set(
      (classes.data ?? [])
        .filter((c) => {
          if (!nodeId) return true
          const n = nodes.data?.find((x) => x.id === c.node_id)
          return n?.path.includes(nodeId)
        })
        .map((c) => c.id),
    )
    return (students.data ?? []).filter((s) => {
      const e = currentEnrollment(s, ctx.year!.id)
      return e && underNode.has(e.class_id)
    })
  }, [classes.data, nodes.data, students.data, nodeId, ctx.year])

  const generate = useMutation({
    mutationFn: async () => {
      const plan = must(
        await supabase
          .from('fee_plans')
          .insert({
            school_id: ctx.school.id,
            academic_year_id: ctx.year!.id,
            node_id: nodeId || null,
            name,
            amount: Number(amount),
            frequency,
          })
          .select('id')
          .single(),
      )
      const start = new Date(`${ctx.year!.starts_on}T12:00:00`)
      const count = frequency === 'monthly' ? Number(months) : 1
      const rows = targets.flatMap((s) =>
        Array.from({ length: count }, (_, i) => {
          const d = new Date(start.getFullYear(), start.getMonth() + i, 10)
          const label =
            frequency === 'monthly'
              ? `${name} — ${new Intl.DateTimeFormat('fr-MA', { month: 'long', year: 'numeric' }).format(d)}`
              : name
          return {
            school_id: ctx.school.id,
            student_id: s.id,
            academic_year_id: ctx.year!.id,
            fee_plan_id: plan.id,
            label,
            amount_due: Number(amount),
            due_on: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-10`,
          }
        }),
      )
      if (rows.length) must(await supabase.from('fee_installments').insert(rows))
      return rows.length
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['school', ctx.school.id, 'balances'] })
      onClose()
    },
  })

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{t('fees.generate')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField label={t('common.name')} value={name} onChange={(e) => setName(e.target.value)} required />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField label={t('fees.amountMad')} type="number" value={amount} onChange={(e) => setAmount(e.target.value)} fullWidth required />
            <TextField select label={t('fees.frequency')} value={frequency} onChange={(e) => setFrequency(e.target.value as typeof frequency)} fullWidth>
              <MenuItem value="monthly">{t('fees.freq.monthly')}</MenuItem>
              <MenuItem value="one_time">{t('fees.freq.one_time')}</MenuItem>
            </TextField>
            {frequency === 'monthly' && (
              <TextField label={t('fees.months')} type="number" value={months} onChange={(e) => setMonths(e.target.value)} sx={{ minWidth: 110, flexShrink: 0 }} />
            )}
          </Stack>
          <TextField
            select
            label={t('fees.appliesTo')}
            value={nodeId}
            onChange={(e) => setNodeId(e.target.value)}
            slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
          >
            <MenuItem value="">{t('ann.wholeSchool')}</MenuItem>
            {(nodes.data ?? [])
              .filter((n) => n.kind === 'cycle' || n.kind === 'level')
              .map((n) => (
                <MenuItem key={n.id} value={n.id}>
                  {nodeLabel(n, nodes.data ?? [], locale)}
                </MenuItem>
              ))}
          </TextField>
          <Box sx={{ p: 1.5, bgcolor: tokens.fill, borderRadius: 2 }}>
            <Typography sx={{ fontSize: 14 }}>
              {t('fees.preview', { students: targets.length, n: frequency === 'monthly' ? Number(months) || 0 : 1 })}
            </Typography>
          </Box>
          {generate.isError && <Alert severity="error">{errorMessage(generate.error, t)}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant="contained" onClick={() => generate.mutate()} loading={generate.isPending} disabled={!name || !(Number(amount) >= 0) || targets.length === 0}>
          {t('fees.generateAction')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

// A reminder for an overdue installment: logged (date, channel, who); by
// WhatsApp/SMS/e-mail a message (simulated) goes to the paying parents. The
// status then reads "en retard · relancé le …".
function ReminderDialog({
  balance,
  studentName,
  payers,
  onClose,
}: {
  balance: Balance
  studentName: string
  payers: Guardian[]
  onClose: () => void
}) {
  const { t, locale } = useI18n()
  const ctx = useSchool()
  const queryClient = useQueryClient()
  const [channel, setChannel] = useState<'whatsapp' | 'sms' | 'phone' | 'email' | 'in_person' | 'letter'>('whatsapp')
  const [note, setNote] = useState('')
  const history = useQuery({
    queryKey: ['school', ctx.school.id, 'reminders-of', balance.id],
    queryFn: async () =>
      must(
        await supabase
          .from('payment_reminders')
          .select('id, channel, note, created_at, by:school_members(user:users(full_name))')
          .eq('installment_id', balance.id)
          .order('created_at', { ascending: false }),
      ) as unknown as { id: string; channel: string; note: string | null; created_at: string; by: { user: { full_name: string } | null } | null }[],
  })
  const save = useMutation({
    mutationFn: async (via?: typeof channel) =>
      must(await supabase.from('payment_reminders').insert({ school_id: ctx.school.id, installment_id: balance.id, channel: via ?? channel, note: note.trim() || null })),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['school', ctx.school.id, 'reminders'] })
      await queryClient.invalidateQueries({ queryKey: ['school', ctx.school.id, 'reminders-of', balance.id] })
      onClose()
    },
  })
  const shown = payers.filter((g) => g.is_payer).length ? payers.filter((g) => g.is_payer) : payers
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{t('fees.remindTitle')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Typography>
            <strong>{studentName}</strong> · {balance.label} · {t('fees.remainingAmount', { amount: formatMoney(balance.amount_remaining, locale) })} ·{' '}
            {t('fees.dueSince', { date: formatDate(balance.due_on, locale) })}
          </Typography>
          <Box>
            {shown.length === 0 && <Alert severity="warning">{t('students.noParent')}</Alert>}
            {shown.map((g) => (
              <Stack key={g.guardian_member_id} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <Typography sx={{ fontSize: 14, flex: 1 }}>
                  {g.member?.user?.full_name}
                  {g.member?.user?.phone && (
                    <Box component="a" href={`tel:${g.member.user.phone}`} dir="ltr" sx={{ ml: 1, color: tokens.accentDark, fontWeight: 600 }}>
                      {formatPhone(g.member.user.phone)}
                    </Box>
                  )}
                </Typography>
                <WhatsAppButton
                  phone={g.member?.user?.phone}
                  label={t('wa.sendReminder')}
                  tooltip={t('wa.reminderTooltip')}
                  text={t('wa.payment', {
                    parent: g.member?.user?.full_name ?? '',
                    child: studentName,
                    label: balance.label,
                    amount: formatMoney(balance.amount_remaining, locale),
                    date: formatDate(balance.due_on, locale),
                    school: ctx.school.name,
                  })}
                  onSent={() => save.mutate('whatsapp')}
                />
              </Stack>
            ))}
          </Box>
          <TextField select label={t('fees.remindChannel')} value={channel} onChange={(e) => setChannel(e.target.value as typeof channel)}>
            {(['whatsapp', 'sms', 'phone', 'email', 'in_person', 'letter'] as const).map((c) => (
              <MenuItem key={c} value={c}>
                {t(`fees.remindChannels.${c}`)}
              </MenuItem>
            ))}
          </TextField>
          {['whatsapp', 'sms', 'email'].includes(channel) && (
            <Typography variant="body2" color="text.secondary">
              {t('fees.remindStub')}
            </Typography>
          )}
          <TextField label={t('fees.remindNote')} value={note} onChange={(e) => setNote(e.target.value)} multiline minRows={2} placeholder={t('fees.remindNotePlaceholder')} />
          {save.isError && <Alert severity="error">{errorMessage(save.error, t)}</Alert>}
          {(history.data ?? []).length > 0 && (
            <>
              <Typography variant="h6">{t('fees.remindHistory')}</Typography>
              {(history.data ?? []).map((h) => (
                <Typography key={h.id} sx={{ fontSize: 13, color: tokens.inkSoft }}>
                  {formatDateTime(h.created_at, locale)} · {t(`fees.remindChannels.${h.channel}`)} · {h.by?.user?.full_name}
                  {h.note ? ` — ${h.note}` : ''}
                </Typography>
              ))}
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant="contained" onClick={() => save.mutate(undefined)} loading={save.isPending}>
          {t('fees.remindSave')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
