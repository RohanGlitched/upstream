-- Upstream's Unified Semantic Layer: one model over three hospitals and FDA's files, queried in place.
-- Two COMPILE traps on 2.4.3.1, both reported only as "Invalid DDL statement": every table needs a PRIMARY KEY,
-- and tables joined by a FOREIGN KEY must not share a non-key column name (hence est_operations).
-- Foreign keys generate the data-quality rules Upstream reports instead of guessing:
--   stock_<hospital>.ndc11 -> product.ndc11    (a stock row whose NDC FDA does not list)
--   product_site.est_duns -> site.duns         (a plant on a label that is not in FDA's registration file)
--   inspection.fei -> site_fei.fei             (an inspection of a plant we cannot place)
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
    spl_set_id varchar(40)
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
    unit varchar(20),
    ndc_match varchar(40)
);

CREATE TABLE stock_east (
    item_key varchar(40) NOT NULL PRIMARY KEY,
    hospital varchar(40) NOT NULL,
    ndc11 varchar(11) NOT NULL FOREIGN KEY REFERENCES product(ndc11),
    ndc_as_recorded varchar(20),
    description varchar(400),
    on_hand decimal(14,2),
    daily_use decimal(14,3),
    unit varchar(20),
    ndc_match varchar(40)
);

CREATE TABLE stock_lakeside (
    item_key varchar(40) NOT NULL PRIMARY KEY,
    hospital varchar(40) NOT NULL,
    ndc11 varchar(11) NOT NULL FOREIGN KEY REFERENCES product(ndc11),
    ndc_as_recorded varchar(20),
    description varchar(400),
    on_hand decimal(14,2),
    daily_use decimal(14,3),
    unit varchar(20),
    ndc_match varchar(40)
);
-- @end

UPDATE USL lightning.metastore.upstream.upstream_usl SET DESCRIPTION 'Upstream: Corvale Health pharmacy stock in three systems, joined in place to FDA product, plant, registration and inspection records.';

ACTIVATE USL TABLE lightning.metastore.upstream.upstream_usl.product AS
SELECT coalesce(ndc11, '') AS ndc11, coalesce(package_ndc, '') AS package_ndc, product_ndc, generic_name, brand_name, labeler_name, dosage_form, route, spl_set_id
FROM (SELECT *, row_number() OVER (PARTITION BY ndc11 ORDER BY marketing_end_date) AS rn FROM fda.ndc_packages WHERE ndc11 <> '') t
WHERE rn = 1;

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
       coalesce(trim(ndc11), '') AS ndc11, ndc11 AS ndc_as_recorded, generic_name AS description,
       CAST(on_hand AS DECIMAL(14,2)) AS on_hand, CAST(daily_use AS DECIMAL(14,3)) AS daily_use,
       unit_of_use AS unit, '11-digit as recorded' AS ndc_match
FROM corvale_general.stock_position;

ACTIVATE USL TABLE lightning.metastore.upstream.upstream_usl.stock_east AS
SELECT coalesce(concat('EA-', id), '') AS item_key, 'Corvale East' AS hospital,
       coalesce(CASE
           WHEN trim(coalesce(pkg_ndc, '')) RLIKE '^[0-9]{4}-[0-9]{4}-[0-9]{2}$' THEN concat('0', replace(trim(coalesce(pkg_ndc, '')), '-', ''))
           WHEN trim(coalesce(pkg_ndc, '')) RLIKE '^[0-9]{5}-[0-9]{3}-[0-9]{2}$' THEN concat(substr(trim(coalesce(pkg_ndc, '')), 1, 5), '0', substr(trim(coalesce(pkg_ndc, '')), 7, 3), substr(trim(coalesce(pkg_ndc, '')), 11, 2))
           WHEN trim(coalesce(pkg_ndc, '')) RLIKE '^[0-9]{5}-[0-9]{4}-[0-9]{1}$' THEN concat(substr(trim(coalesce(pkg_ndc, '')), 1, 5), substr(trim(coalesce(pkg_ndc, '')), 7, 4), '0', substr(trim(coalesce(pkg_ndc, '')), 12, 1))
           WHEN trim(coalesce(pkg_ndc, '')) RLIKE '^[0-9]{11}$' THEN trim(coalesce(pkg_ndc, ''))
           WHEN trim(coalesce(pkg_ndc, '')) RLIKE '^[0-9]{10}$' THEN concat('0', trim(coalesce(pkg_ndc, '')))
           ELSE '' END, '') AS ndc11,
       pkg_ndc AS ndc_as_recorded, descr AS description,
       CAST(on_hand_pkgs AS DECIMAL(14,2)) AS on_hand, CAST(daily_use_pkgs AS DECIMAL(14,3)) AS daily_use,
       'package' AS unit, CASE
           WHEN trim(coalesce(pkg_ndc, '')) RLIKE '^[0-9]{4,5}-[0-9]{3,4}-[0-9]{1,2}$' THEN 'dashed 10-digit, converted'
           WHEN trim(coalesce(pkg_ndc, '')) RLIKE '^[0-9]{11}$' THEN '11-digit as recorded'
           WHEN trim(coalesce(pkg_ndc, '')) RLIKE '^[0-9]{10}$' THEN 'repaired: leading zero restored'
           WHEN trim(coalesce(pkg_ndc, '')) = '' THEN 'blank in source'
           ELSE 'unrecognised format' END AS ndc_match
