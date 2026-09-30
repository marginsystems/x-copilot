UPDATE own_posts SET kind = 'quote'
WHERE kind = 'reply' AND quoted_post_id IS NOT NULL AND quoted_post_id <> '';
