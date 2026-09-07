-- Initial local accounting-preparation store. Never edit after live application.
CREATE TABLE finance_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  schema_name TEXT NOT NULL CHECK (schema_name = 'acos-finance')
) STRICT;
INSERT INTO finance_meta VALUES (1, 'acos-finance');
CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY CHECK (version > 0),
  checksum TEXT NOT NULL CHECK (length(checksum) = 64),
  applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE TABLE entities (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  kind TEXT NOT NULL CHECK (kind IN ('personal', 'business')),
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;
CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE RESTRICT,
  alias TEXT NOT NULL CHECK (length(trim(alias)) BETWEEN 1 AND 80),
  currency TEXT NOT NULL CHECK (currency GLOB '[A-Z][A-Z][A-Z]'),
  minor_digits INTEGER NOT NULL CHECK (minor_digits BETWEEN 0 AND 4),
  opening_balance_minor INTEGER NOT NULL CHECK (abs(opening_balance_minor) <= 9000000000000),
  opening_date TEXT NOT NULL CHECK (length(opening_date) = 10 AND date(opening_date, '+0 days') IS opening_date),
  archived_at TEXT,
  UNIQUE (id, entity_id),
  UNIQUE (entity_id, alias)
) STRICT;
CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  kind TEXT NOT NULL CHECK (kind IN ('expense', 'income', 'transfer', 'uncategorized')),
  archived_at TEXT,
  UNIQUE (id, entity_id),
  UNIQUE (entity_id, name)
) STRICT;
CREATE UNIQUE INDEX one_uncategorized_category ON categories(entity_id) WHERE kind = 'uncategorized';

