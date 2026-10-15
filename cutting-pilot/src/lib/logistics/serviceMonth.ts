// src/lib/logistics/serviceMonth.ts
// inv-month-01: single source of truth for which month a freight invoice belongs to. An invoice is
// filed whole under the month most of its lines SHIPPED (ties → later month), falling back to the
// invoice date's month when no line has a ship date. Carriers invoice late, so invoice_date is not
// the service month. Prefix a query with this CTE and select FROM `invoice_lines` instead of
// `freight_invoice_lines`; `service_month` is 'YYYY-MM'.
export const SERVICE_MONTH_CTE = `WITH inv_month AS (
  SELECT invoice_number, month FROM (
    SELECT invoice_number, substr(ship_date, 1, 7) AS month,
           ROW_NUMBER() OVER (
             PARTITION BY invoice_number
             ORDER BY COUNT(*) DESC, substr(ship_date, 1, 7) DESC
           ) AS rk
    FROM freight_invoice_lines
    WHERE ship_date IS NOT NULL AND ship_date <> ''
    GROUP BY invoice_number, substr(ship_date, 1, 7)
  ) WHERE rk = 1
),
invoice_lines AS (
  SELECT l.*, COALESCE(m.month, substr(l.invoice_date, 1, 7)) AS service_month
  FROM freight_invoice_lines l
  LEFT JOIN inv_month m ON m.invoice_number = l.invoice_number
)
`;
