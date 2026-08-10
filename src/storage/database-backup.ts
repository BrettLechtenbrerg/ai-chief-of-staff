import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { resolveExistingPathWithin } from '../utils/safe-path.js';

const PRIVATE_FILE_MODE = 0o600;
const PRIVATE_DIRECTORY_MODE = 0o700;
const DEFAULT_RETENTION = 7;
const DEFAULT_MINIMUM_INTERVAL_MS = 20 * 60 * 60 * 1000;
const BACKUP_PATTERN = /^ai-chief-of-staff-(\d{8}T\d{6}\d{3}Z)\.db$/;

export interface DatabaseBackupOptions {
  retention?: number;
  minimumIntervalMs?: number;
  now?: Date;
}

function formatTimestamp(date: Date): string {
  return date.toISOString().replace(/[-:.]/g, '');
}

function backupDirectory(userDataDirectory: string): string {
  return path.join(userDataDirectory, 'backups');
}

function chmodIfPresent(filePath: string, mode: number): void {
  try {
    if (fs.existsSync(filePath)) fs.chmodSync(filePath, mode);
  } catch (error) {
    throw new Error(`Could not harden private database path: ${filePath}`, { cause: error });
  }
}

export function hardenPrivateDatabaseFiles(databasePath: string): void {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  chmodIfPresent(path.dirname(databasePath), PRIVATE_DIRECTORY_MODE);
  for (const suffix of ['', '-wal', '-shm']) {
    chmodIfPresent(`${databasePath}${suffix}`, PRIVATE_FILE_MODE);
  }
}

function listBackupPaths(userDataDirectory: string): string[] {
  const directory = backupDirectory(userDataDirectory);
  if (!fs.existsSync(directory)) return [];
  return fs
    .readdirSync(directory)
    .filter((name) => BACKUP_PATTERN.test(name))
    .map((name) => path.join(directory, name))
    .sort()
    .reverse();
}

export function listDatabaseBackups(
  userDataDirectory: string
): Array<{ name: string; path: string; createdAt: Date; size: number }> {
  return listBackupPaths(userDataDirectory).map((backupPath) => {
    const stat = fs.statSync(backupPath);
    return {
      name: path.basename(backupPath),
      path: backupPath,
      createdAt: stat.mtime,
      size: stat.size,
    };
  });
}

function validateDatabase(databasePath: string): void {
  const database = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    const row = database.pragma('quick_check', { simple: true });
    if (row !== 'ok') throw new Error(`SQLite quick_check failed: ${String(row)}`);
  } finally {
    database.close();
  }
}

function removeSqliteSidecars(databasePath: string): void {
  for (const suffix of ['-wal', '-shm']) fs.rmSync(`${databasePath}${suffix}`, { force: true });
}

async function onlineBackup(sourcePath: string, destinationPath: string): Promise<void> {
  const source = new Database(sourcePath, { fileMustExist: true });
  try {
    await source.backup(destinationPath);
  } finally {
    source.close();
  }
  fs.chmodSync(destinationPath, PRIVATE_FILE_MODE);
  try {
    validateDatabase(destinationPath);
  } finally {
    // A backup of a WAL-mode source can briefly create empty sidecars while it
    // is validated. The connection is closed/checkpointed, so they are stale
    // and must not survive a DB rename or rotation.
    removeSqliteSidecars(destinationPath);
  }
}

export async function createRotatingDatabaseBackup(
  databasePath: string,
  userDataDirectory: string,
  options: DatabaseBackupOptions = {}
): Promise<string> {
  if (!fs.existsSync(databasePath)) throw new Error('Cannot back up a missing database.');
  hardenPrivateDatabaseFiles(databasePath);
  const directory = backupDirectory(userDataDirectory);
  fs.mkdirSync(directory, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  fs.chmodSync(directory, PRIVATE_DIRECTORY_MODE);

  const now = options.now ?? new Date();
  const minimumIntervalMs = options.minimumIntervalMs ?? DEFAULT_MINIMUM_INTERVAL_MS;
  const existing = listDatabaseBackups(userDataDirectory);
  if (existing[0] && now.getTime() - existing[0].createdAt.getTime() < minimumIntervalMs) {
    return existing[0].path;
  }

  const destination = path.join(directory, `ai-chief-of-staff-${formatTimestamp(now)}.db`);
  const temporary = `${destination}.tmp`;
  try {
    await onlineBackup(databasePath, temporary);
    fs.renameSync(temporary, destination);
    fs.chmodSync(destination, PRIVATE_FILE_MODE);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw new Error('Could not create the rotating SQLite backup.', { cause: error });
  }

  const retention = Math.max(1, Math.min(options.retention ?? DEFAULT_RETENTION, 30));
  for (const staleBackup of listBackupPaths(userDataDirectory).slice(retention)) {
    fs.rmSync(staleBackup, { force: true });
  }
  return destination;
}

export async function restoreDatabaseBackup(
  databasePath: string,
  userDataDirectory: string,
  backupName: string
): Promise<{ restoredFrom: string; emergencyBackup?: string }> {
  if (!BACKUP_PATTERN.test(backupName) || path.basename(backupName) !== backupName) {
    throw new Error('Invalid database backup name.');
  }
  const directory = backupDirectory(userDataDirectory);
  const sourcePath = await resolveExistingPathWithin(directory, path.join(directory, backupName));
  validateDatabase(sourcePath);

  fs.mkdirSync(path.dirname(databasePath), { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  let emergencyBackup: string | undefined;
  if (fs.existsSync(databasePath)) {
    emergencyBackup = path.join(directory, `pre-restore-${formatTimestamp(new Date())}.db`);
    await onlineBackup(databasePath, emergencyBackup);
  }

  const temporary = `${databasePath}.restore-tmp`;
  const replaced = `${databasePath}.restore-old`;
  fs.rmSync(temporary, { force: true });
  fs.rmSync(replaced, { force: true });
  await onlineBackup(sourcePath, temporary);

  try {
    removeSqliteSidecars(databasePath);
    if (fs.existsSync(databasePath)) fs.renameSync(databasePath, replaced);
    fs.renameSync(temporary, databasePath);
    fs.rmSync(replaced, { force: true });
    hardenPrivateDatabaseFiles(databasePath);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    if (!fs.existsSync(databasePath) && fs.existsSync(replaced)) {
      fs.renameSync(replaced, databasePath);
    }
    throw new Error('Could not atomically restore the SQLite backup.', { cause: error });
  }

  return { restoredFrom: sourcePath, emergencyBackup };
}
