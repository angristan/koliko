ALTER TABLE passkeys
ADD COLUMN name TEXT NOT NULL DEFAULT 'Existing passkey'
CHECK (length(trim(name)) BETWEEN 1 AND 80);
