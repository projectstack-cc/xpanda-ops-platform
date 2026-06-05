-- Adds render_overrides JSON blob to bols for the WYSIWYG inline editor.
-- Stored as TEXT (D1/SQLite has no native JSON type). NULL means no overrides.
ALTER TABLE bols ADD COLUMN render_overrides TEXT;
