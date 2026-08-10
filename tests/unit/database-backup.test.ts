import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createRotatingDatabaseBackup,
  hardenPrivateDatabaseFiles,
  listDatabaseBackups,
  restoreDatabaseBackup,
} from '../../src/storage/database-backup';

const temporaryDirectories: string[] = [];

function createFixture(): { root: string; databasePath: string; database: Database.Database } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'acos-db-backup-'));
  temporaryDirectories.push(root);
  const databasePath = path.join(root, 'ai-chief-of-staff.db');
  const database = new Database(databasePath);
  database.pragma('journal_mode = WAL');
  database.exec('CREATE TABLE messages (id INTEGER PRIMARY KEY, content TEXT NOT NULL)');
  return { root, databasePath, database };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('permission-safe rotating SQLite backups', () => {
  it('captures a consistent online snapshot while WAL contains active data', async () => {
    const { root, databasePath, database } = createFixture();
    database.prepare('INSERT INTO messages (content) VALUES (?)').run('inside WAL');

    const backupPath = await createRotatingDatabaseBackup(databasePath, root, {
      minimumIntervalMs: 0,
    });
    const backup = new Database(backupPath, { readonly: true });
    expect(backup.prepare('SELECT content FROM messages').pluck().all()).toEqual(['inside WAL']);
    expect(backup.pragma('quick_check', { simple: true })).toBe('ok');
    backup.close();
    database.close();

    if (process.platform !== 'win32') {
      expect(fs.statSync(backupPath).mode & 0o777).toBe(0o600);
      expect(fs.statSync(path.dirname(backupPath)).mode & 0o777).toBe(0o700);
    }
  });

  it('keeps only the configured number of timestamped backups', async () => {
    const { root, databasePath, database } = createFixture();
    database.prepare('INSERT INTO messages (content) VALUES (?)').run('rotate');
    const baseTime = Date.now() + 1_000;
    for (let index = 0; index < 9; index += 1) {
      await createRotatingDatabaseBackup(databasePath, root, {
        minimumIntervalMs: 0,
        retention: 7,
        now: new Date(baseTime + index * 1_000),
      });
    }
    database.close();
    expect(listDatabaseBackups(root)).toHaveLength(7);
  });

  it('restores a validated backup atomically and preserves a pre-restore snapshot', async () => {
    const { root, databasePath, database } = createFixture();
    database.prepare('INSERT INTO messages (content) VALUES (?)').run('restore me');
    const backupPath = await createRotatingDatabaseBackup(databasePath, root, {
      minimumIntervalMs: 0,
    });
    database.prepare('UPDATE messages SET content = ?').run('newer state');
    database.close();

    const result = await restoreDatabaseBackup(databasePath, root, path.basename(backupPath));
    const restored = new Database(databasePath, { readonly: true });
    expect(restored.prepare('SELECT content FROM messages').pluck().get()).toBe('restore me');
    restored.close();
    expect(result.emergencyBackup).toBeTruthy();
    expect(fs.existsSync(result.emergencyBackup!)).toBe(true);
  });

  it('rejects traversal and malformed backup names', async () => {
    const { root, databasePath, database } = createFixture();
    database.close();
    await expect(restoreDatabaseBackup(databasePath, root, '../outside.db')).rejects.toThrow(
      'Invalid database backup name'
    );
    await expect(restoreDatabaseBackup(databasePath, root, 'backup.db')).rejects.toThrow(
      'Invalid database backup name'
    );
  });

  it('hardens the database, WAL, and SHM files', () => {
    const { databasePath, database } = createFixture();
    database.prepare('INSERT INTO messages (content) VALUES (?)').run('permissions');
    hardenPrivateDatabaseFiles(databasePath);
    if (process.platform !== 'win32') {
      for (const suffix of ['', '-wal', '-shm']) {
        expect(fs.statSync(`${databasePath}${suffix}`).mode & 0o777).toBe(0o600);
      }
    }
    database.close();
  });
});
