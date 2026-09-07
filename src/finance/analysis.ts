import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { FinanceLedger } from './ledger.js';
import type { FinanceBudget, FinanceCategory } from './types.js';
import { currency, isoDate, minorUnits, text } from './validation.js';

export const FINANCE_METHODOLOGY = 'Local accounting preparation, not audited statements, tax advice or completed filings. Only entered/imported records are included; coverage is not verified. Transfers/card payments are excluded from spending. Positive expense allocations reduce spending as refunds. No currency conversion. Opening balances precede transactions on the opening date. Zero reconciliation difference is not proof of complete books. Receipt references do not copy or back up receipt files. An accountant determines tax treatment and formal requirements.';
export interface ReportPeriod { entityId:string; currency:string; year:number; }
export interface ScenarioInput { currency:string; openingBalanceMinor:number; monthlyIncomeMinor:number; monthlyExpenseMinor:number; months:number; }
interface AllocationRow { id:string; transaction_date:string; description:string; amount_minor:number; category_id:string; name:string; kind:FinanceCategory['kind']; has_receipt:number; }
interface MonthlyCategory { month:string; categoryId:string; category:string; kind:FinanceCategory['kind']; amountMinor:string; }
interface TransactionView { id:string; account_id:string; alias:string; transaction_date:string; amount_minor:number; description:string; source_row:number|null; revision:number; allocation_state:string; voided_at:string|null; batch_voided_at:string|null; batch_state:string|null; source_name:string|null; has_receipt:number; }
interface ReceiptReference { id:string; transaction_id:string; path_ref:string; name:string; removed_at:string|null; }

/** Exact aggregates are strings at the UI/export boundary, never rounded JS totals. */
export function decimalMoney(value: string | number | bigint, precision: number): string {
  if (!Number.isInteger(precision) || precision < 0 || precision > 4) throw new Error('Invalid currency precision.');
  if ((typeof value==='number' && !Number.isSafeInteger(value)) || (typeof value==='string' && !/^-?\d+$/.test(value))) throw new Error('Use exact integer minor units.');
  const amount = BigInt(value); const negative = amount < 0n; const digits = (negative ? -amount : amount).toString().padStart(precision+1,'0');
  return `${negative ? '-' : ''}${precision ? `${digits.slice(0,-precision)}.${digits.slice(-precision)}` : digits}`;
}

