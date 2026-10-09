-- Cloudflare D1 / SQLite schema reference v0.2. Não executado na Cloudflare.
-- IDs UUID/ULID gerados no Worker. DateTime TEXT ISO8601 UTC. JSON TEXT com json_valid.
PRAGMA foreign_keys = ON;
CREATE TABLE organizations (
  id TEXT PRIMARY KEY, name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE workspaces (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id), name TEXT NOT NULL,
  require_review INTEGER NOT NULL DEFAULT 0 CHECK(require_review IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(id,organization_id)
);
CREATE TABLE users (
  id TEXT PRIMARY KEY, access_subject TEXT NOT NULL UNIQUE, email TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE workspace_members (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id), user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL CHECK(role IN ('viewer','editor','publisher','admin')),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY(workspace_id,user_id)
);
CREATE TABLE ai_assets (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, workspace_id TEXT NOT NULL, project_id TEXT,
  type TEXT NOT NULL CHECK(type IN ('prompt','skill')),
  name TEXT NOT NULL CHECK(length(name) BETWEEN 3 AND 80 AND name NOT GLOB '*[^a-z0-9-]*'),
  title TEXT NOT NULL, description TEXT, owner_user_id TEXT REFERENCES users(id),
  sharing_scope TEXT NOT NULL DEFAULT 'private' CHECK(sharing_scope IN ('private','workspace')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived','deleted')),
  latest_version INTEGER NOT NULL DEFAULT 1 CHECK(latest_version>=1),
  tags_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(tags_json) AND json_type(tags_json)='array'),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  archived_at TEXT, deleted_at TEXT,
  FOREIGN KEY(workspace_id,organization_id) REFERENCES workspaces(id,organization_id),
  UNIQUE(workspace_id,type,name)
);
CREATE INDEX ai_assets_listing_idx ON ai_assets(workspace_id,status,updated_at DESC);
CREATE TABLE ai_asset_versions (
  id TEXT PRIMARY KEY, asset_id TEXT NOT NULL REFERENCES ai_assets(id),
  version INTEGER NOT NULL CHECK(version>=1),
  definition_json TEXT NOT NULL CHECK(json_valid(definition_json)),
  definition_hash TEXT NOT NULL CHECK(length(definition_hash)=64),
  notes TEXT, created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(asset_id,version), UNIQUE(asset_id,definition_hash)
);
CREATE INDEX ai_versions_idx ON ai_asset_versions(asset_id,version DESC);
CREATE TABLE ai_asset_aliases (
  id TEXT PRIMARY KEY, asset_id TEXT NOT NULL REFERENCES ai_assets(id),
  alias TEXT NOT NULL CHECK(alias IN ('staging','production')),
  version INTEGER NOT NULL, revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>=1),
  moved_by TEXT NOT NULL REFERENCES users(id),
  moved_at TEXT NOT NULL, reason TEXT,
  action TEXT NOT NULL CHECK(action IN ('stage','publish','rollback')),
  UNIQUE(asset_id,alias), FOREIGN KEY(asset_id,version) REFERENCES ai_asset_versions(asset_id,version)
);
CREATE TABLE version_write_guards (
  id TEXT PRIMARY KEY, asset_id TEXT NOT NULL REFERENCES ai_assets(id), workspace_id TEXT NOT NULL REFERENCES workspaces(id), expected_latest_version INTEGER NOT NULL CHECK(expected_latest_version>=1)
);
CREATE TRIGGER guard_versions_precondition BEFORE INSERT ON version_write_guards
BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM ai_assets WHERE id=NEW.asset_id AND workspace_id=NEW.workspace_id AND latest_version=NEW.expected_latest_version)
    THEN RAISE(ABORT,'version_conflict') END;
END;
CREATE TRIGGER versions_sequence_precondition BEFORE INSERT ON ai_asset_versions BEGIN
  SELECT CASE WHEN (SELECT latest_version FROM ai_assets WHERE id=NEW.asset_id)<>NEW.version
    THEN RAISE(ABORT,'version_sequence_conflict') END;
  SELECT CASE WHEN NEW.version>1 AND NOT EXISTS(
      SELECT 1 FROM version_write_guards WHERE asset_id=NEW.asset_id AND expected_latest_version=NEW.version-1
    ) THEN RAISE(ABORT,'version_guard_required') END;
