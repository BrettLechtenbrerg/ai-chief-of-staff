import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FinanceDatabase } from '../../src/finance/database';
import { FinanceLedger } from '../../src/finance/ledger';
import { FinanceAnalysis, decimalMoney } from '../../src/finance/analysis';
import { buildFinanceSummary } from '../../src/finance/ai-summary';
import { csvCell, escapeHtml, exportFinance } from '../../src/finance/export';
import { prepareImport } from '../../src/finance/import';
import { FINANCE_APPLICATION_ID, FINANCE_SCHEMA_VERSION, MAX_MINOR_UNITS } from '../../src/finance/types';

let dir:string,store:FinanceDatabase,ledger:FinanceLedger,analysis:FinanceAnalysis,entity:string,account:string;
let categories:Record<string,string>;
beforeEach(async()=>{
  dir=fs.mkdtempSync(path.join(os.tmpdir(),'acos-analysis-'));store=await FinanceDatabase.open(dir);ledger=new FinanceLedger(store);analysis=new FinanceAnalysis(ledger);
  entity=ledger.createEntity('Synthetic personal');account=ledger.createAccount(entity,'Checking','USD',2,10000,'2026-01-01');
  categories=Object.fromEntries(store.db.prepare<[string],{id:string;kind:string}>('SELECT id,kind FROM categories WHERE entity_id=?').all(entity).map(row=>[row.kind,row.id]));
});
afterEach(async()=>{vi.restoreAllMocks();await store.close();fs.rmSync(dir,{recursive:true,force:true});});
const period=()=>({entityId:entity,currency:'USD',year:2026});
function entry(amount:number,kind='expense',date='2026-01-02',description='Synthetic') {
  const id=randomUUID();ledger.manualEntry(entity,account,id,date,amount,description,[{categoryId:categories[kind],amountMinor:amount}]);return id;
}