FROM corvale_east.stock_position;

ACTIVATE USL TABLE lightning.metastore.upstream.upstream_usl.stock_lakeside AS
SELECT coalesce(concat('LS-', c.MedID), '') AS item_key, 'Corvale Lakeside' AS hospital,
       coalesce(CASE
           WHEN trim(coalesce(c.NDC, '')) RLIKE '^[0-9]{4}-[0-9]{4}-[0-9]{2}$' THEN concat('0', replace(trim(coalesce(c.NDC, '')), '-', ''))
           WHEN trim(coalesce(c.NDC, '')) RLIKE '^[0-9]{5}-[0-9]{3}-[0-9]{2}$' THEN concat(substr(trim(coalesce(c.NDC, '')), 1, 5), '0', substr(trim(coalesce(c.NDC, '')), 7, 3), substr(trim(coalesce(c.NDC, '')), 11, 2))
           WHEN trim(coalesce(c.NDC, '')) RLIKE '^[0-9]{5}-[0-9]{4}-[0-9]{1}$' THEN concat(substr(trim(coalesce(c.NDC, '')), 1, 5), substr(trim(coalesce(c.NDC, '')), 7, 4), '0', substr(trim(coalesce(c.NDC, '')), 12, 1))
           WHEN trim(coalesce(c.NDC, '')) RLIKE '^[0-9]{11}$' THEN trim(coalesce(c.NDC, ''))
           WHEN trim(coalesce(c.NDC, '')) RLIKE '^[0-9]{10}$' THEN concat('0', trim(coalesce(c.NDC, '')))
           ELSE '' END, '') AS ndc11,
       c.NDC AS ndc_as_recorded, c.MedDescription AS description,
       CAST(c.Qty AS DECIMAL(14,2)) AS on_hand, CAST(CAST(u.Units30d AS DOUBLE) / 30.0 AS DECIMAL(14,3)) AS daily_use,
       c.Unit AS unit, CASE
           WHEN trim(coalesce(c.NDC, '')) RLIKE '^[0-9]{4,5}-[0-9]{3,4}-[0-9]{1,2}$' THEN 'dashed 10-digit, converted'
           WHEN trim(coalesce(c.NDC, '')) RLIKE '^[0-9]{11}$' THEN '11-digit as recorded'
           WHEN trim(coalesce(c.NDC, '')) RLIKE '^[0-9]{10}$' THEN 'repaired: leading zero restored'
           WHEN trim(coalesce(c.NDC, '')) = '' THEN 'blank in source'
           ELSE 'unrecognised format' END AS ndc_match
FROM corvale_lakeside.cabinet c
JOIN corvale_lakeside.usage_30d u ON u.MedID = c.MedID;

RUN DQ TABLE lightning.metastore.upstream.upstream_usl.stock_general;
RUN DQ TABLE lightning.metastore.upstream.upstream_usl.stock_east;
RUN DQ TABLE lightning.metastore.upstream.upstream_usl.stock_lakeside;
