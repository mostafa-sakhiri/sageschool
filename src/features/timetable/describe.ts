import { pauseLabel } from '#/features/setup/ScheduleEditor'
import type { Busy, IssueCode, PSlot } from './plan'
import type { Pause } from '#/features/setup/schedule'

type T = (key: string, vars?: Record<string, string | number>) => string

// One sentence per placement problem, the same words in the editor's drag
// feedback and in the assistant's cards.
export function describeIssue(
  v: { code: IssueCode; hit?: PSlot; busy?: Busy; pauses?: Pause[]; what?: string; candidates?: string[] },
  h: { t: T; subjectName: (id: string | null) => string | undefined; teacherName: (id: string) => string | undefined },
) {
  const { t } = h
  switch (v.code) {
    case 'closed_day':
      return t('tt.dayClosed')
    case 'outside_hours':
      return t('tt.outsideDay')
    case 'invalid':
      return t('assistant.tt.invalid')
    case 'overlap':
      return t('tt.overlaps', { name: v.hit?.title || h.subjectName(v.hit?.subjectId ?? null) || '—' })
    case 'teacher_busy':
      return t('tt.teacherBusy', { name: h.teacherName(v.busy?.teacherId ?? '') ?? '', class: v.busy?.label ?? '' })
    case 'pause':
      return t('tt.overPause', { pauses: (v.pauses ?? []).map((p) => pauseLabel(p, t)).join(', ') })
    case 'not_found':
      return v.candidates?.length
        ? t('assistant.ambiguous', { what: v.what ?? '', candidates: v.candidates.join(', ') })
        : t('assistant.notFound', { what: v.what ?? '' })
  }
}
