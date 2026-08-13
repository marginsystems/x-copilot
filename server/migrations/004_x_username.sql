-- Public X handle for reply detect (Google users type it; X login copies oauth username).

ALTER TABLE users ADD COLUMN x_username TEXT;

UPDATE users
SET x_username = (
  SELECT oa.username
  FROM oauth_accounts oa
  WHERE oa.user_id = users.id
    AND oa.provider = 'x'
    AND oa.username IS NOT NULL
    AND TRIM(oa.username) != ''
  LIMIT 1
)
WHERE x_username IS NULL;
