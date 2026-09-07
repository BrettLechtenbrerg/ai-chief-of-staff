-- Additive reporting support; preserve original category meaning and bound budget windows.
CREATE INDEX receipts_by_transaction ON receipt_references(transaction_id, removed_at);
CREATE INDEX transactions_entity_date ON transactions(entity_id, transaction_date, id);
CREATE TRIGGER preserve_category_identity BEFORE UPDATE OF entity_id, kind ON categories BEGIN
  SELECT RAISE(ABORT, 'Category identity is immutable; reallocate to another category');
END;
CREATE TRIGGER calendar_annual_budget_insert BEFORE INSERT ON budget_lines
WHEN NEW.months = 12 AND substr(NEW.period_start, 6) != '01-01' BEGIN
  SELECT RAISE(ABORT, 'Annual budgets start on January 1');
END;
CREATE TRIGGER calendar_annual_budget_update BEFORE UPDATE OF months, period_start ON budget_lines
WHEN NEW.months = 12 AND substr(NEW.period_start, 6) != '01-01' BEGIN
  SELECT RAISE(ABORT, 'Annual budgets start on January 1');
END;
