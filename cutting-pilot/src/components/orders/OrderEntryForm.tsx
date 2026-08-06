"use client";
// src/components/orders/OrderEntryForm.tsx
// Manual order-entry form for /v2/orders. Single-column, section by section, posts to the
// P338 contract at POST /v2/api/orders. A packing-slip dropzone (P340) parses a PDF client-side
// and prefills form state — parsing failures never block manual entry.
import { useRef, useState } from "react";
import { FileUp, Plus, Trash2 } from "lucide-react";
import PlatformHeader from "@/components/PlatformHeader";
import { parsePackingSlip } from "@/lib/packingSlip";

export interface OrderLineItem {
  part_number: string;
  description: string;
  quantity: string;
  dimensions: string;
  density: string;
}

export interface OrderPayload {
  customer: string;
  po_number: string;
  invoice_number: string;
  ship_to_company: string;
  ship_to_attention: string;
  ship_to_street: string;
  ship_to_city: string;
  ship_to_state: string;
  ship_to_zip: string;
  method: string;
  carrier: string;
  ship_date: string;
  load_count: number;
  total_bdft: number;
  cutting_instructions: string;
  packing_instructions: string;
  notes: string;
  packing_slip_filename?: string;
  packing_slip_invoice?: string;
  line_items: Array<{
    part_number: string;
    description: string;
    quantity: number;
    dimensions: string;
    density: string;
  }>;
}

const EMPTY_LINE: OrderLineItem = { part_number: "", description: "", quantity: "", dimensions: "", density: "" };

