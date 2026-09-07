import { createHash, randomUUID } from 'node:crypto';
import { parse } from 'csv-parse/sync';
import type Database from 'better-sqlite3';
import { MAX_IMPORT_BYTES, MAX_IMPORT_ROWS, type FinanceAccount, type ImportMapping, type ImportPreview, type ImportRow, type ImportDecision } from './types.js';
import { isoDate, parseMoney, text } from './validation.js';

export const fingerprint = (value: string) => createHash('sha256').update(value).digest('hex');
export const transactionFingerprint = (date: string, amount: number, description: string) =>
  fingerprint(JSON.stringify([date, amount, description.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ')]));

export function validateMapping(input: ImportMapping): ImportMapping {
  if (!input || ![',',';','\t'].includes(input.delimiter) || !['ymd','mdy','dmy'].includes(input.dateOrder) ||
      !['.',','].includes(input.decimal) || !['signed','expense-positive','debit-credit'].includes(input.amountMode)) {
    throw new Error('Choose explicit CSV, date and amount conventions.');
  }
  const column = (value: unknown) => {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value >= 64) throw new Error('Invalid column mapping.');
    return value;
  };
  const mapping: ImportMapping = {
    delimiter: input.delimiter, dateOrder: input.dateOrder, decimal: input.decimal, amountMode: input.amountMode,
    dateColumn: column(input.dateColumn), descriptionColumn: column(input.descriptionColumn),
  };
  if (mapping.amountMode === 'debit-credit') {
    mapping.debitColumn = column(input.debitColumn); mapping.creditColumn = column(input.creditColumn);
  } else mapping.amountColumn = column(input.amountColumn);
  if (input.currencyColumn !== undefined) mapping.currencyColumn = column(input.currencyColumn);
  const columns = [mapping.dateColumn,mapping.descriptionColumn,mapping.amountColumn,mapping.debitColumn,mapping.creditColumn,mapping.currencyColumn].filter(v => v !== undefined);
  if (new Set(columns).size !== columns.length) throw new Error('Mapped columns must be distinct.');
  return mapping;
}

export function decodeCsv(bytes: Uint8Array, delimiter: ImportMapping['delimiter']): string[][] {
  if (!bytes.byteLength || bytes.byteLength > MAX_IMPORT_BYTES || ![',',';','\t'].includes(delimiter)) throw new Error('CSV must be nonempty and at most 8 MiB.');
  let input: string;
  try { input = new TextDecoder('utf-8',{fatal:true}).decode(bytes); } catch { throw new Error('Save the CSV as UTF-8.'); }
  for (const char of input) {
    const code = char.charCodeAt(0);
    if (code < 32 && ![9,10,13].includes(code)) throw new Error('CSV contains unsupported control characters.');
  }
  let count = 0;
  try {
    return parse(input, {
      bom: true, delimiter, columns: false, skip_empty_lines: true, max_record_size: 8192,
      on_record(record: string[]) {
        if (++count > MAX_IMPORT_ROWS + 1 || record.length > 64 || JSON.stringify(record).length > 7000) {
          throw new Error('CSV limits exceeded.');
        }
        return record;
      },
    });
  } catch {
    throw new Error('Malformed or oversized CSV. Use consistent columns, at most 50,000 rows, 64 columns and 7,000 characters per row.');
  }
}

function parseDate(input: string, order: ImportMapping['dateOrder']): string {
  const match = input.trim().match(/^(\d{1,4})([-/.])(\d{1,2})\2(\d{1,4})$/);
  if (!match) throw new Error('Date does not match the selected convention.');
  const parts = [match[1],match[3],match[4]];
  const [year, month, day] = order === 'ymd' ? parts : order === 'mdy' ? [parts[2],parts[0],parts[1]] : [parts[2],parts[1],parts[0]];
  if (year.length !== 4 || month.length > 2 || day.length > 2) throw new Error('Use a four-digit year and explicit date order.');
  return isoDate(`${year}-${month.padStart(2,'0')}-${day.padStart(2,'0')}`);
}

export function duplicateLookup(db: Database.Database, accountId: string): (hash: string) => number {
  const statement = db.prepare<[string,string],{ count: number }>(`SELECT count(*) AS count FROM transactions t
    LEFT JOIN import_batches b ON b.id=t.import_batch_id
    WHERE t.account_id=? AND t.row_fingerprint=? AND t.voided_at IS NULL
    AND (t.import_batch_id IS NULL OR (b.state='committed' AND b.voided_at IS NULL))`);
  return hash => statement.get(accountId,hash)?.count ?? 0;
}

export function reviewImport(preview: ImportPreview, decisions: ImportDecision[]) {
  if (preview.expiresAt <= Date.now()) throw new Error('Import preview expired; load the file again.');
  if (!Array.isArray(decisions) || decisions.length > preview.rows.length) throw new Error('Invalid row review.');
  const choices = new Map<number, 'keep' | 'skip'>();
  for (const choice of decisions) {
    if (!choice || !Number.isInteger(choice.row) || choice.row < 1 || choice.row > preview.rows.length ||
        !['keep','skip'].includes(choice.action) || choices.has(choice.row)) throw new Error('Invalid row review.');
    choices.set(choice.row, choice.action);
  }
  const selected = preview.rows.filter(row => {
    const choice = choices.get(row.row);
    if (row.error && choice !== 'skip') throw new Error('Explicitly exclude every invalid row before importing.');
    if (!row.error && (row.existingMatches || row.repeatedInFile) && !choice) throw new Error('Review every candidate duplicate.');
    return choice !== 'skip';
  });
  const excluded = preview.rows.filter(row => choices.get(row.row) === 'skip');
  return {selected, excluded, totalMinor:selected.reduce((sum,row) => sum + BigInt(row.amount!), 0n).toString()};
}

/** Called only in the finance worker; the renderer receives bounded pages, not this retained snapshot. */
export function prepareImport(db: Database.Database, bytes: Uint8Array, sourceName: string, account: FinanceAccount, input: ImportMapping): ImportPreview {
  const mapping = validateMapping(input); const records = decodeCsv(bytes,mapping.delimiter);
  if (records.length < 2) throw new Error('CSV has no transaction rows.');
  const headers = records[0];
  for (const index of [mapping.dateColumn,mapping.descriptionColumn,mapping.amountColumn,mapping.debitColumn,mapping.creditColumn,mapping.currencyColumn]) {
    if (index !== undefined && index >= headers.length) throw new Error('Mapped column is missing.');
  }
  const lookup = duplicateLookup(db,account.id);
  const seen = new Set<string>(); const matches = new Map<string,number>(); let total = 0n;
  const rows: ImportRow[] = records.slice(1).map((cells,index) => {
    const row: ImportRow = {row:index+1,cells,existingMatches:0,repeatedInFile:false};
    try {
      if (mapping.currencyColumn !== undefined && cells[mapping.currencyColumn].trim().toUpperCase() !== account.currency) {
        throw new Error('Row currency differs from the selected account. Use a matching account; no conversion is performed.');
      }
      row.date = parseDate(cells[mapping.dateColumn],mapping.dateOrder);
      row.description = text(cells[mapping.descriptionColumn], 'description',2000);
      if (mapping.amountMode === 'debit-credit') {
        if (!cells[mapping.debitColumn!].trim() && !cells[mapping.creditColumn!].trim()) throw new Error('Debit/credit amount is missing.');
        const debit = parseMoney(cells[mapping.debitColumn!].trim() || '0',account.minor_digits,mapping.decimal);
        const credit = parseMoney(cells[mapping.creditColumn!].trim() || '0',account.minor_digits,mapping.decimal);
        if (debit < 0 || credit < 0 || (debit !== 0 && credit !== 0)) throw new Error('Debit/credit cells must be nonnegative, with only one nonzero.');
        row.amount = credit - debit;
      } else row.amount = parseMoney(cells[mapping.amountColumn!],account.minor_digits,mapping.decimal) * (mapping.amountMode === 'expense-positive' ? -1 : 1);
      row.fingerprint = transactionFingerprint(row.date,row.amount,row.description);
      total += BigInt(row.amount);
    } catch (error) { row.error = error instanceof Error ? error.message : 'Invalid row.'; }
    if (!row.error && row.fingerprint) {
      if (!matches.has(row.fingerprint)) matches.set(row.fingerprint,lookup(row.fingerprint));
      row.existingMatches = matches.get(row.fingerprint)!;
      row.repeatedInFile = seen.has(row.fingerprint); seen.add(row.fingerprint);
    }
    return row;
  });
  return {
    id:randomUUID(), entityId:account.entity_id, accountId:account.id, sourceName:text(sourceName,'source name',255),
    fingerprint:createHash('sha256').update(bytes).digest('hex'), mappingFingerprint:fingerprint(JSON.stringify(mapping)),
    mapping, headers, rows, currency:account.currency, minorDigits:account.minor_digits,
    totalMinor:total.toString(), expiresAt:Date.now()+10*60*1000,
  };
}
