-- Envoi manuel (liens WhatsApp) : le bureau coche chaque message de la boîte
-- d'envoi comme envoyé, avec la date et l'auteur. Seuls ces champs changent.
ALTER TABLE notification_outbox
  ADD COLUMN sent_at timestamptz,
  ADD COLUMN sent_by_member_id uuid REFERENCES school_members(id);

CREATE OR REPLACE FUNCTION private.notification_outbox_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF (NEW.school_id, NEW.channel, NEW.recipient_user_id, NEW.kind, NEW.ref_id, NEW.body, NEW.created_at)
     IS DISTINCT FROM (OLD.school_id, OLD.channel, OLD.recipient_user_id, OLD.kind, OLD.ref_id, OLD.body, OLD.created_at) THEN
    RAISE EXCEPTION 'seul le statut d''envoi d''un message peut changer' USING ERRCODE = '42501';
  END IF;
  NEW.sent_at := CASE WHEN NEW.status = 'sent' THEN COALESCE(NEW.sent_at, now()) ELSE NULL END;
  NEW.sent_by_member_id := CASE WHEN NEW.status = 'sent'
    THEN COALESCE(private.my_member_id_in(NEW.school_id, ARRAY['staff', 'admin']), NEW.sent_by_member_id) ELSE NULL END;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_notification_outbox_guard BEFORE UPDATE ON notification_outbox
  FOR EACH ROW EXECUTE FUNCTION private.notification_outbox_guard();

CREATE POLICY notification_outbox_update ON notification_outbox FOR UPDATE TO authenticated
  USING ((SELECT private.is_office(school_id)))
  WITH CHECK ((SELECT private.is_office(school_id)));
