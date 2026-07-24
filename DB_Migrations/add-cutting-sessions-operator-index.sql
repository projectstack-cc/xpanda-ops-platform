CREATE UNIQUE INDEX IF NOT EXISTS idx_cutting_sessions_one_open_per_operator
  ON cutting_sessions (operator_id)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_cutting_sessions_operator_status
  ON cutting_sessions (operator_id, status);
