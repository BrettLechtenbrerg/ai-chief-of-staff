-- Precision is part of an account's immutable currency identity.
CREATE TRIGGER preserve_account_precision BEFORE UPDATE OF minor_digits ON accounts BEGIN
  SELECT RAISE(ABORT, 'Account currency precision is immutable');
END;
CREATE TRIGGER consistent_entity_currency_precision BEFORE INSERT ON accounts
WHEN EXISTS (
  SELECT 1 FROM accounts WHERE entity_id = NEW.entity_id AND currency = NEW.currency AND minor_digits != NEW.minor_digits
) BEGIN
  SELECT RAISE(ABORT, 'Currency precision must match accounts in this entity');
END;
