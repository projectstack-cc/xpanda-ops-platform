"use client";
// src/components/orders/OrderEntryForm.tsx
// Manual order-entry form for /v2/orders. Single-column, section by section, posts to the
// P338 contract at POST /v2/api/orders. A packing-slip dropzone (P340) parses a PDF client-side
// and prefills form state — parsing failures never block manual entry.
import { useEffect, useRef, useState } from "react";
import { FileUp, Plus, Printer, Trash2 } from "lucide-react";
import PlatformHeader from "@/components/PlatformHeader";
import { useLang } from "@/components/lang";
import { parsePackingSlip } from "@/lib/packingSlip";
import { matchLineItemToPart, loadPartsLibrary } from "@/lib/partMatch";
import { buildCutListPdf, type CutListJob } from "@/lib/cutList";
import PartsPicker from "@/components/orders/PartsPicker";
import AddressCorrectionModal, { type AddressParts } from "@/components/orders/AddressCorrectionModal";

export interface OrderLineItem {
  category?: string;
  thickness?: number;
  part_id?: string;
  part_number: string;
  description: string;
  quantity: string;
  dimensions: string;
  density: string;
  bdftOrig?: string;
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
  ship_to_street2?: string;
  ship_to_verified?: string;
  ship_to_standardized?: unknown;
  ship_to_verified_at?: string;
  customer_pickup: boolean;
  carrier: string;
  delivery_time: string;
  scrap_pickup: string;
  contact_name: string;
  contact_phone: string;
  processes: Array<{ name: string; completed: boolean }>;
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
  const { t } = useLang();
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
  const [customerPickup, setCustomerPickup] = useState(false);
  const [carrier, setCarrier] = useState("");
  const [loadCount, setLoadCount] = useState("1");
  const [deliveryTime, setDeliveryTime] = useState("");
  const [scrapPickup, setScrapPickup] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [procCrossCutter, setProcCrossCutter] = useState(false);
  const [procHoleCutter, setProcHoleCutter] = useState(false);
  const [procMainLine, setProcMainLine] = useState(false);
  const [procBlueLine, setProcBlueLine] = useState(false);
  const [procLaminate, setProcLaminate] = useState(false);

  const [lineItems, setLineItems] = useState<OrderLineItem[]>([{ ...EMPTY_LINE }]);
  const [qtyAsBdft, setQtyAsBdft] = useState(false);

  const [cuttingInstructions, setCuttingInstructions] = useState("");
  const [packingInstructions, setPackingInstructions] = useState("");
  const [notes, setNotes] = useState("");

  const [packingSlipFilename, setPackingSlipFilename] = useState("");
  const [packingSlipBase64, setPackingSlipBase64] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [savedOrder, setSavedOrder] = useState<{
    id: string;
    invoice_number: string;
    ship_date: string;
    customer: string;
    ship_to_company: string;
    ship_to_attention: string;
    ship_to_street: string;
    ship_to_street2: string;
    ship_to_city: string;
    ship_to_state: string;
    ship_to_zip: string;
    carrier: string;
    line_items: Array<{
      part_number: string;
      description: string;
      quantity: number;
      dimensions: string;
      density: string;
    }>;
    hb_chunk_breakdown: string | null;
  } | null>(null);
  const [printing, setPrinting] = useState(false);
  const [printError, setPrintError] = useState<string | null>(null);
  const printBlobUrlRef = useRef<string | null>(null);
  const printIframeRef = useRef<HTMLIFrameElement | null>(null);

