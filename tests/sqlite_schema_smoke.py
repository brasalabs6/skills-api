"""SQLite/D1 invariants smoke against the exact deployed migration.

Run: python3 tests/sqlite_schema_smoke.py
This checks SQL constraints and transactional relationships without network access.
"""
import pathlib, sqlite3, uuid

db=sqlite3.connect(":memory:")
db.row_factory=sqlite3.Row
db.executescript(pathlib.Path("migrations/0001_init.sql").read_text())
def uid(): return str(uuid.uuid4())
def execute(sql,params=()): return db.execute(sql,params)
def must_fail(sql,params=(),expected=None):
    try: execute(sql,params)
    except sqlite3.DatabaseError as exc:
        if expected: assert expected in str(exc),(expected,str(exc))
    else: raise AssertionError("Expected failure: "+sql)

org,ws,editor,publisher,asset=map(lambda _:uid(),range(5))
execute("INSERT INTO organizations(id,name) VALUES(?,?)",(org,"Team"))
execute("INSERT INTO workspaces(id,organization_id,name) VALUES(?,?,?)",(ws,org,"Internal"))
for user,role in [(editor,"editor"),(publisher,"publisher")]:
    execute("INSERT INTO users(id,access_subject,email) VALUES(?,?,?)",(user,user,user+"@example.test"))
    execute("INSERT INTO workspace_members(workspace_id,user_id,role) VALUES(?,?,?)",(ws,user,role))
execute("INSERT INTO ai_assets(id,workspace_id,type,name,title,owner_user_id,sharing_scope,created_by) VALUES(?,?,'prompt','first','First',?,'workspace',?)",(asset,ws,editor,editor))
execute("INSERT INTO ai_asset_versions(id,asset_id,version,definition_json,definition_hash,created_by) VALUES(?,?,1,?,?,?)",(uid(),asset,'{"content":"first"}',"hash-v1",editor))

must_fail("UPDATE ai_asset_versions SET definition_hash='changed' WHERE asset_id=?",(asset,),"immutable_version")
must_fail("DELETE FROM ai_asset_versions WHERE asset_id=?",(asset,),"immutable_version")
must_fail("DELETE FROM ai_asset_audit_logs WHERE asset_id=?",(asset,),"immutable_audit")
must_fail("UPDATE ai_asset_audit_logs SET actor_id=NULL WHERE asset_id=?",(asset,),"immutable_audit")
must_fail("INSERT INTO ai_asset_versions(id,asset_id,version,definition_json,definition_hash,created_by) VALUES(?,?,2,?,?,?)",(uid(),asset,'{"content":"second"}',"hash-v2",editor),"version_guard_required")

guard=uid()
execute("INSERT INTO version_write_guards(id,asset_id,expected_latest_version) VALUES(?,?,1)",(guard,asset))
execute("UPDATE ai_assets SET latest_version=2 WHERE id=? AND latest_version=1",(asset,))
execute("INSERT INTO ai_asset_versions(id,asset_id,version,definition_json,definition_hash,created_by) VALUES(?,?,2,?,?,?)",(uid(),asset,'{"content":"second"}',"hash-v2",editor))
execute("DELETE FROM version_write_guards WHERE id=?",(guard,))
assert execute("SELECT COUNT(*) FROM ai_asset_versions WHERE asset_id=?",(asset,)).fetchone()[0]==2
must_fail("INSERT INTO version_write_guards(id,asset_id,expected_latest_version) VALUES(?,?,1)",(uid(),asset),"version_conflict")

execute("INSERT INTO alias_write_guards(id,asset_id,alias,expected_revision) VALUES(?,?,'staging',0)",(uid(),asset))
execute("INSERT INTO ai_asset_aliases(id,asset_id,alias,version,revision,action,moved_by) VALUES(?,?,'staging',2,1,'stage',?)",(uid(),asset,editor))
must_fail("INSERT INTO ai_asset_aliases(id,asset_id,alias,version,revision,reason,action,moved_by) VALUES(?,?,'production',2,1,'because','publish',?)",(uid(),asset,editor),"permission_denied")
must_fail("INSERT INTO ai_asset_aliases(id,asset_id,alias,version,revision,reason,action,moved_by) VALUES(?,?,'production',2,1,NULL,'publish',?)",(uid(),asset,publisher),"reason_required")
execute("INSERT INTO alias_write_guards(id,asset_id,alias,expected_revision) VALUES(?,?,'production',0)",(uid(),asset))
execute("INSERT INTO ai_asset_aliases(id,asset_id,alias,version,revision,reason,action,moved_by) VALUES(?,?,'production',2,1,'approved','publish',?)",(uid(),asset,publisher))
must_fail("INSERT INTO alias_write_guards(id,asset_id,alias,expected_revision) VALUES(?,?,'production',0)",(uid(),asset),"alias_conflict")
execute("INSERT INTO alias_write_guards(id,asset_id,alias,expected_revision) VALUES(?,?,'production',1)",(uid(),asset))
execute("UPDATE ai_asset_aliases SET version=1,revision=2,reason='incident',action='rollback' WHERE asset_id=? AND alias='production'",(asset,))
assert execute("SELECT version FROM ai_asset_aliases WHERE asset_id=? AND alias='production'",(asset,)).fetchone()[0]==1
assert execute("SELECT COUNT(*) FROM ai_asset_audit_logs WHERE asset_id=?",(asset,)).fetchone()[0]>=4
assert execute("SELECT COUNT(*) FROM event_outbox WHERE event_type='asset.rollback'").fetchone()[0]==1

execute("UPDATE ai_assets SET status='archived' WHERE id=?",(asset,))
must_fail("UPDATE ai_asset_aliases SET version=2,revision=3,reason='restore',action='publish' WHERE asset_id=? AND alias='production'",(asset,),"permission_denied")
print("PASS: D1 schema, version immutability, CAS guards, RBAC, publish/rollback, audit and outbox")
