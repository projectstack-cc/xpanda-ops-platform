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
