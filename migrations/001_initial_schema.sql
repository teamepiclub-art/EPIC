-- Migration 001: Initial Schema for EPIC CLUB Registration System
-- Engine: SQLite (node:sqlite / SQLite 3.40+)

-- 1. Administrators Table
CREATE TABLE IF NOT EXISTS admins (
    id TEXT PRIMARY KEY,
    username TEXT COLLATE NOCASE UNIQUE NOT NULL,
    full_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'Admin' CHECK (role IN ('SuperAdmin', 'Admin', 'Reviewer')),
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- 2. Admin Sessions Table
CREATE TABLE IF NOT EXISTS admin_sessions (
    token TEXT PRIMARY KEY,
    admin_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    FOREIGN KEY (admin_id) REFERENCES admins (id) ON DELETE CASCADE
);

-- 3. System Settings Table (Key-Value configuration)
CREATE TABLE IF NOT EXISTS system_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- 4. Registrations Table
CREATE TABLE IF NOT EXISTS registrations (
    id TEXT PRIMARY KEY,                             -- Internal unique identifier (e.g. UUID)
    registration_number TEXT UNIQUE NOT NULL,        -- Unique public reference (e.g. EPIC-2026-XXXX)
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    telegram_username TEXT NOT NULL,
    telegram_chat_id INTEGER,                        -- Nullable until verified through Telegram
    phone_number TEXT NOT NULL,
    normalized_phone TEXT NOT NULL,                  -- Stripped & normalized for duplicate enforcement
    status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Confirmed', 'Rejected')),
    linking_token TEXT UNIQUE NOT NULL,              -- Deep-link token for Telegram bot
    telegram_linked_at TEXT,
    telegram_invite_status TEXT NOT NULL DEFAULT 'Not Sent' CHECK (
        telegram_invite_status IN ('Not Sent', 'Pending Linking', 'Sent', 'Delivered', 'Failed', 'Joined', 'Revoked')
    ),
    rejection_reason TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    confirmed_at TEXT,
    confirmed_by TEXT,
    FOREIGN KEY (confirmed_by) REFERENCES admins (id) ON DELETE SET NULL
);

-- 5. Invitations Table
CREATE TABLE IF NOT EXISTS invitations (
    id TEXT PRIMARY KEY,                             -- Unique invitation record identifier
    registration_id TEXT NOT NULL,
    target_group_identifier TEXT NOT NULL,
    invite_link TEXT,
    expiry_timestamp INTEGER DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'Pending' CHECK (
        status IN ('Pending', 'Pending Linking', 'Sent', 'Delivered', 'Failed', 'Revoked', 'Joined')
    ),
    created_at TEXT NOT NULL,
    sent_at TEXT,
    revoked_at TEXT,
    last_error TEXT,                                 -- Sanitized error message without secrets
    FOREIGN KEY (registration_id) REFERENCES registrations (id) ON DELETE CASCADE
);

-- 6. Admin Audit Log Table
CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_id TEXT NOT NULL,
    actor_username TEXT NOT NULL,
    action TEXT NOT NULL,
    affected_registration_id TEXT,
    outcome TEXT NOT NULL CHECK (outcome IN ('SUCCESS', 'FAILURE')),
    details TEXT,                                    -- Safe JSON or descriptive text
    ip_address TEXT,
    created_at TEXT NOT NULL
);
