import fs from 'node:fs';
import path from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';
import { FinanceDatabase } from './database.js';
import { FinanceLedger } from './ledger.js';
import { FinanceAnalysis, decimalMoney, type ReportPeriod, type ScenarioInput } from './analysis.js';
import { exportFinance } from './export.js';
import { buildFinanceSummary } from './ai-summary.js';
import { decodeCsv, prepareImport, reviewImport } from './import.js';
import { MAX_IMPORT_BYTES, type AllocationInput, type FinanceCategory, type FinanceEntity, type FinanceAccount, type FinanceCatalog, type ImportDecision, type ImportMapping, type ImportPreview } from './types.js';

export type FinanceCommand =
  | ({action:'report'|'transactions'|'aiSummary'; offset?:number} & ReportPeriod)
  | ({action:'export'; destination:string} & ReportPeriod)
  | {action:'saveBudget'; entityId:string; categoryId:string; currency:string; start:string; months:1|12; amount:number; expected:number|null}
  | {action:'statement'; entityId:string; accountId:string; date:string}
  | {action:'saveStatement'; entityId:string; accountId:string; date:string; balance:number; expected:number|null}
  | {action:'projectScenario'|'saveScenario'; entityId:string; id:string; name:string; assumptions:ScenarioInput}
  | {action:'addReceipt'; entityId:string; transactionId:string; id:string; filePath:string}
  | {action:'saveRule'; entityId:string; id:string; match:string; categoryId:string; enabled:boolean}
  | {action:'catalog'}
  | {action:'createEntity'; id:string; name:string; kind:FinanceEntity['kind']}
  | {action:'createAccount'; id:string; entityId:string; alias:string; currency:string; precision:number; balance:number; date:string}
  | {action:'createCategory'; id:string; entityId:string; name:string; kind:FinanceCategory['kind']}
  | {action:'reviewManual' | 'manualEntry'; entityId:string; accountId:string; id:string; date:string; amount:number; description:string; allocations:AllocationInput[]}
  | {action:'reviewAllocation'|'allocate'; entityId:string; id:string; revision:number; allocations:AllocationInput[]}
  | {action:'reviewVoid'|'void'; entityId:string; type:'transaction'|'import_batch'; id:string; voided:boolean}
  | {action:'loadCsv'; filePath:string; delimiter:ImportMapping['delimiter']}
  | {action:'previewImport'; entityId:string; accountId:string; mapping:ImportMapping}
  | {action:'previewPage'; entityId:string; id:string; offset:number}
  | {action:'extendPreview'; entityId:string; id:string}
  | {action:'reviewImport' | 'commitImport'; entityId:string; id:string; decisions:ImportDecision[]}
  | {action:'cancelImport'} | {action:'backup'} | {action:'close'};

function readCsv(filePath: string): Uint8Array {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath) || path.extname(filePath).toLowerCase() !== '.csv') throw new Error('Select a local CSV file.');
  const fd = fs.openSync(filePath,fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const before = fs.fstatSync(fd);
    if (!before.isFile() || before.size > MAX_IMPORT_BYTES) throw new Error('CSV must be a regular file at most 8 MiB.');
    const bytes = Buffer.alloc(MAX_IMPORT_BYTES+1); let read = 0;
    while (read < bytes.length) {
      const count = fs.readSync(fd,bytes,read,bytes.length-read,null);
      if (!count) break; read += count;
    }
    const after = fs.fstatSync(fd);
    if (read > MAX_IMPORT_BYTES || before.size !== read || after.mtimeMs !== before.mtimeMs || after.size !== before.size) throw new Error('CSV changed or exceeds the file limit; select it again.');
    return Uint8Array.from(bytes.subarray(0,read));
  } finally { fs.closeSync(fd); }
}

