-- Suivi du secrétariat et de l'administration (additif) :
--   1. droit du secrétariat sur la scolarité, réglable par l'admin
--   2. coordonnées : l'école met à jour nom / téléphone de ses membres
--   3. réclamations saisies par le secrétariat pour le compte d'un parent
--   4. parent prévenu d'une absence ; alertes (3 jours d'absence d'affilée, manuelles)
--   5. arrivée / départ des professeurs, relevés par le secrétariat
--   6. agenda de l'administration (visites, inscriptions)
--   7. pré-inscriptions et relances
--   8. relances de paiement en retard

-- ---------------------------------------------------------------------
-- 0. Nouveaux types de messages (simulés) dans la boîte d'envoi
-- ---------------------------------------------------------------------
ALTER TABLE notification_outbox DROP CONSTRAINT notification_outbox_kind_check;
ALTER TABLE notification_outbox ADD CONSTRAINT notification_outbox_kind_check
  CHECK (kind IN ('announcement', 'case_reply', 'absence', 'absence_alert', 'payment_reminder', 'preinscription'));

-- ---------------------------------------------------------------------
-- 1. Scolarité : l'admin décide si le secrétariat y a accès
--    schools.settings.staff_fees_access (booléen, absent = non)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.can_manage_fees(p_school_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT private.has_role(p_school_id, 'admin')
      OR (private.has_role(p_school_id, 'staff')
          AND COALESCE((SELECT (s.settings ->> 'staff_fees_access')::boolean
                        FROM public.schools s WHERE s.id = p_school_id), false));
$$;

DROP POLICY fee_plans_select ON fee_plans;
DROP POLICY fee_plans_write ON fee_plans;
DROP POLICY fee_installments_select ON fee_installments;
DROP POLICY fee_installments_write ON fee_installments;
DROP POLICY payments_select ON payments;
DROP POLICY payments_insert ON payments;

CREATE POLICY fee_plans_select ON fee_plans FOR SELECT TO authenticated
  USING ((SELECT private.can_manage_fees(school_id)));
CREATE POLICY fee_plans_write ON fee_plans FOR ALL TO authenticated
  USING ((SELECT private.can_manage_fees(school_id)))
  WITH CHECK ((SELECT private.can_manage_fees(school_id)));
CREATE POLICY fee_installments_select ON fee_installments FOR SELECT TO authenticated
  USING ((SELECT private.can_manage_fees(school_id)) OR student_id IN (SELECT private.guardian_student_ids()));
CREATE POLICY fee_installments_write ON fee_installments FOR ALL TO authenticated
  USING ((SELECT private.can_manage_fees(school_id)))
  WITH CHECK ((SELECT private.can_manage_fees(school_id)));
CREATE POLICY payments_select ON payments FOR SELECT TO authenticated
  USING (
    (SELECT private.can_manage_fees(school_id))
    OR EXISTS (SELECT 1 FROM fee_installments i
               WHERE i.id = installment_id AND i.student_id IN (SELECT private.guardian_student_ids()))
  );
CREATE POLICY payments_insert ON payments FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.can_manage_fees(school_id))
              AND recorded_by_member_id IN (SELECT private.my_member_ids()));

-- ---------------------------------------------------------------------
-- 2. Coordonnées d'un membre (nom, téléphone), par l'école
--    admin : tout membre de l'école ; secrétariat : parents et élèves ;
--    chacun : soi-même.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_member_contact(p_member_id uuid, p_full_name text, p_phone text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  m public.school_members;
  v_phone text := NULLIF(btrim(p_phone), '');
BEGIN
  SELECT * INTO m FROM public.school_members WHERE id = p_member_id;
  IF m.id IS NULL THEN
    RAISE EXCEPTION 'membre introuvable' USING ERRCODE = 'P0002';
  END IF;
  IF NOT (
    m.user_id = private.current_user_id()
    OR private.has_role(m.school_id, 'admin')
    OR (private.has_role(m.school_id, 'staff') AND m.role IN ('parent', 'student'))
  ) THEN
    RAISE EXCEPTION 'droits insuffisants' USING ERRCODE = '42501';
  END IF;
  IF v_phone IS NOT NULL AND v_phone !~ '^\+?[0-9 .-]{6,20}$' THEN
    RAISE EXCEPTION 'numéro de téléphone invalide' USING ERRCODE = '22023';
  END IF;
  IF v_phone IS NULL AND NOT EXISTS (SELECT 1 FROM public.users WHERE id = m.user_id AND email IS NOT NULL) THEN
    RAISE EXCEPTION 'il faut au moins un e-mail ou un téléphone' USING ERRCODE = '23514';
  END IF;
  UPDATE public.users
     SET phone = regexp_replace(v_phone, '[ .-]', '', 'g'),
         full_name = COALESCE(NULLIF(btrim(p_full_name), ''), full_name)
   WHERE id = m.user_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.update_member_contact(uuid, text, text) TO authenticated;

-- ---------------------------------------------------------------------
-- 3. Réclamations : le secrétariat saisit celle d'un parent (téléphone,
--    guichet), adressée à l'administration
-- ---------------------------------------------------------------------
ALTER TABLE cases
  ADD COLUMN channel text NOT NULL DEFAULT 'app' CHECK (channel IN ('app', 'phone', 'in_person', 'other')),
  ADD COLUMN for_admin boolean NOT NULL DEFAULT false;

