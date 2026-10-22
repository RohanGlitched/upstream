-- Upstream's Unified Semantic Layer: one model over three hospitals and FDA's files. The hospitals are read in place;
-- FDA's public files are cleaned once into CSVs (data/fda/build_bundle.py) that Zetaris reads as file tables.
-- Two COMPILE traps on 2.4.3.1, both reported only as "Invalid DDL statement": every table needs a PRIMARY KEY,
-- and tables joined by a FOREIGN KEY must not share a non-key column name (hence est_operations, pkg_units).
-- COMPILE ... IF NOT EXISTS keeps an older model: to change it, REMOVE USL upstream_usl NAMESPACE lightning.metastore.upstream first.
-- Foreign keys generate the data-quality rules Upstream reports instead of guessing:
--   stock_<hospital>.ndc11 -> product.ndc11    (a stock row whose NDC FDA does not list)
--   stock_<hospital>.unit -> unit_of_use.unit  (a stock row counted in a unit no other hospital uses)
--   product_site.est_duns -> site.duns         (a plant on a label that is not in FDA's registration file)
--   inspection.fei -> site_fei.fei             (an inspection of a plant we cannot place)
-- Units: every stock table is in units of use (vial, tablet, bag). East counts packages, so its activation multiplies
-- by East's own pkg_size; General's snapshot carries part-used vials as fractions, so only whole units count.
-- NDC repair: an undashed 10-digit NDC can be read three ways (4-4-2, 5-3-2, 5-4-1). Each reading is looked up in
-- FDA's NDC file; only a single hit is accepted, and two or more is marked ambiguous and left for the DQ rule.
CREATE NAMESPACE IF NOT EXISTS lightning.metastore;
CREATE NAMESPACE IF NOT EXISTS lightning.metastore.upstream;

-- @whole
COMPILE USL IF NOT EXISTS upstream_usl DEPLOY NAMESPACE lightning.metastore.upstream DDL
CREATE TABLE product (
    ndc11 varchar(11) NOT NULL PRIMARY KEY,
    package_ndc varchar(14) NOT NULL,
    product_ndc varchar(12),
    generic_name varchar(400),
    brand_name varchar(400),
    labeler_name varchar(200),
    dosage_form varchar(120),
    route varchar(200),
    spl_set_id varchar(40),
    strength varchar(400),
    units_per_pkg decimal(14,2),
    pkg_unit varchar(40),
    unit_content varchar(40)
);

CREATE TABLE unit_of_use (
    unit varchar(20) NOT NULL PRIMARY KEY,
    unit_kind varchar(40)
);

CREATE TABLE site (
    duns varchar(9) NOT NULL PRIMARY KEY,
    fei varchar(12),
    firm_name varchar(200),
    country_iso3 varchar(3),
    address varchar(400),
    operations varchar(400)
);

CREATE TABLE site_fei (
    fei varchar(12) NOT NULL PRIMARY KEY,
    firm_name varchar(200),
    country_iso3 varchar(3)
);

CREATE TABLE product_site (
    link_id varchar(60) NOT NULL PRIMARY KEY,
    set_id varchar(40) NOT NULL,
    est_duns varchar(9) FOREIGN KEY REFERENCES site(duns),
    establishment varchar(200),
    est_operations varchar(200),
    site_source varchar(40)
);

CREATE TABLE inspection (
    inspection_id varchar(12) NOT NULL PRIMARY KEY,
    fei varchar(12) NOT NULL FOREIGN KEY REFERENCES site_fei(fei),
    legal_name varchar(200),
    country varchar(80),
    end_date varchar(10),
    classification varchar(4),
    known_date varchar(10),
    known_date_basis varchar(30)
);

CREATE TABLE stock_general (
    item_key varchar(40) NOT NULL PRIMARY KEY,
    hospital varchar(40) NOT NULL,
    ndc11 varchar(11) NOT NULL FOREIGN KEY REFERENCES product(ndc11),
    ndc_as_recorded varchar(20),
    description varchar(400),
    on_hand decimal(14,2),
    daily_use decimal(14,3),
    unit varchar(20) NOT NULL FOREIGN KEY REFERENCES unit_of_use(unit),
    pkg_units decimal(14,2),
    unit_basis varchar(80),
    ndc_match varchar(80)
);

CREATE TABLE stock_east (
    item_key varchar(40) NOT NULL PRIMARY KEY,
    hospital varchar(40) NOT NULL,
    ndc11 varchar(11) NOT NULL FOREIGN KEY REFERENCES product(ndc11),
    ndc_as_recorded varchar(20),
    description varchar(400),
    on_hand decimal(14,2),
    daily_use decimal(14,3),
    unit varchar(20) NOT NULL FOREIGN KEY REFERENCES unit_of_use(unit),
    pkg_units decimal(14,2),
    unit_basis varchar(80),
    ndc_match varchar(80)
);

CREATE TABLE stock_lakeside (
    item_key varchar(40) NOT NULL PRIMARY KEY,
    hospital varchar(40) NOT NULL,
    ndc11 varchar(11) NOT NULL FOREIGN KEY REFERENCES product(ndc11),
    ndc_as_recorded varchar(20),
    description varchar(400),
    on_hand decimal(14,2),
    daily_use decimal(14,3),
    unit varchar(20) NOT NULL FOREIGN KEY REFERENCES unit_of_use(unit),
    pkg_units decimal(14,2),
    unit_basis varchar(80),
    ndc_match varchar(80)
);
-- @end

UPDATE USL lightning.metastore.upstream.upstream_usl SET DESCRIPTION 'Upstream - Corvale Health pharmacy stock in three systems, in units of use, joined to FDA product, plant, registration and inspection records.';

ACTIVATE USL TABLE lightning.metastore.upstream.upstream_usl.product AS
SELECT coalesce(ndc11, '') AS ndc11, coalesce(package_ndc, '') AS package_ndc, product_ndc, generic_name, brand_name, labeler_name, dosage_form, route, spl_set_id,
       strength,
       CAST(CASE WHEN first_n = '' OR lower(first_u) IN ('ml', 'l', 'g', 'mg', 'mcg', 'kg', 'oz', 'meq', 'unit', 'units') THEN 1 ELSE CAST(first_n AS DOUBLE) END AS DECIMAL(14,2)) AS units_per_pkg,
       lower(CASE WHEN first_n = '' OR lower(first_u) IN ('ml', 'l', 'g', 'mg', 'mcg', 'kg', 'oz', 'meq', 'unit', 'units') THEN regexp_extract(outer_seg, ' in 1 ([A-Za-z]+)', 1) ELSE first_u END) AS pkg_unit,
       nullif(regexp_extract(package_description, '([0-9.]+ (mL|L|g|mg)) in 1 ', 1), '') AS unit_content
FROM (SELECT *, row_number() OVER (PARTITION BY ndc11 ORDER BY marketing_end_date) AS rn,
             split(package_description, ' / ')[0] AS outer_seg,
             regexp_extract(split(package_description, ' / ')[0], '^ *([0-9.]+) +([A-Za-z]+)', 1) AS first_n,
             regexp_extract(split(package_description, ' / ')[0], '^ *([0-9.]+) +([A-Za-z]+)', 2) AS first_u
      FROM fda.ndc_packages WHERE ndc11 <> '') t
WHERE rn = 1;

ACTIVATE USL TABLE lightning.metastore.upstream.upstream_usl.unit_of_use AS
SELECT unit, unit_kind FROM VALUES ('vial', 'container'), ('bag', 'container'), ('syringe', 'container'), ('tablet', 'solid dose'), ('capsule', 'solid dose'), ('each', 'count') AS v(unit, unit_kind);

ACTIVATE USL TABLE lightning.metastore.upstream.upstream_usl.site AS
SELECT coalesce(duns, '') AS duns, fei, firm_name, country_iso3, address, operations FROM fda.registrations;

ACTIVATE USL TABLE lightning.metastore.upstream.upstream_usl.site_fei AS
SELECT coalesce(fei, '') AS fei, max(firm_name) AS firm_name, max(country_iso3) AS country_iso3 FROM fda.registrations WHERE fei <> '' GROUP BY fei;

ACTIVATE USL TABLE lightning.metastore.upstream.upstream_usl.product_site AS
SELECT coalesce(concat(set_id, '#', row_number() OVER (PARTITION BY set_id ORDER BY establishment, est_duns)), '') AS link_id,
       coalesce(set_id, '') AS set_id, nullif(est_duns, '') AS est_duns, establishment, operations AS est_operations, source AS site_source
FROM fda.spl_establishments WHERE establishment IS NOT NULL;

ACTIVATE USL TABLE lightning.metastore.upstream.upstream_usl.inspection AS
SELECT coalesce(inspection_id, '') AS inspection_id, coalesce(fei, '') AS fei, legal_name, country, end_date, classification, known_date, known_date_basis FROM fda.inspections;

ACTIVATE USL TABLE lightning.metastore.upstream.upstream_usl.stock_general AS
SELECT coalesce(concat('CG-', item_id), '') AS item_key, 'Corvale General' AS hospital,
       coalesce(trim(ndc11), '') AS ndc11, ndc11 AS ndc_as_recorded, concat_ws(' ', generic_name, strength) AS description,
       CAST(floor(on_hand) AS DECIMAL(14,2)) AS on_hand, CAST(daily_use AS DECIMAL(14,3)) AS daily_use,
       coalesce(lower(trim(unit_of_use)), '') AS unit, CAST(1 AS DECIMAL(14,2)) AS pkg_units, 'units of use, whole units only' AS unit_basis,
       '11-digit as recorded' AS ndc_match
FROM corvale_general.stock_position;

ACTIVATE USL TABLE lightning.metastore.upstream.upstream_usl.stock_east AS
SELECT coalesce(concat('EA-', x.id), '') AS item_key, 'Corvale East' AS hospital,
       coalesce(CASE
           WHEN x.raw RLIKE '^[0-9]{4}-[0-9]{4}-[0-9]{2}$' THEN concat('0', replace(x.raw, '-', ''))
           WHEN x.raw RLIKE '^[0-9]{5}-[0-9]{3}-[0-9]{2}$' THEN concat(substr(x.raw, 1, 5), '0', substr(x.raw, 7, 3), substr(x.raw, 11, 2))
           WHEN x.raw RLIKE '^[0-9]{5}-[0-9]{4}-[0-9]{1}$' THEN concat(substr(x.raw, 1, 5), substr(x.raw, 7, 4), '0', substr(x.raw, 12, 1))
           WHEN x.raw RLIKE '^[0-9]{11}$' THEN x.raw
           WHEN x.raw RLIKE '^[0-9]{10}$' AND x.hits = 1 THEN coalesce(x.k442, x.k532, x.k541)
           ELSE '' END, '') AS ndc11,
       x.pkg_ndc AS ndc_as_recorded, x.descr AS description,
       CAST(round(x.on_hand_pkgs * coalesce(x.pkg_size, 1), 0) AS DECIMAL(14,2)) AS on_hand,
       CAST(x.daily_use_pkgs * coalesce(x.pkg_size, 1) AS DECIMAL(14,3)) AS daily_use,
       coalesce(lower(trim(x.uom)), '') AS unit, CAST(coalesce(x.pkg_size, 1) AS DECIMAL(14,2)) AS pkg_units,
       concat('packages of ', coalesce(x.pkg_size, 1), ', converted to units') AS unit_basis,
       CASE
           WHEN x.raw RLIKE '^[0-9]{4,5}-[0-9]{3,4}-[0-9]{1,2}$' THEN 'dashed 10-digit, converted'
           WHEN x.raw RLIKE '^[0-9]{11}$' THEN '11-digit as recorded'
           WHEN x.raw RLIKE '^[0-9]{10}$' AND x.hits = 1 THEN concat('repaired: undashed, only the ', CASE WHEN x.k442 IS NOT NULL THEN '4-4-2' WHEN x.k532 IS NOT NULL THEN '5-3-2' ELSE '5-4-1' END, ' reading is in FDA')
           WHEN x.raw RLIKE '^[0-9]{10}$' AND x.hits = 0 THEN 'undashed, no reading is in FDA'
           WHEN x.raw RLIKE '^[0-9]{10}$' THEN concat('ambiguous: undashed, ', x.hits, ' readings are in FDA')
           WHEN x.raw = '' THEN 'blank in source'
           ELSE 'unrecognised format' END AS ndc_match
FROM (SELECT r.*, a.k AS k442, b.k AS k532, d.k AS k541,
             CASE WHEN a.k IS NULL THEN 0 ELSE 1 END + CASE WHEN b.k IS NULL THEN 0 ELSE 1 END + CASE WHEN d.k IS NULL THEN 0 ELSE 1 END AS hits
      FROM (SELECT e.*, trim(coalesce(e.pkg_ndc, '')) AS raw FROM corvale_east.stock_position e) r
      LEFT JOIN (SELECT DISTINCT ndc11 AS k FROM fda.ndc_packages) a ON r.raw RLIKE '^[0-9]{10}$' AND a.k = concat('0', r.raw)
      LEFT JOIN (SELECT DISTINCT ndc11 AS k FROM fda.ndc_packages) b ON r.raw RLIKE '^[0-9]{10}$' AND b.k = concat(substr(r.raw, 1, 5), '0', substr(r.raw, 6, 5))
      LEFT JOIN (SELECT DISTINCT ndc11 AS k FROM fda.ndc_packages) d ON r.raw RLIKE '^[0-9]{10}$' AND d.k = concat(substr(r.raw, 1, 9), '0', substr(r.raw, 10, 1))) x;

ACTIVATE USL TABLE lightning.metastore.upstream.upstream_usl.stock_lakeside AS
SELECT coalesce(concat('LS-', x.MedID), '') AS item_key, 'Corvale Lakeside' AS hospital,
       coalesce(CASE
           WHEN x.raw RLIKE '^[0-9]{4}-[0-9]{4}-[0-9]{2}$' THEN concat('0', replace(x.raw, '-', ''))
           WHEN x.raw RLIKE '^[0-9]{5}-[0-9]{3}-[0-9]{2}$' THEN concat(substr(x.raw, 1, 5), '0', substr(x.raw, 7, 3), substr(x.raw, 11, 2))
           WHEN x.raw RLIKE '^[0-9]{5}-[0-9]{4}-[0-9]{1}$' THEN concat(substr(x.raw, 1, 5), substr(x.raw, 7, 4), '0', substr(x.raw, 12, 1))
           WHEN x.raw RLIKE '^[0-9]{11}$' THEN x.raw
           WHEN x.raw RLIKE '^[0-9]{10}$' AND x.hits = 1 THEN coalesce(x.k442, x.k532, x.k541)
           ELSE '' END, '') AS ndc11,
       x.NDC AS ndc_as_recorded, x.MedDescription AS description,
       CAST(x.Qty AS DECIMAL(14,2)) AS on_hand, CAST(CAST(x.Units30d AS DOUBLE) / 30.0 AS DECIMAL(14,3)) AS daily_use,
       coalesce(lower(trim(x.Unit)), '') AS unit, CAST(1 AS DECIMAL(14,2)) AS pkg_units, 'units of use, as exported' AS unit_basis,
       CASE
           WHEN x.raw RLIKE '^[0-9]{4,5}-[0-9]{3,4}-[0-9]{1,2}$' THEN 'dashed 10-digit, converted'
           WHEN x.raw RLIKE '^[0-9]{11}$' THEN '11-digit as recorded'
           WHEN x.raw RLIKE '^[0-9]{10}$' AND x.hits = 1 THEN concat('repaired: undashed, only the ', CASE WHEN x.k442 IS NOT NULL THEN '4-4-2' WHEN x.k532 IS NOT NULL THEN '5-3-2' ELSE '5-4-1' END, ' reading is in FDA')
           WHEN x.raw RLIKE '^[0-9]{10}$' AND x.hits = 0 THEN 'undashed, no reading is in FDA'
           WHEN x.raw RLIKE '^[0-9]{10}$' THEN concat('ambiguous: undashed, ', x.hits, ' readings are in FDA')
           WHEN x.raw = '' THEN 'blank in source'
           ELSE 'unrecognised format' END AS ndc_match
FROM (SELECT r.*, a.k AS k442, b.k AS k532, d.k AS k541,
             CASE WHEN a.k IS NULL THEN 0 ELSE 1 END + CASE WHEN b.k IS NULL THEN 0 ELSE 1 END + CASE WHEN d.k IS NULL THEN 0 ELSE 1 END AS hits
      FROM (SELECT c.MedID, c.NDC, c.MedDescription, c.Qty, c.Unit, u.Units30d, trim(coalesce(c.NDC, '')) AS raw FROM corvale_lakeside.cabinet c JOIN corvale_lakeside.usage_30d u ON u.MedID = c.MedID) r
      LEFT JOIN (SELECT DISTINCT ndc11 AS k FROM fda.ndc_packages) a ON r.raw RLIKE '^[0-9]{10}$' AND a.k = concat('0', r.raw)
      LEFT JOIN (SELECT DISTINCT ndc11 AS k FROM fda.ndc_packages) b ON r.raw RLIKE '^[0-9]{10}$' AND b.k = concat(substr(r.raw, 1, 5), '0', substr(r.raw, 6, 5))
      LEFT JOIN (SELECT DISTINCT ndc11 AS k FROM fda.ndc_packages) d ON r.raw RLIKE '^[0-9]{10}$' AND d.k = concat(substr(r.raw, 1, 9), '0', substr(r.raw, 10, 1))) x;

RUN DQ TABLE lightning.metastore.upstream.upstream_usl.stock_general;
RUN DQ TABLE lightning.metastore.upstream.upstream_usl.stock_east;
RUN DQ TABLE lightning.metastore.upstream.upstream_usl.stock_lakeside;
RUN DQ TABLE lightning.metastore.upstream.upstream_usl.product_site;
RUN DQ TABLE lightning.metastore.upstream.upstream_usl.inspection;
