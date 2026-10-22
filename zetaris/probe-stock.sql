-- Probe: days of stock for one molecule across all three Corvale hospitals, in one federated statement.
WITH general AS (
  SELECT 'Corvale General' AS hospital, f.ndc11, f.generic_name AS description,
         inv.on_hand, use.daily
  FROM corvale_general.formulary_item f
  JOIN (SELECT item_id, sum(qty_units) AS on_hand FROM corvale_general.inventory_snapshot GROUP BY item_id) inv ON inv.item_id = f.item_id
  JOIN (SELECT item_id, sum(units) / 28.0 AS daily FROM corvale_general.dispense_daily
        WHERE day > date_sub(DATE '2026-10-21', 28) GROUP BY item_id) use ON use.item_id = f.item_id
),
east AS (
  SELECT 'Corvale East' AS hospital, p.ndc11, i.descr AS description,
         s.on_hand_pkgs AS on_hand, u.pkgs / 28.0 AS daily
  FROM corvale_east.items i
  JOIN corvale_east.stock s ON s.id = i.id
  JOIN (SELECT id, sum(pkgs_used) AS pkgs FROM corvale_east.usage_weekly WHERE week_start > date_sub(DATE '2026-10-21', 28) GROUP BY id) u ON u.id = i.id
  LEFT JOIN fda.ndc_packages p ON p.package_ndc = i.pkg_ndc
),
lakeside AS (
  SELECT 'Corvale Lakeside' AS hospital, p.ndc11, c.MedDescription AS description,
         CAST(c.Qty AS DOUBLE) AS on_hand, CAST(u.Units30d AS DOUBLE) / 30.0 AS daily
  FROM corvale_lakeside.cabinet c
  JOIN corvale_lakeside.usage_30d u ON u.MedID = c.MedID
  LEFT JOIN fda.ndc_packages p
    ON p.package_ndc = c.NDC OR p.ndc11 = c.NDC OR p.ndc11 = concat('0', c.NDC)
)
SELECT hospital, ndc11, description, round(on_hand, 0) AS on_hand, round(daily, 1) AS daily_use,
       round(on_hand / nullif(daily, 0), 1) AS days_on_hand
FROM (SELECT * FROM general UNION ALL SELECT * FROM east UNION ALL SELECT * FROM lakeside) s
WHERE lower(description) LIKE '%carboplatin%'
ORDER BY hospital, ndc11