/** Owns the only finance connection and only retained preview. No raw SQL RPC. */
export class FinanceRuntime {
  readonly ledger: FinanceLedger;
  readonly analysis: FinanceAnalysis;
  private source: {bytes:Uint8Array; name:string; expiresAt:number} | null = null;
  private preview: ImportPreview | null = null;
  private readonly expiry: ReturnType<typeof setInterval>;
  constructor(readonly store: FinanceDatabase) {
    this.ledger = new FinanceLedger(store);
    this.analysis = new FinanceAnalysis(this.ledger);
    this.expiry = setInterval(() => {
      if (this.source && this.source.expiresAt <= Date.now()) this.source = null;
      if (this.preview && this.preview.expiresAt <= Date.now()) this.preview = null;
    },30_000); this.expiry.unref();
  }
  private currentPreview(entityId: string, id: string): ImportPreview {
    if (!this.preview || this.preview.id !== id || this.preview.entityId !== entityId || this.preview.expiresAt <= Date.now()) throw new Error('Import preview is missing or expired.');
    return this.preview;
  }
  async execute(command: FinanceCommand): Promise<unknown> {
    switch (command.action) {
      case 'statement': return this.analysis.statement(command.entityId,command.accountId,command.date);
      case 'report': return this.analysis.report(command);
      case 'aiSummary': return buildFinanceSummary(this.analysis.report(command));
      case 'transactions': return this.analysis.transactions(command,command.offset);
      case 'projectScenario': return this.analysis.projectScenario(command.entityId,command.assumptions);
      case 'export': return exportFinance(this.ledger,command,command.destination);
      case 'close': clearInterval(this.expiry); this.source = null; this.preview = null; await this.store.close(); return null;
      case 'cancelImport': this.source = null; this.preview = null; return null;
      case 'backup': await this.store.backup(true); return {backupWarning:this.store.backupWarning};
      case 'catalog': return {
        entities:this.store.db.prepare<[],FinanceEntity>('SELECT * FROM entities WHERE archived_at IS NULL ORDER BY name LIMIT 100').all(),
        accounts:this.store.db.prepare<[],FinanceAccount>('SELECT * FROM accounts WHERE archived_at IS NULL ORDER BY alias LIMIT 1000').all(),
        categories:this.store.db.prepare<[],FinanceCategory>('SELECT * FROM categories WHERE archived_at IS NULL ORDER BY name LIMIT 5000').all(),
        backupWarning:this.store.backupWarning,
      } satisfies FinanceCatalog;
      case 'reviewAllocation': return this.ledger.previewAllocation(command.entityId,command.id,command.revision,command.allocations);
      case 'reviewVoid': return this.ledger.previewVoid(command.entityId,command.type,command.id,command.voided);
      case 'reviewManual': return this.ledger.previewManualEntry(command.entityId,command.accountId,command.date,command.amount,command.description,command.allocations);
      case 'loadCsv': {
        this.source = null; this.preview = null;
        const bytes = readCsv(command.filePath); const records = decodeCsv(bytes,command.delimiter);
        this.source = {bytes,name:path.basename(command.filePath),expiresAt:Date.now()+600_000};
        return {name:this.source.name,headers:records[0],sample:records.slice(1,6),rowCount:records.length-1};
      }
      case 'previewImport': {
        this.preview = null;
        if (!this.source || this.source.expiresAt <= Date.now()) throw new Error('Select the CSV again.');
        const account = this.ledger.account(command.entityId,command.accountId);
        const preview = prepareImport(this.store.db,this.source.bytes,this.source.name,account,command.mapping);
        this.preview = preview;
        return {id:preview.id,currency:preview.currency,minorDigits:preview.minorDigits,rowCount:preview.rows.length,
          invalidCount:preview.rows.filter(row => row.error).length,
          duplicateCount:preview.rows.filter(row => row.existingMatches || row.repeatedInFile).length,
          totalMinor:preview.totalMinor,expiresAt:preview.expiresAt,sourceName:preview.sourceName};
      }
      case 'reviewImport': {
        const preview = this.currentPreview(command.entityId,command.id);
        const review = reviewImport(preview,command.decisions);
        const account=this.ledger.account(preview.entityId,preview.accountId);
        return {sourceName:preview.sourceName, account:account.alias, entityId:preview.entityId,
          currency:preview.currency, minorDigits:preview.minorDigits, mapping:preview.mapping,
          formattedTotal:`${preview.currency} ${decimalMoney(review.totalMinor,preview.minorDigits)}`,
          importedCount:review.selected.length, excludedCount:review.excluded.length, totalMinor:review.totalMinor};
      }
      case 'extendPreview': {
        const preview=this.currentPreview(command.entityId,command.id);
        preview.expiresAt=Date.now()+600_000;
        return {expiresAt:preview.expiresAt};
      }
      case 'previewPage': {
        const preview = this.currentPreview(command.entityId,command.id);
        if (!Number.isSafeInteger(command.offset) || command.offset < 0 || command.offset > preview.rows.length) throw new Error('Invalid preview page.');
        return preview.rows.slice(command.offset,command.offset+100);
      }
      default: break;
    }
    // Before bulk changes, failure to snapshot leaves all current rows untouched.
    if (command.action === 'commitImport') this.currentPreview(command.entityId,command.id);
    if (command.action === 'void') this.ledger.entity(command.entityId);
    if (command.action === 'commitImport' || command.action === 'void') await this.store.backup(true);
    let result: unknown;
    switch (command.action) {
      case 'saveBudget': result = this.analysis.saveBudget(command.entityId,command.categoryId,command.currency,command.start,command.months,command.amount,command.expected); break;
      case 'saveStatement': result = this.analysis.saveStatement(command.entityId,command.accountId,command.date,command.balance,command.expected); break;
      case 'saveScenario': result = this.analysis.saveScenario(command.entityId,command.id,command.name,command.assumptions); break;
      case 'addReceipt': result = this.analysis.addReceipt(command.entityId,command.transactionId,command.id,command.filePath); break;
      case 'saveRule': result = this.analysis.saveRule(command.entityId,command.id,command.match,command.categoryId,command.enabled); break;
      case 'createEntity': result = this.ledger.createEntity(command.name,command.kind,command.id); break;
      case 'createAccount': result = this.ledger.createAccount(command.entityId,command.alias,command.currency,command.precision,command.balance,command.date,command.id); break;
      case 'createCategory': result = this.ledger.createCategory(command.entityId,command.name,command.kind,command.id); break;
      case 'manualEntry': result = this.ledger.manualEntry(command.entityId,command.accountId,command.id,command.date,command.amount,command.description,command.allocations); break;
      case 'allocate': result = this.ledger.allocate(command.entityId,command.id,command.revision,command.allocations); break;
      case 'void': result = this.ledger.setVoided(command.entityId,command.type,command.id,command.voided); break;
      case 'commitImport': result = this.ledger.commitImport(this.currentPreview(command.entityId,command.id),command.decisions); break;
      default: throw new Error('Unknown finance operation.');
    }
    await this.store.backup(command.action === 'commitImport').catch(() => { /* Return saved result plus warning, not a false failed-write result. */ });
    return {result,backupWarning:this.store.backupWarning};
  }
}

if (parentPort && workerData?.kind === 'finance') {
  const port = parentPort;
  const runtime = FinanceDatabase.open(workerData.userDataDirectory).then(store => new FinanceRuntime(store));
  let queue = Promise.resolve(); let waiting = 0;
  port.on('message',(message: {id:number; command:FinanceCommand}) => {
    if (waiting >= 8) { port.postMessage({id:message?.id,error:'Finance is busy; wait for the current operation.'}); return; }
    waiting++;
    queue = queue.then(async () => {
      if (!Number.isSafeInteger(message?.id) || !message.command || typeof message.command.action !== 'string') return;
      try {
        const result = await (await runtime).execute(message.command);
        port.postMessage({id:message.id,result});
        if (message.command.action === 'close') port.close();
      } catch (error) {
        // Never serialize parser/SQLite objects or row-bearing diagnostic fields.
        const detail = error instanceof Error && !('code' in error) ? error.message :
          'Finance operation failed. Check the selected file, storage space, and duplicate names.';
        port.postMessage({id:message.id,error:detail});
      }
    }).catch(() => { /* Port closed: no further responses can be delivered. */ }).finally(() => { waiting--; });
  });
  void runtime.catch(() => { /* First request receives the initialization error. */ });
}
