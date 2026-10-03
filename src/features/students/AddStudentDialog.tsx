import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Divider,
  FormControlLabel,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useSchool } from '#/lib/session'
import { useI18n } from '#/i18n/i18n'
import { supabase } from '#/lib/supabase/client'
import { errorMessage, must } from '#/lib/errors'
import { formatMoney, todayIso } from '#/lib/format'
import { classesQuery } from '#/features/classes/api'
import { tokens } from '#/theme/theme'
import { SurfaceActions, SurfaceContent, SurfaceDialog, SurfaceTitle } from '#/components/Surface'

export type StudentPrefill = {
  first?: string
  last?: string
  birth?: string
  gender?: 'female' | 'male'
  classId?: string
  preinscriptionId?: string
}

type Month = { key: string; due: string; label: string }

// The months of a school year, due on the 10th (same rule as fee plans).
function yearMonths(startsOn: string, endsOn: string, name: string): Month[] {
  const out: Month[] = []
  const start = new Date(`${startsOn}T12:00:00`)
  const end = new Date(`${endsOn}T12:00:00`)
  for (let d = new Date(start.getFullYear(), start.getMonth(), 10); d <= end && out.length < 12; d = new Date(d.getFullYear(), d.getMonth() + 1, 10)) {
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    out.push({ key, due: `${key}-10`, label: `${name} — ${new Intl.DateTimeFormat('fr-MA', { month: 'long', year: 'numeric' }).format(d)}` })
  }
  return out
}

