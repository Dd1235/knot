-- Sessions did not record how they happened, so a history page could not tell
-- a spoken conversation from a typed one. 'mixed' is a real state, not a
-- fallback: continuing a voice conversation in text is the point of keeping
-- them in one table.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS channel STRING NOT NULL DEFAULT 'text';

-- running_summary has been declared since the first migration and never
-- written. A history list needs a title; without one every entry reads
-- "Conversation".
