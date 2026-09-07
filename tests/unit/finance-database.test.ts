import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FinanceDatabase, restoreFinanceDatabase } from '../../src/finance/database';
import { FINANCE_APPLICATION_ID, FINANCE_SCHEMA_VERSION, MAX_MINOR_UNITS } from '../../src/finance/types';
import { createRotatingDatabaseBackup } from '../../src/storage/database-backup';

const roots: string[] = [];
const stores: FinanceDatabase[] = [];
function root() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acos-finance-test-')); roots.push(dir); return dir; }
async function open(dir = root()) { const store = await FinanceDatabase.open(dir); stores.push(store); return store; }
function seed(store: FinanceDatabase) {
  store.db.exec(`
    INSERT INTO entities (id,name,kind) VALUES ('a','Synthetic personal','personal'),('b','Synthetic secondary','personal');
    INSERT INTO accounts (id,entity_id,alias,currency,minor_digits,opening_balance_minor,opening_date)
      VALUES ('account-a','a','Checking','USD',2,0,'2026-01-01');
    INSERT INTO categories (id,entity_id,name,kind) VALUES ('cat-a','a','Uncategorized','uncategorized'),('cat-b','b','Uncategorized','uncategorized');
  `);
}
function transaction(store: FinanceDatabase, id = 'tx', amount = -12345, date = '2026-02-28') {
  store.db.prepare(`INSERT INTO transactions
    (id,entity_id,account_id,transaction_date,amount_minor,description,source_json,row_fingerprint)
    VALUES (?, 'a', 'account-a', ?, ?, 'Synthetic entry', '{}', ?)`)
    .run(id, date, amount, 'a'.repeat(64));
}
afterEach(async () => {
  for (const store of stores.splice(0)) await store.close();
  for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('private finance schema and recovery', () => {
  it('owns one connection, repeats migrations without changing rows and closes its timer', async () => {
    const timer = vi.spyOn(global, 'setInterval'); const clear = vi.spyOn(global, 'clearInterval');
    const dir = root(); const store = await open(dir); seed(store);
    expect(store.db.pragma('application_id', { simple: true })).toBe(FINANCE_APPLICATION_ID);
    expect(store.db.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(store.db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(store.db.pragma('busy_timeout', { simple: true })).toBe(5000);
    await expect(FinanceDatabase.open(dir)).rejects.toThrow(/already has an owner/);
    await store.close(); expect(clear).toHaveBeenCalledWith(timer.mock.results[0].value);
    const reopened = await open(dir);
    expect(reopened.db.prepare('SELECT count(*) FROM schema_migrations').pluck().get()).toBe(FINANCE_SCHEMA_VERSION);
    expect(reopened.db.prepare('SELECT count(*) FROM entities').pluck().get()).toBe(2);
  });

  it.each([1.5, NaN, Infinity, MAX_MINOR_UNITS + 1, -MAX_MINOR_UNITS - 1])('rejects non-integral/out-of-bound money %s', async amount => {
    const store = await open(); seed(store);
    expect(() => transaction(store, 'bad', amount)).toThrow();
    expect(store.db.prepare('SELECT count(*) FROM transactions').pluck().get()).toBe(0);
  });

  it.each(['2026-02-30','2026-13-01','01/02/2026','not-a-date'])('rejects invalid dates %s', async date => {
    const store = await open(); seed(store);
    expect(() => transaction(store, 'bad', 100, date)).toThrow();
  });

  it('enforces cross-entity ownership, balanced splits, immutable originals and append-only history', async () => {
    const store = await open(); seed(store); transaction(store);
    expect(() => store.db.prepare('INSERT INTO allocations VALUES (?, ?, ?, ?)').run('tx','a','cat-b',-12345)).toThrow(/FOREIGN KEY/);
    store.db.prepare('INSERT INTO allocations VALUES (?, ?, ?, ?)').run('tx','a','cat-a',-12344);
    expect(() => store.db.exec("UPDATE transactions SET allocation_state='balanced' WHERE id='tx'")).toThrow(/Allocations must equal/);
    store.db.exec("UPDATE allocations SET amount_minor=-12345 WHERE transaction_id='tx'");
    store.db.exec("UPDATE transactions SET allocation_state='balanced' WHERE id='tx'");
    expect(() => store.db.exec("DELETE FROM allocations WHERE transaction_id='tx'")).toThrow(/Reopen allocation draft/);
    expect(() => store.db.exec("UPDATE transactions SET amount_minor=0 WHERE id='tx'")).toThrow(/immutable/);
    expect(() => store.db.exec("DELETE FROM transactions WHERE id='tx'")).toThrow(/Void transactions/);
    expect(() => store.db.exec("UPDATE accounts SET currency='EUR' WHERE id='account-a'")).toThrow(/immutable/);
    store.db.exec("INSERT INTO edit_history(entity_id,record_type,record_id,action,before_json,after_json) VALUES('a','transaction','tx','create','null','{}')");
    expect(() => store.db.exec('DELETE FROM edit_history WHERE id=1')).toThrow(/append-only/);
    expect(() => store.db.exec("UPDATE edit_history SET action='other' WHERE id=1")).toThrow(/append-only/);
  });

  it('rolls back an entire failed write and retains equal legitimate purchases', async () => {
    const store = await open(); seed(store);
    expect(() => store.db.transaction(() => {
      transaction(store, 'failed');
      store.db.prepare('INSERT INTO allocations VALUES (?, ?, ?, ?)').run('failed','a','cat-a',12);
      store.db.exec("UPDATE transactions SET allocation_state='balanced' WHERE id='failed'");
    })()).toThrow(/Allocations must equal/);
    expect(store.db.prepare('SELECT count(*) FROM transactions').pluck().get()).toBe(0);
    transaction(store, 'one'); transaction(store, 'two');
    expect(store.db.prepare('SELECT count(*) FROM transactions').pluck().get()).toBe(2);
  });

  it('commits imports only after every expected row has balanced allocations', async () => {
    const store = await open(); seed(store);
    const insert = store.db.prepare(`INSERT INTO import_batches
      (id,entity_id,account_id,fingerprint,mapping_fingerprint,source_name,source_row_count,imported_row_count,state)
      VALUES (?,'a','account-a',?,?,'synthetic.csv',1,1,?)`);
    expect(() => insert.run('invalid','b'.repeat(64),'c'.repeat(64),'committed')).toThrow(/import draft/);
    insert.run('batch','b'.repeat(64),'c'.repeat(64),'draft');
    const commit = () => store.db.exec("UPDATE import_batches SET state='committed' WHERE id='batch'");
    expect(commit).toThrow(/counts and allocations/);
    const add = store.db.prepare(`INSERT INTO transactions
      (id,entity_id,account_id,import_batch_id,transaction_date,amount_minor,description,source_row,source_json,row_fingerprint)
      VALUES (?,'a','account-a','batch','2026-02-28',-100,'Synthetic',?,'{}',?)`);
    add.run('imported',1,'d'.repeat(64));
    expect(commit).toThrow(/counts and allocations/);
    store.db.prepare('INSERT INTO allocations VALUES (?,?,?,?)').run('imported','a','cat-a',-100);
    store.db.exec("UPDATE transactions SET allocation_state='balanced' WHERE id='imported'");
    commit();
    expect(store.db.prepare("SELECT state FROM import_batches WHERE id='batch'").pluck().get()).toBe('committed');
    expect(() => add.run('extra',2,'e'.repeat(64))).toThrow(/Cannot append/);
    expect(() => store.db.exec("UPDATE import_batches SET state='draft' WHERE id='batch'")).toThrow(/instead of reopening/);
    expect(() => store.db.exec("UPDATE import_batches SET imported_row_count=0 WHERE id='batch'")).toThrow(/lineage is immutable/);
    store.db.exec("UPDATE import_batches SET voided_at='2026-03-01T00:00:00Z' WHERE id='batch'");
    expect(store.db.prepare('SELECT count(*) FROM transactions').pluck().get()).toBe(1);
  });

  it('rolls back an incomplete import including its batch and history', async () => {
    const store = await open(); seed(store);
    expect(() => store.db.transaction(() => {
      store.db.prepare(`INSERT INTO import_batches
        (id,entity_id,account_id,fingerprint,mapping_fingerprint,source_name,source_row_count,imported_row_count)
        VALUES ('batch','a','account-a',?,?,'synthetic.csv',2,2)`)
        .run('b'.repeat(64),'c'.repeat(64));
      store.db.exec("INSERT INTO edit_history(entity_id,record_type,record_id,action,before_json,after_json) VALUES('a','import_batch','batch','create','null','{}')");
      store.db.exec("UPDATE import_batches SET state='committed' WHERE id='batch'");
    }).immediate()).toThrow(/counts and allocations/);
    expect(store.db.prepare('SELECT count(*) FROM import_batches').pluck().get()).toBe(0);
    expect(store.db.prepare('SELECT count(*) FROM edit_history').pluck().get()).toBe(0);
  });

  it('rejects a wrong store and unknown schema without migrating it', async () => {
    const dir = root(); fs.mkdirSync(path.join(dir,'finance'));
    const file = path.join(dir,'finance/finance.db'); const other = new Database(file);
    other.exec('CREATE TABLE messages (content TEXT)'); other.prepare('INSERT INTO messages VALUES (?)').run('keep'); other.close();
    const before = fs.readFileSync(file);
    await expect(FinanceDatabase.open(dir)).rejects.toThrow(/identity/);
    expect(fs.readFileSync(file)).toEqual(before);
    const validDir = root(); const store = await open(validDir); await store.close();
    const future = new Database(store.databasePath); future.pragma('user_version = 99'); future.close();
    await expect(FinanceDatabase.open(validDir)).rejects.toThrow(/Unsupported finance schema/);
  });

  it('rejects a symlinked finance directory before changing the target', async () => {
    const dir = root(); const target = root(); fs.symlinkSync(target,path.join(dir,'finance'));
    await expect(FinanceDatabase.open(dir)).rejects.toThrow(/symlink/);
    expect(fs.readdirSync(target)).toEqual([]);
  });

  it('preserves real WAL data in a private backup and performs a timed independent restore', async () => {
    const store = await open(); seed(store); transaction(store);
    store.db.prepare('INSERT INTO allocations VALUES (?, ?, ?, ?)').run('tx','a','cat-a',-12345);
    store.db.exec("UPDATE transactions SET allocation_state='balanced' WHERE id='tx'");
    const backup = await store.backup(true);
    store.db.prepare('UPDATE entities SET name=? WHERE id=?').run('Newer source state','a');
    const separate = root(); const destination = await open(separate); await destination.close();
    fs.mkdirSync(path.join(destination.directory,'backups'));
    fs.copyFileSync(backup,path.join(destination.directory,'backups',path.basename(backup)));
    const start = performance.now();
    const result = await restoreFinanceDatabase(separate,path.basename(backup));
    const restored = await open(separate);
    expect(restored.db.prepare("SELECT name FROM entities WHERE id='a'").pluck().get()).toBe('Synthetic personal');
    expect(restored.db.prepare("SELECT amount_minor FROM transactions WHERE id='tx'").pluck().get()).toBe(-12345);
    expect(restored.db.pragma('quick_check',{simple:true})).toBe('ok');
    expect(restored.db.pragma('foreign_key_check')).toEqual([]);
    expect(store.db.prepare("SELECT name FROM entities WHERE id='a'").pluck().get()).toBe('Newer source state');
    expect(result.emergencyBackup).toBeTruthy();
    console.info(`Synthetic finance backup/restore verified in ${Math.round(performance.now()-start)}ms`);
    for (const file of [store.databasePath, `${store.databasePath}-wal`, `${store.databasePath}-shm`, backup]) {
      expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    }
    expect(fs.statSync(store.directory).mode & 0o777).toBe(0o700);
    await expect(restoreFinanceDatabase(separate,path.basename(backup))).rejects.toThrow(/Close the finance database/);
  });

  it('refuses an application-memory backup in the finance namespace', async () => {
    const store = await open(); seed(store); await store.close();
    const appRoot = root(); const file = path.join(appRoot,'app.db'); const app = new Database(file);
    app.exec('CREATE TABLE messages (content TEXT)'); app.close();
    const backup = await createRotatingDatabaseBackup(file,appRoot,{minimumIntervalMs:0});
    fs.mkdirSync(path.join(store.directory,'backups'));
    fs.copyFileSync(backup,path.join(store.directory,'backups',path.basename(backup)));
    const before = fs.readFileSync(store.databasePath);
    await expect(restoreFinanceDatabase(path.dirname(store.directory),path.basename(backup))).rejects.toThrow(/identity/);
    expect(fs.readFileSync(store.databasePath)).toEqual(before);
  });
});