CREATE TABLE import_batches (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL CHECK (length(fingerprint) = 64),
  mapping_fingerprint TEXT NOT NULL CHECK (length(mapping_fingerprint) = 64),
  source_name TEXT NOT NULL CHECK (length(source_name) BETWEEN 1 AND 255),
  source_row_count INTEGER NOT NULL CHECK (source_row_count BETWEEN 0 AND 50000),
  imported_row_count INTEGER NOT NULL CHECK (imported_row_count BETWEEN 0 AND source_row_count),
  reviewed_exclusions_json TEXT NOT NULL DEFAULT '[]' CHECK (length(reviewed_exclusions_json) <= 524288 AND json_valid(reviewed_exclusions_json)),
  state TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'committed')),
  voided_at TEXT,
  imported_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (account_id, entity_id) REFERENCES accounts(id, entity_id) ON DELETE RESTRICT,
  UNIQUE (id, account_id, entity_id),
  UNIQUE (account_id, fingerprint, mapping_fingerprint)
) STRICT;
CREATE TABLE transactions (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  import_batch_id TEXT,
  transaction_date TEXT NOT NULL CHECK (length(transaction_date) = 10 AND date(transaction_date, '+0 days') IS transaction_date),
  amount_minor INTEGER NOT NULL CHECK (abs(amount_minor) <= 9000000000000),
  description TEXT NOT NULL CHECK (length(description) <= 2000),
  source_row INTEGER,
  source_json TEXT NOT NULL CHECK (length(source_json) <= 8192 AND json_valid(source_json)),
  row_fingerprint TEXT NOT NULL CHECK (length(row_fingerprint) = 64),
  allocation_state TEXT NOT NULL DEFAULT 'draft' CHECK (allocation_state IN ('draft', 'balanced')),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  voided_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (account_id, entity_id) REFERENCES accounts(id, entity_id) ON DELETE RESTRICT,
  FOREIGN KEY (import_batch_id, account_id, entity_id) REFERENCES import_batches(id, account_id, entity_id) ON DELETE RESTRICT,
  CHECK ((import_batch_id IS NULL AND source_row IS NULL) OR
         (import_batch_id IS NOT NULL AND typeof(source_row) = 'integer' AND source_row BETWEEN 1 AND 50000)),
  UNIQUE (id, entity_id),
  UNIQUE (import_batch_id, source_row)
) STRICT;
CREATE INDEX transactions_account_date ON transactions(account_id, transaction_date, id);
-- Candidate duplicates are NOT unique: equal legitimate purchases must survive.
CREATE INDEX transactions_candidate_duplicate ON transactions(account_id, row_fingerprint);
CREATE TABLE allocations (
  transaction_id TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  category_id TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (abs(amount_minor) <= 9000000000000),
  PRIMARY KEY (transaction_id, category_id),
  FOREIGN KEY (transaction_id, entity_id) REFERENCES transactions(id, entity_id) ON DELETE RESTRICT,
  FOREIGN KEY (category_id, entity_id) REFERENCES categories(id, entity_id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE budget_lines (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  category_id TEXT NOT NULL,
  currency TEXT NOT NULL CHECK (currency GLOB '[A-Z][A-Z][A-Z]'),
  period_start TEXT NOT NULL CHECK (length(period_start) = 10 AND date(period_start, 'start of month') IS period_start),
  months INTEGER NOT NULL CHECK (months IN (1, 12)),
  amount_minor INTEGER NOT NULL CHECK (amount_minor BETWEEN 0 AND 9000000000000),
  FOREIGN KEY (category_id, entity_id) REFERENCES categories(id, entity_id) ON DELETE RESTRICT,
  UNIQUE (entity_id, category_id, currency, period_start, months)
) STRICT;
CREATE TABLE merchant_rules (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  category_id TEXT NOT NULL,
  match_text TEXT NOT NULL CHECK (length(trim(match_text)) BETWEEN 1 AND 160),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  approved_at TEXT,
  CHECK (enabled = 0 OR approved_at IS NOT NULL),
  FOREIGN KEY (category_id, entity_id) REFERENCES categories(id, entity_id) ON DELETE RESTRICT,
  UNIQUE (entity_id, match_text)
) STRICT;
CREATE TABLE receipt_references (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  transaction_id TEXT NOT NULL,
  path_ref TEXT NOT NULL CHECK (length(path_ref) BETWEEN 1 AND 4096),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 255),
  removed_at TEXT,
  FOREIGN KEY (transaction_id, entity_id) REFERENCES transactions(id, entity_id) ON DELETE RESTRICT
) STRICT;
CREATE TABLE reconciliations (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  statement_date TEXT NOT NULL CHECK (length(statement_date) = 10 AND date(statement_date, '+0 days') IS statement_date),
  statement_balance_minor INTEGER NOT NULL CHECK (abs(statement_balance_minor) <= 9000000000000),
  FOREIGN KEY (account_id, entity_id) REFERENCES accounts(id, entity_id) ON DELETE RESTRICT,
  UNIQUE (account_id, statement_date)
) STRICT;
CREATE TABLE scenarios (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  assumptions_json TEXT NOT NULL CHECK (length(assumptions_json) <= 8192 AND json_valid(assumptions_json)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;
CREATE TABLE edit_history (
  id INTEGER PRIMARY KEY,
  entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE RESTRICT,
  record_type TEXT NOT NULL CHECK (record_type IN ('entity','account','category','transaction','import_batch','budget','rule','receipt','reconciliation','scenario')),
  record_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (length(action) BETWEEN 1 AND 40),
  before_json TEXT NOT NULL CHECK (length(before_json) <= 65536 AND json_valid(before_json)),
  after_json TEXT NOT NULL CHECK (length(after_json) <= 65536 AND json_valid(after_json)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;
CREATE INDEX history_by_entity ON edit_history(entity_id, id);

CREATE TRIGGER require_import_draft BEFORE INSERT ON import_batches
WHEN NEW.state != 'draft' BEGIN
  SELECT RAISE(ABORT, 'Build an import draft before committing');
END;
CREATE TRIGGER finalize_complete_import BEFORE UPDATE OF state ON import_batches
WHEN NEW.state = 'committed' AND (
  NEW.imported_row_count != (SELECT count(*) FROM transactions WHERE import_batch_id = NEW.id) OR
  EXISTS (SELECT 1 FROM transactions WHERE import_batch_id = NEW.id AND allocation_state != 'balanced')
) BEGIN
  SELECT RAISE(ABORT, 'Import counts and allocations must be complete');
END;
CREATE TRIGGER preserve_committed_import BEFORE UPDATE OF state ON import_batches
WHEN OLD.state = 'committed' AND NEW.state != 'committed' BEGIN
  SELECT RAISE(ABORT, 'Void a committed import instead of reopening it');
END;
CREATE TRIGGER insert_into_draft_import BEFORE INSERT ON transactions
WHEN NEW.import_batch_id IS NOT NULL AND
  (SELECT state FROM import_batches WHERE id = NEW.import_batch_id) != 'draft' BEGIN
  SELECT RAISE(ABORT, 'Cannot append transactions to a committed import');
END;
CREATE TRIGGER preserve_account_currency BEFORE UPDATE OF entity_id, currency, minor_digits ON accounts BEGIN
  SELECT RAISE(ABORT, 'Account owner and currency are immutable');
END;
CREATE TRIGGER preserve_category_kind BEFORE UPDATE OF entity_id, kind ON categories BEGIN
  SELECT RAISE(ABORT, 'Category owner and kind are immutable');
END;
CREATE TRIGGER preserve_import_identity BEFORE UPDATE OF entity_id, account_id, fingerprint,
  mapping_fingerprint, source_name, source_row_count, imported_row_count, reviewed_exclusions_json ON import_batches BEGIN
  SELECT RAISE(ABORT, 'Original import lineage is immutable');
END;
CREATE TRIGGER preserve_import_batches BEFORE DELETE ON import_batches BEGIN
  SELECT RAISE(ABORT, 'Void import batches instead of deleting them');
END;
CREATE TRIGGER preserve_original_transactions BEFORE DELETE ON transactions BEGIN
  SELECT RAISE(ABORT, 'Void transactions instead of deleting originals');
END;
CREATE TRIGGER preserve_original_fields BEFORE UPDATE OF
  entity_id, account_id, import_batch_id, transaction_date, amount_minor, description,
  source_row, source_json, row_fingerprint ON transactions BEGIN
  SELECT RAISE(ABORT, 'Original transaction fields are immutable');
END;
CREATE TRIGGER preserve_history_update BEFORE UPDATE ON edit_history BEGIN
  SELECT RAISE(ABORT, 'Edit history is append-only');
END;
CREATE TRIGGER preserve_history_delete BEFORE DELETE ON edit_history BEGIN
  SELECT RAISE(ABORT, 'Edit history is append-only');
END;
CREATE TRIGGER require_initial_draft BEFORE INSERT ON transactions
WHEN NEW.allocation_state != 'draft' BEGIN
  SELECT RAISE(ABORT, 'Allocate a draft transaction before finalizing');
END;
CREATE TRIGGER require_balanced_allocations BEFORE UPDATE OF allocation_state ON transactions
WHEN NEW.allocation_state = 'balanced' AND (
  NOT EXISTS (SELECT 1 FROM allocations WHERE transaction_id = NEW.id) OR
  (SELECT coalesce(sum(amount_minor), 0) FROM allocations WHERE transaction_id = NEW.id) != NEW.amount_minor
) BEGIN
  SELECT RAISE(ABORT, 'Allocations must equal the original transaction amount');
END;
CREATE TRIGGER allocations_insert_draft BEFORE INSERT ON allocations
WHEN (SELECT allocation_state FROM transactions WHERE id = NEW.transaction_id) != 'draft' BEGIN
  SELECT RAISE(ABORT, 'Reopen allocation draft before editing');
END;
CREATE TRIGGER allocations_update_draft BEFORE UPDATE ON allocations
WHEN (SELECT allocation_state FROM transactions WHERE id = OLD.transaction_id) != 'draft'
  OR (SELECT allocation_state FROM transactions WHERE id = NEW.transaction_id) != 'draft' BEGIN
  SELECT RAISE(ABORT, 'Reopen allocation draft before editing');
END;
CREATE TRIGGER allocations_delete_draft BEFORE DELETE ON allocations
WHEN (SELECT allocation_state FROM transactions WHERE id = OLD.transaction_id) != 'draft' BEGIN
  SELECT RAISE(ABORT, 'Reopen allocation draft before editing');
END;