describe('deterministic accounting preparation',()=>{
  it('allows only anonymous aggregate fields into the AI summary',()=>{
    const id=entry(-12345,'expense','2026-01-02','Private merchant sentinel');
    const receipt=path.join(dir,'private-receipt-sentinel.txt');fs.writeFileSync(receipt,'Private receipt contents');
    analysis.addReceipt(entity,id,randomUUID(),receipt);
    const encoded=buildFinanceSummary(analysis.report(period()));
    for(const privateValue of [id,entity,account,receipt,'Private merchant sentinel','Private receipt contents','Checking','Synthetic personal',categories.expense]) expect(encoded).not.toContain(privateValue);
    const summary=JSON.parse(encoded);expect(summary.expense).toBe('123.45');expect(summary.months).toHaveLength(12);
    expect(summary.categoryExpenses).toEqual([{category:'Category 1',expense:'123.45'}]);
  });
  it('reads a prior statement only within its owning entity',()=>{
    analysis.saveStatement(entity,account,'2026-01-31',9900,null);
    analysis.saveStatement(entity,account,'2026-02-28',9800,null);
    expect(analysis.statement(entity,account,'2026-01-31')).toMatchObject({statement_balance_minor:9900});
    const other=ledger.createEntity('Separate');expect(()=>analysis.statement(other,account,'2026-01-31')).toThrow();
    expect(analysis.statement(entity,account,'2026-03-31')).toBeNull();
  });
  it('upgrades a populated version-two store additively and preserves its pre-migration backup', async()=>{
    const oldRoot=path.join(dir,'old');fs.mkdirSync(path.join(oldRoot,'finance'),{recursive:true});
    const raw=new Database(path.join(oldRoot,'finance','finance.db'));
    for(const [version,name] of [[1,'001-initial.sql'],[2,'002-currency-precision.sql']] as const){
      const sql=fs.readFileSync(new URL(`../../src/finance/migrations/${name}`,import.meta.url),'utf8');
      raw.exec(sql);raw.prepare('INSERT INTO schema_migrations(version,checksum) VALUES(?,?)').run(version,createHash('sha256').update(sql).digest('hex'));
    }
    raw.exec("INSERT INTO entities(id,name,kind) VALUES('original','Preserve me','personal')");
    raw.pragma(`application_id=${FINANCE_APPLICATION_ID}`);raw.pragma('user_version=2');raw.close();
    const upgraded=await FinanceDatabase.open(oldRoot);
    try {
      expect(upgraded.db.pragma('user_version',{simple:true})).toBe(FINANCE_SCHEMA_VERSION);
      expect(upgraded.db.prepare("SELECT name FROM entities WHERE id='original'").pluck().get()).toBe('Preserve me');
      const backup=fs.readdirSync(path.join(upgraded.directory,'backups')).find(name=>name.endsWith('.db'))!;
      const old=new Database(path.join(upgraded.directory,'backups',backup),{readonly:true});
      try {expect(old.pragma('user_version',{simple:true})).toBe(2);} finally {old.close();}
    } finally {await upgraded.close();}
  });
  it('does not propagate extra command metadata into reports',()=>{
    const command={...period(),destination:'PRIVATE_SENTINEL',action:'report'};
    expect(analysis.report(command).period).not.toHaveProperty('destination');
    expect(analysis.report(command).period).not.toHaveProperty('action');
  });
  it('handles refunds, income, transfers and unknown categories without double counting',()=>{
    entry(-1000);entry(200);entry(-3000,'transfer');entry(5000,'income');entry(-100,'uncategorized');
    const report=analysis.report(period());
    expect(report).toMatchObject({transactionCount:5,expenseMinor:'800',incomeMinor:'5000',transferNetMinor:'-3000',uncategorizedNetMinor:'-100',uncategorizedCount:1,missingReceiptReferenceCount:1});
    expect(report.coverage).toMatch(/Unverified/);
    expect(report.reconciliations[0].differenceMinor).toBeNull();
  });
  it('supports mixed-sign splits and exact totals beyond floating-point precision',()=>{
    ledger.manualEntry(entity,account,randomUUID(),'2026-01-02',9700,'Net deposit',[
      {categoryId:categories.income,amountMinor:10000},{categoryId:categories.expense,amountMinor:-300}]);
    store.db.transaction(()=>{for(let i=0;i<1001;i++)entry(-MAX_MINOR_UNITS);})();
    const exact=BigInt(MAX_MINOR_UNITS)*1001n+300n;
    const report=analysis.report(period());expect(report.expenseMinor).toBe(exact.toString());expect(report.incomeMinor).toBe('10000');
    expect(decimalMoney(exact.toString(),2)).toBe('90090000000003.00');
    expect(()=>decimalMoney(Number.MAX_SAFE_INTEGER+1,2)).toThrow(/exact/);
    expect(()=>decimalMoney('0xff',2)).toThrow(/exact/);
  });
  it('separates currencies and entities and excludes other years',()=>{
    entry(-100);entry(-999,'expense','2025-12-31');
    const euro=ledger.createAccount(entity,'Euro','EUR',2,0,'2026-01-01');
    ledger.manualEntry(entity,euro,randomUUID(),'2026-01-02',-700,'Euro',[{categoryId:categories.expense,amountMinor:-700}]);
    const other=ledger.createEntity('Other');const otherAccount=ledger.createAccount(other,'Other','USD',2,0,'2026-01-01');
    const otherCategory=ledger.createCategory(other,'Other costs','expense');
    ledger.manualEntry(other,otherAccount,randomUUID(),'2026-01-02',-9999,'Other',[{categoryId:otherCategory,amountMinor:-9999}]);
    expect(analysis.report(period()).expenseMinor).toBe('100');expect(analysis.report({...period(),currency:'EUR'}).expenseMinor).toBe('700');
    expect(()=>analysis.report({...period(),currency:'GBP'})).toThrow(/No account/);
  });
  it('compares independent monthly/annual budgets and rejects stale edits or changing category identity',()=>{
    entry(-1000);entry(200);entry(5000,'income');
    analysis.saveBudget(entity,categories.expense,'USD','2026-01-01',1,1000,null);
    analysis.saveBudget(entity,categories.expense,'USD','2026-01-01',12,2000,null);
    analysis.saveBudget(entity,categories.income,'USD','2026-01-01',1,6000,null);
    const budgets=analysis.report(period()).budgetComparison;
    expect(budgets.find(row=>row.months===12)).toMatchObject({actualMinor:'800',favorableVarianceMinor:'1200'});
    expect(budgets.find(row=>row.kind==='income')).toMatchObject({actualMinor:'5000',favorableVarianceMinor:'-1000'});
    expect(()=>analysis.saveBudget(entity,categories.expense,'USD','2026-01-01',1,1500,null)).toThrow(/changed/);
    analysis.saveBudget(entity,categories.expense,'USD','2026-01-01',1,1500,1000);
    expect(()=>analysis.saveBudget(entity,categories.expense,'USD','2026-02-01',12,100,null)).toThrow(/calendar-year/);
    expect(()=>store.db.prepare("UPDATE categories SET kind='transfer' WHERE id=?").run(categories.expense)).toThrow(/immutable/);
  });
  it('compares entered balances, retains statement history and responds to void/undo',()=>{
    const id=entry(-1000);entry(200);entry(-3000,'transfer');entry(5000,'income');entry(-100,'uncategorized');
    entry(-999,'expense','2025-12-31');
    analysis.saveStatement(entity,account,'2026-01-31',11100,null);
    expect(analysis.report(period()).reconciliations[0]).toMatchObject({calculatedMinor:'11100',differenceMinor:'0'});
    ledger.setVoided(entity,'transaction',id,true);
    expect(analysis.report(period()).reconciliations[0].differenceMinor).toBe('1000');
    ledger.setVoided(entity,'transaction',id,false);
    expect(analysis.report(period()).reconciliations[0].differenceMinor).toBe('0');
    expect(()=>analysis.saveStatement(entity,account,'2026-01-31',10000,null)).toThrow(/changed/);
    analysis.saveStatement(entity,account,'2026-01-31',10000,11100);
    expect(store.db.prepare("SELECT count(*) FROM edit_history WHERE record_type='reconciliation'").pluck().get()).toBe(2);
  });
  it('labels recurrence as observations and leaves merchant-rule suggestions pending',()=>{
    for(const date of ['2026-01-02','2026-02-02','2026-03-02'])entry(-1000,'expense',date,'Streaming');
    const id=entry(-1000,'uncategorized','2026-04-02','Streaming');
    const rule=randomUUID();analysis.saveRule(entity,rule,'Streaming',categories.expense,false);
    expect(analysis.transactions(period()).find(row=>row.id===id)?.suggestions).toEqual([]);
    analysis.saveRule(entity,rule,'Streaming',categories.expense,true);
    const row=analysis.transactions(period()).find(row=>row.id===id)!;
    expect(row.suggestions[0]).toMatchObject({categoryId:categories.expense});
    expect(row.allocations[0].kind).toBe('uncategorized');
    expect(analysis.report(period()).recurring[0]).toMatchObject({cadence:'monthly',amountMinor:'1000',reason:expect.stringContaining('Candidate only')});
  });
  it('retains skipped/voided import exceptions without treating them as complete books',()=>{
    const preview=prepareImport(store.db,new TextEncoder().encode('Date,Memo,Amount\n2026-01-02,Valid,-1\n2026-02-30,Invalid,-2'),'synthetic.csv',ledger.account(entity,account),
      {delimiter:',',dateColumn:0,descriptionColumn:1,amountColumn:2,amountMode:'signed',dateOrder:'ymd',decimal:'.'});
    const batch=ledger.commitImport(preview,[{row:2,action:'skip'}]);
    expect(analysis.report(period())).toMatchObject({transactionCount:1,uncategorizedCount:1});
    ledger.setVoided(entity,'import_batch',batch.id,true);
    expect(analysis.report(period())).toMatchObject({transactionCount:0,excludedTransactionCount:1});
  });
  it('enforces entity boundaries for budgets, statements, receipts and rules',()=>{
    const other=ledger.createEntity('Other');const id=entry(-100);const receipt=path.join(dir,'reference.txt');fs.writeFileSync(receipt,'Synthetic');
    expect(()=>analysis.saveBudget(other,categories.expense,'USD','2026-01-01',1,100,null)).toThrow(/this entity/);
    expect(()=>analysis.saveStatement(other,account,'2026-01-31',100,null)).toThrow(/this entity/);
    expect(()=>analysis.addReceipt(other,id,randomUUID(),receipt)).toThrow(/this entity/);
    expect(()=>analysis.saveRule(other,randomUUID(),'match',categories.expense,true)).toThrow(/this entity/);
  });
  it('stores explicit scenarios idempotently and never treats them as bank forecasts',()=>{
    const assumptions={currency:'USD',openingBalanceMinor:10000,monthlyIncomeMinor:3000,monthlyExpenseMinor:4000,months:12};
    const result=analysis.projectScenario(entity,assumptions);expect(result.balances.at(-1)?.balanceMinor).toBe('-2000');expect(result.label).toMatch(/not a prediction/);
    const id=randomUUID();expect(analysis.saveScenario(entity,id,'What if',assumptions)).toBe(id);expect(analysis.saveScenario(entity,id,'What if',assumptions)).toBe(id);
    expect(()=>analysis.projectScenario(entity,{...assumptions,months:61})).toThrow(/1–60/);
    expect(()=>analysis.saveScenario(entity,id,'What if',{...assumptions,months:10})).toThrow(/already used/);
  });
  it('keeps receipt references separate from files and reports unavailable references',()=>{
    const id=entry(-100);const file=path.join(dir,'receipt.txt');fs.writeFileSync(file,'Synthetic receipt');
    analysis.addReceipt(entity,id,randomUUID(),file);
    expect(analysis.report(period())).toMatchObject({missingReceiptReferenceCount:0,unavailableReceiptCount:0});
    fs.unlinkSync(file);
    expect(analysis.report(period())).toMatchObject({missingReceiptReferenceCount:0,unavailableReceiptCount:1});
  });
});

