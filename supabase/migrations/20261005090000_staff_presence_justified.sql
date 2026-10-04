-- A teacher's absence, late arrival or early departure can be justified
-- (medical appointment, warned in advance...). The note says why.
ALTER TABLE staff_presence ADD COLUMN justified boolean NOT NULL DEFAULT false;

-- Absences per student over a period: days absent (justified or not), days
-- with an unjustified absence, late arrivals. As the caller: RLS decides
-- which students' records count.
CREATE FUNCTION public.student_absence_summary(p_school_id uuid, p_from date, p_to date)
RETURNS TABLE (student_id uuid, days int, unjustified_days int, lates int)
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT r.student_id,
         count(DISTINCT r.session_date) FILTER (WHERE r.status IN ('absent', 'excused'))::int,
         count(DISTINCT r.session_date) FILTER (WHERE r.status = 'absent')::int,
         count(*) FILTER (WHERE r.status = 'late')::int
  FROM public.attendance_records r
  WHERE r.school_id = p_school_id AND r.session_date BETWEEN p_from AND p_to AND r.status <> 'present'
  GROUP BY r.student_id;
$$;

-- A teacher's incidents over a period: absences, late arrivals and early
-- departures beyond `p_grace` minutes of the expected hours recorded that day.
CREATE FUNCTION public.staff_incidents(p_school_id uuid, p_from date, p_to date, p_grace int DEFAULT 5)
RETURNS TABLE (id uuid, member_id uuid, day date, absent boolean, late_minutes int, early_minutes int, justified boolean, note text)
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT p.id, p.member_id, p.day, p.absent,
         CASE WHEN NOT p.absent AND p.arrived_at - p.expected_start > make_interval(mins => p_grace)
              THEN (extract(epoch FROM p.arrived_at - p.expected_start) / 60)::int ELSE 0 END,
         CASE WHEN NOT p.absent AND p.expected_end - p.left_at > make_interval(mins => p_grace)
              THEN (extract(epoch FROM p.expected_end - p.left_at) / 60)::int ELSE 0 END,
         p.justified, p.note
  FROM public.staff_presence p
  WHERE p.school_id = p_school_id AND p.day BETWEEN p_from AND p_to
    AND (p.absent
         OR p.arrived_at - p.expected_start > make_interval(mins => p_grace)
         OR p.expected_end - p.left_at > make_interval(mins => p_grace))
  ORDER BY p.day DESC;
$$;

REVOKE ALL ON FUNCTION public.student_absence_summary(uuid, date, date), public.staff_incidents(uuid, date, date, int) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.student_absence_summary(uuid, date, date), public.staff_incidents(uuid, date, date, int) TO authenticated;
