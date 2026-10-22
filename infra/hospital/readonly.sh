#!/bin/sh
# Least privilege: the hospital publishes one read-only reporting view per table in "public"
# (Zetaris lists only the public schema of a Postgres source), and zetaris_reader can SELECT those
# views and nothing else. The tables themselves stay in the hospital's own schema.
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'zetaris_reader') THEN
    CREATE ROLE zetaris_reader LOGIN PASSWORD '${ZETARIS_READER_PASSWORD}';
  END IF;
END
\$\$;
REVOKE ALL ON SCHEMA ${HOSPITAL_SCHEMA} FROM zetaris_reader;
REVOKE ALL ON ALL TABLES IN SCHEMA ${HOSPITAL_SCHEMA} FROM zetaris_reader;
GRANT CONNECT ON DATABASE ${POSTGRES_DB} TO zetaris_reader;
DO \$\$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = '${HOSPITAL_SCHEMA}' LOOP
    EXECUTE format('CREATE OR REPLACE VIEW public.%I WITH (security_barrier) AS SELECT * FROM ${HOSPITAL_SCHEMA}.%I', t.tablename, t.tablename);
    EXECUTE format('GRANT SELECT ON public.%I TO zetaris_reader', t.tablename);
  END LOOP;
END
\$\$;
SQL
