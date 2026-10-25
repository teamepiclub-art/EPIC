-- Migration 002: Indexes and Constraints for EPIC CLUB System
-- Optimizes registration queries, duplicate prevention, and audit lookups

-- Indexes for registrations table
CREATE INDEX IF NOT EXISTS idx_registrations_reg_num ON registrations (registration_number);
CREATE INDEX IF NOT EXISTS idx_registrations_status ON registrations (status);
CREATE INDEX IF NOT EXISTS idx_registrations_normalized_phone ON registrations (normalized_phone);
CREATE INDEX IF NOT EXISTS idx_registrations_telegram_user ON registrations (telegram_username COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_registrations_telegram_chat ON registrations (telegram_chat_id);
CREATE INDEX IF NOT EXISTS idx_registrations_created_at ON registrations (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_registrations_confirmed_by ON registrations (confirmed_by);

-- Unique index to prevent duplicate active registrations by normalized phone
-- (applicants cannot hold multiple Pending or Confirmed registrations with the same phone)
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_registration_phone
ON registrations (normalized_phone)
WHERE status IN ('Pending', 'Confirmed');

-- Indexes for invitations table
CREATE INDEX IF NOT EXISTS idx_invitations_registration ON invitations (registration_id);
CREATE INDEX IF NOT EXISTS idx_invitations_status ON invitations (status);
CREATE INDEX IF NOT EXISTS idx_invitations_created_at ON invitations (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invitations_target ON invitations (target_group_identifier);

-- Indexes for audit logs
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs (actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_registration ON audit_logs (affected_registration_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs (action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs (created_at DESC);

-- Indexes for admin sessions
CREATE INDEX IF NOT EXISTS idx_admin_sessions_admin ON admin_sessions (admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires ON admin_sessions (expires_at);
