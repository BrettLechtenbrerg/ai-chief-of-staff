import type { FinanceCommand } from './worker.js';
import type { ImportMapping, AllocationInput } from './types.js';
import { currency, isoDate, minorUnits, text } from './validation.js';

function object(value:unknown):Record<string,unknown> {
  if (!value || typeof value!=='object' || Array.isArray(value)) throw new Error('Invalid finance request.');
  return value as Record<string,unknown>;
}
function integer(value:unknown,min:number,max:number):number {
  if (typeof value!=='number' || !Number.isSafeInteger(value) || value<min || value>max) throw new Error('Invalid number or range.');
  return value;
}
function choice<T extends string>(value:unknown,allowed:readonly T[]):T {
  if (typeof value!=='string' || !allowed.includes(value as T)) throw new Error('Choose a supported option.');return value as T;
}
function id(value:unknown):string {const result=text(value,'identifier');if (!/^[\w-]+$/.test(result)) throw new Error('Invalid identifier.');return result;}
function amount(value:unknown):number {if(typeof value!=='number') throw new Error('Use integer minor units.');minorUnits(value);return value;}
function date(value:unknown):string {const result=text(value,'date',10);isoDate(result);return result;}
function code(value:unknown):string {const result=text(value,'currency',3);currency(result);return result;}
function boolean(value:unknown):boolean {if(typeof value!=='boolean') throw new Error('Explicit yes/no value required.');return value;}
function allocations(value:unknown):AllocationInput[] {
  if (!Array.isArray(value) || value.length<1 || value.length>100) throw new Error('Use 1–100 allocations.');
  return value.map(item=>{const row=object(item);return {categoryId:id(row.categoryId),amountMinor:amount(row.amountMinor)};});
}
function mapping(value:unknown):ImportMapping {
  const row=object(value);const column=(key:string)=>row[key]===undefined ? undefined : integer(row[key],0,63);
  return {delimiter:choice(row.delimiter,[',',';','\t']),dateColumn:integer(row.dateColumn,0,63),descriptionColumn:integer(row.descriptionColumn,0,63),
    amountMode:choice(row.amountMode,['signed','expense-positive','debit-credit']),dateOrder:choice(row.dateOrder,['ymd','mdy','dmy']),decimal:choice(row.decimal,['.',',']),
    amountColumn:column('amountColumn'),debitColumn:column('debitColumn'),creditColumn:column('creditColumn'),currencyColumn:column('currencyColumn')};
}
export function financePeriod(value:unknown) {
  const row=object(value);return {entityId:id(row.entityId),currency:code(row.currency),year:integer(row.year,1900,2200)};
}
export function financeReceiptInput(value:unknown) {
  const row=object(value);return {entityId:id(row.entityId),transactionId:id(row.transactionId),id:id(row.id)};
}
export function financeDelimiter(value:unknown) {return choice(value,[',',';','\t']);}

/** Only this allowlist crosses the renderer boundary. Paths/exports/close belong to native handlers. */
export function financeRequest(value:unknown):FinanceCommand {
  if (Buffer.byteLength(JSON.stringify(value),'utf8')>2*1024*1024) throw new Error('Finance request exceeds 2 MiB.');
  const row=object(value);const action=text(row.action,'action',32);
  const entity=()=>id(row.entityId);const account=()=>id(row.accountId);const expected=()=>row.expected===null ? null : amount(row.expected);
  let result:FinanceCommand;
  switch(action) {
    case 'catalog': case 'backup': result={action};break;
    case 'report': result={action,...financePeriod(row)};break;
    case 'transactions': result={action,...financePeriod(row),offset:row.offset===undefined ? 0 : integer(row.offset,0,200000)};break;
    case 'createEntity': result={action,id:id(row.id),name:text(row.name,'entity name'),kind:choice(row.kind,['personal','business'])};break;
    case 'createAccount': result={action,id:id(row.id),entityId:entity(),alias:text(row.alias,'account alias'),currency:code(row.currency),precision:integer(row.precision,0,4),balance:amount(row.balance),date:date(row.date)};break;
    case 'createCategory': result={action,id:id(row.id),entityId:entity(),name:text(row.name,'category name'),kind:choice(row.kind,['expense','income','transfer','uncategorized'])};break;
    case 'manualEntry': case 'reviewManual': result={action,entityId:entity(),accountId:account(),id:id(row.id),date:date(row.date),amount:amount(row.amount),description:text(row.description,'description',2000),allocations:allocations(row.allocations)};break;
    case 'allocate': result={action,entityId:entity(),id:id(row.id),revision:integer(row.revision,0,Number.MAX_SAFE_INTEGER),allocations:allocations(row.allocations)};break;
    case 'void': result={action,entityId:entity(),type:choice(row.type,['transaction','import_batch']),id:id(row.id),voided:boolean(row.voided)};break;
    case 'previewImport': result={action,entityId:entity(),accountId:account(),mapping:mapping(row.mapping)};break;
    case 'extendPreview': result={action,entityId:entity(),id:id(row.id)};break;
    case 'previewPage': result={action,entityId:entity(),id:id(row.id),offset:integer(row.offset,0,50000)};break;
    case 'reviewImport': case 'commitImport': {
      if (!Array.isArray(row.decisions) || row.decisions.length>50000) throw new Error('Invalid row review.');
      const decisions=row.decisions.map(item=>{const decision=object(item);return {row:integer(decision.row,1,50000),action:choice(decision.action,['keep','skip'])};});
      result={action,entityId:entity(),id:id(row.id),decisions};break;
    }
    case 'saveBudget': {
      const months=integer(row.months,1,12);if (months!==1 && months!==12) throw new Error('Use monthly or annual budgets.');
      result={action,entityId:entity(),categoryId:id(row.categoryId),currency:code(row.currency),start:date(row.start),months,amount:amount(row.amount),expected:expected()};break;
    }
    case 'statement': result={action,entityId:entity(),accountId:account(),date:date(row.date)};break;
    case 'saveStatement': result={action,entityId:entity(),accountId:account(),date:date(row.date),balance:amount(row.balance),expected:expected()};break;
    case 'projectScenario': case 'saveScenario': {
      const input=object(row.assumptions);
      result={action,entityId:entity(),id:id(row.id),name:text(row.name,'scenario name'),assumptions:{currency:code(input.currency),openingBalanceMinor:amount(input.openingBalanceMinor),monthlyIncomeMinor:amount(input.monthlyIncomeMinor),monthlyExpenseMinor:amount(input.monthlyExpenseMinor),months:integer(input.months,1,60)}};break;
    }
    case 'saveRule': result={action,entityId:entity(),id:id(row.id),match:text(row.match,'merchant match',160),categoryId:id(row.categoryId),enabled:boolean(row.enabled)};break;
    default: throw new Error('Unsupported finance action.');
  }
  if (Object.keys(row).some(key=>!Object.prototype.hasOwnProperty.call(result,key))) throw new Error('Unexpected finance request field.');
  return result;
}
export const FINANCE_READ_ACTIONS = new Set(['catalog','report','transactions','statement','reviewManual','previewImport','previewPage','extendPreview','reviewImport','projectScenario']);
