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
import { AppShell } from '#/components/AppShell'
import { PageIntro, StatCard, Tag, fullName, type Tone } from '#/components/ui'
import { EmptyState, QueryState } from '#/components/states'
import { useSchool } from '#/lib/session'
import { useI18n } from '#/i18n/i18n'
import { supabase } from '#/lib/supabase/client'
import { errorMessage, must } from '#/lib/errors'
import { formatDate, formatMoney, todayIso } from '#/lib/format'
import { nodeLabel, nodesQuery } from '#/features/structure/api'
import { classesQuery } from '#/features/classes/api'
import { currentEnrollment, studentsQuery } from '#/features/students/api'
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
  const balances = useQuery({ ...balancesQuery(ctx.school.id, ctx.year?.id ?? ''), enabled: !!ctx.year })
  const students = useQuery(studentsQuery(ctx.school.id))
  const [filter, setFilter] = useState<'all' | 'open' | 'overdue'>('all')
  const [paying, setPaying] = useState<Balance | null>(null)
  const [planOpen, setPlanOpen] = useState(false)

  const name = (id: string) => fullName(students.data?.find((s) => s.id === id))
  const rows = (balances.data ?? []).filter((b) =>
    filter === 'all' ? true : filter === 'overdue' ? b.payment_status === 'overdue' : ['pending', 'partial', 'overdue'].includes(b.payment_status),
  )
  const totals = useMemo(() => {
    const all = balances.data ?? []
    return {
      due: all.reduce((s, b) => s + Number(b.amount_due), 0),
      paid: all.reduce((s, b) => s + Number(b.amount_paid), 0),
      overdue: all.filter((b) => b.payment_status === 'overdue').length,
    }
  }, [balances.data])

  if (!ctx.year)
    return (
      <AppShell title={t('nav.fees')}>
        <EmptyState title={t('year.none')} />
      </AppShell>
    )

  return (
    <AppShell title={t('nav.fees')}>
      <PageIntro
        title={ctx.isOffice ? t('fees.title') : t('fees.titleParent')}
        subtitle={ctx.isOffice ? t('fees.subtitle') : t('fees.subtitleParent')}
        actions={
          ctx.isOffice && (
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
      <ToggleButtonGroup exclusive size="small" value={filter} onChange={(_, v) => v && setFilter(v)} sx={{ mb: 2 }}>
        <ToggleButton value="all">{t('common.all')}</ToggleButton>
        <ToggleButton value="open">{t('fees.open')}</ToggleButton>
        <ToggleButton value="overdue">{t('fees.overdue')}</ToggleButton>
      </ToggleButtonGroup>
      <QueryState
        query={balances}
        rows={5}
        empty={(d) => (d.length === 0 ? <EmptyState title={t('fees.empty')} hint={ctx.isOffice ? t('fees.emptyHint') : undefined} /> : null)}
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
                  {ctx.isOffice && <TableCell />}
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
                      <Tag tone={STATUS_TONE[b.payment_status]} label={t(`fees.status.${b.payment_status}`)} />
                    </TableCell>
                    {ctx.isOffice && (
                      <TableCell align="right">
                        {Number(b.amount_remaining) > 0 && b.payment_status !== 'cancelled' && (
                          <Button size="small" onClick={() => setPaying(b)}>
                            {t('fees.record')}
                          </Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Paper>
        )}
      </QueryState>
      {!ctx.isOffice && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
          {t('fees.parentNote')}
        </Typography>
      )}
      {paying && <PaymentDialog balance={paying} studentName={name(paying.student_id)} onClose={() => setPaying(null)} />}
      {planOpen && <PlanDialog onClose={() => setPlanOpen(false)} />}
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
          <Box sx={{ p: 1.5, bgcolor: tokens.paper, borderRadius: 2 }}>
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
