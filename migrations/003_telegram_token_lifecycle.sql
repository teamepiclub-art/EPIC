-- Migration 003: Telegram Token Lifecycle and Verification Controls
-- Adds token expiration, consumption tracking, and indexes

-- Add token lifecycle columns to registrations
ALTER TABLE registrations ADD COLUMN linking_token_expires_at TEXT;
ALTER TABLE registrations ADD COLUMN linking_token_consumed_at TEXT;

-- Create index on linking token for fast deep link lookup
CREATE INDEX IF NOT EXISTS idx_registrations_linking_token ON registrations (linking_token);
