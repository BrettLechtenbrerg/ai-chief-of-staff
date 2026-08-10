import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const DB_PATH =
  process.env.FLO_PROPOSALS_PATH || path.join(process.env.HOME || '', '.flo', 'proposals.db');

export class ProposalCache {
  db;

  constructor() {
    const directory = path.dirname(DB_PATH);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    fs.chmodSync(directory, 0o700);
    this.db = new Database(DB_PATH);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS proposals (
        id TEXT PRIMARY KEY,
        client_action_id TEXT UNIQUE NOT NULL,
        type TEXT NOT NULL,
        payload TEXT NOT NULL,
        risk TEXT NOT NULL,
        violations TEXT NOT NULL,
        created_at TEXT NOT NULL,
        executed INTEGER NOT NULL DEFAULT 0,
        executed_at TEXT,
        receipt TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_client_action_id ON proposals(client_action_id);
      CREATE INDEX IF NOT EXISTS idx_executed ON proposals(executed);
      CREATE INDEX IF NOT EXISTS idx_created_at ON proposals(created_at);
    `);
    fs.chmodSync(DB_PATH, 0o600);
    for (const suffix of ['-wal', '-shm']) {
      const sidecar = `${DB_PATH}${suffix}`;
      if (fs.existsSync(sidecar)) fs.chmodSync(sidecar, 0o600);
    }
  }

  saveProposal(proposal) {
    this.db
      .prepare(`
        INSERT INTO proposals (
          id, client_action_id, type, payload, risk, violations,
          created_at, executed, executed_at, receipt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        proposal.id,
        proposal.client_action_id,
        proposal.type,
        JSON.stringify(proposal.payload),
        proposal.risk,
        JSON.stringify(proposal.violations),
        proposal.created_at,
        proposal.executed ? 1 : 0,
        proposal.executed_at || null,
        proposal.receipt ? JSON.stringify(proposal.receipt) : null,
      );
  }

  getProposal(id) {
    const row = this.db.prepare('SELECT * FROM proposals WHERE id = ?').get(id);
    if (!row) return null;
    return {
      id: row.id,
      client_action_id: row.client_action_id,
      type: row.type,
      payload: JSON.parse(row.payload),
      risk: row.risk,
      violations: JSON.parse(row.violations),
      created_at: row.created_at,
      executed: row.executed === 1,
      executed_at: row.executed_at || undefined,
      receipt: row.receipt ? JSON.parse(row.receipt) : undefined,
    };
  }

  checkDuplicate(clientActionId) {
    return !!this.db
      .prepare('SELECT id FROM proposals WHERE client_action_id = ? AND executed = 1')
      .get(clientActionId);
  }

  markExecuted(id, receipt) {
    this.db
      .prepare('UPDATE proposals SET executed = 1, executed_at = ?, receipt = ? WHERE id = ?')
      .run(new Date().toISOString(), JSON.stringify(receipt), id);
  }

  getPending() {
    const rows = this.db
      .prepare('SELECT * FROM proposals WHERE executed = 0 ORDER BY created_at DESC LIMIT 50')
      .all();
    return rows.map((row) => ({
      id: row.id,
      client_action_id: row.client_action_id,
      type: row.type,
      payload: JSON.parse(row.payload),
      risk: row.risk,
      violations: JSON.parse(row.violations),
      created_at: row.created_at,
      executed: row.executed === 1,
      executed_at: row.executed_at || undefined,
      receipt: row.receipt ? JSON.parse(row.receipt) : undefined,
    }));
  }

  close() {
    this.db.close();
  }
}
