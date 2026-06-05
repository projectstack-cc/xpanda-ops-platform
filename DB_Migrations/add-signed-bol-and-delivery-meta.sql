-- P83: signed-BOL photo (R2 reference) + delivery metadata.

-- BOL: R2 key + upload timestamp for the signed photo.
ALTER TABLE bols ADD COLUMN signed_bol_photo_key TEXT;
ALTER TABLE bols ADD COLUMN signed_bol_uploaded_at TEXT;

-- Shipment: delivery-flow capture from the driver QR.
ALTER TABLE shipments ADD COLUMN delivery_accepted TEXT;        -- 'yes' | 'no' | 'partial'
ALTER TABLE shipments ADD COLUMN delivery_damages INTEGER DEFAULT 0;
ALTER TABLE shipments ADD COLUMN delivery_damage_notes TEXT;
ALTER TABLE shipments ADD COLUMN delivery_recorded_at TEXT;
ALTER TABLE shipments ADD COLUMN delivery_source TEXT;          -- 'driver_qr' for QR-flow deliveries
ALTER TABLE shipments ADD COLUMN in_transit_at TEXT;
ALTER TABLE shipments ADD COLUMN delivered_at TEXT;
