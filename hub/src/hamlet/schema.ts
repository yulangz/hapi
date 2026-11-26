export const hamletSchema = `
CREATE TABLE IF NOT EXISTS hamlet_agents (
    id TEXT PRIMARY KEY, namespace TEXT NOT NULL, parent_id TEXT REFERENCES hamlet_agents ON DELETE CASCADE,
    machine_id TEXT NOT NULL REFERENCES machines(id), request_id TEXT NOT NULL,
    name TEXT NOT NULL, description TEXT NOT NULL, launch_config TEXT NOT NULL, token TEXT NOT NULL UNIQUE,
    UNIQUE(parent_id, request_id)
);
CREATE INDEX IF NOT EXISTS hamlet_agents_by_machine ON hamlet_agents(machine_id);
CREATE UNIQUE INDEX IF NOT EXISTS hamlet_root ON hamlet_agents(namespace) WHERE parent_id IS NULL;
CREATE TABLE IF NOT EXISTS hamlet_groups (
    id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES hamlet_agents ON DELETE CASCADE, name TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS hamlet_groups_by_owner ON hamlet_groups(owner);
CREATE TABLE IF NOT EXISTS hamlet_members (
    group_id TEXT NOT NULL REFERENCES hamlet_groups ON DELETE CASCADE,
    agent TEXT NOT NULL REFERENCES hamlet_agents ON DELETE CASCADE, PRIMARY KEY(group_id,agent)
);
CREATE INDEX IF NOT EXISTS hamlet_members_by_agent ON hamlet_members(agent);
CREATE TABLE IF NOT EXISTS hamlet_events (
    seq INTEGER PRIMARY KEY, source TEXT NOT NULL, event_key TEXT NOT NULL, kind TEXT NOT NULL,
    text TEXT NOT NULL, images TEXT NOT NULL, group_id TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch('subsec')*1000),
    UNIQUE(source,event_key)
);
CREATE TABLE IF NOT EXISTS hamlet_inbox (
    agent TEXT NOT NULL REFERENCES hamlet_agents ON DELETE CASCADE,
    event INTEGER NOT NULL REFERENCES hamlet_events ON DELETE CASCADE, batch TEXT, PRIMARY KEY(agent,event)
);
CREATE INDEX IF NOT EXISTS hamlet_inbox_by_batch ON hamlet_inbox(agent,batch);
CREATE TABLE IF NOT EXISTS hamlet_timers (
    id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES hamlet_agents ON DELETE CASCADE,
    due INTEGER NOT NULL, period INTEGER, text TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS hamlet_due ON hamlet_timers(due);
CREATE TABLE IF NOT EXISTS hamlet_doorbells (
    id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES hamlet_agents ON DELETE CASCADE,
    name TEXT NOT NULL, script TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
    token TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'pending', last_error TEXT,
    max_rings INTEGER, rings INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS hamlet_doorbells_by_owner ON hamlet_doorbells(owner);
CREATE TABLE IF NOT EXISTS hamlet_attachments (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS hamlet_attachment_access (
    attachment TEXT NOT NULL REFERENCES hamlet_attachments ON DELETE CASCADE,
    agent TEXT NOT NULL REFERENCES hamlet_agents ON DELETE CASCADE, PRIMARY KEY(attachment,agent)
);
CREATE TABLE IF NOT EXISTS hamlet_steers (
    event INTEGER PRIMARY KEY REFERENCES hamlet_events ON DELETE CASCADE,
    agent TEXT NOT NULL REFERENCES hamlet_agents ON DELETE CASCADE, turn_id TEXT NOT NULL, request_id TEXT NOT NULL,
    UNIQUE(agent,turn_id,request_id)
);
CREATE TABLE IF NOT EXISTS hamlet_notification_requests (
    agent TEXT NOT NULL REFERENCES hamlet_agents ON DELETE CASCADE,
    request_id TEXT NOT NULL, id TEXT NOT NULL, text_hash TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('dispatching', 'dispatched', 'failed')),
    PRIMARY KEY(agent,request_id)
);
CREATE TABLE IF NOT EXISTS hamlet_cleanup (
    agent TEXT PRIMARY KEY, machine_id TEXT NOT NULL, requested_by TEXT NOT NULL
);`


/** Columns added after v27 shipped to testers; CREATE TABLE IF NOT EXISTS cannot add them. */
export const hamletColumnMigrations: { table: string; column: string; ddl: string }[] = [
    { table: 'hamlet_doorbells', column: 'max_rings', ddl: 'ALTER TABLE hamlet_doorbells ADD COLUMN max_rings INTEGER' },
    { table: 'hamlet_doorbells', column: 'rings', ddl: 'ALTER TABLE hamlet_doorbells ADD COLUMN rings INTEGER NOT NULL DEFAULT 0' },
]
