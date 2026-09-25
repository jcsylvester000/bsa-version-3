-- F-26: server-side session revocation cut-off. Any JWT issued before this instant is rejected
-- by getSession, so logout / password change / role change take effect immediately.
ALTER TABLE "app_user" ADD COLUMN IF NOT EXISTS "sessions_valid_after" timestamptz(6);
