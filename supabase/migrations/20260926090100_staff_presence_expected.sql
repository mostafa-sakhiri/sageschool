-- Heures prévues au moment du relevé (premier et dernier cours du jour) : le
-- retard et le départ anticipé restent lisibles même si l'emploi du temps change.
ALTER TABLE staff_presence
  ADD COLUMN expected_start time,
  ADD COLUMN expected_end time;
