import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import {
  assertDatabaseIdentity, createRotatingDatabaseBackup, hardenPrivateDatabaseFiles,
  restoreDatabaseBackup, type DatabaseIdentity,
} from '../storage/database-backup.js';
import { FINANCE_APPLICATION_ID, FINANCE_SCHEMA_VERSION } from './types.js';

const migrations = [
  { version: 1, url: new URL('../../src/finance/migrations/001-initial.sql', import.meta.url) },
  { version: 2, url: new URL('../../src/finance/migrations/002-currency-precision.sql', import.meta.url) },
  { version: 3, url: new URL('../../src/finance/migrations/003-reporting-invariants.sql', import.meta.url) },
]
  .map(migration => {
    const sql = fs.readFileSync(migration.url, 'utf8');
    return { version: migration.version, sql, checksum: createHash('sha256').update(sql).digest('hex') };
  });
const owners = new Set<string>();
const BACKUP_INTERVAL_MS = 20 * 60 * 60 * 1000;
const BACKUP_WARNING = 'The last finance backup attempt failed. Current data has not been rolled back; check backups before continuing.';

function checkSchema(database: Database.Database): void {
  const version = database.pragma('user_version', { simple: true });
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1 || version > FINANCE_SCHEMA_VERSION) {
    throw new Error('Unsupported finance schema version; preserve the database and use the matching app.');
  }
  const identity = database.prepare<[], { schema_name: string }>('SELECT schema_name FROM finance_meta WHERE id = 1').get();
  if (identity?.schema_name !== 'acos-finance') throw new Error('Finance schema identity mismatch.');
  const applied = database.prepare<[], { version: number; checksum: string }>('SELECT version, checksum FROM schema_migrations ORDER BY version').all();
  if (applied.length !== version || applied.some((row, i) =>
    row.version !== migrations[i]?.version || row.checksum !== migrations[i]?.checksum)) {
    throw new Error('Finance migration history mismatch; no automatic rewrite is permitted.');
  }
  const foreignKeys = database.pragma('foreign_key_check');
  if (!Array.isArray(foreignKeys) || foreignKeys.length) throw new Error('Finance database has unresolved foreign keys.');
}

export const FINANCE_IDENTITY: DatabaseIdentity = {
  applicationId: FINANCE_APPLICATION_ID,
  requiredTables: ['finance_meta', 'schema_migrations', 'entities', 'accounts', 'categories',
    'transactions', 'allocations', 'import_batches', 'budget_lines', 'merchant_rules',
    'receipt_references', 'reconciliations', 'scenarios', 'edit_history'],
  validateSchema: checkSchema,
};

function privateDirectory(directory: string): void {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (process.getuid && stat.uid !== process.getuid())) {
    throw new Error('Finance storage must be an owned local directory, not a symlink.');
  }
  fs.chmodSync(directory, 0o700);
}

function financePaths(userDataDirectory: string): { directory: string; databasePath: string } {
  const directory = path.join(fs.realpathSync(userDataDirectory), 'finance');
  privateDirectory(directory);
  const databasePath = path.join(directory, 'finance.db');
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      const stat = fs.lstatSync(`${databasePath}${suffix}`);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || (process.getuid && stat.uid !== process.getuid())) {
        throw new Error('Finance database files must be owned regular files without links.');
      }
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    }
  }
  return { directory: fs.realpathSync(directory), databasePath };
}

/** One owner in the finance worker; never instantiate per IPC request or renderer. */
export class FinanceDatabase {
  private pendingBackup: Promise<string> | null = null;
  private closePromise: Promise<void> | null = null;
  private backupPath: string | null = null;
  private backupTime = 0;
  private readonly timer: ReturnType<typeof setInterval>;
  backupWarning: string | null = null;

  private constructor(
    private readonly connection: Database.Database,
    readonly directory: string,
    readonly databasePath: string,
  ) {
    // Local-only RPO target: 21h while active (20h threshold + 20min polling).
    // Sleep/failures extend this. Retain 30 snapshots, not guaranteed days.
    // Same-Mac copies do not survive loss of the Mac.
    this.timer = setInterval(() => {
      try {
        if (!this.closePromise && this.connection.open && !this.connection.inTransaction && this.hasUserData()) {
          void this.backup().catch(() => { /* backupWarning is exposed to the UI. */ });
        }
      } catch {
        this.backupWarning = BACKUP_WARNING;
      }
    }, 20 * 60 * 1000);
    this.timer.unref();
  }

