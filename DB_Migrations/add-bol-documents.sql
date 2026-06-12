-- Signed BOL copies (driver / customer). One row per stored PDF in R2.
CREATE TABLE IF NOT EXISTS bol_documents (
  id         TEXT PRIMARY KEY,
  bol_id     TEXT NOT NULL,
  doc_type   TEXT NOT NULL,   -- 'driver_signed' | 'customer_signed'
  r2_key     TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bol_documents_bol_id ON bol_documents(bol_id);