  // P438: live Holey Board "Chunks required" preview — ported from legacy updateHoleyChunkPreview
  // + /api/holey-chunks/preview. Resolves each line against the parts library, posts
  // {items:[{thickness,qty}]} where category==='Holey Board', renders a count badge below the
  // line-items section. Hidden when no HB items (matches legacy hidden-default behavior).
  const [holeyPreview, setHoleyPreview] = useState<{
    chunks_required: number;
    avg_util: number;
    height: number;
    kerf: number;
  } | null>(null);
  const holeyPreviewSeqRef = useRef(0);
  const holeyPreviewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Ship-to correction modal: a promise resolver bridges the async save flow to the operator's click.
  const [addrModal, setAddrModal] = useState<{ entered: AddressParts; standardized: AddressParts } | null>(null);
  const addrResolver = useRef<((choice: "use" | "keep") => void) | null>(null);
  function askAddressChoice(entered: AddressParts, standardized: AddressParts): Promise<"use" | "keep"> {
    return new Promise((resolve) => {
      addrResolver.current = resolve;
      setAddrModal({ entered, standardized });
    });
  }
  function resolveAddrChoice(choice: "use" | "keep") {
    setAddrModal(null);
    const r = addrResolver.current;
    addrResolver.current = null;
    r?.(choice);
  }

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
      // Stash the raw PDF bytes as base64 so the server can persist the attachment
      // (R2 by default, D1 base64 fallback) on POST — otherwise the legacy job board
      // has no packing slip to display. Mirrors legacy /api/jobs/ POST behavior.
      try {
        const buf = await file.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let bin = "";
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        setPackingSlipBase64(btoa(bin));
      } catch {
        /* if we can't read the bytes, the form still saves with just the filename */
      }
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
      if (data.contact_name) setContactName(data.contact_name);
      if (data.contact_phone) setContactPhone(data.contact_phone);
      if (data.line_items && data.line_items.length) {
        let items = data.line_items;
        // Auto-match each parsed line to the parts library (fail-open: unmatched rows stay blank
        // for manual entry / the "From parts library" picker).
        try {
          const parts = await loadPartsLibrary();
          items = items.map((li) => {
            const m = matchLineItemToPart(li, parts);
            return m ? { ...li, part_id: m.part.id, part_number: m.part.part_number } : li;
          });
        } catch {
          /* parts unavailable — leave rows for manual entry */
        }
        setLineItems(items);
      }
    } catch {
      setParseError("Couldn't read that slip — enter the order manually.");
    } finally {
      setParsing(false);
    }
  }

  function updateLine(idx: number, patch: Partial<OrderLineItem>) {
    setLineItems((prev) => prev.map((li, i) => {
      if (i !== idx) return li;
      const next = { ...li, ...patch };
      if (patch.quantity != null || patch.dimensions != null) delete next.bdftOrig;
      return next;
    }));
  }

  const [partsPickerOpen, setPartsPickerOpen] = useState(false);

  function addLine() {
    setLineItems((prev) => [...prev, { ...EMPTY_LINE }]);
  }

  // Append a picked part; if the only row is still the empty default, replace it.
  function addPartLine(line: OrderLineItem) {
    setLineItems((prev) => {
      const onlyEmpty =
        prev.length === 1 && !prev[0].part_number && !prev[0].description && !prev[0].dimensions;
      return onlyEmpty ? [line] : [...prev, line];
    });
  }

function removeLine(idx: number) {
  setLineItems((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev));
}

