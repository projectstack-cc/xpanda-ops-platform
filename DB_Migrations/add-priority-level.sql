-- P238: graded priority level on jobs (0=Normal, 1=Elevated, 2=High, 3=Critical).
-- Pairs with the EXISTING jobs.priority ('normal'|'rush') pin, which sorts above all levels.
-- Cutting queue sort: rush DESC, priority_level DESC, ship_date ASC, invoice_number ASC.
ALTER TABLE jobs ADD COLUMN priority_level INTEGER NOT NULL DEFAULT 0;
