-- schedule-board.sql
-- Staging + live store for the /v2/schedule TV board.
-- Populated by the v2 cron poller (see PXXX schedule-board 2/5), read by the board endpoint (3/5).
-- Keyed on invoice_number parsed from the Google Sheet "DELIVERY TIME" column (regex INV\s*(\d+)).
-- Joins to jobs.invoice_number; match_job_id mirrors jobs.id (TEXT).
-- Run manually in the Cloudflare D1 console. Migration first, worker second.

CREATE TABLE IF NOT EXISTS schedule_rows (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_number   TEXT    NOT NULL,           
  ship_week        TEXT    NOT NULL,           
  ship_date        TEXT,                       
  day_of_week      TEXT,                        
  sort_order       INTEGER NOT NULL DEFAULT 0,  
  customer         TEXT,
  load_count       REAL,                        
  method           TEXT,                        
  location         TEXT,                        
  delivery_time    TEXT,                       
  carrier          TEXT,                        
  total_bdft       REAL,                        
  scrap_pickup     TEXT,                        
  sheet_status     TEXT,                        
                                                
  match_job_id     TEXT,                        
  last_seen_at     TEXT    NOT NULL,            
  created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_schedule_rows_inv        ON schedule_rows (invoice_number);
CREATE INDEX IF NOT EXISTS idx_schedule_rows_ship_week  ON schedule_rows (ship_week);
CREATE INDEX IF NOT EXISTS idx_schedule_rows_match      ON schedule_rows (match_job_id);