DROP POLICY cases_insert ON cases;
CREATE POLICY cases_insert ON cases FOR INSERT TO authenticated
  WITH CHECK (
    status = 'open' AND resolved_at IS NULL AND (
      -- la famille ouvre un échange, pour elle-même et ses enfants
      (direction = 'parent_to_school' AND channel = 'app'
       AND parent_member_id IN (SELECT private.my_member_ids('parent'))
       AND opened_by_member_id = parent_member_id
       AND (student_id IS NULL OR student_id IN (SELECT private.guardian_student_ids())))
      OR
      -- le secrétariat saisit la réclamation d'un parent reçue hors application
      (direction = 'parent_to_school' AND channel <> 'app'
       AND (SELECT private.is_office(school_id))
       AND opened_by_member_id IN (SELECT private.my_member_ids()))
      OR
      -- l'école écrit à une famille
      (direction = 'school_to_parent'
       AND (SELECT private.is_office(school_id))
       AND opened_by_member_id IN (SELECT private.my_member_ids()))
    )
  );

-- Le premier message d'une réclamation saisie par le secrétariat est la parole
-- du parent : l'échange reste ouvert et rien n'est envoyé au parent.
CREATE OR REPLACE FUNCTION private.case_messages_after_insert() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  c public.cases%ROWTYPE;
  v_author_role text;
  v_parent_user uuid;
BEGIN
  SELECT * INTO c FROM public.cases WHERE id = NEW.case_id FOR UPDATE;
  IF c.status = 'resolved' THEN
    RAISE EXCEPTION 'cet échange est clos' USING ERRCODE = '23514';
  END IF;
  SELECT role INTO v_author_role FROM public.school_members WHERE id = NEW.author_member_id;

  IF c.direction = 'parent_to_school' AND c.channel <> 'app'
     AND NOT EXISTS (SELECT 1 FROM public.case_messages x WHERE x.case_id = c.id AND x.id <> NEW.id) THEN
    UPDATE public.cases SET status = 'open' WHERE id = c.id;
  ELSIF v_author_role IN ('admin', 'staff') THEN
    UPDATE public.cases SET status = 'answered' WHERE id = c.id;
    SELECT user_id INTO v_parent_user FROM public.school_members WHERE id = c.parent_member_id;
    INSERT INTO public.notification_outbox (school_id, recipient_user_id, kind, ref_id, body)
    VALUES (c.school_id, v_parent_user, 'case_reply', c.id,
            'Réponse de l''école — ' || c.subject || ' : ' || left(NEW.body, 280));
  ELSE
    UPDATE public.cases SET status = 'open' WHERE id = c.id;
  END IF;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------
-- 4a. Absence : le parent a-t-il été prévenu ?
-- ---------------------------------------------------------------------
ALTER TABLE attendance_records
  ADD COLUMN parent_notified_at timestamptz,
  ADD COLUMN parent_notified_by_member_id uuid REFERENCES school_members(id);