END;
CREATE TABLE ai_asset_reviews (
  id TEXT PRIMARY KEY, asset_id TEXT NOT NULL, version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected','changes_requested')),
  requested_by TEXT NOT NULL REFERENCES users(id), reviewed_by TEXT REFERENCES users(id), comment TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), reviewed_at TEXT,
  FOREIGN KEY(asset_id,version) REFERENCES ai_asset_versions(asset_id,version)
);
CREATE UNIQUE INDEX ai_reviews_pending_idx ON ai_asset_reviews(asset_id,version) WHERE status='pending';
CREATE TABLE ai_asset_test_cases (
  id TEXT PRIMARY KEY, asset_id TEXT NOT NULL REFERENCES ai_assets(id),
  name TEXT NOT NULL, case_revision INTEGER NOT NULL DEFAULT 1,
  input_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(input_json)),
  expected_output_json TEXT CHECK(expected_output_json IS NULL OR json_valid(expected_output_json)),
  evaluator_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(evaluator_json)),
  required_for_production INTEGER NOT NULL DEFAULT 0 CHECK(required_for_production IN (0,1)),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(asset_id,name)
);
CREATE TABLE ai_asset_test_runs (
  id TEXT PRIMARY KEY, asset_id TEXT NOT NULL, version INTEGER NOT NULL,
  test_case_id TEXT REFERENCES ai_asset_test_cases(id), case_revision INTEGER,
  mode TEXT NOT NULL CHECK(mode IN ('preview','llm','contract','manual')),
  status TEXT NOT NULL CHECK(status IN ('queued','running','passed','failed','error','not_evaluated')),
  score TEXT, evaluator_output_json TEXT CHECK(evaluator_output_json IS NULL OR json_valid(evaluator_output_json)),
  model TEXT, latency_ms INTEGER, cost_usd TEXT,
  input_hash TEXT, output_hash TEXT, run_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY(asset_id,version) REFERENCES ai_asset_versions(asset_id,version)
);
CREATE INDEX ai_test_runs_lookup_idx ON ai_asset_test_runs(asset_id,version,test_case_id,created_at DESC);
CREATE TABLE ai_asset_audit_logs (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id), actor_id TEXT,
  actor_type TEXT NOT NULL CHECK(actor_type IN ('user','service_account','system')),
  event_type TEXT NOT NULL, asset_id TEXT REFERENCES ai_assets(id), asset_type TEXT, version INTEGER,
  before_json TEXT CHECK(before_json IS NULL OR json_valid(before_json)),
  after_json TEXT CHECK(after_json IS NULL OR json_valid(after_json)),
  reason TEXT, request_id TEXT, ip_address TEXT, user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX ai_audit_lookup_idx ON ai_asset_audit_logs(workspace_id,created_at DESC);