export class FinanceAnalysis {
  constructor(readonly ledger: FinanceLedger) {}
  private get db() { return this.ledger.store.db; }
  period(input: ReportPeriod) {
    this.ledger.entity(input.entityId); currency(input.currency);
    if (!Number.isInteger(input.year) || input.year < 1900 || input.year > 2200) throw new Error('Choose a year between 1900 and 2200.');
    const account = this.db.prepare<[string,string],{minor_digits:number}>('SELECT minor_digits FROM accounts WHERE entity_id=? AND currency=? LIMIT 1').get(input.entityId,input.currency);
    if (!account) throw new Error('No account uses this currency in this entity.');
    return {entityId:input.entityId,currency:input.currency,year:input.year,minorDigits:account.minor_digits,start:`${input.year}-01-01`,end:`${input.year}-12-31`};
  }
  saveBudget(entityId:string, categoryId:string, code:string, start:string, months:1|12, amount:number, expected:number|null): string {
    this.ledger.entity(entityId); const category = this.ledger.category(entityId,categoryId);
    currency(code); isoDate(start); minorUnits(amount);
    // simplification: annual budgets use calendar years; fiscal starts need explicit fiscal-window comparisons.
    if (!['expense','income'].includes(category.kind) || amount < 0 || ![1,12].includes(months) || !start.endsWith('-01') || (months === 12 && !start.endsWith('-01-01'))) throw new Error('Use an income/expense monthly or calendar-year budget.');
    this.period({entityId,currency:code,year:Number(start.slice(0,4))});
    if (expected !== null) minorUnits(expected);
    return this.db.transaction(() => {
      const before = this.db.prepare<[string,string,string,string,number],FinanceBudget>('SELECT * FROM budget_lines WHERE entity_id=? AND category_id=? AND currency=? AND period_start=? AND months=?').get(entityId,categoryId,code,start,months);
      if (before?.amount_minor === amount) return before.id;
      if ((before?.amount_minor ?? null) !== expected) throw new Error('Budget changed; refresh before editing.');
      const id = before?.id ?? randomUUID();
      this.db.prepare(`INSERT INTO budget_lines(id,entity_id,category_id,currency,period_start,months,amount_minor) VALUES(?,?,?,?,?,?,?)
        ON CONFLICT(entity_id,category_id,currency,period_start,months) DO UPDATE SET amount_minor=excluded.amount_minor`).run(id,entityId,categoryId,code,start,months,amount);
      this.ledger.history(entityId,'budget',id,'set',before ?? null,{amountMinor:amount}); return id;
    }).immediate();
  }
  statement(entityId:string, accountId:string, date:string) {
    this.ledger.account(entityId,accountId);isoDate(date);
    return this.db.prepare<[string,string,string],{id:string;statement_balance_minor:number;statement_date:string}>(
      'SELECT id,statement_balance_minor,statement_date FROM reconciliations WHERE entity_id=? AND account_id=? AND statement_date=?').get(entityId,accountId,date) ?? null;
  }
  saveStatement(entityId:string, accountId:string, date:string, balance:number, expected:number|null): string {
    const account = this.ledger.account(entityId,accountId); isoDate(date); minorUnits(balance);
    if (date < account.opening_date) throw new Error('Statement date precedes the opening balance.');
    if (expected !== null) minorUnits(expected);
    return this.db.transaction(() => {
      const before = this.db.prepare<[string,string],{id:string;statement_balance_minor:number}>('SELECT * FROM reconciliations WHERE account_id=? AND statement_date=?').get(accountId,date);
      if (before?.statement_balance_minor === balance) return before.id;
      if ((before?.statement_balance_minor ?? null) !== expected) throw new Error('Statement changed; refresh before editing.');
      const id = before?.id ?? randomUUID();
      this.db.prepare(`INSERT INTO reconciliations(id,entity_id,account_id,statement_date,statement_balance_minor) VALUES(?,?,?,?,?)
        ON CONFLICT(account_id,statement_date) DO UPDATE SET statement_balance_minor=excluded.statement_balance_minor`).run(id,entityId,accountId,date,balance);
      this.ledger.history(entityId,'reconciliation',id,'set',before ?? null,{date,balance}); return id;
    }).immediate();
  }
  saveScenario(entityId:string, id:string, name:string, input:ScenarioInput) {
    name = text(name,'scenario name'); id = text(id,'scenario identifier');
    const projection = this.projectScenario(entityId,input);
    const assumptions = JSON.stringify(projection.assumptions);
    return this.db.transaction(() => {
      const before = this.db.prepare<[string],{entity_id:string;name:string;assumptions_json:string}>('SELECT * FROM scenarios WHERE id=?').get(id);
      if (before) {
        if (before.entity_id === entityId && before.name === name && before.assumptions_json === assumptions) return id;
        throw new Error('Scenario identifier already used; save a new scenario.');
      }
      this.db.prepare('INSERT INTO scenarios(id,entity_id,name,assumptions_json) VALUES(?,?,?,?)').run(id,entityId,name,assumptions);
      this.ledger.history(entityId,'scenario',id,'create',null,{name,...projection.assumptions}); return id;
    }).immediate();
  }
  projectScenario(entityId:string, input:ScenarioInput) {
    this.ledger.entity(entityId); currency(input.currency);
    const account=this.db.prepare<[string,string],{minor_digits:number}>('SELECT minor_digits FROM accounts WHERE entity_id=? AND currency=? LIMIT 1').get(entityId,input.currency);
    if (!account) throw new Error('No account uses this currency in this entity.');
    minorUnits(input.openingBalanceMinor); minorUnits(input.monthlyIncomeMinor); minorUnits(input.monthlyExpenseMinor);
    if (!Number.isInteger(input.months) || input.months < 1 || input.months > 60 || input.monthlyIncomeMinor < 0 || input.monthlyExpenseMinor < 0) throw new Error('Use 1–60 months and nonnegative income/expense assumptions.');
    const assumptions:ScenarioInput = {currency:input.currency,openingBalanceMinor:input.openingBalanceMinor,monthlyIncomeMinor:input.monthlyIncomeMinor,monthlyExpenseMinor:input.monthlyExpenseMinor,months:input.months};
    const delta = BigInt(input.monthlyIncomeMinor)-BigInt(input.monthlyExpenseMinor);
    return {label:'What-if based only on entered assumptions, not a prediction.',minorDigits:account.minor_digits,assumptions,
      balances:Array.from({length:input.months},(_,i) => ({month:i+1,balanceMinor:(BigInt(input.openingBalanceMinor)+delta*BigInt(i+1)).toString()}))};
  }
  addReceipt(entityId:string, transactionId:string, id:string, filePath:string): string {
    this.ledger.entity(entityId); text(id,'receipt identifier'); text(filePath,'receipt path',4096);
    if (!path.isAbsolute(filePath) || !fs.lstatSync(filePath).isFile() || fs.lstatSync(filePath).isSymbolicLink()) throw new Error('Select a regular local receipt file.');
    const row = this.db.prepare('SELECT 1 FROM transactions WHERE id=? AND entity_id=?').get(transactionId,entityId);
    if (!row) throw new Error('Transaction not found in this entity.');
    return this.db.transaction(() => {
      const existing = this.db.prepare<[string],ReceiptReference & {entity_id:string}>('SELECT * FROM receipt_references WHERE id=?').get(id);
      if (existing) {
        if (existing.entity_id === entityId && existing.transaction_id === transactionId && existing.path_ref === filePath && !existing.removed_at) return id;
        throw new Error('Receipt identifier already used.');
      }
      const name = text(path.basename(filePath),'receipt name',255);
      this.db.prepare('INSERT INTO receipt_references(id,entity_id,transaction_id,path_ref,name) VALUES(?,?,?,?,?)').run(id,entityId,transactionId,filePath,name);
      this.ledger.history(entityId,'receipt',id,'reference',null,{transactionId,path:filePath,name}); return id;
    }).immediate();
  }
  saveRule(entityId:string, id:string, match:string, categoryId:string, enabled:boolean): string {
    this.ledger.entity(entityId); this.ledger.category(entityId,categoryId); text(id,'rule identifier'); match = text(match,'merchant match',160).toLowerCase();
    if (typeof enabled !== 'boolean') throw new Error('Choose whether the rule is enabled.');
    return this.db.transaction(() => {
      const before = this.db.prepare<[string],{entity_id:string;match_text:string;category_id:string;enabled:number}>('SELECT * FROM merchant_rules WHERE id=?').get(id);
      if (before && (before.entity_id !== entityId || before.match_text !== match)) throw new Error('Rule identifier already used; create a new rule.');
      if (before?.enabled === Number(enabled) && before.category_id === categoryId) return id;
      const count = this.db.prepare<[string],number>('SELECT count(*) FROM merchant_rules WHERE entity_id=?').pluck().get(entityId) ?? 0;
      if (!before && count >= 100) throw new Error('Use at most 100 merchant rules per entity.');
      this.db.prepare(`INSERT INTO merchant_rules(id,entity_id,category_id,match_text,enabled,approved_at) VALUES(?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET category_id=excluded.category_id,enabled=excluded.enabled,approved_at=excluded.approved_at`).run(id,entityId,categoryId,match,Number(enabled),enabled ? new Date().toISOString() : null);
      this.ledger.history(entityId,'rule',id,'set',before ?? null,{match,categoryId,enabled}); return id;
    }).immediate();
  }
  transactions(input:ReportPeriod, offset=0) {
    const period = this.period(input);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 200000) throw new Error('Invalid transaction page.');
    const rows = this.db.prepare<[string,string,string,string,number],TransactionView>(`SELECT t.id,t.account_id,a.alias,t.transaction_date,t.amount_minor,t.description,t.source_row,t.revision,
      t.allocation_state,t.voided_at,b.voided_at AS batch_voided_at,b.state AS batch_state,b.source_name,
      EXISTS(SELECT 1 FROM receipt_references r WHERE r.transaction_id=t.id AND r.removed_at IS NULL) AS has_receipt
      FROM transactions t JOIN accounts a ON a.id=t.account_id LEFT JOIN import_batches b ON b.id=t.import_batch_id
      WHERE t.entity_id=? AND a.currency=? AND t.transaction_date BETWEEN ? AND ? ORDER BY t.transaction_date,t.id LIMIT 100 OFFSET ?`)
      .all(input.entityId,input.currency,period.start,period.end,offset);
    if (!rows.length) return [];
    const allocations=this.db.prepare<unknown[],{transaction_id:string;categoryId:string;amountMinor:number;category:string;kind:string}>(`SELECT l.transaction_id,l.category_id AS categoryId,l.amount_minor AS amountMinor,c.name AS category,c.kind FROM allocations l JOIN categories c ON c.id=l.category_id
      WHERE l.entity_id=? AND l.transaction_id IN (${rows.map(()=>'?').join(',')})`).all(input.entityId,...rows.map(row=>row.id));
    const rules=this.db.prepare<[string],{id:string;categoryId:string;match_text:string;category:string}>(`SELECT r.id,r.category_id AS categoryId,r.match_text,c.name AS category FROM merchant_rules r JOIN categories c ON c.id=r.category_id
      WHERE r.entity_id=? AND r.enabled=1 AND c.archived_at IS NULL LIMIT 100`).all(input.entityId);
    const grouped=new Map<string,typeof allocations>();
    for (const allocation of allocations) { const items=grouped.get(allocation.transaction_id) ?? []; items.push(allocation); grouped.set(allocation.transaction_id,items); }
    return rows.map(row=>{
      const items=grouped.get(row.id) ?? [];
      const suggestions=items.some(item=>item.kind==='uncategorized') ? rules.filter(rule=>row.description.toLowerCase().includes(rule.match_text)).map(rule=>({categoryId:rule.categoryId,category:rule.category,reason:`Reviewed rule matches “${rule.match_text}”; allocation still requires review.`})) : [];
      return {...row,allocations:items,suggestions};
    });
  }
  report(input:ReportPeriod) { return this.db.transaction(() => this.buildReport(input))(); }
  private buildReport(input:ReportPeriod) {
    const period = this.period(input);
    const totals = {expense:0n,income:0n,transfer:0n,uncategorized:0n};
    const monthly = new Map<string,{row:MonthlyCategory;amount:bigint}>();
    let transactionCount=0,uncategorizedCount=0,missingReceiptReferenceCount=0,allocationCount=0;
    const exceptions:{id:string;date:string;reason:string}[]=[];
    const groups = new Map<string,{description:string;amountMinor:string;dates:string[]}>(); let recurrenceCoverageLimited=false;
    let previous: {id:string;date:string;description:string;expense:bigint;uncategorized:boolean;receipt:boolean}|undefined;
    const finish = () => {
      if (!previous) return;
      transactionCount++;
      if (previous.uncategorized) { uncategorizedCount++; if (exceptions.length<100) exceptions.push({id:previous.id,date:previous.date,reason:'Uncategorized allocations'}); }
      if (previous.expense>0n && !previous.receipt) { missingReceiptReferenceCount++; if (exceptions.length<100) exceptions.push({id:previous.id,date:previous.date,reason:'Expense has no receipt reference'}); }
      if (previous.expense>0n) {
        const key = createHash('sha256').update(previous.description.normalize('NFKC').trim().toLowerCase()).digest('hex')+':'+previous.expense;
        if (!groups.has(key) && groups.size>=5000) { recurrenceCoverageLimited=true; return; }
        const group = groups.get(key) ?? {description:previous.description.slice(0,160),amountMinor:previous.expense.toString(),dates:[]};
        if (group.dates.length<64) group.dates.push(previous.date); else recurrenceCoverageLimited=true;
        groups.set(key,group);
      }
    };
    // simplification: bounded yearly scans (200k transactions/500k allocations); larger books need streamed indexed aggregates.
    const count = this.db.prepare<[string,string,string,string],number>(`SELECT count(*) FROM (SELECT t.id FROM transactions t JOIN accounts a ON a.id=t.account_id
      WHERE t.entity_id=? AND a.currency=? AND t.transaction_date BETWEEN ? AND ? LIMIT 200001)`).pluck().get(input.entityId,input.currency,period.start,period.end) ?? 0;
    if (count>200000) throw new Error('Year exceeds the 200,000-transaction analysis limit; preserve the data for a larger-ledger upgrade.');
    const rows = this.db.prepare<[string,string,string,string],AllocationRow>(`SELECT t.id,t.transaction_date,t.description,l.amount_minor,c.id AS category_id,c.name,c.kind,
      EXISTS(SELECT 1 FROM receipt_references r WHERE r.transaction_id=t.id AND r.removed_at IS NULL) AS has_receipt
      FROM transactions t JOIN accounts a ON a.id=t.account_id JOIN allocations l ON l.transaction_id=t.id JOIN categories c ON c.id=l.category_id
      LEFT JOIN import_batches b ON b.id=t.import_batch_id WHERE t.entity_id=? AND a.currency=? AND t.transaction_date BETWEEN ? AND ?
      AND t.voided_at IS NULL AND t.allocation_state='balanced' AND (b.id IS NULL OR (b.voided_at IS NULL AND b.state='committed'))
      ORDER BY t.transaction_date,t.id`).iterate(input.entityId,input.currency,period.start,period.end);
    for (const row of rows) {
      if (++allocationCount>500000) throw new Error('Year exceeds the allocation analysis limit.');
      if (previous?.id!==row.id) { finish(); previous={id:row.id,date:row.transaction_date,description:row.description,expense:0n,uncategorized:false,receipt:Boolean(row.has_receipt)}; }
      const amount = BigInt(row.amount_minor)*(row.kind==='expense' ? -1n : 1n);
      totals[row.kind]+=amount;
      if (row.kind==='expense') previous!.expense+=amount;
      if (row.kind==='uncategorized') previous!.uncategorized=true;
      const month=row.transaction_date.slice(0,7), key=`${month}:${row.category_id}`;
      const item=monthly.get(key) ?? {row:{month,categoryId:row.category_id,category:row.name,kind:row.kind,amountMinor:'0'},amount:0n};
      item.amount+=amount; monthly.set(key,item);
      if (monthly.size>60000) throw new Error('Category/month report exceeds its analysis limit.');
    }
    finish();
    const categoryMonths=[...monthly.values()].map(item=>({...item.row,amountMinor:item.amount.toString()}));
    const budgets=this.db.prepare<[string,string,string,string],FinanceBudget & {name:string;kind:FinanceCategory['kind']}>(`SELECT b.*,c.name,c.kind FROM budget_lines b JOIN categories c ON c.id=b.category_id
      WHERE b.entity_id=? AND b.currency=? AND b.period_start BETWEEN ? AND ? ORDER BY b.period_start,b.id LIMIT 5001`).all(input.entityId,input.currency,period.start,period.end);
    if (budgets.length>5000) throw new Error('Budget report exceeds 5,000 lines.');
    const budgetComparison=budgets.map(budget=>{
      const actual=categoryMonths.filter(row=>row.categoryId===budget.category_id && (budget.months===12 || row.month===budget.period_start.slice(0,7))).reduce((sum,row)=>sum+BigInt(row.amountMinor),0n);
      const variance=budget.kind==='income' ? actual-BigInt(budget.amount_minor) : BigInt(budget.amount_minor)-actual;
      return {...budget,actualMinor:actual.toString(),favorableVarianceMinor:variance.toString(),note:'Each budget is independent; do not add overlapping monthly and annual budgets.'};
    });
    const recurring=[...groups.values()].flatMap(group=>{
      if (group.dates.length<3) return [];
      const gaps=group.dates.slice(1).map((date,i)=>(Date.parse(date)-Date.parse(group.dates[i]))/86400000);
      const cadence=gaps.every(gap=>gap>=25&&gap<=35) ? 'monthly' : gaps.every(gap=>gap>=6&&gap<=8) ? 'weekly' : gaps.every(gap=>gap>=80&&gap<=100) ? 'quarterly' : null;
      return cadence ? [{...group,cadence,reason:`${group.dates.length} equal-cost observations with ${cadence} spacing. Candidate only; no future charge is verified.`}] : [];
    }).slice(0,100);
    const imports=this.db.prepare(`SELECT b.id,b.source_name,b.state,b.source_row_count,b.imported_row_count,b.reviewed_exclusions_json,b.voided_at,b.imported_at
      FROM import_batches b JOIN accounts a ON a.id=b.account_id WHERE b.entity_id=? AND a.currency=? ORDER BY b.imported_at DESC LIMIT 1001`).all(input.entityId,input.currency);
    const receipts=this.db.prepare<[string,string,string,string],ReceiptReference>(`SELECT r.* FROM receipt_references r JOIN transactions t ON t.id=r.transaction_id JOIN accounts a ON a.id=t.account_id
      WHERE r.entity_id=? AND a.currency=? AND t.transaction_date BETWEEN ? AND ? ORDER BY r.id LIMIT 5001`).all(input.entityId,input.currency,period.start,period.end);
    const receiptIndex=receipts.slice(0,5000).map(receipt=>{
      let status='unavailable'; try { const stat=fs.lstatSync(receipt.path_ref); status=stat.isFile()&&!stat.isSymbolicLink() ? 'available' : 'not a regular file'; } catch { /* A reference is not a backup. */ }
      return {...receipt,status};
    });
    const excludedCount=this.db.prepare<[string,string,string,string],number>(`SELECT count(*) FROM transactions t JOIN accounts a ON a.id=t.account_id LEFT JOIN import_batches b ON b.id=t.import_batch_id
      WHERE t.entity_id=? AND a.currency=? AND t.transaction_date BETWEEN ? AND ? AND
      (t.voided_at IS NOT NULL OR t.allocation_state!='balanced' OR (b.id IS NOT NULL AND (b.voided_at IS NOT NULL OR b.state!='committed')))`)
      .pluck().get(input.entityId,input.currency,period.start,period.end) ?? 0;
    const rules=this.db.prepare('SELECT id,category_id,match_text,enabled FROM merchant_rules WHERE entity_id=? ORDER BY id LIMIT 100').all(input.entityId);
    return {period,methodology:FINANCE_METHODOLOGY,transactionCount,expenseMinor:totals.expense.toString(),incomeMinor:totals.income.toString(),
      transferNetMinor:totals.transfer.toString(),uncategorizedNetMinor:totals.uncategorized.toString(),uncategorizedCount,missingReceiptReferenceCount,
      excludedTransactionCount:excludedCount,categoryMonths,budgetComparison,recurring,recurrenceCoverageLimited,exceptions,
      exceptionsLimited:uncategorizedCount+missingReceiptReferenceCount>exceptions.length,imports:imports.slice(0,1000),importsLimited:imports.length>1000,
      receiptIndex,unavailableReceiptCount:receiptIndex.filter(row=>!row.removed_at && row.status!=='available').length,receiptsLimited:receipts.length>5000,reconciliations:this.reconciliations(input),rules,
      scenarios:this.db.prepare("SELECT id,name,assumptions_json FROM scenarios WHERE entity_id=? AND json_extract(assumptions_json,'$.currency')=? ORDER BY created_at DESC LIMIT 100").all(input.entityId,input.currency),
      coverage:'Unverified; uncategorized, skipped, voided, missing and unimported records may change results.'};
  }
  private reconciliations(input:ReportPeriod) {
    const accounts=this.db.prepare<[string,string],{id:string;alias:string;opening_date:string;opening_balance_minor:number}>(`SELECT id,alias,opening_date,opening_balance_minor FROM accounts WHERE entity_id=? AND currency=? LIMIT 1001`).all(input.entityId,input.currency);
    if (accounts.length>1000) throw new Error('Too many accounts for one report.');
    let scanned=0;
    return accounts.map(account=>{
      const statement=this.db.prepare<[string,string],{statement_date:string;statement_balance_minor:number}>(`SELECT statement_date,statement_balance_minor FROM reconciliations WHERE account_id=? AND statement_date<=? ORDER BY statement_date DESC LIMIT 1`).get(account.id,`${input.year}-12-31`);
      if (!statement) return {accountId:account.id,alias:account.alias,status:'No entered statement',statementDate:null,statementBalanceMinor:null,calculatedMinor:null,differenceMinor:null};
      let calculated=BigInt(account.opening_balance_minor);
      for (const row of this.db.prepare<[string,string,string],{amount_minor:number}>(`SELECT t.amount_minor FROM transactions t LEFT JOIN import_batches b ON b.id=t.import_batch_id
        WHERE t.account_id=? AND t.transaction_date BETWEEN ? AND ? AND t.voided_at IS NULL AND
        (b.id IS NULL OR (b.voided_at IS NULL AND b.state='committed'))`).iterate(account.id,account.opening_date,statement.statement_date)) {
        if (++scanned>2000000) throw new Error('Reconciliation exceeds two million historical rows.');
        calculated+=BigInt(row.amount_minor);
      }
      return {accountId:account.id,alias:account.alias,statementDate:statement.statement_date,statementBalanceMinor:String(statement.statement_balance_minor),
        calculatedMinor:calculated.toString(),differenceMinor:(calculated-BigInt(statement.statement_balance_minor)).toString(),status:'Calculated minus entered statement; coverage unverified'};
    });
  }
}
