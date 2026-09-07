import { randomUUID } from 'node:crypto';
import type { FinanceDatabase } from './database.js';
import { duplicateLookup, reviewImport, transactionFingerprint } from './import.js';
import { currency, digits, isoDate, minorUnits, text } from './validation.js';
import type { AllocationInput, FinanceAccount, FinanceCategory, FinanceEntity, FinanceTransaction, ImportDecision, ImportPreview } from './types.js';

export class FinanceLedger {
  constructor(readonly store: FinanceDatabase) {}
  history(entityId: string, type: string, id: string, action: string, before: unknown, after: unknown): void {
    this.store.db.prepare(`INSERT INTO edit_history(entity_id,record_type,record_id,action,before_json,after_json) VALUES(?,?,?,?,?,?)`)
      .run(entityId,type,id,action,JSON.stringify(before),JSON.stringify(after));
  }
  entity(id: string): FinanceEntity {
    const row = this.store.db.prepare<[string],FinanceEntity>('SELECT * FROM entities WHERE id=? AND archived_at IS NULL').get(text(id,'entity'));
    if (!row) throw new Error('Active entity not found.'); return row;
  }
  account(entityId: string, id: string): FinanceAccount {
    this.entity(entityId);
    const row = this.store.db.prepare<[string,string],FinanceAccount>('SELECT * FROM accounts WHERE entity_id=? AND id=? AND archived_at IS NULL').get(entityId,text(id,'account'));
    if (!row) throw new Error('Active account not found in this entity.'); return row;
  }
  category(entityId: string, id: string): FinanceCategory {
    const row = this.store.db.prepare<[string,string],FinanceCategory>('SELECT * FROM categories WHERE entity_id=? AND id=? AND archived_at IS NULL').get(entityId,text(id,'category'));
    if (!row) throw new Error('Active category not found in this entity.'); return row;
  }
  createEntity(name: string, kind: FinanceEntity['kind'] = 'personal', id: string = randomUUID()): string {
    name = text(name,'entity name'); id = text(id,'request identifier');
    if (!['personal','business'].includes(kind)) throw new Error('Invalid entity type.');
    return this.store.db.transaction(() => {
      const existing = this.store.db.prepare<[string],FinanceEntity>('SELECT * FROM entities WHERE id=?').get(id);
      if (existing) {
        if (existing.name === name && existing.kind === kind && !existing.archived_at) return id;
        throw new Error('Request identifier already used for another entity.');
      }
      this.store.db.prepare('INSERT INTO entities(id,name,kind) VALUES(?,?,?)').run(id,name,kind);
      this.history(id,'entity',id,'create',null,{name,kind});
      for (const [label,categoryKind] of [['Uncategorized','uncategorized'],['Income','income'],['Transfers / card payments','transfer'],['General expenses','expense']] as const) {
        this.createCategory(id,label,categoryKind);
      }
      return id;
    }).immediate();
  }
  createCategory(entityId: string, name: string, kind: FinanceCategory['kind'], id: string = randomUUID()): string {
    this.entity(entityId); name = text(name,'category name'); id = text(id,'request identifier');
    if (!['expense','income','transfer','uncategorized'].includes(kind)) throw new Error('Invalid category type.');
    return this.store.db.transaction(() => {
      const existing = this.store.db.prepare<[string],FinanceCategory>('SELECT * FROM categories WHERE id=?').get(id);
      if (existing) {
        if (existing.entity_id === entityId && existing.name === name && existing.kind === kind && !existing.archived_at) return id;
        throw new Error('Request identifier already used for another category.');
      }
      this.store.db.prepare('INSERT INTO categories(id,entity_id,name,kind) VALUES(?,?,?,?)').run(id,entityId,name,kind);
      this.history(entityId,'category',id,'create',null,{name,kind}); return id;
    }).immediate();
  }
  createAccount(entityId: string, alias: string, code: string, precision: number, balance: number, date: string, id: string = randomUUID()): string {
    this.entity(entityId); alias = text(alias,'account alias'); currency(code); digits(precision); minorUnits(balance); isoDate(date); id = text(id,'request identifier');
    const other = this.store.db.prepare<[string,string],{minor_digits:number}>('SELECT minor_digits FROM accounts WHERE entity_id=? AND currency=? LIMIT 1').get(entityId,code);
    if (other && other.minor_digits !== precision) throw new Error('Currency precision must match existing accounts.');
    return this.store.db.transaction(() => {
      const existing = this.store.db.prepare<[string],FinanceAccount>('SELECT * FROM accounts WHERE id=?').get(id);
      if (existing) {
        if (existing.entity_id === entityId && existing.alias === alias && existing.currency === code && existing.minor_digits === precision &&
            existing.opening_balance_minor === balance && existing.opening_date === date && !existing.archived_at) return id;
        throw new Error('Request identifier already used for another account.');
      }
      this.store.db.prepare('INSERT INTO accounts(id,entity_id,alias,currency,minor_digits,opening_balance_minor,opening_date) VALUES(?,?,?,?,?,?,?)')
        .run(id,entityId,alias,code,precision,balance,date);
      this.history(entityId,'account',id,'create',null,{alias,currency:code,minorDigits:precision,balance,date}); return id;
    }).immediate();
  }
  private validateAllocations(entityId: string, amount: number, allocations: AllocationInput[]): void {
    if (!Array.isArray(allocations) || !allocations.length || allocations.length > 100) throw new Error('Use 1–100 allocations.');
    let sum = 0n; const categories = new Set<string>();
    for (const allocation of allocations) {
      if (!allocation) throw new Error('Invalid allocation.');
      this.category(entityId,allocation.categoryId); minorUnits(allocation.amountMinor);
      if (categories.has(allocation.categoryId)) throw new Error('Combine repeated categories into one allocation.');
      categories.add(allocation.categoryId); sum += BigInt(allocation.amountMinor);
    }
    if (sum !== BigInt(amount)) throw new Error('Allocations must equal the original amount exactly.');
  }
  previewManualEntry(entityId: string, accountId: string, date: string, amount: number, description: string, allocations: AllocationInput[]) {
    const account = this.account(entityId,accountId); isoDate(date); minorUnits(amount);
    description = text(description,'description',2000); this.validateAllocations(entityId,amount,allocations);
    return {entity:this.entity(entityId).name,account:account.alias,accountId:account.id,currency:account.currency,minorDigits:account.minor_digits,date,amountMinor:amount,description,
      existingMatches:duplicateLookup(this.store.db,accountId)(transactionFingerprint(date,amount,description)),
      allocations:allocations.map(allocation => ({...allocation,category:this.category(entityId,allocation.categoryId).name}))};
  }
  private writeAllocations(entityId: string, id: string, amount: number, allocations: AllocationInput[]): void {
    this.validateAllocations(entityId,amount,allocations);
    this.store.db.prepare("UPDATE transactions SET allocation_state='draft' WHERE id=? AND entity_id=?").run(id,entityId);
    this.store.db.prepare('DELETE FROM allocations WHERE transaction_id=? AND entity_id=?').run(id,entityId);
    const insert = this.store.db.prepare('INSERT INTO allocations(transaction_id,entity_id,category_id,amount_minor) VALUES(?,?,?,?)');
    for (const allocation of allocations) insert.run(id,entityId,allocation.categoryId,allocation.amountMinor);
    this.store.db.prepare("UPDATE transactions SET allocation_state='balanced' WHERE id=? AND entity_id=?").run(id,entityId);
  }
  manualEntry(entityId: string, accountId: string, id: string, date: string, amount: number, description: string, allocations: AllocationInput[]): string {
    this.account(entityId,accountId); text(id,'entry identifier'); isoDate(date); minorUnits(amount); description = text(description,'description',2000);
    const hash = transactionFingerprint(date,amount,description);
    return this.store.db.transaction(() => {
      const previous = this.store.db.prepare<[string],FinanceTransaction>('SELECT * FROM transactions WHERE id=?').get(id);
      if (previous) {
        if (previous.entity_id === entityId && previous.account_id === accountId && previous.transaction_date === date &&
            previous.amount_minor === amount && previous.description === description && previous.import_batch_id === null) {
          const original = this.store.db.prepare<[string,string],{after_json:string}>("SELECT after_json FROM edit_history WHERE entity_id=? AND record_id=? AND record_type='transaction' AND action='create' ORDER BY id LIMIT 1").get(entityId,id);
          if (previous.voided_at) throw new Error('Entry is voided; restore it rather than retrying.');
          if (original?.after_json !== JSON.stringify({date,amount,description,allocations})) throw new Error('Entry identifier already used for different allocations.');
          return id;
        }
        throw new Error('Entry identifier already used for different input.');
      }
      this.store.db.prepare(`INSERT INTO transactions(id,entity_id,account_id,transaction_date,amount_minor,description,source_json,row_fingerprint)
        VALUES(?,?,?,?,?,?,?,?)`).run(id,entityId,accountId,date,amount,description,JSON.stringify({source:'manual'}),hash);
      this.writeAllocations(entityId,id,amount,allocations);
      this.history(entityId,'transaction',id,'create',null,{date,amount,description,allocations}); return id;
    }).immediate();
  }
  previewAllocation(entityId:string, id:string, revision:number, allocations:AllocationInput[]) {
    this.entity(entityId);
    const row=this.store.db.prepare<[string,string],{account_id:string;transaction_date:string;amount_minor:number;description:string;revision:number;voided_at:string|null}>(
      'SELECT account_id,transaction_date,amount_minor,description,revision,voided_at FROM transactions WHERE entity_id=? AND id=?').get(entityId,id);
    if(!row || row.voided_at) throw new Error('Active transaction not found in this entity.');
    if(row.revision!==revision) throw new Error('Transaction changed; refresh before allocating.');
    return this.previewManualEntry(entityId,row.account_id,row.transaction_date,row.amount_minor,row.description,allocations);
  }
  allocate(entityId: string, id: string, revision: number, allocations: AllocationInput[]): void {
    this.entity(entityId);
    this.store.db.transaction(() => {
      const row = this.store.db.prepare<[string,string],FinanceTransaction>('SELECT * FROM transactions WHERE entity_id=? AND id=? AND voided_at IS NULL').get(entityId,text(id,'transaction'));
      if (!row || row.revision !== revision) throw new Error('Transaction changed; refresh before editing.');
      const before = this.store.db.prepare('SELECT category_id,amount_minor FROM allocations WHERE transaction_id=? AND entity_id=?').all(id,entityId);
      this.writeAllocations(entityId,id,row.amount_minor,allocations);
      this.store.db.prepare('UPDATE transactions SET revision=revision+1 WHERE id=? AND entity_id=?').run(id,entityId);
      this.history(entityId,'transaction',id,'allocate',before,allocations);
    }).immediate();
  }
  commitImport(preview: ImportPreview, decisions: ImportDecision[]): {id:string; imported:number; alreadyImported:boolean; voided:boolean} {
    if (preview.expiresAt <= Date.now()) throw new Error('Import preview expired; load the file again.');
    const account = this.account(preview.entityId,preview.accountId);
    if (account.currency !== preview.currency || account.minor_digits !== preview.minorDigits) throw new Error('Account changed; preview again.');
    return this.store.db.transaction(() => {
      const existing = this.store.db.prepare<[string,string,string],{id:string; imported_row_count:number; voided_at:string|null; state:string}>(
        'SELECT id,imported_row_count,voided_at,state FROM import_batches WHERE account_id=? AND fingerprint=? AND mapping_fingerprint=?')
        .get(account.id,preview.fingerprint,preview.mappingFingerprint);
      if (existing) {
        if (existing.state !== 'committed') throw new Error('An incomplete import requires recovery; do not reimport.');
        return {id:existing.id,imported:existing.imported_row_count,alreadyImported:true,voided:existing.voided_at !== null};
      }
      const lookup = duplicateLookup(this.store.db,account.id); const observed = new Map<string,number>();
      const {selected, excluded} = reviewImport(preview, decisions);
      for (const row of preview.rows) {
        if (row.fingerprint) {
          if (!observed.has(row.fingerprint)) observed.set(row.fingerprint,lookup(row.fingerprint));
          if (observed.get(row.fingerprint) !== row.existingMatches) throw new Error('Matching transactions changed; preview again.');
        }
      }
      const id = randomUUID();
      const exclusions = {invalid:excluded.filter(row => row.error).map(row => row.row),reviewed:excluded.filter(row => !row.error).map(row => row.row)};
      const uncategorized = this.store.db.prepare<[string],{id:string}>("SELECT id FROM categories WHERE entity_id=? AND kind='uncategorized' AND archived_at IS NULL").get(account.entity_id);
      if (!uncategorized) throw new Error('Uncategorized category is missing.');
      this.store.db.prepare(`INSERT INTO import_batches(id,entity_id,account_id,fingerprint,mapping_fingerprint,source_name,source_row_count,imported_row_count,reviewed_exclusions_json)
        VALUES(?,?,?,?,?,?,?,?,?)`).run(id,account.entity_id,account.id,preview.fingerprint,preview.mappingFingerprint,preview.sourceName,preview.rows.length,selected.length,JSON.stringify(exclusions));
      const insert = this.store.db.prepare(`INSERT INTO transactions(id,entity_id,account_id,import_batch_id,transaction_date,amount_minor,description,source_row,source_json,row_fingerprint)
        VALUES(?,?,?,?,?,?,?,?,?,?)`);
      const allocate = this.store.db.prepare('INSERT INTO allocations(transaction_id,entity_id,category_id,amount_minor) VALUES(?,?,?,?)');
      const finalize = this.store.db.prepare("UPDATE transactions SET allocation_state='balanced' WHERE id=? AND entity_id=?");
      for (const row of selected) {
        if (!row.date || row.amount === undefined || row.description === undefined || !row.fingerprint) throw new Error('Invalid preview row.');
        const transactionId = randomUUID();
        insert.run(transactionId,account.entity_id,account.id,id,row.date,row.amount,row.description,row.row,JSON.stringify({cells:row.cells,mapping:preview.mapping}),row.fingerprint);
        allocate.run(transactionId,account.entity_id,uncategorized.id,row.amount);
        finalize.run(transactionId,account.entity_id);
      }
      this.store.db.prepare("UPDATE import_batches SET state='committed' WHERE id=?").run(id);
      this.history(account.entity_id,'import_batch',id,'commit',null,{rows:selected.length,excluded:excluded.length});
      return {id,imported:selected.length,alreadyImported:false,voided:false};
    }).immediate();
  }
  previewVoid(entityId:string, type:'transaction'|'import_batch', id:string, voided:boolean) {
    this.entity(entityId);
    if (typeof voided!=='boolean') throw new Error('Explicit void/restore choice required.');
    if (type==='transaction') {
      const row=this.store.db.prepare('SELECT t.transaction_date,t.description,t.amount_minor,a.currency,a.minor_digits,t.voided_at FROM transactions t JOIN accounts a ON a.id=t.account_id WHERE t.entity_id=? AND t.id=?').get(entityId,id);
      if(!row) throw new Error('Transaction not found in this entity.');
      return {action:voided ? 'Exclude original' : 'Restore original',rows:1,original:row};
    }
    if(type!=='import_batch') throw new Error('Invalid record type.');
    const row=this.store.db.prepare<[string,string],{source_name:string;imported_row_count:number;state:string;voided_at:string|null}>('SELECT source_name,imported_row_count,state,voided_at FROM import_batches WHERE entity_id=? AND id=?').get(entityId,id);
    if(!row) throw new Error('Import not found in this entity.');
    return {action:voided ? 'Exclude import batch' : 'Restore import batch',rows:row.imported_row_count,sourceName:row.source_name,notice:'Original records remain stored; this changes their inclusion in reports.'};
  }
  setVoided(entityId: string, type: 'transaction'|'import_batch', id: string, voided: boolean): void {
    this.entity(entityId); text(id,'record');
    if (typeof voided !== 'boolean') throw new Error('Invalid void state.');
    const table = type === 'transaction' ? 'transactions' : type === 'import_batch' ? 'import_batches' : null;
    if (!table) throw new Error('Invalid record type.');
    this.store.db.transaction(() => {
      const before = this.store.db.prepare(`SELECT voided_at FROM ${table} WHERE id=? AND entity_id=?`).get(id,entityId);
      if (!before) throw new Error('Record not found in this entity.');
      const date = voided ? new Date().toISOString() : null;
      this.store.db.prepare(`UPDATE ${table} SET voided_at=? WHERE id=? AND entity_id=?`).run(date,id,entityId);
      this.history(entityId,type,id,voided ? 'void' : 'restore',before,{voided_at:date});
    }).immediate();
  }
}