// Used by the students page, the pre-registrations page and the quick actions.
// At enrolment: the school year, the class, and (for whoever handles fees) the
// monthly fee with the months already paid.
export function AddStudentDialog({
  open,
  onClose,
  onCreated,
  prefill,
}: {
  open: boolean
  onClose: () => void
  onCreated: (id: string) => void
  prefill?: StudentPrefill
}) {
  const { t, locale } = useI18n()
  const ctx = useSchool()
  const queryClient = useQueryClient()
  // Fee installments are created along with the student: needs fees write
  const canFeesWrite = ctx.can('fees.plans')
  const [yearId, setYearId] = useState(ctx.year?.id ?? '')
  const year = ctx.years.find((y) => y.id === yearId) ?? null
  const classes = useQuery({ ...classesQuery(ctx.school.id, yearId), enabled: !!yearId })
  const plans = useQuery({
    queryKey: ['school', ctx.school.id, 'fee-plans', yearId],
    enabled: !!yearId && canFeesWrite,
    queryFn: async () =>
      must(
        await supabase
          .from('fee_plans')
          .select('id, name, amount, frequency')
          .eq('academic_year_id', yearId)
          .eq('frequency', 'monthly')
          .order('created_at', { ascending: false }),
      ),
  })
  const [first, setFirst] = useState('')
  const [last, setLast] = useState('')
  const [birth, setBirth] = useState('')
  const [gender, setGender] = useState('')
  const [classId, setClassId] = useState('')
  const [monthly, setMonthly] = useState('')
  const [paid, setPaid] = useState<Set<string>>(new Set())
  const [regFee, setRegFee] = useState('')
  const [regPaid, setRegPaid] = useState(true)
  const [method, setMethod] = useState<'cash' | 'bank_transfer' | 'cheque' | 'card' | 'other'>('cash')

  useEffect(() => {
    if (!open) return
    setFirst(prefill?.first ?? '')
    setLast(prefill?.last ?? '')
    setBirth(prefill?.birth ?? '')
    setGender(prefill?.gender ?? '')
    setClassId(prefill?.classId ?? '')
    setYearId(ctx.year?.id ?? '')
  }, [open, prefill, ctx.year?.id])

  const plan = plans.data?.[0]
  useEffect(() => {
    setMonthly(plan ? String(plan.amount) : '')
    setPaid(new Set())
  }, [plan, yearId])

  const planName = plan?.name ?? t('fees.defaultPlanName')
  const months = useMemo(() => (year ? yearMonths(year.starts_on, year.ends_on, planName) : []), [year, planName])
  const chosen = classes.data?.find((c) => c.id === classId)
  const full = chosen?.capacity != null && (chosen.enrollments?.[0]?.count ?? 0) >= chosen.capacity
  const amount = Number(monthly)
  const reg = Number(regFee)

  const reset = () => {
    setGender('')
    setClassId('')
    setPaid(new Set())
    setRegFee('')
  }

  const create = useMutation({
    mutationFn: async () => {
      const s = must(
        await supabase
          .from('students')
          .insert({
            school_id: ctx.school.id,
            first_name: first.trim(),
            last_name: last.trim(),
            birth_date: birth || null,
            gender: (gender || null) as 'female' | 'male' | null,
          })
          .select('id')
          .single(),
      )
      if (classId && year)
        must(
          await supabase.from('enrollments').insert({
            school_id: ctx.school.id,
            student_id: s.id,
            class_id: classId,
            academic_year_id: year.id,
            started_on: todayIso() > year.starts_on && todayIso() <= year.ends_on ? todayIso() : year.starts_on,
          }),
        )
      if (canFeesWrite && year) {
        // Every month of the year becomes an installment; the months the family
        // already paid get their payment right away.
        const rows = [
          ...(amount > 0
            ? months.map((m) => ({ label: m.label, due_on: m.due, amount_due: amount, fee_plan_id: plan?.id ?? null, paid: paid.has(m.key) }))
            : []),
          ...(reg > 0 ? [{ label: t('enroll.regFeeLabel'), due_on: todayIso(), amount_due: reg, fee_plan_id: null, paid: regPaid }] : []),
        ]
        if (rows.length) {
          const inserted = must(
            await supabase
              .from('fee_installments')
              .insert(rows.map(({ paid: _p, ...r }) => ({ ...r, school_id: ctx.school.id, student_id: s.id, academic_year_id: year.id })))
              .select('id, label'),
          )
          const payments = inserted
            .filter((i) => rows.find((r) => r.label === i.label)?.paid)
            .map((i) => ({
              school_id: ctx.school.id,
              installment_id: i.id,
              amount: rows.find((r) => r.label === i.label)!.amount_due,
              method,
              paid_on: todayIso(),
              note: t('enroll.paidAtEnrollment'),
              recorded_by_member_id: ctx.member.id,
            }))
          if (payments.length) must(await supabase.from('payments').insert(payments))
        }
      }
      if (prefill?.preinscriptionId)
        must(await supabase.from('preinscriptions').update({ status: 'enrolled', student_id: s.id }).eq('id', prefill.preinscriptionId))
      return s.id
    },
    onSuccess: async (id) => {
      await queryClient.invalidateQueries({ queryKey: ['school', ctx.school.id] })
      reset()
      onCreated(id)
      onClose()
    },
  })

  const togglePaid = (key: string) =>
    setPaid((p) => {
      const n = new Set(p)
      if (n.has(key)) n.delete(key)
      else n.add(key)
      return n
    })
  const allPaid = months.length > 0 && months.every((m) => paid.has(m.key))

  return (
    <SurfaceDialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          create.mutate()
        }}
      >
        <SurfaceTitle>{t('students.add')}</SurfaceTitle>
        <SurfaceContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField label={t('students.firstName')} value={first} onChange={(e) => setFirst(e.target.value)} required fullWidth autoFocus />
              <TextField label={t('students.lastName')} value={last} onChange={(e) => setLast(e.target.value)} required fullWidth />
            </Stack>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                label={t('students.birthDate')}
                type="date"
                value={birth}
                onChange={(e) => setBirth(e.target.value)}
                slotProps={{ inputLabel: { shrink: true } }}
                fullWidth
              />
              <TextField select label={t('students.gender')} value={gender} onChange={(e) => setGender(e.target.value)} fullWidth>
                <MenuItem value="">—</MenuItem>
                <MenuItem value="female">{t('students.female')}</MenuItem>
                <MenuItem value="male">{t('students.male')}</MenuItem>
              </TextField>
            </Stack>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                select
                label={t('enroll.year')}
                value={yearId}
                onChange={(e) => {
                  setYearId(e.target.value)
                  setClassId('')
                }}
                required
                sx={{ minWidth: 220 }}
              >
                {ctx.years.map((y) => (
                  <MenuItem key={y.id} value={y.id}>
                    {y.name}
                    {y.is_current ? ` · ${t('year.current')}` : ''}
                  </MenuItem>
                ))}
              </TextField>
              <TextField select label={t('enroll.class')} value={classId} onChange={(e) => setClassId(e.target.value)} fullWidth>
                <MenuItem value="">{t('students.placeLater')}</MenuItem>
                {(classes.data ?? []).map((c) => (
                  <MenuItem key={c.id} value={c.id}>
                    {c.name} · {c.enrollments?.[0]?.count ?? 0}/{c.capacity ?? '∞'}
                  </MenuItem>
                ))}
              </TextField>
            </Stack>
            {full && <Alert severity="warning">{t('students.classFull')}</Alert>}

            {canFeesWrite && year && (
              <>
                <Divider />
                <Box>
                  <Typography variant="h5">{t('enroll.feesTitle')}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {plan ? t('enroll.feesFromPlan', { name: plan.name }) : t('enroll.feesHint')}
                  </Typography>
                </Box>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                  <TextField
                    label={t('enroll.monthly')}
                    type="number"
                    value={monthly}
                    onChange={(e) => setMonthly(e.target.value)}
                    slotProps={{ htmlInput: { min: 0, step: 1 } }}
                    fullWidth
                  />
                  <TextField
                    label={t('enroll.regFee')}
                    type="number"
                    value={regFee}
                    onChange={(e) => setRegFee(e.target.value)}
                    slotProps={{ htmlInput: { min: 0, step: 1 } }}
                    fullWidth
                  />
                </Stack>
                {amount > 0 && (
                  <Box>
                    <Stack direction="row" sx={{ alignItems: 'center', mb: 0.5 }}>
                      <Typography sx={{ fontWeight: 600, fontSize: 14, flex: 1 }}>{t('enroll.monthsPaid')}</Typography>
                      <Button size="small" onClick={() => setPaid(allPaid ? new Set() : new Set(months.map((m) => m.key)))}>
                        {allPaid ? t('enroll.none') : t('enroll.wholeYear')}
                      </Button>
                    </Stack>
                    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(5, 1fr)' }, gap: 0.5 }}>
                      {months.map((m) => (
                        <FormControlLabel
                          key={m.key}
                          sx={{ m: 0, px: 0.75, borderRadius: 1.5, bgcolor: paid.has(m.key) ? tokens.accentSoft : 'transparent' }}
                          control={<Checkbox size="small" checked={paid.has(m.key)} onChange={() => togglePaid(m.key)} />}
                          label={
                            <Typography sx={{ fontSize: 13, textTransform: 'capitalize' }}>
                              {new Intl.DateTimeFormat(locale === 'ar' ? 'ar-MA-u-nu-latn' : 'fr', { month: 'short' }).format(new Date(`${m.due}T12:00:00`))}
                            </Typography>
                          }
                        />
                      ))}
                    </Box>
                  </Box>
                )}
                {reg > 0 && (
                  <FormControlLabel control={<Checkbox checked={regPaid} onChange={(e) => setRegPaid(e.target.checked)} />} label={t('enroll.regFeePaid')} />
                )}
                {(paid.size > 0 || (reg > 0 && regPaid)) && (
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'center' } }}>
                    <TextField select label={t('fees.method')} value={method} onChange={(e) => setMethod(e.target.value as typeof method)} sx={{ minWidth: 200 }}>
                      {(['cash', 'bank_transfer', 'cheque', 'card', 'other'] as const).map((m) => (
                        <MenuItem key={m} value={m}>
                          {t(`fees.methods.${m}`)}
                        </MenuItem>
                      ))}
                    </TextField>
                    <Typography sx={{ fontSize: 14 }}>
                      {t('enroll.collected', { amount: formatMoney(paid.size * (amount || 0) + (reg > 0 && regPaid ? reg : 0), locale) })}
                    </Typography>
                  </Stack>
                )}
              </>
            )}
            {create.isError && <Alert severity="error">{errorMessage(create.error, t)}</Alert>}
          </Stack>
        </SurfaceContent>
        <SurfaceActions>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="contained" loading={create.isPending} disabled={!first.trim() || !last.trim() || !yearId}>
            {t('students.enroll')}
          </Button>
        </SurfaceActions>
      </form>
    </SurfaceDialog>
  )
}
