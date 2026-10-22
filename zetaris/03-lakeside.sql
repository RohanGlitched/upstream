-- Corvale Lakeside has no database: its dispensing cabinets export CSV files nightly to object storage.
-- Zetaris reads the exports where they land.
CREATE LIGHTNING DATABASE corvale_lakeside DESCRIBE BY "Corvale Lakeside cabinet exports, CSV";
CREATE LIGHTNING FILESTORE TABLE cabinet FROM corvale_lakeside FORMAT CSV OPTIONS (path "/home/zetaris/customer-data/shared/upstream/corvale-lakeside-exports/cabinet", header "true", inferSchema "false");
CREATE LIGHTNING FILESTORE TABLE usage_30d FROM corvale_lakeside FORMAT CSV OPTIONS (path "/home/zetaris/customer-data/shared/upstream/corvale-lakeside-exports/usage", header "true", inferSchema "false");
