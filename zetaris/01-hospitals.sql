-- Corvale Health's two hospital databases, reached in place over JDBC with a read-only account.
-- Nothing is copied: every Upstream query against these runs on the hospital's own Postgres.
CREATE DATASOURCE corvale_general DESCRIBE BY "Corvale General pharmacy, Postgres" OPTIONS (
  jdbcdriver "org.postgresql.Driver",
  jdbcurl "jdbc:postgresql://general-db:5432/corvale_general",
  username "zetaris_reader",
  password "${ZETARIS_READER_PASSWORD}",
  fetchsize "1000"
);
REGISTER DATASOURCE TABLES FROM corvale_general;
CREATE DATASOURCE corvale_east DESCRIBE BY "Corvale East pharmacy, Postgres" OPTIONS (
  jdbcdriver "org.postgresql.Driver",
  jdbcurl "jdbc:postgresql://east-db:5432/corvale_east",
  username "zetaris_reader",
  password "${ZETARIS_READER_PASSWORD}",
  fetchsize "1000"
);
REGISTER DATASOURCE TABLES FROM corvale_east;
SHOW DATASOURCE TABLES corvale_general;
SHOW DATASOURCE TABLES corvale_east;