describe('private accountant-preparation exports',()=>{
  it.each(['=SUM(A1:A2)',' +text','-text','@text','\ttext','\ntext','＝text','\u200b=text'])('escapes formula-like text %s',value=>{
    expect(csvCell(value).startsWith('"\'')).toBe(true);
  });
  it('keeps numeric money exact and HTML inert',()=>{
    expect(csvCell({numeric:'-123.45'})).toBe('"-123.45"');expect(csvCell({numeric:'90090000000000300'})).toBe('"\'90090000000000300"');
    expect(()=>csvCell({numeric:'=text'})).toThrow();expect(escapeHtml('<b>"&')).toBe('&lt;b&gt;&quot;&amp;');
  });
  it('exports scoped detail, exceptions, receipts and budgets without overwriting prior packets',()=>{
    entry(-123,'expense','2026-01-02','<b>Untrusted text</b>');entry(-100,'uncategorized','2026-01-03','=Text');
    analysis.saveBudget(entity,categories.expense,'USD','2026-01-01',1,200,null);
    const first=exportFinance(ledger,period(),dir),second=exportFinance(ledger,period(),dir);
    expect(first.directory).not.toBe(second.directory);
    const html=fs.readFileSync(path.join(first.directory,'summary.html'),'utf8');
    expect(html).toContain('Accounting preparation');expect(html).toContain('default-src');expect(html).not.toContain('<b>Untrusted');
    const transactions=fs.readFileSync(path.join(first.directory,'transactions.csv'),'utf8');expect(transactions).toContain('"\'=Text"');expect(transactions).toContain('"-1.23"');
    expect(fs.readFileSync(path.join(first.directory,'review-exceptions.csv'),'utf8')).toContain('no receipt reference');
    const manifest=JSON.parse(fs.readFileSync(path.join(first.directory,'COMPLETE.json'),'utf8'));
    expect(manifest.files.length).toBeGreaterThanOrEqual(10);
    expect(fs.readFileSync(path.join(first.directory,'accounts.csv'),'utf8')).toContain('"10000"');expect(fs.statSync(first.directory).mode&0o777).toBe(0o700);
    for(const name of first.files)expect(fs.statSync(path.join(first.directory,name)).mode&0o777).toBe(0o600);
  });
  it('preserves an incomplete packet on write failure and never marks it complete',()=>{
    entry(-123);const original=fs.writeFileSync;
    vi.spyOn(fs,'writeFileSync').mockImplementationOnce(original).mockImplementationOnce(()=>{throw new Error('Synthetic full disk');});
    expect(()=>exportFinance(ledger,period(),dir)).toThrow(/Synthetic full disk/);
    const packet=fs.readdirSync(dir).find(name=>name.startsWith('books-'))!;
    expect(fs.existsSync(path.join(dir,packet,'README.txt'))).toBe(true);expect(fs.existsSync(path.join(dir,packet,'COMPLETE.json'))).toBe(false);
    vi.restoreAllMocks();expect(exportFinance(ledger,period(),dir).directory).not.toBe(path.join(dir,packet));
  });
  it('rejects a symlink destination without changing its target',()=>{
    const link=path.join(dir,'linked');fs.symlinkSync(store.directory,link);
    expect(()=>exportFinance(ledger,period(),link)).toThrow(/symlink/);
    expect(fs.readdirSync(store.directory).some(name=>name.startsWith('books-'))).toBe(false);
  });
});
