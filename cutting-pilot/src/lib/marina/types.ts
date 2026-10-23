// src/lib/marina/types.ts — marina-02
// API contract for /v2/api/qc/marina/* (Marina Foam inspection). marina-03/04 are written against
// these exact shapes — change them only with a named contract change.

export type MarinaJobStatus = "open" | "complete";
export type MarinaFileKind = "cut_sheet" | "customer_drawing";
export type MarinaPieceStatus = "pass" | "rework_pending" | "accepted" | "scrapped";
export interface MarinaTallies { parts: number; pieces: number; pass: number; accepted: number; rework_pending: number; scrapped: number; }
export interface MarinaJob { id: string; name: string; customer: string | null; tolerance_in: number; status: MarinaJobStatus; notes: string | null; created_by: string | null; created_at: string; completed_at: string | null; }
export interface MarinaJobSummary extends MarinaJob { tallies: MarinaTallies; cut_sheets: number; }   // cut_sheets = non-superseded cut_sheet files
export interface MarinaFile { id: string; job_id: string | null; kind: MarinaFileKind; filename: string | null; size_bytes: number | null; page_count: number | null; superseded_at: string | null; uploaded_by: string | null; uploaded_at: string; }
export interface MarinaDim { id: string; part_id: string; label: string; nominal_in: number; nominal_text: string | null; sort_order: number; }
export interface MarinaPartSummary { id: string; job_id: string; file_id: string | null; page_no: number | null; label: string; notes: string | null; sort_order: number; dims: MarinaDim[]; tallies: Omit<MarinaTallies, "parts">; locked: boolean; }   // locked = any piece has measurements
export interface MarinaJobDetail { job: MarinaJob; files: MarinaFile[]; parts: MarinaPartSummary[]; }

// marina-03 — additive: parts / dims / pieces / measurements. in_tol is stored as INTEGER, returned as boolean.
export interface MarinaMeasurement { id: string; piece_id: string; dim_id: string; attempt: number; nominal_in: number; measured_in: number; measured_text: string | null; in_tol: boolean; measured_by: string | null; measured_at: string; }
export interface MarinaPiece { id: string; part_id: string; piece_no: number; status: MarinaPieceStatus; disposition_note: string | null; created_by: string | null; created_at: string; updated_at: string | null; attempts: number; measurements: MarinaMeasurement[]; }   // all attempts, ordered attempt ASC then dim sort_order
export interface MarinaPartDetail extends MarinaPartSummary { job: Pick<MarinaJob, "id" | "name" | "customer" | "tolerance_in" | "status">; file: MarinaFile | null; pieces: MarinaPiece[]; }   // pieces by piece_no ASC
export interface MarinaReworkItem { piece: MarinaPiece; part: Pick<MarinaPartSummary, "id" | "label" | "dims">; job: Pick<MarinaJob, "id" | "name" | "customer">; }
export interface NewPartInput { label: string; notes?: string | null; file_id?: string | null; page_no?: number | null; dims: NewDimInput[]; }
export interface NewDimInput { label: string; nominal_text?: string; nominal_in?: number; }
export interface MeasureBody { measurements: { dim_id: string; value: string }[]; disposition?: "rework" | "scrap" | null; note?: string | null; }
