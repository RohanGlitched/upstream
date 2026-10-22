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

# The pharmacy's own stock-position report: on hand and 28-day average use, computed in this database.
if [ "$HOSPITAL_SCHEMA" = "cg" ]; then
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
CREATE OR REPLACE VIEW public.stock_position WITH (security_barrier) AS
SELECT f.item_id, f.ndc11, f.generic_name, f.strength, f.unit_of_use,
       inv.on_hand, coalesce(u.units_28d, 0) / 28.0 AS daily_use
FROM cg.formulary_item f
JOIN (SELECT item_id, sum(qty_units) AS on_hand FROM cg.inventory_snapshot GROUP BY item_id) inv USING (item_id)
LEFT JOIN (SELECT item_id, sum(units) AS units_28d FROM cg.dispense_daily
           WHERE day > DATE '2026-10-21' - 28 GROUP BY item_id) u USING (item_id);
GRANT SELECT ON public.stock_position TO zetaris_reader;
SQL
else
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
CREATE OR REPLACE VIEW public.stock_position WITH (security_barrier) AS
SELECT i.id, i.pkg_ndc, i.descr, i.pkg_size, i.uom,
       s.on_hand_pkgs, coalesce(w.pkgs_28d, 0) / 28.0 AS daily_use_pkgs
FROM east.items i
JOIN east.stock s USING (id)
LEFT JOIN (SELECT id, sum(pkgs_used) AS pkgs_28d FROM east.usage_weekly
           WHERE week_start > DATE '2026-10-21' - 28 GROUP BY id) w USING (id);
GRANT SELECT ON public.stock_position TO zetaris_reader;
SQL
fi
