-- Annonces : l'auteur est vérifié à la création ; ensuite tout le bureau
-- (administration, secrétariat) peut corriger ou supprimer une annonce, sans
-- en changer l'auteur.
DROP POLICY announcements_write ON announcements;
CREATE POLICY announcements_insert ON announcements FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.is_office(school_id))
              AND author_member_id IN (SELECT private.my_member_ids()));
CREATE POLICY announcements_update ON announcements FOR UPDATE TO authenticated
  USING ((SELECT private.is_office(school_id)))
  WITH CHECK ((SELECT private.is_office(school_id)));
CREATE POLICY announcements_delete ON announcements FOR DELETE TO authenticated
  USING ((SELECT private.is_office(school_id)));

CREATE OR REPLACE FUNCTION private.announcements_keep_author() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.author_member_id := OLD.author_member_id;
  NEW.school_id := OLD.school_id;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_announcements_keep_author BEFORE UPDATE ON announcements
  FOR EACH ROW EXECUTE FUNCTION private.announcements_keep_author();
