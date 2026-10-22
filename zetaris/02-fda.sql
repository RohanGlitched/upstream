-- FDA's public drug data. Not read in place: data/fda/build_bundle.py downloads openFDA, DailyMed and the Data Dashboard
-- files once and cleans them into CSVs (deriving ndc11, firm_key, fei_match and known_date), which Zetaris reads as file tables.
-- One folder per table under the query engine's shared file root (infra/zetaris/stage-files.sh).
CREATE LIGHTNING DATABASE fda DESCRIBE BY "FDA public drug data, cleaned CSV file tables";
CREATE LIGHTNING FILESTORE TABLE ndc_packages FROM fda FORMAT CSV OPTIONS (path "/home/zetaris/customer-data/shared/upstream/fda/ndc_packages", header "true", inferSchema "false", multiLine "true", escape "\"");
CREATE LIGHTNING FILESTORE TABLE spl_establishments FROM fda FORMAT CSV OPTIONS (path "/home/zetaris/customer-data/shared/upstream/fda/spl_establishments", header "true", inferSchema "false", multiLine "true", escape "\"");
CREATE LIGHTNING FILESTORE TABLE registrations FROM fda FORMAT CSV OPTIONS (path "/home/zetaris/customer-data/shared/upstream/fda/registrations", header "true", inferSchema "false", multiLine "true", escape "\"");
CREATE LIGHTNING FILESTORE TABLE inspections FROM fda FORMAT CSV OPTIONS (path "/home/zetaris/customer-data/shared/upstream/fda/inspections", header "true", inferSchema "false", multiLine "true", escape "\"");
CREATE LIGHTNING FILESTORE TABLE citations FROM fda FORMAT CSV OPTIONS (path "/home/zetaris/customer-data/shared/upstream/fda/citations", header "true", inferSchema "false", multiLine "true", escape "\"");
CREATE LIGHTNING FILESTORE TABLE compliance_actions FROM fda FORMAT CSV OPTIONS (path "/home/zetaris/customer-data/shared/upstream/fda/compliance_actions", header "true", inferSchema "false", multiLine "true", escape "\"");
CREATE LIGHTNING FILESTORE TABLE import_alerts FROM fda FORMAT CSV OPTIONS (path "/home/zetaris/customer-data/shared/upstream/fda/import_alerts", header "true", inferSchema "false", multiLine "true", escape "\"");
CREATE LIGHTNING FILESTORE TABLE recalls FROM fda FORMAT CSV OPTIONS (path "/home/zetaris/customer-data/shared/upstream/fda/recalls", header "true", inferSchema "false", multiLine "true", escape "\"");
CREATE LIGHTNING FILESTORE TABLE shortage_presentations FROM fda FORMAT CSV OPTIONS (path "/home/zetaris/customer-data/shared/upstream/fda/shortage_presentations", header "true", inferSchema "false", multiLine "true", escape "\"");
CREATE LIGHTNING FILESTORE TABLE shortage_episodes FROM fda FORMAT CSV OPTIONS (path "/home/zetaris/customer-data/shared/upstream/fda/shortage_episodes", header "true", inferSchema "false", multiLine "true", escape "\"");
CREATE LIGHTNING FILESTORE TABLE shortage_current FROM fda FORMAT CSV OPTIONS (path "/home/zetaris/customer-data/shared/upstream/fda/shortage_current", header "true", inferSchema "false", multiLine "true", escape "\"");
CREATE LIGHTNING FILESTORE TABLE dmf_api FROM fda FORMAT CSV OPTIONS (path "/home/zetaris/customer-data/shared/upstream/fda/dmf_api", header "true", inferSchema "false", multiLine "true", escape "\"");
