-- Idempotenta schemaändringar som appliceras av db-migrate-workflown
-- (körs via Supabase Management API med repo-hemligheten SUPABASE_ACCESS_TOKEN).

-- Sjukdagar: dagen räknas inte mot målen och streaken pausas utan att brytas
alter table public.entries add column if not exists sick boolean;

-- Kvitto i workflow-loggen på att kolumnen finns
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'entries' and column_name = 'sick';
