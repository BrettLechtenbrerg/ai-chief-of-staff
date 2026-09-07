import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { createHash } from 'node:crypto';

const TYPES = {
  gmail: ['gmail.send', 'gmail.delete', 'gmail.empty_trash', 'gmail.modify_labels'],
  calendar: ['calendar.create', 'calendar.delete', 'calendar.recurring'],
  docs: ['docs.create', 'drive.upload', 'drive.create_folder', 'drive.move_file',
    'docs.append_text', 'docs.replace_text', 'docs.delete_content', 'docs.move_content',
    'docs.insert_at_position', 'docs.apply_formatting'],
};
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const MAX_PREVIEW_BYTES = 1024 * 1024;


const DB_PATH =
  process.env.FLO_PROPOSALS_PATH || path.join(process.env.HOME || '', '.flo', 'proposals.db');

export class ProposalCache {
  db;

  constructor(dbPath = DB_PATH) {
    const directory = path.dirname(dbPath);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    fs.chmodSync(directory, 0o700);
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');
    this.db.pragma('synchronous = FULL');
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
      -- Additive v1 claim ledger: no rewrite of existing proposals, no automatic release.
      CREATE TABLE IF NOT EXISTS proposal_execution_claims_v1 (
        proposal_id TEXT PRIMARY KEY NOT NULL,
        payload_hash TEXT NOT NULL,
        claimed_at TEXT NOT NULL
      );
    `);
    fs.chmodSync(dbPath, 0o600);
    for (const suffix of ['-wal', '-shm']) {
      const sidecar = `${dbPath}${suffix}`;
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

  validateIds(ids) {
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 10 ||
        ids.some(id => typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(id)) ||
        new Set(ids).size !== ids.length) {
      throw new Error('proposal_ids must contain 1–10 unique valid IDs');
    }
  }

  previewSnapshot(ids, service) {
    this.validateIds(ids);
    const proposals = ids.map(id => {
      const row = this.db.prepare('SELECT * FROM proposals WHERE id = ?').get(id);
      if (!row || !TYPES[service]?.includes(row.type)) {
        throw new Error(`Proposal ${id} missing or invalid for ${service}`);
      }
      if (row.executed || this.db.prepare(
        'SELECT 1 FROM proposal_execution_claims_v1 WHERE proposal_id = ?').get(id)) {
        throw new Error(`Proposal ${id} executed or claimed; reconcile before resubmission`);
      }
      const payload = JSON.parse(row.payload);
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new Error(`Invalid payload for ${id}`);
      }
      const preview = { ...payload };
      if (row.type === 'gmail.send' && payload.attachments !== undefined) {
        if (!Array.isArray(payload.attachments)) throw new Error('Invalid attachments');
        preview.attachments = payload.attachments.map(attachment => {
          if (typeof attachment.content !== 'string' || typeof attachment.filename !== 'string') {
            throw new Error('Invalid stored attachment');
          }
          const binary = Buffer.from(attachment.content, 'base64');
          const { content, ...metadata } = attachment;
          return { ...metadata, filename: attachment.filename, size: binary.length, sha256: sha256(binary) };
        });
      }
      return {
        id: row.id,
        type: row.type,
        // Bind exact serialized stored bytes, including attachment data and destinations.
        payload_hash: sha256(JSON.stringify([row.type, row.payload])),
        preview,
        risk: row.risk,
        violations: JSON.parse(row.violations),
      };
    });
    const result = { version: 1, proposals };
    if (Buffer.byteLength(JSON.stringify(result), 'utf8') > MAX_PREVIEW_BYTES) {
      throw new Error('Full proposal preview exceeds 1 MiB; split or reduce proposals. Nothing was truncated.');
    }
    return result;
  }

  previewProposals(ids, service) {
    return this.db.transaction(() => this.previewSnapshot(ids, service))();
  }

  previewTool(args, service) {
    return { content: [{ type: 'text', text: JSON.stringify(this.previewProposals(args?.proposal_ids, service)) }] };
  }

  claimProposals(ids, expectedHashes, service) {
    this.validateIds(ids);
    if (!expectedHashes || typeof expectedHashes !== 'object' || Array.isArray(expectedHashes) ||
        Object.keys(expectedHashes).length !== ids.length || ids.some(id =>
          !Object.hasOwn(expectedHashes, id) || typeof expectedHashes[id] !== 'string' ||
          !/^[a-f0-9]{64}$/.test(expectedHashes[id]))) {
      throw new Error('expected_payload_hashes must map every proposal ID to its preview SHA256');
    }
    // IMMEDIATE serializes competing processes. Read, hash check, capture and claim
    // all happen in the same snapshot; a failed batch rolls back every claim.
    return this.db.transaction(() => {
      const snapshot = this.previewSnapshot(ids, service);
      const captured = [];
      for (const item of snapshot.proposals) {
        if (item.payload_hash !== expectedHashes[item.id]) {
          throw new Error(`Proposal ${item.id} changed; preview and approve again`);
        }
        captured.push(this.getProposal(item.id));
        this.db.prepare(`INSERT INTO proposal_execution_claims_v1
          (proposal_id, payload_hash, claimed_at) VALUES (?, ?, ?)`)
          .run(item.id, item.payload_hash, new Date().toISOString());
      }
      return captured;
    }).immediate();
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
