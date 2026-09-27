import { useSchool } from '#/lib/session'
import { TimetableRenderers } from '#/features/timetable/assistant'
import { EnrollTool } from './enroll'
import { PreregTool } from './prereg'
import { AppointmentTool } from './appointment'
import { AnnouncementTool } from './announcement'
import { InviteTool } from './invite'
import { FindStudentsTool, OpenPageTool } from './lookup'

// The actions available from any page (use cases A1–A8). The timetable's
// own tools are registered by its editor, only on a draft; their cards are
// drawn from here so they stay readable after leaving the page.
export function GlobalTools() {
  const ctx = useSchool()
  return (
    <>
      <EnrollTool />
      <PreregTool />
      <AppointmentTool />
      <AnnouncementTool />
      {ctx.isAdmin && <InviteTool />}
      <FindStudentsTool />
      <OpenPageTool />
      <TimetableRenderers />
    </>
  )
}
