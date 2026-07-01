// Maps a QBO REST invoice → job creation payload.
// Covers: customer, invoice_number, ship-to address, and line items from Line[].
// total_bdft and load_count are NOT computed here — fill manually in the platform.
// Custom fields (PURCHASE ORDER, Truck Loads, etc.) are not available via REST — fill manually.

function mapShipAddr(invoice) {
  const addr = invoice.ShipAddr || invoice.BillAddr || {};
  return {
    ship_to_company:   invoice.CustomerRef?.name || '',
    ship_to_attention: '',
    ship_to_street:    addr.Line1 || '',
    ship_to_street2:   addr.Line2 || '',
    ship_to_city:      addr.City  || '',
    ship_to_state:     addr.CountrySubDivisionCode || '',
    ship_to_zip:       addr.PostalCode || '',
  };
}

function mapLineItems(invoiceLines) {
  const items = [];
  let sort = 0;
  for (const line of invoiceLines || []) {
    if (line.DetailType !== 'SalesItemLineDetail') continue;
    const detail   = line.SalesItemLineDetail || {};
    const itemName = detail.ItemRef?.name || '';
    if (!itemName) continue;
    items.push({
      part_id:     null,
      part_number: itemName,
      description: line.Description || itemName,
      quantity:    Number(detail.Qty) || 0,
      dimensions:  '',
      sort_order:  sort++,
    });
  }
  return items;
}

export function mapInvoiceToJob(invoice) {
  return {
    source:         'quickbooks',
    status:         'not_started',
    customer:       invoice.CustomerRef?.name || '',
    invoice_number: invoice.DocNumber        || '',
    ...mapShipAddr(invoice),
    line_items: mapLineItems(invoice.Line),
  };
}
