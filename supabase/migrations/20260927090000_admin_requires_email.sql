-- Un administrateur a toujours une adresse e-mail : c'est par elle qu'il
-- récupère un mot de passe oublié (un compte par téléphone n'a pas de boîte
-- aux lettres, voir src/lib/phoneLogin.ts). La règle vit ici pour valoir
-- quel que soit le chemin : invitation, import, changement de rôle.

-- Une adhésion d'administrateur active exige un e-mail.
CREATE OR REPLACE FUNCTION private.admin_requires_email() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.role = 'admin' AND NEW.status = 'active' AND NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = NEW.user_id AND nullif(btrim(u.email), '') IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'un administrateur doit avoir une adresse e-mail' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_school_members_admin_email
  BEFORE INSERT OR UPDATE OF role, status, user_id ON public.school_members
  FOR EACH ROW EXECUTE FUNCTION private.admin_requires_email();

-- L'e-mail d'un administrateur actif ne peut pas être retiré.
CREATE OR REPLACE FUNCTION private.admin_keeps_email() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF nullif(btrim(NEW.email), '') IS NULL AND EXISTS (
    SELECT 1 FROM public.school_members m
    WHERE m.user_id = NEW.id AND m.role = 'admin' AND m.status = 'active'
  ) THEN
    RAISE EXCEPTION 'un administrateur doit avoir une adresse e-mail' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_users_admin_email
  BEFORE UPDATE OF email ON public.users
  FOR EACH ROW EXECUTE FUNCTION private.admin_keeps_email();

REVOKE ALL ON FUNCTION private.admin_requires_email() FROM public, anon;
REVOKE ALL ON FUNCTION private.admin_keeps_email() FROM public, anon;
