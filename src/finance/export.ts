import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { FinanceAnalysis, decimalMoney, FINANCE_METHODOLOGY, type ReportPeriod } from './analysis.js';
import type { FinanceLedger } from './ledger.js';

interface NumericCell { numeric:string; }
type Cell = string | number | null | NumericCell;
const numeric = (value:string|number) => ({numeric:String(value)});
export function csvCell(value:Cell): string {
  let cell:string;
  if (typeof value==='object' && value!==null) {
    if (!/^-?\d+(?:\.\d+)?$/.test(value.numeric)) throw new Error('Invalid numeric export cell.');
    cell=value.numeric;
    // Spreadsheet programs round beyond 15 significant digits; keep those exact values as text.
    if (cell.replace(/\D/g,'').replace(/^0+/,'').length>15) cell="'"+cell;
  } else {
    if (typeof value==='number' && !Number.isSafeInteger(value)) throw new Error('Invalid export count.');
    cell=String(value ?? '');
    if (/^[\s\p{Cc}\p{Cf}]*[=+@-]/u.test(cell.normalize('NFKC')) || /^[\t\r\n]/.test(cell)) cell="'"+cell;
  }
  return '"'+cell.replace(/"/g,'""')+'"';
}
export function escapeHtml(value:unknown):string {
  return String(value ?? '').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
}

/** User-selected local destination only. New private packet, no overwrite or automatic sharing. */
export function exportFinance(ledger:FinanceLedger, input:ReportPeriod, destination:string) {
  if (typeof destination!=='string' || !path.isAbsolute(destination)) throw new Error('Select an absolute local export directory.');
  const stat=fs.lstatSync(destination);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (process.getuid && stat.uid!==process.getuid())) throw new Error('Choose an owned local directory, not a symlink.');
  const parent=fs.realpathSync(destination);
  const analysis=new FinanceAnalysis(ledger);
  return ledger.store.db.transaction(()=>{
    const report=analysis.report(input);
    if (report.importsLimited || report.receiptsLimited) throw new Error('Export register exceeds its completeness limit; preserve the data for a larger export.');
    const directory=path.join(parent,`books-${input.year}-${randomUUID()}`);
    fs.mkdirSync(directory,{mode:0o700});
    const files:{name:string;bytes:number;sha256:string}[]=[];
    const output=(name:string,chunks:Iterable<string>)=>{
      const fd=fs.openSync(path.join(directory,name),'wx',0o600); const hash=createHash('sha256');
      try {
        for (const chunk of chunks) { fs.writeFileSync(fd,chunk); hash.update(chunk); }
        fs.fsyncSync(fd); files.push({name,bytes:fs.fstatSync(fd).size,sha256:hash.digest('hex')});
      } finally { fs.closeSync(fd); }
    };
    const csv=(name:string,headers:string[],rows:Iterable<Cell[]>)=>{
      function* lines() { yield headers.map(csvCell).join(',')+'\r\n'; for (const row of rows) yield row.map(csvCell).join(',')+'\r\n'; }
      output(name,lines());
    };
    output('README.txt',[FINANCE_METHODOLOGY+'\n\nOnly a packet containing COMPLETE.json is complete. On interruption, preserve this partial packet and create a new export.\nMoney is exact decimal/minor-unit text; formula-like text and numbers beyond 15 significant digits are apostrophe-prefixed for spreadsheet safety. Monthly and annual budgets are independent, never added together.\nReceipt files are NOT included. Local references may become unavailable. This packet is sensitive and unencrypted; do not share it automatically.\n']);
    const accounts=ledger.store.db.prepare<[string,string],{id:string;alias:string;currency:string;minor_digits:number;opening_date:string;opening_balance_minor:number}>(
      'SELECT id,alias,currency,minor_digits,opening_date,opening_balance_minor FROM accounts WHERE entity_id=? AND currency=? ORDER BY alias LIMIT 1001').all(input.entityId,input.currency);
    if (accounts.length>1000) throw new Error('Account export exceeds 1,000 aliases.');
    csv('accounts.csv',['id','alias','currency','minor_digits','opening_date','opening_balance_minor'],accounts.map(row=>[row.id,row.alias,row.currency,row.minor_digits,row.opening_date,numeric(row.opening_balance_minor)]));
    type Row={id:string;date:string;alias:string;description:string;amount:number;source_name:string|null;source_row:number|null;voided_at:string|null;batch_voided_at:string|null;batch_state:string|null;allocation_state:string};
    const details=ledger.store.db.prepare<[string,string,string,string],Row>(`SELECT t.id,t.transaction_date AS date,a.alias,t.description,t.amount_minor AS amount,
      b.source_name,t.source_row,t.voided_at,b.voided_at AS batch_voided_at,b.state AS batch_state,t.allocation_state
      FROM transactions t JOIN accounts a ON a.id=t.account_id LEFT JOIN import_batches b ON b.id=t.import_batch_id
      WHERE t.entity_id=? AND a.currency=? AND t.transaction_date BETWEEN ? AND ? ORDER BY t.transaction_date,t.id`);
    function* transactionRows():Generator<Cell[]> {
      let count=0;
      for (const row of details.iterate(input.entityId,input.currency,report.period.start,report.period.end)) {
        if (++count>200000) throw new Error('Transaction export exceeds 200,000 rows.');
        const excluded=Boolean(row.voided_at || row.batch_voided_at || row.allocation_state!=='balanced' || (row.batch_state && row.batch_state!=='committed'));
        yield [row.id,row.date,row.alias,row.description,input.currency,numeric(row.amount),numeric(decimalMoney(row.amount,report.period.minorDigits)),
          excluded ? 'excluded' : 'included',row.source_name,row.source_row];
      }
    }
    csv('transactions.csv',['id','date','account_alias','description','currency','amount_minor','amount_decimal','analysis_status','source_file','source_record'],transactionRows());
    const allocations=ledger.store.db.prepare<[string,string,string,string],{transaction_id:string;name:string;kind:string;amount_minor:number;status:string}>(`SELECT l.transaction_id,c.name,c.kind,l.amount_minor,
      CASE WHEN t.voided_at IS NOT NULL OR b.voided_at IS NOT NULL OR t.allocation_state!='balanced' OR
        (b.state IS NOT NULL AND b.state!='committed') THEN 'excluded' ELSE 'included' END AS status
      FROM allocations l JOIN transactions t ON t.id=l.transaction_id JOIN accounts a ON a.id=t.account_id JOIN categories c ON c.id=l.category_id LEFT JOIN import_batches b ON b.id=t.import_batch_id
      WHERE l.entity_id=? AND a.currency=? AND t.transaction_date BETWEEN ? AND ? ORDER BY t.transaction_date,t.id,c.id`);
    function* allocationRows():Generator<Cell[]> {
      let count=0;
      for (const row of allocations.iterate(input.entityId,input.currency,report.period.start,report.period.end)) {
        if (++count>500000) throw new Error('Allocation export exceeds 500,000 rows.');
        yield [row.transaction_id,row.name,row.kind,input.currency,numeric(row.amount_minor),numeric(decimalMoney(row.amount_minor,report.period.minorDigits)),row.status];
      }
    }
    csv('allocations.csv',['transaction_id','category','kind','currency','signed_amount_minor','signed_amount_decimal','analysis_status'],allocationRows());
    csv('category-months.csv',['month','category','kind','currency','amount_minor','amount_decimal'],report.categoryMonths.map(row=>[row.month,row.category,row.kind,input.currency,numeric(row.amountMinor),numeric(decimalMoney(row.amountMinor,report.period.minorDigits))]));
    csv('budgets.csv',['category','start','months','currency','budget_minor','actual_minor','favorable_variance_minor','method'],report.budgetComparison.map(row=>[row.name,row.period_start,row.months,input.currency,numeric(row.amount_minor),numeric(row.actualMinor),numeric(row.favorableVarianceMinor),row.note]));
    csv('receipts.csv',['id','transaction_id','name','local_reference','availability','removed_at'],report.receiptIndex.map(row=>[row.id,row.transaction_id,row.name,row.path_ref,row.status,row.removed_at]));
    csv('reconciliation.csv',['account','statement_date','currency','statement_minor','calculated_minor','difference_minor','status'],report.reconciliations.map(row=>[row.alias,row.statementDate,input.currency,row.statementBalanceMinor===null ? null : numeric(row.statementBalanceMinor),row.calculatedMinor===null ? null : numeric(row.calculatedMinor),row.differenceMinor===null ? null : numeric(row.differenceMinor),row.status]));
    type Import={id:string;source_name:string;state:string;source_row_count:number;imported_row_count:number;reviewed_exclusions_json:string;voided_at:string|null;};
    const imports=report.imports as Import[];
    csv('imports.csv',['id','source_file','state','source_rows','imported_rows','voided_at','reviewed_exclusions'],imports.map(row=>[row.id,row.source_name,row.state,row.source_row_count,row.imported_row_count,row.voided_at,row.reviewed_exclusions_json]));
    const exceptionStatement=ledger.store.db.prepare<[string,string,string,string],{id:string;date:string;reason:string}>(`SELECT t.id,t.transaction_date AS date,
      CASE WHEN t.voided_at IS NOT NULL OR b.voided_at IS NOT NULL THEN 'Voided record'
        WHEN t.allocation_state!='balanced' OR (b.state IS NOT NULL AND b.state!='committed') THEN 'Unfinished allocation/import'
        WHEN EXISTS(SELECT 1 FROM allocations l JOIN categories c ON c.id=l.category_id WHERE l.transaction_id=t.id AND c.kind='uncategorized') THEN 'Uncategorized allocations'
        ELSE 'Expense allocation has no receipt reference' END AS reason FROM transactions t JOIN accounts a ON a.id=t.account_id LEFT JOIN import_batches b ON b.id=t.import_batch_id
      WHERE t.entity_id=? AND a.currency=? AND t.transaction_date BETWEEN ? AND ? AND (t.voided_at IS NOT NULL OR b.voided_at IS NOT NULL OR t.allocation_state!='balanced' OR
      (b.state IS NOT NULL AND b.state!='committed') OR EXISTS(SELECT 1 FROM allocations l JOIN categories c ON c.id=l.category_id WHERE l.transaction_id=t.id AND c.kind='uncategorized') OR
      (NOT EXISTS(SELECT 1 FROM receipt_references r WHERE r.transaction_id=t.id AND r.removed_at IS NULL) AND
      EXISTS(SELECT 1 FROM allocations l JOIN categories c ON c.id=l.category_id WHERE l.transaction_id=t.id AND c.kind='expense' AND l.amount_minor<0))) ORDER BY t.transaction_date,t.id`);
    function* exceptionRows():Generator<Cell[]> {
      for (const row of exceptionStatement.iterate(input.entityId,input.currency,report.period.start,report.period.end)) yield [row.id,row.date,row.reason];
      for (const row of report.receiptIndex) if (row.status!=='available' && !row.removed_at) yield [row.transaction_id,null,'Receipt reference unavailable'];
      yield [null,null,report.coverage];
    }
    csv('review-exceptions.csv',['transaction_id','date','reason'],exceptionRows());
    const table=(headers:string[],rows:unknown[][])=>`<table><thead><tr>${headers.map(h=>`<th scope="col">${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(cell=>`<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    const money=(value:string)=>`${input.currency} ${decimalMoney(value,report.period.minorDigits)}`;
    output('summary.html',[`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>Accounting preparation ${input.year}</title><style>body{font:16px system-ui;max-width:70rem;margin:2rem auto;padding:1rem;color:#17202a;background:#fff}table{border-collapse:collapse;width:100%;margin:1rem 0}th,td{text-align:left;padding:.5rem;border:1px solid #777;overflow-wrap:anywhere}h1{font-size:1.7rem}p{line-height:1.5}</style><h1>Accounting preparation — ${escapeHtml(ledger.entity(input.entityId).name)}, ${input.year}, ${escapeHtml(input.currency)}</h1><p>${escapeHtml(FINANCE_METHODOLOGY)}</p><p>${escapeHtml(report.coverage)}</p><h2>Entered activity</h2>${table(['Measure','Value'],[['Included transactions',report.transactionCount],['Expense net of refunds',money(report.expenseMinor)],['Income',money(report.incomeMinor)],['Uncategorized transactions',report.uncategorizedCount],['Expenses without receipt references',report.missingReceiptReferenceCount],['Excluded transactions',report.excludedTransactionCount]])}<h2>Category/month totals</h2>${table(['Month','Category','Kind','Amount'],report.categoryMonths.map(row=>[row.month,row.category,row.kind,money(row.amountMinor)]))}<h2>Budget comparison</h2><p>Each row is independent; overlapping monthly and annual budgets are not added.</p>${table(['Category','Start','Months','Budget','Actual','Favorable variance'],report.budgetComparison.map(row=>[row.name,row.period_start,row.months,money(String(row.amount_minor)),money(row.actualMinor),money(row.favorableVarianceMinor)]))}<h2>Reconciliation</h2>${table(['Account','Statement date','Difference','Status'],report.reconciliations.map(row=>[row.alias,row.statementDate,row.differenceMinor===null ? 'Unavailable' : money(row.differenceMinor),row.status]))}<h2>Coverage and files</h2><p>Transaction, allocation, receipt, import and exception detail is in the adjacent CSV files. Receipt files are not copied. ${report.recurrenceCoverageLimited ? 'Recurring-charge candidate coverage is limited.' : 'Recurring-charge patterns are suggestions only.'}</p></html>`]);
    output('COMPLETE.json',[JSON.stringify({createdAt:new Date().toISOString(),period:report.period,methodology:FINANCE_METHODOLOGY,files},null,2)]);
    const fd=fs.openSync(directory,'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    return {directory,files:files.map(file=>file.name),transactionCount:report.transactionCount};
  })();
}
