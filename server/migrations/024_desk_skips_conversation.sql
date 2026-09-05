-- Preserve conversation ancestry when a user skips a Scout card.

ALTER TABLE desk_skips ADD COLUMN conversation_id TEXT;
ALTER TABLE desk_skips ADD COLUMN in_reply_to_id TEXT;
