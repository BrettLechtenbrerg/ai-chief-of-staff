import type { FinanceAnalysis } from './analysis.js';
import { decimalMoney } from './analysis.js';

export type FinanceReport = ReturnType<FinanceAnalysis['report']>;

/** Deliberate allowlist: no names, aliases, paths, source cells, receipt text or record IDs. */
export function buildFinanceSummary(report:FinanceReport):string {
  const money=(amount:string|number)=>decimalMoney(amount,report.period.minorDigits);
  const annual=new Map<string,bigint>();
  const monthly=new Map<string,{income:bigint;expense:bigint}>();
  for(const row of report.categoryMonths) {
    if(row.kind==='expense') annual.set(row.categoryId,(annual.get(row.categoryId) ?? 0n)+BigInt(row.amountMinor));
    const totals=monthly.get(row.month) ?? {income:0n,expense:0n};
    if(row.kind==='income' || row.kind==='expense') totals[row.kind]+=BigInt(row.amountMinor);
    monthly.set(row.month,totals);
  }
  const largest=[...annual].sort((a,b)=>a[1]===b[1] ? 0 : a[1]>b[1] ? -1 : 1).slice(0,10);
  const labels=new Map<string,string>();const label=(id:string)=>{if(!labels.has(id))labels.set(id,`Category ${labels.size+1}`);return labels.get(id)!;};
  const categoryExpenses=largest.map(([id,amount])=>({category:label(id),expense:money(amount.toString())}));
  const budgets=[...report.budgetComparison].sort((a,b)=>{
    const left=BigInt(a.favorableVarianceMinor),right=BigInt(b.favorableVarianceMinor);return left===right ? 0 : left<right ? -1 : 1;
  }).slice(0,30).map(row=>({category:label(row.category_id),kind:row.kind,start:row.period_start,months:row.months,
    budget:money(row.amount_minor),actual:money(row.actualMinor),favorableVariance:money(row.favorableVarianceMinor)}));
  const summary={version:'finance-aggregate-v1',year:report.period.year,currency:report.period.currency,
    coverage:'Only entered/imported records. Completeness unverified. No bank verification.',
    expense:money(report.expenseMinor),income:money(report.incomeMinor),transferNet:money(report.transferNetMinor),uncategorizedNet:money(report.uncategorizedNetMinor),
    transactionCount:report.transactionCount,uncategorizedCount:report.uncategorizedCount,excludedCount:report.excludedTransactionCount,
    missingReceiptReferenceCount:report.missingReceiptReferenceCount,unavailableReceiptCount:report.unavailableReceiptCount,
    months:Array.from({length:12},(_,index)=>{
      const month=`${report.period.year}-${String(index+1).padStart(2,'0')}`;const totals=monthly.get(month);
      return {month,income:money((totals?.income ?? 0n).toString()),expense:money((totals?.expense ?? 0n).toString())};
    }),
    categoryExpenses,categoryCoverage:`Largest ${categoryExpenses.length} of ${annual.size} expense categories; labels anonymized.`,
    budgets,budgetCoverage:`${budgets.length} of ${report.budgetComparison.length} independent comparisons, lowest favorable variance first. Never add monthly and annual budgets.`,
    reconciliation:{accounts:report.reconciliations.length,missingStatements:report.reconciliations.filter(row=>row.differenceMinor===null).length,
      differingBalances:report.reconciliations.filter(row=>row.differenceMinor!==null && row.differenceMinor!=='0').length}};
  const encoded=JSON.stringify(summary,null,2);
  if(Buffer.byteLength(encoded,'utf8')>32768) throw new Error('Aggregate summary exceeds its privacy preview limit.');
  return encoded;
}
