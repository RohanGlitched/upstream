#!/bin/sh
# Least privilege: Zetaris connects as zetaris_reader, which can only SELECT.
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<SQL
CREATE ROLE zetaris_reader LOGIN PASSWORD '${ZETARIS_READER_PASSWORD}';
GRANT CONNECT ON DATABASE ${POSTGRES_DB} TO zetaris_reader;
GRANT USAGE ON SCHEMA ${HOSPITAL_SCHEMA} TO zetaris_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA ${HOSPITAL_SCHEMA} TO zetaris_reader;
SQL
