import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FinanceDatabase } from '../../src/finance/database';
import { FinanceLedger } from '../../src/finance/ledger';
import { FinanceRuntime } from '../../src/finance/worker';
import { decodeCsv, prepareImport, reviewImport } from '../../src/finance/import';
import { parseMoney } from '../../src/finance/validation';
import type { ImportMapping } from '../../src/finance/types';

let dir:string; let store:FinanceDatabase; let ledger:FinanceLedger; let entity:string; let account:string; let general:string;
const mapping:ImportMapping = {delimiter:',',dateColumn:0,descriptionColumn:1,amountColumn:2,dateOrder:'ymd',decimal:'.',amountMode:'signed'};
const bytes = (value:string) => new TextEncoder().encode(value);
const preview = (value:string,input=mapping) => prepareImport(store.db,bytes(value),'synthetic.csv',ledger.account(entity,account),input);
beforeEach(async () => {
  dir=fs.mkdtempSync(path.join(os.tmpdir(),'acos-import-')); store=await FinanceDatabase.open(dir); ledger=new FinanceLedger(store);
  entity=ledger.createEntity('Personal'); account=ledger.createAccount(entity,'Checking','USD',2,0,'2026-01-01');
  general=store.db.prepare("SELECT id FROM categories WHERE entity_id=? AND kind='expense'").pluck().get(entity) as string;
});
afterEach(async () => { await store.close(); fs.rmSync(dir,{recursive:true,force:true}); });