function setQtyAsBdftConvert(on: boolean) {
  setQtyAsBdft(on);
  setLineItems((prev) =>
    prev.map((li) => {
      if (on) {
        const bpp = bdftPerPiece(li.dimensions);
        const bdft = parseFloat(li.quantity);
        if (bpp != null && Number.isFinite(bdft) && bdft > 0) {
          return { ...li, bdftOrig: li.quantity, quantity: String(Math.round(bdft / bpp)) };
        }
        return li;
      }
      if (li.bdftOrig != null) {
        const restored = li.bdftOrig;
        return { ...li, quantity: restored, bdftOrig: undefined };
      }
      return li;
    })
  );
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
    setCustomerPickup(false);
    setCarrier("");
    setLoadCount("1");
    setDeliveryTime("");
    setScrapPickup("");
    setContactName("");
    setContactPhone("");
    setDragActive(false);
    setProcCrossCutter(false);
    setProcHoleCutter(false);
    setProcMainLine(false);
    setProcBlueLine(false);
    setProcLaminate(false);
    setLineItems([{ ...EMPTY_LINE }]);
    setQtyAsBdft(false);
    setCuttingInstructions("");
    setPackingInstructions("");
    setNotes("");
    setPackingSlipFilename("");
    setPackingSlipBase64("");
    setParseError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setError(null);
    setSavedId(null);
    setSavedOrder(null);
    setPrintError(null);
    if (printBlobUrlRef.current) {
      try { URL.revokeObjectURL(printBlobUrlRef.current); } catch {}
      printBlobUrlRef.current = null;
    }
    setHoleyPreview(null);
    if (holeyPreviewTimerRef.current) {
      clearTimeout(holeyPreviewTimerRef.current);
      holeyPreviewTimerRef.current = null;
    }
  }

  const totalBdft = computeTotalBdft(lineItems);

  // P438: live HB preview — debounced 350ms after line items change so typing dims/qty doesn't
  // spam the endpoint. Late responses drop silently via the seq counter (mirrors legacy
  // _holeyPreviewSeq in jobs/index.html).
  useEffect(() => {
    if (holeyPreviewTimerRef.current) clearTimeout(holeyPreviewTimerRef.current);
    const candidate = lineItems.filter((li) => li.part_number.trim() || li.description.trim());
    if (candidate.length === 0) {
      setHoleyPreview(null);
      return;
    }
    holeyPreviewTimerRef.current = setTimeout(async () => {
      const seq = ++holeyPreviewSeqRef.current;
      try {
        const parts = await loadPartsLibrary();
        const items: { thickness: number; qty: number }[] = [];
        for (const li of candidate) {
          if (!li.part_id) continue;
          const part = parts.find((p) => p.id === li.part_id);
          if (!part || part.category !== "Holey Board") continue;
          const thickness = parseFloat(String(part.height_in ?? ""));
          const qty = parseInt(String(li.quantity ?? ""), 10);
          if (!(thickness > 0) || !(qty >= 1)) continue;
          items.push({ thickness, qty });
        }
        if (seq !== holeyPreviewSeqRef.current) return; // stale
        if (items.length === 0) {
          setHoleyPreview(null);
          return;
        }
        const res = await fetch("/v2/api/orders/holey-chunks/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items }),
        });
        if (seq !== holeyPreviewSeqRef.current) return; // stale
        const body = await res.json();
        if (!res.ok || !body?.ok) {
          setHoleyPreview(null);
          return;
        }
        if (seq !== holeyPreviewSeqRef.current) return; // stale
        setHoleyPreview({
          chunks_required: body.chunks_required,
          avg_util: body.avg_util,
          height: body.height,
          kerf: body.kerf,
        });
      } catch {
        if (seq === holeyPreviewSeqRef.current) setHoleyPreview(null);
      }
    }, 350);
    return () => {
      if (holeyPreviewTimerRef.current) clearTimeout(holeyPreviewTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineItems]);

  // P438: build + print the cut list for the just-saved order. Uses buildCutListPdf (same call as
  // /v2/board's OrderDetailModal) so the PDF is pixel-parity with the order-detail viewer's print,
  // including the CHUNK BREAKDOWN page when jobs.hb_chunk_breakdown is populated (best-effort
  // resolved from the POST response; falls back to null if the server didn't return it).
  async function handlePrintCutList() {
    if (!savedOrder) return;
    setPrinting(true);
    setPrintError(null);
    try {
      const job: CutListJob = {
        id: savedOrder.id,
        invoice_number: savedOrder.invoice_number || null,
        ship_date: savedOrder.ship_date || null,
        customer: savedOrder.customer || null,
        ship_to_company: savedOrder.ship_to_company || null,
        ship_to_attention: savedOrder.ship_to_attention || null,
        ship_to_street: savedOrder.ship_to_street || null,
        ship_to_street2: savedOrder.ship_to_street2 || null,
        ship_to_city: savedOrder.ship_to_city || null,
        ship_to_state: savedOrder.ship_to_state || null,
        ship_to_zip: savedOrder.ship_to_zip || null,
        carrier: savedOrder.carrier || null,
        line_items: savedOrder.line_items.map((li) => ({
          part_number: li.part_number || null,
          description: li.description || null,
          quantity: li.quantity,
          dimensions: li.dimensions || null,
          density: li.density || null,
        })),
        hb_chunk_breakdown: savedOrder.hb_chunk_breakdown || null,
      };
      const pdfBytes = await buildCutListPdf(job);
      const blob = new Blob([pdfBytes as BlobPart], { type: "application/pdf" });
      if (printBlobUrlRef.current) {
        try { URL.revokeObjectURL(printBlobUrlRef.current); } catch {}
      }
      const url = URL.createObjectURL(blob);
      printBlobUrlRef.current = url;
      const iframe = printIframeRef.current;
      if (iframe && iframe.contentWindow) {
        iframe.src = url;
        // Wait for load before invoking print; onload fires after src assignment.
        iframe.onload = () => {
          try { iframe.contentWindow?.focus(); iframe.contentWindow?.print(); } catch {}
        };
      } else {
        // No iframe mounted yet — fall back to opening in a new tab so the user still gets the PDF.
        window.open(url, "_blank");
      }
    } catch (e) {
      console.error("Cut list print failed:", e);
      setPrintError("Couldn't generate the cut list. Please try again.");
    } finally {
      setPrinting(false);
    }
  }

  // Revoke the print blob URL on unmount so we never leak it across module navigations.
  useEffect(() => {
    return () => {
      if (printBlobUrlRef.current) {
        try { URL.revokeObjectURL(printBlobUrlRef.current); } catch {}
        printBlobUrlRef.current = null;
      }
    };
  }, []);

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
      customer_pickup: customerPickup,
      carrier: carrier.trim(),
      ship_date: shipDate,
      delivery_time: deliveryTime.trim(),
      scrap_pickup: scrapPickup,
      contact_name: contactName.trim(),
      contact_phone: contactPhone.trim(),
      processes: [
        { name: "Cross Cutter", completed: false, checked: procCrossCutter },
        { name: "Hole Cutter", completed: false, checked: procHoleCutter },
        { name: "Main Line", completed: false, checked: procMainLine },
        { name: "Blue Line", completed: false, checked: procBlueLine },
        { name: "Laminate", completed: false, checked: procLaminate },
      ]
        .filter((p) => p.checked)
        .map((p) => ({ name: p.name, completed: p.completed })),
      load_count: Number.isFinite(Number(loadCount)) && Number(loadCount) > 0 ? Number(loadCount) : 1,
      total_bdft: totalBdft,
      cutting_instructions: cuttingInstructions.trim(),
      packing_instructions: packingInstructions.trim(),
      notes: notes.trim(),
      ...(packingSlipFilename ? { packing_slip_filename: packingSlipFilename } : {}),
      ...(packingSlipFilename && invoiceNumber.trim() ? { packing_slip_invoice: invoiceNumber.trim() } : {}),
      ...(packingSlipBase64 ? { packing_slip_pdf: packingSlipBase64 } : {}),
      line_items: lineItems
        .filter((li) => li.part_number.trim() || li.description.trim())
        .map((li) => ({
          part_number: li.part_number.trim(),
          description: li.description.trim(),
          quantity: Number.isFinite(Number(li.quantity)) ? Number(li.quantity) : 0,
          dimensions: li.dimensions.trim(),
          density: li.density.trim(),
          ...(li.part_id ? { part_id: li.part_id } : {}),
        })),
    };

    // ── Ship-to verification (Lob via legacy /api/address/validate) — fail-open ──
    const hasFullShipTo = !!(payload.ship_to_street && payload.ship_to_city && payload.ship_to_state && payload.ship_to_zip);
    if (hasFullShipTo) {
      let result: any = { status: "unverifiable" };
      try {
        const vr = await fetch("/api/address/validate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            street: payload.ship_to_street,
            street2: "",
            city: payload.ship_to_city,
            state: payload.ship_to_state,
            zip: payload.ship_to_zip,
          }),
        });
        const vb = await vr.json();
        if (vr.ok && vb?.data) result = vb.data;
      } catch {
        result = { status: "unverifiable" };
      }

      let finalStatus: string = result.status || "unverifiable";
      if (result.status === "corrected" && result.standardized) {
        const choice = await askAddressChoice(
          { street: payload.ship_to_street, city: payload.ship_to_city, state: payload.ship_to_state, zip: payload.ship_to_zip },
          result.standardized
        );
        if (choice === "use") {
          payload.ship_to_street = result.standardized.street || payload.ship_to_street;
          payload.ship_to_street2 = result.standardized.street2 || "";
          payload.ship_to_city = result.standardized.city || payload.ship_to_city;
          payload.ship_to_state = result.standardized.state || payload.ship_to_state;
          payload.ship_to_zip = result.standardized.zip || payload.ship_to_zip;
          finalStatus = "corrected";
        } else {
          finalStatus = "kept_original";
        }
      }
      payload.ship_to_verified = finalStatus;
      payload.ship_to_standardized = result.standardized || null;
      payload.ship_to_verified_at = new Date().toISOString();
    }

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
      setSavedOrder({
        id: data.id,
        invoice_number: payload.invoice_number,
        ship_date: payload.ship_date,
        customer: payload.customer,
        ship_to_company: payload.ship_to_company,
        ship_to_attention: payload.ship_to_attention,
        ship_to_street: payload.ship_to_street,
        ship_to_street2: payload.ship_to_street2 ?? "",
        ship_to_city: payload.ship_to_city,
        ship_to_state: payload.ship_to_state,
        ship_to_zip: payload.ship_to_zip,
        carrier: payload.carrier,
        line_items: payload.line_items.map((li) => ({
          part_number: li.part_number,
          description: li.description,
          quantity: li.quantity,
          dimensions: li.dimensions,
          density: li.density,
        })),
        hb_chunk_breakdown: data?.job?.hb_chunk_breakdown ?? data?.hb_chunk_breakdown ?? null,
      });
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
          <div className="w-full max-w-[770px] bg-surface border border-[var(--card-border)] rounded-2xl p-8 text-center space-y-4">
            <h2 className="text-lg font-semibold text-text">{t("orders.orderSaved")}</h2>
            <p className="text-sm text-muted">The order was created successfully.</p>
            {printError && (
              <p className="text-sm text-[var(--warn-text)]">{printError}</p>
            )}
            <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
              <button
                type="button"
                onClick={resetForm}
                className="min-h-[44px] px-5 rounded-md bg-[var(--brand)] text-white text-sm font-semibold cursor-pointer hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
              >
                {t("orders.newOrder")}
              </button>
              {/* P438: print the cut list for the order just saved (pixel-parity with the
                  /v2/board OrderDetailModal cut-list viewer). Native print() in same tab. */}
              <button
                type="button"
                onClick={handlePrintCutList}
                disabled={printing}
                className="min-h-[44px] px-5 inline-flex items-center gap-2 rounded-md border border-[var(--input-border)] text-text text-sm font-semibold cursor-pointer hover:bg-[var(--ghost-bg)] disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
              >
                <Printer size={16} aria-hidden="true" />
                {printing ? "Generating…" : "Print cut list"}
              </button>
              <a
                href="/jobs/"
                className="min-h-[44px] inline-flex items-center px-5 rounded-md border border-[var(--input-border)] text-text text-sm font-semibold no-underline hover:bg-[var(--ghost-bg)]"
              >
                Go to job board
              </a>
            </div>
            {/* Hidden iframe — printCutList points it at the blob URL and invokes print() on load. */}
            <iframe
              ref={printIframeRef}
              title="Cut list"
              style={{ position: "absolute", left: -9999, top: -9999, width: 0, height: 0, border: 0 }}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-bg">
      <PlatformHeader userName={userName} isAdmin={isAdmin} permissions={permissions} title="Orders · v2" currentPath="/v2/orders" />

      <form onSubmit={handleSubmit} className="flex-1 w-full max-w-[770px] mx-auto px-4 py-6 space-y-6">
        <h1 className="text-xl font-semibold text-text">{t("orders.newOrder")}</h1>

        {/* Packing-slip upload — client-side parse + prefill; never blocks manual entry */}
        <section>
          <label
            htmlFor="packing-slip-input"
            onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
            onDragEnter={(e) => { e.preventDefault(); setDragActive(true); }}
            onDragLeave={(e) => { e.preventDefault(); setDragActive(false); }}
            onDrop={(e) => { e.preventDefault(); setDragActive(false); handleSlipFile(e.dataTransfer.files?.[0]); }}
            className={`flex flex-col items-center justify-center gap-2 min-h-[96px] rounded-lg border-2 border-dashed ${dragActive ? "border-[var(--brand)]" : "border-[var(--input-border)]"} bg-[var(--surface-2)] text-center px-4 py-6 cursor-pointer hover:border-[var(--brand)] transition-colors`}
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
          <h2 className="text-sm font-semibold text-text">{t("orders.customerOrderSection")}</h2>
          <TextField label={t("orders.customer")} value={customer} onChange={setCustomer} required placeholder="Customer name" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <TextField label={t("orders.poNumber")} value={poNumber} onChange={setPoNumber} />
            <TextField label={t("orders.invoiceNumber")} value={invoiceNumber} onChange={setInvoiceNumber} />
          </div>
        </section>

        {/* Ship-to */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-text">Ship-to</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <TextField label="Company" value={shipToCompany} onChange={setShipToCompany} />
            <TextField label="Attention" value={shipToAttention} onChange={setShipToAttention} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-[2fr_1fr_1fr_1fr] gap-3 items-end">
            <TextField label="Street" value={shipToStreet} onChange={setShipToStreet} />
            <TextField label="City" value={shipToCity} onChange={setShipToCity} />
            <TextField label="State" value={shipToState} onChange={setShipToState} />
            <TextField label="ZIP" value={shipToZip} onChange={setShipToZip} />
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
            <TextField label="Delivery time" value={deliveryTime} onChange={setDeliveryTime} placeholder="e.g. 7:00 am & HRLY" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <TextField label="Carrier" value={carrier} onChange={setCarrier} placeholder="e.g. LISMA" />
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
            <label className="block">
              <span className={labelClass}>Scrap pickup</span>
              <select value={scrapPickup} onChange={(e) => setScrapPickup(e.target.value)} className={inputClass}>
                <option value="">— N/A —</option>
                <option value="YES">YES</option>
                <option value="NO">NO</option>
                <option value="N/A">N/A</option>
              </select>
            </label>
            <label className="inline-flex items-center gap-2 min-h-[44px] cursor-pointer select-none">
              <input
                type="checkbox"
                checked={customerPickup}
                onChange={(e) => setCustomerPickup(e.target.checked)}
                className="h-5 w-5 accent-[var(--brand)]"
              />
              <span className="text-sm font-medium text-text">Customer pickup</span>
            </label>
          </div>
        </section>

        {/* Contact */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-text">Contact</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <TextField label="Contact name" value={contactName} onChange={setContactName} placeholder="Contact person" />
            <TextField label="Contact phone" value={contactPhone} onChange={setContactPhone} placeholder="Phone number" />
          </div>
        </section>

        {/* Production processes */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-text">Production processes</h2>
          <p className="text-xs text-muted">Select which processes this job requires.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {[
              { label: "Cross Cutter", checked: procCrossCutter, set: setProcCrossCutter },
              { label: "Hole Cutter", checked: procHoleCutter, set: setProcHoleCutter },
              { label: "Main Line", checked: procMainLine, set: setProcMainLine },
              { label: "Blue Line", checked: procBlueLine, set: setProcBlueLine },
              { label: "Laminate", checked: procLaminate, set: setProcLaminate },
            ].map((proc) => (
              <label
                key={proc.label}
                className="inline-flex items-center gap-2 min-h-[44px] px-3 rounded-md border border-[var(--input-border)] cursor-pointer select-none hover:bg-[var(--ghost-bg)]"
              >
                <input
                  type="checkbox"
                  checked={proc.checked}
                  onChange={(e) => proc.set(e.target.checked)}
                  className="h-5 w-5 accent-[var(--brand)]"
                />
                <span className="text-sm font-medium text-text">{proc.label}</span>
              </label>
            ))}
          </div>
        </section>

        {/* Line items */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-text">Line items</h2>
            <span className="text-xs font-mono tabular-nums text-muted">Total BDFT: {totalBdft || 0}</span>
          </div>

          {/* P438: live Holey Board chunks preview (port of legacy holey-chunks-summary) */}
          {holeyPreview && (
            <div className="rounded-lg border border-[var(--card-border)] bg-[var(--surface-2)] px-4 py-3">
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-semibold text-text">Chunks required</span>
                <span className="text-xl font-bold tabular-nums text-text">
                  {holeyPreview.chunks_required}
                </span>
                <span className="text-xs text-muted">
                  · 48×24×{holeyPreview.height}&quot; · {holeyPreview.kerf}&quot; kerf · {holeyPreview.avg_util}% avg fill
                </span>
              </div>
              <div className="mt-1 text-[11px] text-muted">
                live estimate; the value saved on the order is authoritative.
              </div>
            </div>
          )}
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
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={addLine}
              className="min-h-[44px] px-4 inline-flex items-center gap-2 rounded-md border border-[var(--input-border)] text-text text-sm font-semibold cursor-pointer hover:bg-[var(--ghost-bg)]"
            >
              <Plus size={16} aria-hidden="true" />
              Add line
            </button>
            <button
              type="button"
              onClick={() => setPartsPickerOpen(true)}
              className="min-h-[44px] px-4 inline-flex items-center gap-2 rounded-md border border-[var(--input-border)] text-text text-sm font-semibold cursor-pointer hover:bg-[var(--ghost-bg)]"
            >
              From parts library
            </button>
            <label
              className="ml-auto inline-flex items-center gap-2 min-h-[44px] cursor-pointer select-none text-xs whitespace-nowrap"
              title="Sales sometimes enters total board feet instead of a piece count. Uses each row's Dimensions to convert BDFT → pieces."
            >
              <input
                type="checkbox"
                checked={qtyAsBdft}
                onChange={(e) => setQtyAsBdftConvert(e.target.checked)}
                className="h-5 w-5 accent-[var(--brand)]"
              />
              <span className="font-medium text-text">Qty entered as BDFT — convert to pieces</span>
            </label>
          </div>
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

      {addrModal && (
        <AddressCorrectionModal
          isOpen={true}
          entered={addrModal.entered}
          standardized={addrModal.standardized}
          onUse={() => resolveAddrChoice("use")}
          onKeep={() => resolveAddrChoice("keep")}
        />
      )}

      <PartsPicker
        isOpen={partsPickerOpen}
        onClose={() => setPartsPickerOpen(false)}
        onPick={addPartLine}
      />
    </div>
  );
}
