-- Agenda : visite découverte d'une famille qui n'est pas (encore) inscrite
ALTER TABLE appointments DROP CONSTRAINT appointments_kind_check;
ALTER TABLE appointments ADD CONSTRAINT appointments_kind_check
  CHECK (kind IN ('visit_parent', 'visit_student', 'visit_prospect', 'enrollment', 'meeting', 'other'));
