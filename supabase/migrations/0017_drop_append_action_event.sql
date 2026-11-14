-- Cleanup after 0016: the deployed action function now commits via
-- commit_game_update (0016), so the single-event append_action_event RPC
-- (0015) has no callers left. The legacy `activity` trigger table and its
-- writes stay for another release — old client bundles may still poll its
-- realtime signal until every client has the new bundle.
drop function if exists append_action_event(
  uuid, int, int, text, text, jsonb, timestamptz, int, jsonb, boolean);