-- 4b. Alertes élève : automatiques (3 jours d'absence d'affilée) ou manuelles.
--     Statut : à prévenir -> parent prévenu -> close.
CREATE TABLE student_alerts (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id             uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id            uuid NOT NULL,
  kind                  text NOT NULL CHECK (kind IN ('absence_streak', 'manual')),
  title                 text,
  note                  text,
  starts_on             date NOT NULL DEFAULT current_date,
  ends_on               date,
  days                  int,
  status                text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'notified', 'closed')),
  notified_at           timestamptz,
  notified_by_member_id uuid REFERENCES school_members(id),
  created_by_member_id  uuid REFERENCES school_members(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (student_id, school_id) REFERENCES students (id, school_id) ON DELETE CASCADE,
  CHECK (kind <> 'manual' OR length(btrim(title)) > 0),
  CHECK ((status = 'notified') <= (notified_at IS NOT NULL))
);
-- une alerte automatique par série d'absences (clé : premier jour)
CREATE UNIQUE INDEX student_alerts_streak_uq ON student_alerts (student_id, starts_on) WHERE kind = 'absence_streak';
CREATE INDEX student_alerts_school_idx ON student_alerts (school_id, status, created_at DESC);
CREATE TRIGGER trg_student_alerts_updated_at BEFORE UPDATE ON student_alerts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Jours ouvrés consécutifs : lundi..vendredi, le week-end ne coupe pas une série.
CREATE OR REPLACE FUNCTION private.school_day_index(d date) RETURNS int
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT ((d - date '2000-01-03') / 7) * 5 + LEAST(extract(isodow FROM d)::int, 5) - 1;
$$;

-- Après chaque absence relevée : la série de jours d'absence qui contient ce
-- jour ; à partir de 3 jours, une alerte (créée ou prolongée).
CREATE OR REPLACE FUNCTION private.attendance_streak_alert() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_first date;
  v_last  date;
  v_days  int;
BEGIN
  IF NEW.status <> 'absent' THEN
    RETURN NEW;
  END IF;
  WITH days AS (
    SELECT DISTINCT r.session_date AS d
    FROM public.attendance_records r
    WHERE r.student_id = NEW.student_id AND r.status = 'absent'
      AND extract(isodow FROM r.session_date) <= 5
      AND r.session_date BETWEEN NEW.session_date - 40 AND NEW.session_date + 40
  ), islands AS (
    SELECT d, private.school_day_index(d) - row_number() OVER (ORDER BY d)::int AS grp FROM days
  )
  SELECT min(d), max(d), count(*) INTO v_first, v_last, v_days
  FROM islands
  WHERE grp = (SELECT grp FROM islands WHERE d = NEW.session_date);

  IF v_days >= 3 THEN
    -- une série qui s'allonge par le début remplace l'ancienne alerte
    DELETE FROM public.student_alerts a
     WHERE a.student_id = NEW.student_id AND a.kind = 'absence_streak'
       AND a.starts_on > v_first AND a.starts_on <= v_last AND a.status = 'open';
    INSERT INTO public.student_alerts (school_id, student_id, kind, starts_on, ends_on, days)
    VALUES (NEW.school_id, NEW.student_id, 'absence_streak', v_first, v_last, v_days)
    ON CONFLICT (student_id, starts_on) WHERE kind = 'absence_streak'
    DO UPDATE SET ends_on = EXCLUDED.ends_on, days = EXCLUDED.days,
                  -- de nouveaux jours après « prévenu » : il faut reprévenir
                  status = CASE WHEN public.student_alerts.days < EXCLUDED.days
                                 AND public.student_alerts.status = 'notified'
                                THEN 'open' ELSE public.student_alerts.status END;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_attendance_streak_alert
  AFTER INSERT OR UPDATE OF status ON attendance_records
  FOR EACH ROW EXECUTE FUNCTION private.attendance_streak_alert();