// Board-foot per piece = (L × W × H) / 144 (inches). Ported from jobs/index.html's
// liBdftPerPiece — same "L x W x H" free-text convention, fractions included. Returns null
// (contributes 0 to the total) when the dimensions string doesn't parse to three positive numbers.
function bdftPerPiece(dimStr: string): number | null {
  if (!dimStr) return null;
  const parts = dimStr.replace(/[“”„‟""]/g, '"').split(/\s*[x×X]\s*/i);
  if (parts.length < 3) return null;
  const num = (s: string): number | null => {
    const t = s.replace(/["'\s]/g, "").trim();
    let m = t.match(/^(\d+)-(\d+)\/(\d+)$/);
    if (m) return Number(m[1]) + Number(m[2]) / Number(m[3]);
    m = t.match(/^(\d+)\/(\d+)$/);
    if (m) return Number(m[1]) / Number(m[2]);
    const n = parseFloat(t);
    return isNaN(n) ? null : n;
  };
  const L = num(parts[0]), W = num(parts[1]), H = num(parts[2]);
  if ([L, W, H].some((v) => v == null || v <= 0)) return null;
  return ((L as number) * (W as number) * (H as number)) / 144;
}

function computeTotalBdft(items: OrderLineItem[]): number {
  let total = 0;
  for (const li of items) {
    const bpp = bdftPerPiece(li.dimensions);
    const qty = parseFloat(li.quantity);
    if (bpp != null && Number.isFinite(qty) && qty > 0) total += bpp * qty;
  }
  return Math.round(total * 100) / 100;
}

const inputClass =
  "w-full min-h-[44px] rounded-md border border-[var(--input-border)] bg-[var(--input-bg)] text-text text-sm px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]";
const labelClass = "block text-xs font-semibold text-muted mb-1";

interface Field {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
}

function TextField({ label, value, onChange, placeholder, required }: Field) {
  return (
    <label className="block">
      <span className={labelClass}>
        {label}
        {required ? " *" : ""}
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        className={inputClass}
      />
    </label>
  );
}

interface OrderEntryFormProps {
  userName: string;
  isAdmin: boolean;
  permissions: Record<string, { view?: boolean; edit?: boolean }>;
}

export default function OrderEntryForm({ userName, isAdmin, permissions }: OrderEntryFormProps) {
  const [customer, setCustomer] = useState("");
  const [poNumber, setPoNumber] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");

  const [shipToCompany, setShipToCompany] = useState("");
  const [shipToAttention, setShipToAttention] = useState("");
  const [shipToStreet, setShipToStreet] = useState("");
  const [shipToCity, setShipToCity] = useState("");
  const [shipToState, setShipToState] = useState("");
  const [shipToZip, setShipToZip] = useState("");

  const [shipDate, setShipDate] = useState("");
  const [method, setMethod] = useState("");
  const [carrier, setCarrier] = useState("");
  const [loadCount, setLoadCount] = useState("1");

  const [lineItems, setLineItems] = useState<OrderLineItem[]>([{ ...EMPTY_LINE }]);

  const [cuttingInstructions, setCuttingInstructions] = useState("");
  const [packingInstructions, setPackingInstructions] = useState("");
  const [notes, setNotes] = useState("");

  const [packingSlipFilename, setPackingSlipFilename] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);

  async function handleSlipFile(file: File | undefined | null) {
    if (!file) return;
    setParseError(null);
    setParsing(true);
    try {
      const result = await parsePackingSlip(file);
      if (!result.success) {
        setParseError("Couldn't read that slip — enter the order manually.");
        return;
      }
      const { data } = result;
      setPackingSlipFilename(result.filename);
      if (data.customer) setCustomer(data.customer);
      if (data.po_number) setPoNumber(data.po_number);
      if (data.invoice_number) setInvoiceNumber(data.invoice_number);
      if (data.ship_to_company) setShipToCompany(data.ship_to_company);
      if (data.ship_to_attention) setShipToAttention(data.ship_to_attention);
      if (data.ship_to_street) setShipToStreet(data.ship_to_street);
      if (data.ship_to_city) setShipToCity(data.ship_to_city);
      if (data.ship_to_state) setShipToState(data.ship_to_state);
      if (data.ship_to_zip) setShipToZip(data.ship_to_zip);
      if (data.ship_date) setShipDate(data.ship_date);
      if (data.line_items && data.line_items.length) setLineItems(data.line_items);
    } catch {
      setParseError("Couldn't read that slip — enter the order manually.");
    } finally {
      setParsing(false);
    }
  }

  function updateLine(idx: number, patch: Partial<OrderLineItem>) {
    setLineItems((prev) => prev.map((li, i) => (i === idx ? { ...li, ...patch } : li)));
  }

  function addLine() {
    setLineItems((prev) => [...prev, { ...EMPTY_LINE }]);
  }

  function removeLine(idx: number) {
    setLineItems((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev));
  }

  function resetForm() {
    setCustomer("");
    setPoNumber("");
    setInvoiceNumber("");
    setShipToCompany("");
    setShipToAttention("");
    setShipToStreet("");
    setShipToCity("");
    setShipToState("");
    setShipToZip("");
    setShipDate("");
    setMethod("");
    setCarrier("");
    setLoadCount("1");
    setLineItems([{ ...EMPTY_LINE }]);
    setCuttingInstructions("");
    setPackingInstructions("");
    setNotes("");
    setPackingSlipFilename("");
    setParseError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setError(null);
    setSavedId(null);
  }

  const totalBdft = computeTotalBdft(lineItems);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!customer.trim()) {
      setError("Customer is required.");
      return;
    }

    const payload: OrderPayload = {
      customer: customer.trim(),
      po_number: poNumber.trim(),
      invoice_number: invoiceNumber.trim(),
      ship_to_company: shipToCompany.trim(),
      ship_to_attention: shipToAttention.trim(),
      ship_to_street: shipToStreet.trim(),
      ship_to_city: shipToCity.trim(),
      ship_to_state: shipToState.trim(),
      ship_to_zip: shipToZip.trim(),
      method: method.trim(),
      carrier: carrier.trim(),
      ship_date: shipDate,
      load_count: Number.isFinite(Number(loadCount)) && Number(loadCount) > 0 ? Number(loadCount) : 1,
      total_bdft: totalBdft,
      cutting_instructions: cuttingInstructions.trim(),
      packing_instructions: packingInstructions.trim(),
      notes: notes.trim(),
      ...(packingSlipFilename ? { packing_slip_filename: packingSlipFilename } : {}),
      ...(packingSlipFilename && invoiceNumber.trim() ? { packing_slip_invoice: invoiceNumber.trim() } : {}),
      line_items: lineItems
        .filter((li) => li.part_number.trim() || li.description.trim())
        .map((li) => ({
          part_number: li.part_number.trim(),
          description: li.description.trim(),
          quantity: Number.isFinite(Number(li.quantity)) ? Number(li.quantity) : 0,
          dimensions: li.dimensions.trim(),
          density: li.density.trim(),
        })),
    };

    setSaving(true);
    try {
      const res = await fetch("/v2/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || "Couldn't save the order. Try again.");
        return;
      }
      setSavedId(data.id);
    } catch (e: any) {
      setError("Network error — couldn't reach the server.");
    } finally {
      setSaving(false);
    }
  }

  if (savedId) {
    return (
      <div className="min-h-screen flex flex-col bg-bg">
        <PlatformHeader userName={userName} isAdmin={isAdmin} permissions={permissions} title="Orders · v2" currentPath="/v2/orders" />
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="w-full max-w-md bg-surface border border-[var(--card-border)] rounded-2xl p-8 text-center space-y-4">
            <h2 className="text-lg font-semibold text-text">Order saved</h2>
            <p className="text-sm text-muted">The order was created successfully.</p>
            <div className="flex items-center justify-center gap-3 pt-2">
              <button
                type="button"
                onClick={resetForm}
                className="min-h-[44px] px-5 rounded-md bg-[var(--brand)] text-white text-sm font-semibold cursor-pointer hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
              >
                New order
              </button>
              <a
                href="/v2/board"
                className="min-h-[44px] inline-flex items-center px-5 rounded-md border border-[var(--input-border)] text-text text-sm font-semibold no-underline hover:bg-[var(--ghost-bg)]"
              >
                Go to production board
              </a>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-bg">
      <PlatformHeader userName={userName} isAdmin={isAdmin} permissions={permissions} title="Orders · v2" currentPath="/v2/orders" />

      <form onSubmit={handleSubmit} className="flex-1 w-full max-w-2xl mx-auto px-4 py-6 space-y-6">
        <h1 className="text-xl font-semibold text-text">New order</h1>

        {/* Packing-slip upload — client-side parse + prefill; never blocks manual entry */}
        <section>
          <label
            htmlFor="packing-slip-input"
            className="flex flex-col items-center justify-center gap-2 min-h-[96px] rounded-lg border-2 border-dashed border-[var(--input-border)] bg-[var(--surface-2)] text-center px-4 py-6 cursor-pointer hover:border-[var(--brand)] transition-colors"
          >
            <FileUp size={22} className="text-muted" aria-hidden="true" />
            <span className="text-sm font-medium text-text">
              {parsing
                ? "Parsing packing slip…"
                : packingSlipFilename
                  ? `Loaded: ${packingSlipFilename} — drop another to replace`
                  : "Drop a packing slip to prefill, or click to browse"}
            </span>
            <input
              ref={fileInputRef}
              id="packing-slip-input"
              type="file"
              accept="application/pdf,.pdf"
              className="sr-only"
              onChange={(e) => handleSlipFile(e.target.files?.[0])}
            />
          </label>
          {parseError && (
            <p className="text-sm text-[var(--warn-text)] mt-2">{parseError}</p>
          )}
        </section>

        {error && (
          <div className="rounded-md border border-[var(--warn-border)] bg-[var(--warn-bg)] text-[var(--warn-text)] text-sm px-4 py-3">
            {error}
          </div>
        )}

        {/* Customer & order */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-text">Customer & order</h2>
          <TextField label="Customer" value={customer} onChange={setCustomer} required placeholder="Customer name" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <TextField label="PO number" value={poNumber} onChange={setPoNumber} />
            <TextField label="Invoice number" value={invoiceNumber} onChange={setInvoiceNumber} />
          </div>
        </section>

        {/* Ship-to */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-text">Ship-to</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <TextField label="Company" value={shipToCompany} onChange={setShipToCompany} />
            <TextField label="Attention" value={shipToAttention} onChange={setShipToAttention} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-[2fr_1fr_1fr_1fr_auto] gap-3 items-end">
            <TextField label="Street" value={shipToStreet} onChange={setShipToStreet} />
            <TextField label="City" value={shipToCity} onChange={setShipToCity} />
            <TextField label="State" value={shipToState} onChange={setShipToState} />
            <TextField label="ZIP" value={shipToZip} onChange={setShipToZip} />
            <button
              type="button"
              disabled
              title="Address verification — coming"
              className="min-h-[44px] px-4 rounded-md border border-[var(--input-border)] text-muted text-sm font-semibold cursor-not-allowed opacity-60"
            >
              Verify
            </button>
          </div>
        </section>

        {/* Shipping */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-text">Shipping</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <span className={labelClass}>Ship date</span>
              <input type="date" value={shipDate} onChange={(e) => setShipDate(e.target.value)} className={inputClass} />
            </label>
            <label className="block">
              <span className={labelClass}>Method</span>
              <select value={method} onChange={(e) => setMethod(e.target.value)} className={inputClass}>
                <option value="">— Select —</option>
                <option value="Our truck">Our truck</option>
                <option value="Common carrier">Common carrier</option>
                <option value="Customer pickup">Customer pickup</option>
              </select>
            </label>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <TextField label="Carrier" value={carrier} onChange={setCarrier} />
            <label className="block">
              <span className={labelClass}>Load count</span>
              <input
                type="number"
                min={1}
                value={loadCount}
                onChange={(e) => setLoadCount(e.target.value)}
                className={inputClass}
              />
            </label>
          </div>
        </section>

        {/* Line items */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-text">Line items</h2>
            <span className="text-xs font-mono tabular-nums text-muted">Total BDFT: {totalBdft || 0}</span>
          </div>
          <div className="space-y-3">
            {lineItems.map((li, idx) => (
              <div key={idx} className="rounded-lg border border-[var(--card-border)] p-3 space-y-2">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <TextField label="Part number" value={li.part_number} onChange={(v) => updateLine(idx, { part_number: v })} />
                  <TextField label="Description" value={li.description} onChange={(v) => updateLine(idx, { description: v })} />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_1fr_auto] gap-2 items-end">
                  <label className="block">
                    <span className={labelClass}>Quantity</span>
                    <input
                      type="number"
                      min={0}
                      value={li.quantity}
                      onChange={(e) => updateLine(idx, { quantity: e.target.value })}
                      className={inputClass}
                    />
                  </label>
                  <TextField label="Dimensions" value={li.dimensions} onChange={(v) => updateLine(idx, { dimensions: v })} placeholder='e.g. 76 x 38 x 12' />
                  <TextField label="Density" value={li.density} onChange={(v) => updateLine(idx, { density: v })} placeholder="1.0 RC" />
                  <button
                    type="button"
                    onClick={() => removeLine(idx)}
                    disabled={lineItems.length <= 1}
                    aria-label="Remove line"
                    className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-md border border-[var(--input-border)] text-muted hover:text-text hover:bg-[var(--ghost-bg)] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                  >
                    <Trash2 size={16} aria-hidden="true" />
                  </button>
                </div>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={addLine}
            className="min-h-[44px] px-4 inline-flex items-center gap-2 rounded-md border border-[var(--input-border)] text-text text-sm font-semibold cursor-pointer hover:bg-[var(--ghost-bg)]"
          >
            <Plus size={16} aria-hidden="true" />
            Add line
          </button>
        </section>

        {/* Instructions */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-text">Instructions</h2>
          <label className="block">
            <span className={labelClass}>Cutting instructions</span>
            <textarea
              value={cuttingInstructions}
              onChange={(e) => setCuttingInstructions(e.target.value)}
              rows={3}
              className={inputClass}
            />
          </label>
          <label className="block">
            <span className={labelClass}>Packing instructions</span>
            <textarea
              value={packingInstructions}
              onChange={(e) => setPackingInstructions(e.target.value)}
              rows={3}
              className={inputClass}
            />
          </label>
          <label className="block">
            <span className={labelClass}>Notes</span>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className={inputClass} />
          </label>
        </section>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 pt-2 pb-8">
          <button
            type="button"
            onClick={resetForm}
            className="min-h-[44px] px-5 rounded-md border border-[var(--input-border)] text-text text-sm font-semibold cursor-pointer hover:bg-[var(--ghost-bg)]"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="min-h-[44px] px-6 rounded-md bg-[var(--brand)] text-white text-sm font-semibold cursor-pointer hover:opacity-90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
          >
            {saving ? "Saving…" : "Save order"}
          </button>
        </div>
      </form>
    </div>
  );
}