CREATE INDEX ai_audit_asset_idx ON ai_asset_audit_logs(asset_id,created_at DESC);
CREATE TABLE ai_asset_executions (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id), asset_id TEXT NOT NULL REFERENCES ai_assets(id),
  asset_type TEXT NOT NULL CHECK(asset_type IN ('prompt','skill')),
  requested_ref TEXT NOT NULL, requested_alias TEXT, resolved_version INTEGER NOT NULL,
  definition_hash TEXT NOT NULL, caller_app TEXT, environment TEXT,
  trace_id TEXT NOT NULL UNIQUE, model TEXT,
  status TEXT NOT NULL CHECK(status IN ('resolved','success','failure')),
  latency_ms INTEGER, cost_usd TEXT, input_hash TEXT, output_hash TEXT, error_code TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY(asset_id,resolved_version) REFERENCES ai_asset_versions(asset_id,version)
);
CREATE INDEX ai_executions_list_idx ON ai_asset_executions(workspace_id,created_at DESC);
CREATE TABLE service_tokens (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL, token_prefix TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE CHECK(length(token_hash)=64),
  scopes_json TEXT NOT NULL CHECK(json_valid(scopes_json) AND json_type(scopes_json)='array'),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_used_at TEXT, expires_at TEXT, revoked_at TEXT
);
CREATE TABLE webhook_endpoints (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  url TEXT NOT NULL, encrypted_secret TEXT NOT NULL,
  events_json TEXT NOT NULL DEFAULT '["asset.published","asset.rollback","asset.version_created"]' CHECK(json_valid(events_json)),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE event_outbox (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  event_type TEXT NOT NULL, payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','delivered','dead')),
  attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT NOT NULL,
  leased_until TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  delivered_at TEXT
);
CREATE INDEX event_outbox_ready_idx ON event_outbox(status,next_attempt_at);
CREATE TABLE webhook_deliveries (
  id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES event_outbox(id),
  endpoint_id TEXT NOT NULL REFERENCES webhook_endpoints(id),
  status TEXT NOT NULL CHECK(status IN ('pending','processing','delivered','dead')),
  attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT NOT NULL,
  leased_until TEXT, last_response_code INTEGER, last_attempt_at TEXT, delivered_at TEXT,
  UNIQUE(event_id,endpoint_id)
);
CREATE INDEX webhook_deliveries_ready_idx ON webhook_deliveries(status,next_attempt_at);
CREATE TABLE idempotency_keys (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id), actor_key TEXT NOT NULL,
  method TEXT NOT NULL, path TEXT NOT NULL, idem_key TEXT NOT NULL,
  request_hash TEXT NOT NULL CHECK(length(request_hash)=64), response_status INTEGER,
  response_json TEXT CHECK(response_json IS NULL OR json_valid(response_json)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at TEXT NOT NULL,
  PRIMARY KEY(workspace_id,actor_key,method,path,idem_key)
);
CREATE INDEX idempotency_expiration_idx ON idempotency_keys(expires_at);
CREATE TABLE skill_files (
  asset_id TEXT NOT NULL, version INTEGER NOT NULL,
  filename TEXT NOT NULL, r2_key TEXT NOT NULL, sha256 TEXT NOT NULL CHECK(length(sha256)=64),
  size_bytes INTEGER NOT NULL CHECK(size_bytes BETWEEN 0 AND 1048576),
  mime TEXT NOT NULL CHECK(mime IN ('text/plain','text/markdown','application/json')),
  PRIMARY KEY(asset_id,version,filename),
  FOREIGN KEY(asset_id,version) REFERENCES ai_asset_versions(asset_id,version)
);
-- Publication gates enforced on every INSERT/UPDATE alias write (defense in depth).
-- UI/API authorization remains mandatory; these triggers prevent bypass through SQL paths.
CREATE TRIGGER alias_policy_insert BEFORE INSERT ON ai_asset_aliases BEGIN
  SELECT CASE WHEN NEW.revision<>1 OR (NEW.alias='staging' AND NEW.action<>'stage') OR
    (NEW.alias='production' AND NEW.action NOT IN ('publish','rollback')) OR
    (NEW.action='rollback' AND NEW.alias<>'production')
      THEN RAISE(ABORT,'invalid_alias_action') END;
  SELECT CASE WHEN NEW.alias='production' AND (NEW.reason IS NULL OR length(trim(NEW.reason))=0)
      THEN RAISE(ABORT,'publication_reason_required') END;
  SELECT CASE WHEN NOT EXISTS(
      SELECT 1 FROM ai_assets a JOIN workspace_members m ON m.workspace_id=a.workspace_id
      WHERE a.id=NEW.asset_id AND a.status='active' AND m.user_id=NEW.moved_by AND m.active=1
        AND (m.role IN ('admin','publisher') OR
          (NEW.alias='staging' AND (m.role='editor' OR a.owner_user_id=NEW.moved_by)))
    ) THEN RAISE(ABORT,'permission_denied_or_asset_archived') END;
  SELECT CASE WHEN NEW.alias='production' AND EXISTS(
      SELECT 1 FROM ai_asset_test_cases c WHERE c.asset_id=NEW.asset_id AND c.required_for_production=1
        AND COALESCE((SELECT CASE WHEN r.status='passed' AND r.case_revision=c.case_revision THEN 'passed' ELSE 'failed' END
          FROM ai_asset_test_runs r WHERE r.test_case_id=c.id AND r.asset_id=NEW.asset_id AND r.version=NEW.version
          ORDER BY r.created_at DESC,r.id DESC LIMIT 1),'failed')<>'passed'
    ) THEN RAISE(ABORT,'test_required') END;
  SELECT CASE WHEN NEW.alias='production' AND EXISTS(
      SELECT 1 FROM ai_assets a JOIN workspaces w ON w.id=a.workspace_id WHERE a.id=NEW.asset_id AND w.require_review=1
        AND NOT EXISTS(SELECT 1 FROM ai_asset_reviews r JOIN ai_asset_versions v
          ON v.asset_id=r.asset_id AND v.version=r.version
          WHERE r.asset_id=a.id AND r.version=NEW.version AND r.status='approved'
            AND r.reviewed_by IS NOT NULL AND r.reviewed_by<>v.created_by)
    ) THEN RAISE(ABORT,'review_required') END;
END;
CREATE TRIGGER alias_policy_update BEFORE UPDATE ON ai_asset_aliases BEGIN
  SELECT CASE WHEN NEW.revision<>OLD.revision+1 OR NEW.asset_id<>OLD.asset_id OR NEW.alias<>OLD.alias OR
    (NEW.alias='staging' AND NEW.action<>'stage') OR
    (NEW.alias='production' AND NEW.action NOT IN ('publish','rollback'))
    THEN RAISE(ABORT,'invalid_alias_revision') END;
  SELECT CASE WHEN NEW.alias='production' AND (NEW.reason IS NULL OR length(trim(NEW.reason))=0)
    THEN RAISE(ABORT,'publication_reason_required') END;
  SELECT CASE WHEN NOT EXISTS(
      SELECT 1 FROM ai_assets a JOIN workspace_members m ON m.workspace_id=a.workspace_id
      WHERE a.id=NEW.asset_id AND a.status='active' AND m.user_id=NEW.moved_by AND m.active=1
        AND (m.role IN ('admin','publisher') OR
          (NEW.alias='staging' AND (m.role='editor' OR a.owner_user_id=NEW.moved_by)))
    ) THEN RAISE(ABORT,'permission_denied_or_asset_archived') END;
  SELECT CASE WHEN NEW.alias='production' AND EXISTS(
      SELECT 1 FROM ai_asset_test_cases c WHERE c.asset_id=NEW.asset_id AND c.required_for_production=1
        AND COALESCE((SELECT CASE WHEN r.status='passed' AND r.case_revision=c.case_revision THEN 'passed' ELSE 'failed' END
          FROM ai_asset_test_runs r WHERE r.test_case_id=c.id AND r.asset_id=NEW.asset_id AND r.version=NEW.version
          ORDER BY r.created_at DESC,r.id DESC LIMIT 1),'failed')<>'passed'
    ) THEN RAISE(ABORT,'test_required') END;
  SELECT CASE WHEN NEW.alias='production' AND EXISTS(
      SELECT 1 FROM ai_assets a JOIN workspaces w ON w.id=a.workspace_id WHERE a.id=NEW.asset_id AND w.require_review=1
        AND NOT EXISTS(SELECT 1 FROM ai_asset_reviews r JOIN ai_asset_versions v
          ON v.asset_id=r.asset_id AND v.version=r.version
          WHERE r.asset_id=a.id AND r.version=NEW.version AND r.status='approved'
            AND r.reviewed_by IS NOT NULL AND r.reviewed_by<>v.created_by)
    ) THEN RAISE(ABORT,'review_required') END;
END;
-- Metadata asset creation audit is in DB (app must audit other metadata changes in a batch).
CREATE TRIGGER asset_created_audit AFTER INSERT ON ai_assets BEGIN
  INSERT INTO ai_asset_audit_logs(id,organization_id,workspace_id,actor_id,actor_type,event_type,asset_id,asset_type,version,after_json)
    VALUES(lower(hex(randomblob(16))),NEW.organization_id,NEW.workspace_id,NEW.created_by,'user','asset.created',NEW.id,NEW.type,1,
      json_object('name',NEW.name,'sharing_scope',NEW.sharing_scope));
END;

-- Triggers protect immutable history (validating INSERT-only).
CREATE TRIGGER versions_append_only_u BEFORE UPDATE ON ai_asset_versions BEGIN SELECT RAISE(ABORT,'immutable_version'); END;
CREATE TRIGGER versions_append_only_d BEFORE DELETE ON ai_asset_versions BEGIN SELECT RAISE(ABORT,'immutable_version'); END;
CREATE TRIGGER audit_append_only_u BEFORE UPDATE ON ai_asset_audit_logs BEGIN SELECT RAISE(ABORT,'immutable_audit'); END;
CREATE TRIGGER audit_append_only_d BEFORE DELETE ON ai_asset_audit_logs BEGIN SELECT RAISE(ABORT,'immutable_audit'); END;
-- Atomically audit every new version and append outbox event.
CREATE TRIGGER versions_audit_event AFTER INSERT ON ai_asset_versions BEGIN
  INSERT INTO ai_asset_audit_logs(id,organization_id,workspace_id,actor_id,actor_type,event_type,asset_id,asset_type,version,after_json)
    SELECT lower(hex(randomblob(16))), a.organization_id,a.workspace_id,NEW.created_by,'user','asset.version_created',a.id,a.type,NEW.version,
       json_object('definition_hash',NEW.definition_hash) FROM ai_assets a WHERE a.id=NEW.asset_id;
  INSERT INTO event_outbox(id,workspace_id,event_type,payload_json,next_attempt_at)
    SELECT lower(hex(randomblob(16))),a.workspace_id,'asset.version_created',json_object('asset_id',a.id,'version',NEW.version,'hash',NEW.definition_hash),
      strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM ai_assets a WHERE a.id=NEW.asset_id;
END;
-- Atomically audit aliased writes. ON INSERT and ON UPDATE both needed.
CREATE TRIGGER alias_audit_insert AFTER INSERT ON ai_asset_aliases BEGIN
  INSERT INTO ai_asset_audit_logs(id,organization_id,workspace_id,actor_id,actor_type,event_type,asset_id,asset_type,version,after_json,reason)
    SELECT lower(hex(randomblob(16))),a.organization_id,a.workspace_id,NEW.moved_by,'user',
       CASE WHEN NEW.action='rollback' THEN 'asset.rollback' WHEN NEW.alias='production' THEN 'asset.published' ELSE 'asset.alias_moved' END,
       a.id,a.type,NEW.version,json_object('alias',NEW.alias,'version',NEW.version,'revision',NEW.revision),NEW.reason
       FROM ai_assets a WHERE a.id=NEW.asset_id;
  INSERT INTO event_outbox(id,workspace_id,event_type,payload_json,next_attempt_at)
    SELECT lower(hex(randomblob(16))),a.workspace_id,
       CASE WHEN NEW.action='rollback' THEN 'asset.rollback' WHEN NEW.alias='production' THEN 'asset.published' ELSE 'asset.alias_moved' END,
       json_object('asset_id',a.id,'alias',NEW.alias,'version',NEW.version,'revision',NEW.revision),
       strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM ai_assets a WHERE a.id=NEW.asset_id;
END;
CREATE TRIGGER alias_audit_update AFTER UPDATE ON ai_asset_aliases WHEN OLD.version<>NEW.version OR OLD.revision<>NEW.revision BEGIN
  INSERT INTO ai_asset_audit_logs(id,organization_id,workspace_id,actor_id,actor_type,event_type,asset_id,asset_type,version,before_json,after_json,reason)
    SELECT lower(hex(randomblob(16))),a.organization_id,a.workspace_id,NEW.moved_by,'user',
       CASE WHEN NEW.action='rollback' THEN 'asset.rollback' WHEN NEW.alias='production' THEN 'asset.published' ELSE 'asset.alias_moved' END,
       a.id,a.type,NEW.version,
       json_object('alias',OLD.alias,'version',OLD.version,'revision',OLD.revision),
       json_object('alias',NEW.alias,'version',NEW.version,'revision',NEW.revision),NEW.reason
       FROM ai_assets a WHERE a.id=NEW.asset_id;
  INSERT INTO event_outbox(id,workspace_id,event_type,payload_json,next_attempt_at)
    SELECT lower(hex(randomblob(16))),a.workspace_id,
       CASE WHEN NEW.action='rollback' THEN 'asset.rollback' WHEN NEW.alias='production' THEN 'asset.published' ELSE 'asset.alias_moved' END,
       json_object('asset_id',a.id,'alias',NEW.alias,'previous_version',OLD.version,'version',NEW.version,'revision',NEW.revision),
       strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM ai_assets a WHERE a.id=NEW.asset_id;
END;