import { useSchool } from '#/lib/session'
import { TimetableRenderers } from '#/features/timetable/assistant'
import { EnrollTool } from './enroll'
import { PreregTool } from './prereg'
import { AppointmentTool } from './appointment'
import { AnnouncementTool } from './announcement'
import { InviteTool } from './invite'
import { FindStudentsTool, OpenPageTool } from './lookup'
import { StudentAbsencesTool } from './absences'
import { TeacherPresenceTool } from './presence'
import { OpenCycleTool } from './cycle'

// The actions available from any page (use cases A1–A8). The timetable's
// own tools are registered by its editor, only on a draft; their cards are
// drawn from here so they stay readable after leaving the page.
export function GlobalTools() {
  const ctx = useSchool()
  return (
    <>
      {ctx.can('students.create') && <EnrollTool />}
      {ctx.can('preregistrations.manage') && <PreregTool />}
      {ctx.can('agenda.manage') && <AppointmentTool />}
      {ctx.can('announcements.create') && <AnnouncementTool />}
      {ctx.isAdmin && <InviteTool />}
      {ctx.can('attendance.view_all') && <StudentAbsencesTool />}
      {ctx.can('staff_presence.record') && <TeacherPresenceTool />}
      {ctx.isAdmin && <OpenCycleTool />}
      <FindStudentsTool />
      <OpenPageTool />
      <TimetableRenderers />
    </>
  )
}
