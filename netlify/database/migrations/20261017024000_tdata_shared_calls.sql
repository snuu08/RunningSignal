-- Provider quota state is private server state, separate from app users and GPS.
CREATE TABLE tdata_call_account (
  id text PRIMARY KEY,
  blocked_until_ms bigint NOT NULL DEFAULT 0,
  lease_until_ms bigint NOT NULL DEFAULT 0,
  lease_token text,
  lease_request text
);
CREATE TABLE tdata_call_service (
  id text PRIMARY KEY,
  blocked_until_ms bigint NOT NULL DEFAULT 0,
  next_call_ms bigint NOT NULL DEFAULT 0
);
CREATE TABLE tdata_call_cache (
  id text PRIMARY KEY,
  expires_at_ms bigint NOT NULL,
  call_id text NOT NULL,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object')
);
CREATE INDEX tdata_call_cache_expiry ON tdata_call_cache (expires_at_ms);
REVOKE ALL ON tdata_call_account, tdata_call_service, tdata_call_cache FROM PUBLIC;
