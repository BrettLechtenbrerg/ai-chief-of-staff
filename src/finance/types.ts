export const FINANCE_APPLICATION_ID = 1094927945; // SQLite header: ACFI
export const FINANCE_SCHEMA_VERSION = 3;
export const MAX_MINOR_UNITS = 9_000_000_000_000;
export const MAX_IMPORT_BYTES = 8 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 50_000;

export interface ImportMapping {
  delimiter: ',' | ';' | '\t';
  dateColumn: number;
  descriptionColumn: number;
  dateOrder: 'ymd' | 'mdy' | 'dmy';
  decimal: '.' | ',';
  amountMode: 'signed' | 'expense-positive' | 'debit-credit';
  amountColumn?: number;
  debitColumn?: number;
  creditColumn?: number;
  currencyColumn?: number;
}
export interface ImportRow {
  row: number;
  cells: string[];
  date?: string;
  amount?: number;
  description?: string;
  fingerprint?: string;
  error?: string;
  existingMatches: number;
  repeatedInFile: boolean;
}
export interface ImportPreview {
  id: string;
  entityId: string;
  accountId: string;
  sourceName: string;
  fingerprint: string;
  mappingFingerprint: string;
  mapping: ImportMapping;
  headers: string[];
  rows: ImportRow[];
  currency: string;
  minorDigits: number;
  totalMinor: string;
  expiresAt: number;
}
export interface ImportDecision { row: number; action: 'keep' | 'skip'; }
export interface AllocationInput { categoryId: string; amountMinor: number; }

export interface FinanceEntity {
  id: string;
  name: string;
  kind: 'personal' | 'business';
  archived_at: string | null;
  created_at: string;
}

export interface FinanceAccount {
  id: string;
  entity_id: string;
  alias: string;
  currency: string;
  minor_digits: number;
  opening_balance_minor: number;
  opening_date: string;
  archived_at: string | null;
}

export interface FinanceCategory {
  id: string;
  entity_id: string;
  name: string;
  kind: 'expense' | 'income' | 'transfer' | 'uncategorized';
  archived_at: string | null;
}

export interface FinanceCatalog {
  entities:FinanceEntity[];
  accounts:FinanceAccount[];
  categories:FinanceCategory[];
  backupWarning:string|null;
}

export interface FinanceTransaction {
  id: string;
  entity_id: string;
  account_id: string;
  import_batch_id: string | null;
  transaction_date: string;
  amount_minor: number;
  description: string;
  source_row: number | null;
  row_fingerprint: string;
  allocation_state: 'draft' | 'balanced';
  revision: number;
  voided_at: string | null;
  created_at: string;
}

export interface FinanceAllocation {
  transaction_id: string;
  entity_id: string;
  category_id: string;
  amount_minor: number;
}

export interface FinanceBudget {
  id: string;
  entity_id: string;
  category_id: string;
  currency: string;
  period_start: string;
  months: 1 | 12;
  amount_minor: number;
}
