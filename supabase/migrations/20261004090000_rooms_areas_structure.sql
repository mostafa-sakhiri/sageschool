-- Rooms grouped in buildings and floors, and a structure that can grow
-- after installation.

-- ---------------------------------------------------------- room areas
-- Optional: a school with one corridor just lists its rooms. Otherwise
-- buildings, floors (in a building, or on their own for a single building),
-- and rooms in either.
CREATE TABLE room_areas (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id  uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  parent_id  uuid,
  kind       text NOT NULL CHECK (kind IN ('building', 'floor')),
  name       text NOT NULL CHECK (btrim(name) <> ''),
  position   int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, school_id),
  FOREIGN KEY (parent_id, school_id) REFERENCES room_areas (id, school_id) ON DELETE CASCADE,
  -- only a floor sits in something (a building)
  CHECK (parent_id IS NULL OR kind = 'floor')
);
CREATE UNIQUE INDEX room_areas_name_uq ON room_areas (school_id, COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), name);
CREATE INDEX room_areas_school_idx ON room_areas (school_id, parent_id, position);

CREATE FUNCTION private.room_areas_parent_is_building() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.parent_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.room_areas WHERE id = NEW.parent_id AND kind = 'building') THEN
    RAISE EXCEPTION 'un étage se place dans un bâtiment' USING ERRCODE = '23514';
  END IF;
  NEW.name := btrim(NEW.name);
  RETURN NEW;
END;
$$;
CREATE TRIGGER room_areas_parent_is_building BEFORE INSERT OR UPDATE ON room_areas
  FOR EACH ROW EXECUTE FUNCTION private.room_areas_parent_is_building();

ALTER TABLE room_areas ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON room_areas TO authenticated;
CREATE POLICY room_areas_select ON room_areas FOR SELECT TO authenticated
  USING ((SELECT private.is_school_member(school_id)));
CREATE POLICY room_areas_write ON room_areas FOR ALL TO authenticated
  USING ((SELECT private.has_role(school_id, 'admin')))
  WITH CHECK ((SELECT private.has_role(school_id, 'admin')));

-- Deleting a building or floor keeps its rooms (they lose their place)
ALTER TABLE rooms ADD COLUMN area_id uuid;
ALTER TABLE rooms
  ADD CONSTRAINT rooms_area_fkey FOREIGN KEY (area_id, school_id) REFERENCES room_areas (id, school_id) ON DELETE SET NULL (area_id);
CREATE INDEX rooms_area_idx ON rooms (area_id) WHERE area_id IS NOT NULL;

-- ------------------------------------------------- structure, after install
-- Adds template nodes the school doesn't have yet. `p_codes`: cycles (with
-- all their levels) or levels (with their tracks and options); the ancestors
-- of a chosen node come along. Nodes already there are kept as they are.
CREATE FUNCTION public._add_template_nodes(p_school_id uuid, p_parent_id uuid, p_nodes jsonb, p_codes text[], p_whole boolean)
RETURNS integer LANGUAGE plpgsql SET search_path = 'public', 'pg_temp' AS $$
DECLARE
  n        jsonb;
  v_pos    bigint;
  v_id     uuid;
  v_count  int := 0;
  v_chosen boolean;
  v_needed boolean;
BEGIN
  FOR n, v_pos IN SELECT e, ord - 1 FROM jsonb_array_elements(p_nodes) WITH ORDINALITY AS x(e, ord) LOOP
    v_chosen := p_whole OR (n->>'code') = ANY (p_codes);
    -- an ancestor of a chosen node
    v_needed := v_chosen OR EXISTS (
      SELECT 1 FROM jsonb_path_query(n, '$.**.code') c WHERE c #>> '{}' = ANY (p_codes));
    CONTINUE WHEN NOT v_needed;
    SELECT id INTO v_id FROM curriculum_nodes WHERE school_id = p_school_id AND code = n->>'code';
    IF v_id IS NULL THEN
      INSERT INTO curriculum_nodes (school_id, parent_id, kind, code, name, name_ar, position)
      VALUES (p_school_id, p_parent_id, n->>'kind', n->>'code', n->>'name', n->>'name_ar', v_pos)
      RETURNING id INTO v_id;
      v_count := v_count + 1;
    END IF;
    IF n ? 'children' THEN
      v_count := v_count + _add_template_nodes(p_school_id, v_id, n->'children', p_codes, v_chosen);
    END IF;
  END LOOP;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public._add_template_nodes(uuid, uuid, jsonb, text[], boolean) FROM public, anon;

CREATE FUNCTION public.add_curriculum_nodes(p_school_id uuid, p_template_code text, p_codes text[])
RETURNS integer LANGUAGE plpgsql SET search_path = 'public', 'pg_temp' AS $$
DECLARE
  v_tree jsonb;
BEGIN
  IF NOT private.has_role(p_school_id, 'admin') THEN
    RAISE EXCEPTION 'réservé à l''administration de l''école' USING ERRCODE = '42501';
  END IF;
  SELECT tree INTO v_tree FROM curriculum_templates WHERE code = p_template_code;
  IF v_tree IS NULL THEN
    RAISE EXCEPTION 'modèle % introuvable', p_template_code USING ERRCODE = '22023';
  END IF;
  RETURN _add_template_nodes(p_school_id, NULL, v_tree, p_codes, false);
END;
$$;
REVOKE ALL ON FUNCTION public.add_curriculum_nodes(uuid, text, text[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.add_curriculum_nodes(uuid, text, text[]) TO authenticated;

-- Closes a level (or a whole cycle) with everything under it, unless
-- something still uses it: classes, pre-registrations, fee plans.
CREATE FUNCTION public.remove_curriculum_node(p_node_id uuid) RETURNS integer
LANGUAGE plpgsql SET search_path = 'public', 'pg_temp' AS $$
DECLARE
  v_school uuid;
  v_ids    uuid[];
  v_n      int;
BEGIN
  SELECT school_id INTO v_school FROM curriculum_nodes WHERE id = p_node_id;
  IF v_school IS NULL THEN
    RAISE EXCEPTION 'niveau introuvable' USING ERRCODE = 'P0002';
  END IF;
  IF NOT private.has_role(v_school, 'admin') THEN
    RAISE EXCEPTION 'réservé à l''administration de l''école' USING ERRCODE = '42501';
  END IF;
  SELECT array_agg(id) INTO v_ids FROM curriculum_nodes WHERE school_id = v_school AND p_node_id = ANY (path);
  SELECT count(*) INTO v_n FROM classes WHERE node_id = ANY (v_ids);
  IF v_n > 0 THEN
    RAISE EXCEPTION 'ce niveau a encore % classe(s) : supprimez-les d''abord', v_n USING ERRCODE = '23503';
  END IF;
  IF EXISTS (SELECT 1 FROM preinscriptions WHERE node_id = ANY (v_ids))
     OR EXISTS (SELECT 1 FROM fee_plans WHERE node_id = ANY (v_ids)) THEN
    RAISE EXCEPTION 'des pré-inscriptions ou des tarifs utilisent encore ce niveau' USING ERRCODE = '23503';
  END IF;
  -- Leaves first, pass after pass: the parent key has no cascade
  LOOP
    DELETE FROM curriculum_nodes c
    WHERE c.id = ANY (v_ids)
      AND NOT EXISTS (SELECT 1 FROM curriculum_nodes k WHERE k.parent_id = c.id);
    EXIT WHEN NOT FOUND;
  END LOOP;
  RETURN cardinality(v_ids);
END;
$$;
REVOKE ALL ON FUNCTION public.remove_curriculum_node(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.remove_curriculum_node(uuid) TO authenticated;
