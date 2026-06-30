-- P221: delivery incident flag + notes on shipments
ALTER TABLE shipments ADD COLUMN delivery_incident INTEGER DEFAULT 0;
ALTER TABLE shipments ADD COLUMN delivery_incident_notes TEXT;
