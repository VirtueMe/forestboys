-- #14: more than one sign-in provider. Ids become `<provider>:<id>`
-- (`google:<sub>`, `github:<id>`); one account per email stays enforced by
-- the UNIQUE email from 0001. There were no Google users when this ran, so
-- no id is rewritten.
ALTER TABLE users ADD COLUMN provider TEXT;
