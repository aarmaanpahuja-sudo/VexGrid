/*
# Add proper verification toggle (like/unlike behavior)

This adds support for users to toggle their verification on an incident
(+1 on first click, -1 on second click) while keeping the count accurate
for everyone via realtime.

- New table `incident_verifications` tracks who verified what (supports both
  anonymous client_id and signed-in user_id).
- Replaces the old one-way `increment_verification` with a new
  `toggle_verification` RPC that handles add/remove atomically.
- Follows your existing dual-path RLS pattern (client_id OR user_id).
*/

-- ============================================
-- 1. New table to track individual verifications
-- ============================================
CREATE TABLE IF NOT EXISTS incident_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id uuid NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  client_id uuid,                                    -- for anonymous users
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,  -- for signed-in users
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Prevent the same person from verifying the same incident twice
CREATE UNIQUE INDEX IF NOT EXISTS incident_verifications_unique_client
  ON incident_verifications (incident_id, client_id)
  WHERE client_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS incident_verifications_unique_user
  ON incident_verifications (incident_id, user_id)
  WHERE user_id IS NOT NULL;

ALTER TABLE incident_verifications ENABLE ROW LEVEL SECURITY;

-- RLS policies (dual-path like your watch_zones and profiles)
DROP POLICY IF EXISTS "verifications_select" ON incident_verifications;
CREATE POLICY "verifications_select" ON incident_verifications
  FOR SELECT TO anon, authenticated
  USING (true);   -- public read is fine (like the count)

DROP POLICY IF EXISTS "verifications_insert" ON incident_verifications;
CREATE POLICY "verifications_insert" ON incident_verifications
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    (client_id = current_setting('app.client_id', true)::uuid) OR
    (user_id = auth.uid())
  );

DROP POLICY IF EXISTS "verifications_delete" ON incident_verifications;
CREATE POLICY "verifications_delete" ON incident_verifications
  FOR DELETE TO anon, authenticated
  USING (
    (client_id = current_setting('app.client_id', true)::uuid) OR
    (user_id = auth.uid())
  );

-- ============================================
-- 2. New toggle RPC (replaces increment_verification)
-- ============================================
CREATE OR REPLACE FUNCTION toggle_verification(
  p_id uuid,           -- incident id
  p_client uuid,       -- current user's client_id (from frontend)
  p_user uuid DEFAULT NULL   -- current user's auth user_id (if signed in)
)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  new_count integer;
  already_verified boolean;
BEGIN
  -- Check if this identity already verified this incident
  SELECT EXISTS (
    SELECT 1 FROM incident_verifications
    WHERE incident_id = p_id
      AND (
        (p_user IS NOT NULL AND user_id = p_user) OR
        (p_client IS NOT NULL AND client_id = p_client)
      )
  ) INTO already_verified;

  IF already_verified THEN
    -- Remove their verification and decrease count
    DELETE FROM incident_verifications
    WHERE incident_id = p_id
      AND (
        (p_user IS NOT NULL AND user_id = p_user) OR
        (p_client IS NOT NULL AND client_id = p_client)
      );

    UPDATE incidents
    SET verifications = GREATEST(verifications - 1, 0),
        updated_at = now()
    WHERE id = p_id;
  ELSE
    -- Add their verification and increase count
    INSERT INTO incident_verifications (incident_id, client_id, user_id)
    VALUES (p_id, p_client, p_user)
    ON CONFLICT DO NOTHING;

    UPDATE incidents
    SET verifications = verifications + 1,
        updated_at = now()
    WHERE id = p_id;
  END IF;

  SELECT verifications INTO new_count FROM incidents WHERE id = p_id;
  RETURN new_count;
END;
$$;

GRANT EXECUTE ON FUNCTION toggle_verification(uuid, uuid, uuid) TO anon, authenticated;

-- (Optional but recommended) Keep the old function name working for now
-- so existing code doesn't break immediately
CREATE OR REPLACE FUNCTION increment_verification(p_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  -- For backward compatibility during transition — just calls toggle once
  RETURN toggle_verification(p_id, gen_random_uuid(), NULL);
END;
$$;

GRANT EXECUTE ON FUNCTION increment_verification(uuid) TO anon, authenticated;