  static async open(userDataDirectory: string): Promise<FinanceDatabase> {
    const { directory, databasePath } = financePaths(userDataDirectory);
    if (owners.has(databasePath)) throw new Error('The finance database already has an owner.');
    owners.add(databasePath);
    let connection: Database.Database | undefined;
    try {
      if (!fs.existsSync(databasePath)) fs.closeSync(fs.openSync(databasePath, 'wx', 0o600));
      connection = new Database(databasePath, { fileMustExist: true, timeout: 5000 });
      const version = connection.pragma('user_version', { simple: true });
      const empty = !connection.prepare("SELECT 1 FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' LIMIT 1").get();
      if (!(empty && version === 0 && connection.pragma('application_id', { simple: true }) === 0)) {
        assertDatabaseIdentity(connection, FINANCE_IDENTITY);
      }
      connection.pragma('foreign_keys = ON');
      connection.pragma('journal_mode = WAL');
      connection.pragma('synchronous = FULL');
      connection.pragma('busy_timeout = 5000');
      hardenPrivateDatabaseFiles(databasePath);
      if (typeof version !== 'number' || version > FINANCE_SCHEMA_VERSION) throw new Error('Unsupported finance schema.');
      if (version > 0 && version < FINANCE_SCHEMA_VERSION) {
        privateDirectory(path.join(directory, 'backups'));
        await createRotatingDatabaseBackup(databasePath, directory, {
          identity: FINANCE_IDENTITY, sourceDatabase: connection, minimumIntervalMs: 0, retention: 30,
        });
      }
      const db = connection;
      db.transaction(() => {
        for (const migration of migrations.filter(item => item.version > version)) {
          db.exec(migration.sql);
          db.prepare('INSERT INTO schema_migrations (version, checksum) VALUES (?, ?)').run(migration.version, migration.checksum);
          db.pragma(`user_version = ${migration.version}`);
        }
        db.pragma(`application_id = ${FINANCE_APPLICATION_ID}`);
        assertDatabaseIdentity(db, FINANCE_IDENTITY);
      }).immediate();
      hardenPrivateDatabaseFiles(databasePath);
      const hasData = Boolean(db.prepare('SELECT 1 FROM entities LIMIT 1').get());
      const owner = new FinanceDatabase(db, directory, databasePath);
      if (hasData) await owner.backup().catch(() => { /* Surface status without misreporting open as lost data. */ });
      return owner;
    } catch (error) {
      connection?.close();
      owners.delete(databasePath);
      throw error;
    }
  }

  get db(): Database.Database {
    if (this.closePromise || !this.connection.open) throw new Error('Finance database is closed.');
    return this.connection;
  }

  private hasUserData(): boolean {
    return Boolean(this.connection.prepare('SELECT 1 FROM entities LIMIT 1').get());
  }

  /** Call after committed writes; force fresh snapshots around bulk changes. */
  backup(force = false): Promise<string> {
    if (this.closePromise) return Promise.reject(new Error('Finance database is closing.'));
    if (this.pendingBackup) return force
      ? this.pendingBackup.then(() => this.backup(true))
      : this.pendingBackup;
    if (!force && this.backupPath && fs.existsSync(this.backupPath) && Date.now() - this.backupTime < BACKUP_INTERVAL_MS) {
      return Promise.resolve(this.backupPath);
    }
    this.pendingBackup = (async () => {
      try {
        privateDirectory(path.join(this.directory, 'backups'));
        const backup = await createRotatingDatabaseBackup(this.databasePath, this.directory, {
          identity: FINANCE_IDENTITY, sourceDatabase: this.connection, retention: 30,
          minimumIntervalMs: force ? 0 : BACKUP_INTERVAL_MS,
        });
        this.backupPath = backup;
        this.backupTime = fs.statSync(backup).mtimeMs;
        this.backupWarning = null;
        return backup;
      } catch {
        this.backupWarning = BACKUP_WARNING;
        throw new Error(this.backupWarning);
      }
    })().finally(() => { this.pendingBackup = null; });
    return this.pendingBackup;
  }

  close(): Promise<void> {
    if (!this.closePromise) {
      clearInterval(this.timer);
      this.closePromise = (async () => {
        await this.pendingBackup?.catch(() => { /* Failure already surfaced in backupWarning. */ });
        this.connection.close();
        owners.delete(this.databasePath);
      })();
    }
    return this.closePromise;
  }
}

/** Maintenance-only: all finance operations must be stopped and the owner closed. */
export async function restoreFinanceDatabase(userDataDirectory: string, backupName: string) {
  const { directory, databasePath } = financePaths(userDataDirectory);
  if (owners.has(databasePath)) throw new Error('Close the finance database before restoring.');
  privateDirectory(path.join(directory, 'backups'));
  owners.add(databasePath);
  try {
    return await restoreDatabaseBackup(databasePath, directory, backupName, FINANCE_IDENTITY);
  } finally {
    owners.delete(databasePath);
  }
}
