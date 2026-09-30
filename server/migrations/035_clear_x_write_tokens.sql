UPDATE oauth_accounts
SET access_token = NULL, access_token_secret = NULL, write_granted_at = NULL
WHERE access_token IS NOT NULL OR access_token_secret IS NOT NULL OR write_granted_at IS NOT NULL;