-- ---------------------------------------------------------------------
-- 5. Présence du personnel : arrivée / départ relevés par le secrétariat
-- ---------------------------------------------------------------------
CREATE TABLE staff_presence (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id             uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  member_id             uuid NOT NULL REFERENCES school_members(id) ON DELETE CASCADE,
  day                   date NOT NULL,
  arrived_at            time,
  left_at               time,
  absent                boolean NOT NULL DEFAULT false,
  note                  text,
  recorded_by_member_id uuid REFERENCES school_members(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (member_id, day),
  CHECK (left_at IS NULL OR arrived_at IS NULL OR left_at >= arrived_at)
);
CREATE INDEX staff_presence_school_day_idx ON staff_presence (school_id, day);
CREATE TRIGGER trg_staff_presence_updated_at BEFORE UPDATE ON staff_presence
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------
-- 6. Agenda de l'administration
-- ---------------------------------------------------------------------
CREATE TABLE appointments (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id             uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  kind                  text NOT NULL DEFAULT 'visit_parent'
                        CHECK (kind IN ('visit_parent', 'visit_student', 'enrollment', 'meeting', 'other')),
  title                 text NOT NULL CHECK (length(btrim(title)) > 0),
  starts_at             timestamptz NOT NULL,
  ends_at               timestamptz NOT NULL,
  visitor_name          text,
  visitor_phone         text,
  student_id            uuid,
  preinscription_id     uuid,
  host_member_id        uuid REFERENCES school_members(id) ON DELETE SET NULL,
  notes                 text,
  status                text NOT NULL DEFAULT 'planned'
                        CHECK (status IN ('planned', 'done', 'cancelled', 'no_show')),
  created_by_member_id  uuid REFERENCES school_members(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (student_id, school_id) REFERENCES students (id, school_id) ON DELETE SET NULL (student_id),
  CHECK (ends_at > starts_at)
);
CREATE INDEX appointments_school_start_idx ON appointments (school_id, starts_at);
CREATE TRIGGER trg_appointments_updated_at BEFORE UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------
-- 7. Pré-inscriptions et relances
-- ---------------------------------------------------------------------
CREATE TABLE preinscriptions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id             uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  academic_year_id      uuid,
  node_id               uuid,                               -- niveau souhaité
  child_first_name      text NOT NULL CHECK (length(btrim(child_first_name)) > 0),
  child_last_name       text NOT NULL CHECK (length(btrim(child_last_name)) > 0),
  birth_date            date,
  parent_name           text NOT NULL CHECK (length(btrim(parent_name)) > 0),
  parent_phone          text,
  parent_email          text,
  source                text,                               -- bouche-à-oreille, site, visite...
  notes                 text,
  status                text NOT NULL DEFAULT 'new'
                        CHECK (status IN ('new', 'contacted', 'visit_planned', 'waiting', 'enrolled', 'dropped')),
  last_followup_at      timestamptz,
  followup_count        int NOT NULL DEFAULT 0,
  next_followup_on      date,
  student_id            uuid,                               -- après inscription
  created_by_member_id  uuid REFERENCES school_members(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (academic_year_id, school_id) REFERENCES academic_years (id, school_id),
  FOREIGN KEY (node_id, school_id) REFERENCES curriculum_nodes (id, school_id),
  FOREIGN KEY (student_id, school_id) REFERENCES students (id, school_id) ON DELETE SET NULL (student_id),
  CHECK (parent_phone IS NOT NULL OR parent_email IS NOT NULL),
  UNIQUE (id, school_id)
);
CREATE INDEX preinscriptions_school_idx ON preinscriptions (school_id, status, created_at DESC);
CREATE TRIGGER trg_preinscriptions_updated_at BEFORE UPDATE ON preinscriptions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE appointments
  ADD FOREIGN KEY (preinscription_id, school_id) REFERENCES preinscriptions (id, school_id) ON DELETE SET NULL (preinscription_id);

CREATE TABLE preinscription_followups (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id           uuid NOT NULL,
  preinscription_id   uuid NOT NULL,
  channel             text NOT NULL DEFAULT 'phone' CHECK (channel IN ('phone', 'whatsapp', 'email', 'in_person', 'other')),
  note                text,
  by_member_id        uuid REFERENCES school_members(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (preinscription_id, school_id) REFERENCES preinscriptions (id, school_id) ON DELETE CASCADE
);
CREATE INDEX preinscription_followups_idx ON preinscription_followups (preinscription_id, created_at DESC);

-- Une relance : date de dernière relance, compteur ; une fiche « nouvelle » passe à « contactée ».
CREATE OR REPLACE FUNCTION private.preinscription_followup_after_insert() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.preinscriptions
     SET last_followup_at = NEW.created_at,
         followup_count = followup_count + 1,
         status = CASE WHEN status = 'new' THEN 'contacted' ELSE status END
   WHERE id = NEW.preinscription_id;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_preinscription_followup_after_insert
  AFTER INSERT ON preinscription_followups
  FOR EACH ROW EXECUTE FUNCTION private.preinscription_followup_after_insert();

CREATE OR REPLACE FUNCTION private.set_author_member() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  NEW.by_member_id := COALESCE(private.my_member_id_in(NEW.school_id, ARRAY['staff', 'admin']), NEW.by_member_id);
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_preinscription_followups_author BEFORE INSERT ON preinscription_followups
  FOR EACH ROW EXECUTE FUNCTION private.set_author_member();

-- ---------------------------------------------------------------------
-- 8. Relances de paiement : historique par échéance + message (simulé) aux
--    parents payeurs. Le statut affiché devient « en retard · relancé ».
-- ---------------------------------------------------------------------
CREATE TABLE payment_reminders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id       uuid NOT NULL,
  installment_id  uuid NOT NULL,
  channel         text NOT NULL DEFAULT 'whatsapp' CHECK (channel IN ('phone', 'whatsapp', 'sms', 'email', 'in_person', 'letter')),
  note            text,
  by_member_id    uuid REFERENCES school_members(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (installment_id, school_id) REFERENCES fee_installments (id, school_id) ON DELETE CASCADE
);
CREATE INDEX payment_reminders_installment_idx ON payment_reminders (installment_id, created_at DESC);
CREATE TRIGGER trg_payment_reminders_author BEFORE INSERT ON payment_reminders
  FOR EACH ROW EXECUTE FUNCTION private.set_author_member();

CREATE OR REPLACE FUNCTION private.payment_reminder_notify() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.channel IN ('whatsapp', 'sms', 'email') THEN
    INSERT INTO public.notification_outbox (school_id, channel, recipient_user_id, kind, ref_id, body)
    SELECT NEW.school_id, CASE NEW.channel WHEN 'email' THEN 'email' WHEN 'sms' THEN 'sms' ELSE 'whatsapp' END,
           m.user_id, 'payment_reminder', NEW.id,
           'Rappel de paiement — ' || s.first_name || ' ' || s.last_name || ' : ' || b.label
           || ', reste ' || to_char(b.amount_remaining, 'FM999G999D00') || ' (échéance du '
           || to_char(b.due_on, 'DD/MM/YYYY') || ')'
    FROM public.installment_balances b
    JOIN public.students s ON s.id = b.student_id
    JOIN public.student_guardians g ON g.student_id = b.student_id
    JOIN public.school_members m ON m.id = g.guardian_member_id AND m.status = 'active'
    WHERE b.id = NEW.installment_id
      AND (g.is_payer OR NOT EXISTS (SELECT 1 FROM public.student_guardians g2
                                     WHERE g2.student_id = b.student_id AND g2.is_payer));
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_payment_reminders_notify AFTER INSERT ON payment_reminders
  FOR EACH ROW EXECUTE FUNCTION private.payment_reminder_notify();

-- Dernière relance par échéance (lecture par la vue des soldes)
CREATE VIEW installment_reminders WITH (security_invoker = true) AS
SELECT installment_id, max(created_at) AS last_reminded_at, count(*)::int AS reminder_count
FROM payment_reminders
GROUP BY installment_id;

-- ---------------------------------------------------------------------
-- 9. Droits et RLS des nouvelles tables : administration et secrétariat
-- ---------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON student_alerts, staff_presence, appointments,
  preinscriptions, preinscription_followups, payment_reminders TO authenticated;
GRANT SELECT ON installment_reminders TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA private TO authenticated;

ALTER TABLE student_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_presence ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE preinscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE preinscription_followups ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_reminders ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['student_alerts', 'appointments', 'preinscriptions', 'preinscription_followups'] LOOP
    EXECUTE format($f$
      CREATE POLICY %1$s_office ON public.%1$I FOR ALL TO authenticated
        USING ((SELECT private.is_office(school_id)))
        WITH CHECK ((SELECT private.is_office(school_id)));
    $f$, t);
  END LOOP;
END $$;

-- Présence du personnel : le bureau relève ; chacun voit la sienne
CREATE POLICY staff_presence_select ON staff_presence FOR SELECT TO authenticated
  USING ((SELECT private.is_office(school_id)) OR member_id IN (SELECT private.my_member_ids()));
CREATE POLICY staff_presence_write ON staff_presence FOR ALL TO authenticated
  USING ((SELECT private.is_office(school_id)))
  WITH CHECK ((SELECT private.is_office(school_id)));

-- Relances de paiement : ceux qui ont accès à la scolarité
CREATE POLICY payment_reminders_select ON payment_reminders FOR SELECT TO authenticated
  USING ((SELECT private.can_manage_fees(school_id)));
CREATE POLICY payment_reminders_insert ON payment_reminders FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.can_manage_fees(school_id)));
CREATE POLICY payment_reminders_delete ON payment_reminders FOR DELETE TO authenticated
  USING ((SELECT private.has_role(school_id, 'admin')));