describe('exact CSV and manual imports', () => {
  it('rejects mapped foreign currency rows instead of labeling them as account currency',()=>{
    const draft=preview('Date,Description,Amount,Currency\n2026-01-01,Local,-1.23,USD\n2026-01-02,Foreign,-9.99,EUR',{...mapping,currencyColumn:3});
    expect(draft.totalMinor).toBe('-123');expect(draft.rows[0].error).toBeUndefined();
    expect(draft.rows[1].error).toContain('currency differs');expect(()=>reviewImport(draft,[])).toThrow();
    expect(reviewImport(draft,[{row:2,action:'skip'}]).totalMinor).toBe('-123');
  });
  it('extends the same scoped preview without changing its rows or identity',async()=>{
    const runtime=new FinanceRuntime(store);const file=path.join(dir,'extend.csv');fs.writeFileSync(file,'Date,Description,Amount\n2026-01-01,Local,-1.23');
    try {
      await runtime.execute({action:'loadCsv',filePath:file,delimiter:','});
      const draft=await runtime.execute({action:'previewImport',entityId:entity,accountId:account,mapping}) as {id:string;expiresAt:number};
      const rows=await runtime.execute({action:'previewPage',entityId:entity,id:draft.id,offset:0});
      const renewed=await runtime.execute({action:'extendPreview',entityId:entity,id:draft.id}) as {expiresAt:number};
      expect(renewed.expiresAt).toBeGreaterThanOrEqual(draft.expiresAt);
      expect(await runtime.execute({action:'previewPage',entityId:entity,id:draft.id,offset:0})).toEqual(rows);
      await expect(runtime.execute({action:'extendPreview',entityId:'other',id:draft.id})).rejects.toThrow();
    } finally { await runtime.execute({action:'close'}); }
  });
  it.each([
    ['0.10',2,'.',10],['1,234.56',2,'.',123456],['(1.234,56)',2,',',-123456],['-0.01',2,'.',-1],['123',0,'.',123],['1.2345',4,'.',12345],
  ] as const)('parses %s without float arithmetic', (value,precision,decimal,expected) => {
    expect(parseMoney(value,precision,decimal)).toBe(expected);
  });
  it.each(['1.234','1,00.00','NaN','1e3','$1','--1','(-1)','90000000000.01','1.'])('rejects ambiguous/invalid amounts %s', value => {
    expect(() => parseMoney(value,2)).toThrow();
  });
  it('preserves quoted delimiters/newlines, BOM, row lineage and exact re-import idempotence', () => {
    const input=preview('\ufeffDate,Description,Amount\r\n2026-02-01,"Lunch, then\nlunch",-12.34\r\n2026-02-02,Refund,2.34\r\n');
    expect(input.rows[0].description).toBe('Lunch, then\nlunch'); expect(input.totalMinor).toBe('-1000');
    const saved=ledger.commitImport(input,[]); expect(saved.imported).toBe(2);
    expect(ledger.commitImport(input,[])).toMatchObject({id:saved.id,alreadyImported:true});
    expect(store.db.prepare('SELECT count(*) FROM transactions').pluck().get()).toBe(2);
    const original=store.db.prepare('SELECT source_row,source_json FROM transactions ORDER BY source_row').all();
    expect(original[0]).toMatchObject({source_row:1});
    expect(JSON.parse((original[0] as {source_json:string}).source_json).cells[1]).toBe('Lunch, then\nlunch');
  });
  it('requires explicit date conventions, handles refunds and debit/credit columns', () => {
    const input=preview('Date;Memo;Debit;Credit\n02/03/2026;Purchase;12,00;\n03/03/2026;Refund;;2,00',
      {...mapping,delimiter:';',dateOrder:'dmy',decimal:',',amountMode:'debit-credit',debitColumn:2,creditColumn:3});
    expect(input.rows.map(row => [row.date,row.amount])).toEqual([['2026-03-02',-1200],['2026-03-03',200]]);
    expect(input.totalMinor).toBe('-1000');
    const invalid=preview('D,M,A\n26-02-03,Purchase,12\n2026-02-30,Purchase,12');
    expect(invalid.rows.every(row => row.error)).toBe(true);
    expect(() => ledger.commitImport(invalid,[])).toThrow(/exclude every invalid/);
    const saved=ledger.commitImport(invalid,[{row:1,action:'skip'},{row:2,action:'skip'}]); expect(saved.imported).toBe(0);
  });
  it('keeps equal legitimate purchases and requires review of both within-file and overlapping candidates', () => {
    const first=preview('D,M,A\n2026-01-02,Coffee,-5\n2026-01-02,Coffee,-5');
    expect(() => ledger.commitImport(first,[])).toThrow(/candidate duplicate/);
    ledger.commitImport(first,[{row:2,action:'keep'}]);
    const overlap=preview('D,M,A\n2026-01-02,Coffee,-5\n2026-01-03,Other,-7');
    expect(overlap.rows[0].existingMatches).toBe(2);
    expect(() => ledger.commitImport(overlap,[])).toThrow(/candidate duplicate/);
    expect(ledger.commitImport(overlap,[{row:1,action:'skip'}]).imported).toBe(1);
    expect(store.db.prepare('SELECT count(*) FROM transactions').pluck().get()).toBe(3);
  });
  it('rejects stale duplicate observations and expired snapshots', () => {
    const input=preview('D,M,A\n2026-01-02,Coffee,-5');
    ledger.manualEntry(entity,account,randomUUID(),'2026-01-02',-500,'Coffee',[{categoryId:general,amountMinor:-500}]);
    expect(() => ledger.commitImport(input,[])).toThrow(/Matching transactions changed/);
    input.expiresAt=0; expect(() => ledger.commitImport(input,[])).toThrow(/expired/);
  });
  it('makes manual retries exact, enforces entity ownership and archives old allocations transactionally', () => {
    const id=randomUUID(); const allocations=[{categoryId:general,amountMinor:-100}];
    ledger.manualEntry(entity,account,id,'2026-01-01',-100,'Purchase',allocations);
    expect(ledger.manualEntry(entity,account,id,'2026-01-01',-100,'Purchase',allocations)).toBe(id);
    expect(() => ledger.manualEntry(entity,account,id,'2026-01-01',-100,'Purchase',[])).toThrow(/different allocations/);
    const other=ledger.createEntity('Other personal'); const foreign=ledger.createCategory(other,'Other','expense');
    expect(() => ledger.allocate(entity,id,0,[{categoryId:foreign,amountMinor:-100}])).toThrow(/this entity/);
    expect(() => ledger.allocate(other,id,0,allocations)).toThrow(/changed/);
    expect(() => ledger.allocate(entity,id,0,[{categoryId:general,amountMinor:-99}])).toThrow(/exactly/);
    ledger.allocate(entity,id,0,allocations);
    expect(() => ledger.allocate(entity,id,0,allocations)).toThrow(/changed/);
    expect(store.db.prepare("SELECT count(*) FROM edit_history WHERE action='allocate'").pluck().get()).toBe(1);
  });
  it('preserves originals on batch void/undo and rejects precision drift', () => {
    const saved=ledger.commitImport(preview('D,M,A\n2026-01-02,Coffee,-5'),[]);
    ledger.setVoided(entity,'import_batch',saved.id,true);
    expect(preview('D,M,A\n2026-01-02,Coffee,-5').rows[0].existingMatches).toBe(0);
    ledger.setVoided(entity,'import_batch',saved.id,false);
    expect(preview('D,M,A\n2026-01-02,Coffee,-5').rows[0].existingMatches).toBe(1);
    expect(() => store.db.prepare('UPDATE accounts SET minor_digits=0 WHERE id=?').run(account)).toThrow(/immutable/);
    expect(() => ledger.createAccount(entity,'Other','USD',0,0,'2026-01-01')).toThrow(/precision/);
  });
  it('rejects malformed, oversized, invalid UTF-8 and excessive-column files without leaking cell text', () => {
    for (const value of ['D,M,A\n1,"private unmatched', 'D,M\n1,2,3', Array(65).fill('cell').join(',')]) {
      expect(() => decodeCsv(bytes(value),',')).toThrow(/Malformed or oversized/);
    }
    expect(() => decodeCsv(new Uint8Array(8*1024*1024+1),',')).toThrow(/8 MiB/);
    expect(() => decodeCsv(new Uint8Array([0xff]),',')).toThrow(/UTF-8/);
    expect(() => decodeCsv(bytes('D,M\n1,\0'),',')).toThrow(/control/);
  });
  it('previews manual splits without writing and rejects imbalance', () => {
    const allocations=[{categoryId:general,amountMinor:-123}];
    expect(ledger.previewManualEntry(entity,account,'2026-01-01',-123,'Manual',allocations))
      .toMatchObject({entity:'Personal',account:'Checking',accountId:account,currency:'USD',minorDigits:2,amountMinor:-123});
    expect(store.db.prepare('SELECT count(*) FROM transactions').pluck().get()).toBe(0);
    expect(() => ledger.previewManualEntry(entity,account,'2026-01-01',-124,'Manual',allocations)).toThrow(/exactly/);
    ledger.manualEntry(entity,account,randomUUID(),'2026-01-01',-123,'Manual',allocations);
    expect(ledger.previewManualEntry(entity,account,'2026-01-01',-123,'Manual',allocations).existingMatches).toBe(1);
  });
  it('previews the exact reviewed total and rejects conflicting decisions', () => {
    const input=preview('D,M,A\n2026-01-02,Coffee,-5\n2026-01-02,Coffee,-5\n2026-01-03,Refund,2');
    const review=reviewImport(input,[{row:2,action:'skip'}]);
    expect(review.totalMinor).toBe('-300'); expect(review.selected).toHaveLength(2);
    expect(review.excluded).toHaveLength(1);
    expect(() => reviewImport(input,[{row:2,action:'keep'},{row:2,action:'skip'}])).toThrow(/Invalid row review/);
  });
  it('rolls back batches, originals, allocations and history together on a failed row', () => {
    store.db.exec(`CREATE TRIGGER synthetic_failure BEFORE INSERT ON transactions
      WHEN NEW.description='Synthetic failure' BEGIN SELECT RAISE(ABORT,'Injected write failure'); END;`);
    const input=preview('D,M,A\n2026-01-02,First,-5\n2026-01-03,Synthetic failure,-7');
    expect(() => ledger.commitImport(input,[])).toThrow(/Injected write failure/);
    for (const table of ['transactions','allocations','import_batches']) {
      expect(store.db.prepare(`SELECT count(*) FROM ${table}`).pluck().get()).toBe(0);
    }
    expect(store.db.prepare("SELECT count(*) FROM edit_history WHERE record_type='import_batch'").pluck().get()).toBe(0);
  });
  it('makes entity, account and category creation retries exact', () => {
    const id=randomUUID(); const created=ledger.createEntity('Retry','personal',id);
    expect(ledger.createEntity('Retry','personal',id)).toBe(created);
    expect(() => ledger.createEntity('Different','personal',id)).toThrow(/already used/);
    const accountId=randomUUID(); const categoryId=randomUUID();
    for (let i=0;i<2;i++) {
      expect(ledger.createAccount(created,'Retry account','USD',2,0,'2026-01-01',accountId)).toBe(accountId);
      expect(ledger.createCategory(created,'Retry category','expense',categoryId)).toBe(categoryId);
    }
    expect(() => ledger.createCategory(entity,'Retry category','expense',categoryId)).toThrow(/already used/);
  });
  it('blocks bulk writes when the prior backup fails and reports saved manual writes accurately', async () => {
    const runtime=new FinanceRuntime(store); const file=path.join(dir,'fixture.csv');
    fs.writeFileSync(file,'D,M,A\n2026-01-02,Coffee,-5');
    fs.writeFileSync(path.join(store.directory,'backups'),'Synthetic obstruction');
    try {
      await runtime.execute({action:'loadCsv',filePath:file,delimiter:','});
      const info=await runtime.execute({action:'previewImport',entityId:entity,accountId:account,mapping}) as {id:string};
      await expect(runtime.execute({action:'commitImport',entityId:entity,id:info.id,decisions:[]})).rejects.toThrow();
      expect(store.db.prepare('SELECT count(*) FROM transactions').pluck().get()).toBe(0);
      const id=randomUUID();
      const response=await runtime.execute({action:'manualEntry',entityId:entity,accountId:account,id,date:'2026-01-01',amount:-100,description:'Manual',allocations:[{categoryId:general,amountMinor:-100}]});
      expect(response).toMatchObject({result:id,backupWarning:expect.stringContaining('backup attempt failed')});
      expect(store.db.prepare('SELECT count(*) FROM transactions').pluck().get()).toBe(1);
    } finally { await runtime.execute({action:'close'}); }
  });
  it('binds runtime import consent to the held preview and clears canceled data', async () => {
    const runtime=new FinanceRuntime(store); const file=path.join(dir,'fixture.csv'); fs.writeFileSync(file,'D,M,A\n2026-01-02,Coffee,-5');
    try {
      await runtime.execute({action:'loadCsv',filePath:file,delimiter:','});
      const info=await runtime.execute({action:'previewImport',entityId:entity,accountId:account,mapping}) as {id:string};
      await expect(runtime.execute({action:'commitImport',entityId:'other',id:info.id,decisions:[]})).rejects.toThrow(/missing or expired/);
      await runtime.execute({action:'cancelImport'});
      await expect(runtime.execute({action:'commitImport',entityId:entity,id:info.id,decisions:[]})).rejects.toThrow(/missing or expired/);
      expect(store.db.prepare('SELECT count(*) FROM transactions').pluck().get()).toBe(0);
    } finally { await runtime.execute({action:'close'}); }
  });
});
