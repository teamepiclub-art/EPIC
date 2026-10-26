/**
 * PostgreSQL Database Layer for EPIC CLUB - Vercel Serverless
 * Uses @neondatabase/serverless for HTTP-based PostgreSQL connections
 */

const { neon } = require('@neondatabase/serverless');
const crypto = require('crypto');

let _sql = null;
let _schemaInitialized = false;

function getDb() {
  if (!_sql) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL environment variable is required. Please set DATABASE_URL in Vercel Project Settings.');
    }
    _sql = neon(connectionString);
  }
  return _sql;
}

async function ensureSchema() {
  if (_schemaInitialized) return;
  try {
    const sql = getDb();
    const rows = await sql`
      SELECT 1 FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_name = 'registrations'
    `;
    if (rows.length === 0) {
      console.log('Database tables not found. Automatically initializing schema...');
      await initializeSchema();
      await ensureDefaultAdmin();
    }
    _schemaInitialized = true;
  } catch (err) {
    if (err.message && !err.message.includes('DATABASE_URL')) {
      try {
        await initializeSchema();
        await ensureDefaultAdmin();
        _schemaInitialized = true;
      } catch (initErr) {
        console.error('Auto schema initialization error:', initErr);
      }
    } else {
      throw err;
    }
  }
}

// =====================================================================
// SCHEMA INITIALIZATION (run once via /api/admin/init-db)
// =====================================================================

async function initializeSchema() {
  const sql = getDb();

  await sql`
    CREATE TABLE IF NOT EXISTS admins (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      full_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'Admin' CHECK (role IN ('SuperAdmin', 'Admin', 'Reviewer')),
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS admin_sessions (
      token TEXT PRIMARY KEY,
      admin_id TEXT NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at BIGINT NOT NULL
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS registrations (
      id TEXT PRIMARY KEY,
      registration_number TEXT UNIQUE NOT NULL,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      telegram_username TEXT NOT NULL,
      telegram_chat_id BIGINT,
      phone_number TEXT NOT NULL,
      normalized_phone TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Confirmed', 'Rejected')),
      linking_token TEXT UNIQUE NOT NULL,
      linking_token_expires_at TIMESTAMPTZ,
      linking_token_consumed_at TIMESTAMPTZ,
      telegram_linked_at TIMESTAMPTZ,
      telegram_invite_status TEXT NOT NULL DEFAULT 'Not Sent'
        CHECK (telegram_invite_status IN ('Not Sent', 'Pending Linking', 'Sent', 'Delivered', 'Failed', 'Joined', 'Revoked')),
      rejection_reason TEXT,
      field_of_study TEXT,
      academic_year TEXT,
      matricule TEXT,
      primary_department TEXT,
      secondary_department TEXT,
      motivation TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      confirmed_at TIMESTAMPTZ,
      confirmed_by TEXT REFERENCES admins(id) ON DELETE SET NULL
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS invitations (
      id TEXT PRIMARY KEY,
      registration_id TEXT NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
      target_group_identifier TEXT NOT NULL,
      invite_link TEXT,
      expiry_timestamp BIGINT DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'Pending'
        CHECK (status IN ('Pending', 'Pending Linking', 'Sent', 'Delivered', 'Failed', 'Revoked', 'Joined')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      sent_at TIMESTAMPTZ,
      revoked_at TIMESTAMPTZ,
      last_error TEXT
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id BIGSERIAL PRIMARY KEY,
      actor_id TEXT NOT NULL,
      actor_username TEXT NOT NULL,
      action TEXT NOT NULL,
      affected_registration_id TEXT,
      outcome TEXT NOT NULL CHECK (outcome IN ('SUCCESS', 'FAILURE')),
      details TEXT,
      ip_address TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  // Indexes
  await sql`CREATE INDEX IF NOT EXISTS idx_regs_status ON registrations(status)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_regs_phone ON registrations(normalized_phone)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_regs_token ON registrations(linking_token)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_regs_chat ON registrations(telegram_chat_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_audit_reg ON audit_logs(affected_registration_id)`;

  return { success: true, message: 'Schema initialized' };
}

// =====================================================================
// SETTINGS
// =====================================================================

async function getSetting(key, defaultValue = '') {
  await ensureSchema();
  const sql = getDb();
  const rows = await sql`SELECT value FROM system_settings WHERE key = ${key}`;
  return rows.length > 0 ? rows[0].value : defaultValue;
}

async function getAllSettings() {
  await ensureSchema();
  const sql = getDb();
  const rows = await sql`SELECT key, value FROM system_settings`;
  const map = {};
  for (const r of rows) map[r.key] = r.value;
  const envToken = process.env.TELEGRAM_BOT_TOKEN;
  const envUsername = process.env.TELEGRAM_BOT_USERNAME;
  if (envToken) map.telegramBotToken = envToken;
  if (envUsername) map.telegramBotUsername = envUsername;
  return map;
}

async function setSetting(key, value) {
  await ensureSchema();
  const sql = getDb();
  await sql`
    INSERT INTO system_settings (key, value, updated_at)
    VALUES (${key}, ${String(value)}, NOW())
    ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `;
}

// =====================================================================
// ADMINS & SESSIONS
// =====================================================================

async function getAdminByUsername(username) {
  if (!username) return null;
  await ensureSchema();
  const sql = getDb();
  const rows = await sql`SELECT * FROM admins WHERE LOWER(username) = LOWER(${username.trim()})`;
  return rows[0] || null;
}

async function getAdminById(adminId) {
  if (!adminId) return null;
  const sql = getDb();
  const rows = await sql`SELECT id, username, full_name, role, created_at FROM admins WHERE id = ${adminId}`;
  return rows[0] || null;
}

async function createAdminSession(adminId, token, expiresAt) {
  const sql = getDb();
  await sql`INSERT INTO admin_sessions (token, admin_id, expires_at) VALUES (${token}, ${adminId}, ${expiresAt})`;
}

async function getAdminSession(token) {
  if (!token) return null;
  const sql = getDb();
  const rows = await sql`
    SELECT s.token, s.expires_at, a.id AS admin_id, a.username, a.full_name, a.role
    FROM admin_sessions s
    JOIN admins a ON s.admin_id = a.id
    WHERE s.token = ${token}
  `;
  const session = rows[0];
  if (!session) return null;
  if (Date.now() > Number(session.expires_at)) {
    await deleteAdminSession(token);
    return null;
  }
  return session;
}

async function deleteAdminSession(token) {
  if (!token) return;
  const sql = getDb();
  await sql`DELETE FROM admin_sessions WHERE token = ${token}`;
}

async function ensureDefaultAdmin() {
  const sql = getDb();
  const rows = await sql`SELECT COUNT(*) AS count FROM admins`;
  if (Number(rows[0].count) > 0) return;

  const adminUser = process.env.ADMIN_DEFAULT_USERNAME || 'admin';
  const adminPass = process.env.ADMIN_DEFAULT_PASSWORD || 'EpicAdmin2026!';
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(adminPass, salt, 100000, 64, 'sha512').toString('hex');
  const now = new Date().toISOString();

  await sql`
    INSERT INTO admins (id, username, full_name, role, password_hash, salt, created_at, updated_at)
    VALUES ('admin-root-01', ${adminUser}, 'EPIC System Administrator', 'SuperAdmin', ${hash}, ${salt}, ${now}, ${now})
    ON CONFLICT(id) DO NOTHING
  `;

  // Seed default settings
  const defaultSettings = {
    telegramBotUsername: process.env.TELEGRAM_BOT_USERNAME || 'epic_club_setif_bot',
    defaultTargetChatId: process.env.TELEGRAM_TARGET_CHAT_ID || '',
    defaultExpiryHours: '48'
  };
  for (const [k, v] of Object.entries(defaultSettings)) {
    await sql`
      INSERT INTO system_settings (key, value) VALUES (${k}, ${v})
      ON CONFLICT(key) DO NOTHING
    `;
  }
}

// =====================================================================
// REGISTRATIONS
// =====================================================================

async function createRegistration({
  firstName, lastName, telegramUsername, phoneNumber, normalizedPhone,
  fieldOfStudy = null, academicYear = null, matricule = null,
  primaryDepartment = null, secondaryDepartment = null, motivation = null
}) {
  await ensureSchema();
  const sql = getDb();
  const internalId = crypto.randomUUID();

  // Generate unique registration number
  let registrationNumber = '';
  let isUnique = false;
  while (!isUnique) {
    const randNum = Math.floor(1000 + Math.random() * 9000);
    registrationNumber = `EPIC-2026-${randNum}`;
    const existing = await sql`SELECT 1 FROM registrations WHERE registration_number = ${registrationNumber}`;
    if (existing.length === 0) isUnique = true;
  }

  const tokenSecret = crypto.randomBytes(16).toString('base64url');
  const linkingToken = `link_${tokenSecret}`;
  const tokenExpiryHours = parseInt(process.env.LINKING_TOKEN_EXPIRY_HOURS, 10) || 48;
  const linkingTokenExpiresAt = new Date(Date.now() + tokenExpiryHours * 3600 * 1000).toISOString();
  const now = new Date().toISOString();

  await sql`
    INSERT INTO registrations (
      id, registration_number, first_name, last_name, telegram_username,
      telegram_chat_id, phone_number, normalized_phone, status,
      linking_token, linking_token_expires_at, telegram_invite_status,
      field_of_study, academic_year, matricule,
      primary_department, secondary_department, motivation,
      created_at, updated_at
    ) VALUES (
      ${internalId}, ${registrationNumber}, ${firstName}, ${lastName},
      ${telegramUsername}, NULL, ${phoneNumber}, ${normalizedPhone}, 'Pending',
      ${linkingToken}, ${linkingTokenExpiresAt}, 'Not Sent',
      ${fieldOfStudy}, ${academicYear}, ${matricule},
      ${primaryDepartment}, ${secondaryDepartment}, ${motivation},
      ${now}, ${now}
    )
  `;

  await createAuditLog({
    actorId: 'applicant',
    actorUsername: 'Applicant',
    action: 'REGISTRATION_SUBMITTED',
    affectedRegistrationId: registrationNumber,
    outcome: 'SUCCESS',
    details: 'Initial online application received'
  });

  return getRegistrationByIdOrNumber(registrationNumber);
}

async function findDuplicateActiveRegistration(normalizedPhone, telegramUsername) {
  await ensureSchema();
  const sql = getDb();
  const rows = await sql`
    SELECT registration_number, status, phone_number, telegram_username, created_at
    FROM registrations
    WHERE status IN ('Pending', 'Confirmed')
      AND (normalized_phone = ${normalizedPhone} OR LOWER(telegram_username) = LOWER(${telegramUsername}))
    LIMIT 1
  `;
  return rows[0] || null;
}

async function getRegistrationByIdOrNumber(idOrNumber) {
  if (!idOrNumber) return null;
  await ensureSchema();
  const sql = getDb();
  const rows = await sql`
    SELECT
      r.*,
      a.full_name AS confirmed_by_name,
      a.username AS confirmed_by_username,
      inv.invite_link,
      inv.target_group_identifier,
      inv.expiry_timestamp,
      inv.status AS invitation_status,
      inv.sent_at AS invitation_sent_at,
      inv.last_error AS invitation_error
    FROM registrations r
    LEFT JOIN admins a ON r.confirmed_by = a.id
    LEFT JOIN invitations inv ON inv.registration_id = r.id
    WHERE r.id = ${idOrNumber} OR r.registration_number = ${idOrNumber}
    LIMIT 1
  `;
  if (!rows[0]) return null;
  return formatRegistrationRecord(sql, rows[0]);
}

async function getRegistrationByLinkingToken(token) {
  if (!token) return null;
  const sql = getDb();
  const rows = await sql`
    SELECT
      r.*,
      a.full_name AS confirmed_by_name,
      a.username AS confirmed_by_username,
      inv.invite_link,
      inv.target_group_identifier,
      inv.expiry_timestamp,
      inv.status AS invitation_status,
      inv.sent_at AS invitation_sent_at,
      inv.last_error AS invitation_error
    FROM registrations r
    LEFT JOIN admins a ON r.confirmed_by = a.id
    LEFT JOIN invitations inv ON inv.registration_id = r.id
    WHERE r.linking_token = ${token}
       OR r.registration_number = ${token}
       OR ('link_' || r.registration_number) = ${token}
    LIMIT 1
  `;
  if (!rows[0]) return null;
  return formatRegistrationRecord(sql, rows[0]);
}

async function getRegistrationByChatId(chatId) {
  if (!chatId) return null;
  const sql = getDb();
  const rows = await sql`
    SELECT
      r.*,
      a.full_name AS confirmed_by_name,
      a.username AS confirmed_by_username,
      inv.invite_link,
      inv.target_group_identifier,
      inv.expiry_timestamp,
      inv.status AS invitation_status,
      inv.sent_at AS invitation_sent_at,
      inv.last_error AS invitation_error
    FROM registrations r
    LEFT JOIN admins a ON r.confirmed_by = a.id
    LEFT JOIN invitations inv ON inv.registration_id = r.id
    WHERE r.telegram_chat_id = ${chatId}
    LIMIT 1
  `;
  if (!rows[0]) return null;
  return formatRegistrationRecord(sql, rows[0]);
}

async function findActiveRegistrationByChatId(chatId, excludeInternalId = null) {
  if (!chatId) return null;
  const sql = getDb();
  let rows;
  if (excludeInternalId) {
    rows = await sql`
      SELECT registration_number, first_name, last_name, status
      FROM registrations
      WHERE telegram_chat_id = ${chatId}
        AND status IN ('Pending', 'Confirmed')
        AND id != ${excludeInternalId}
      LIMIT 1
    `;
  } else {
    rows = await sql`
      SELECT registration_number, first_name, last_name, status
      FROM registrations
      WHERE telegram_chat_id = ${chatId}
        AND status IN ('Pending', 'Confirmed')
      LIMIT 1
    `;
  }
  return rows[0] || null;
}

async function linkTelegramChat(idOrNumber, chatId) {
  const reg = await getRegistrationByIdOrNumber(idOrNumber);
  if (!reg) return { success: false, error: 'NOT_FOUND', message: 'Registration record not found.' };

  if (reg.linkingTokenConsumedAt) {
    await createAuditLog({
      actorId: 'telegram_bot', actorUsername: 'Telegram Bot',
      action: 'TELEGRAM_LINK_REJECTED', affectedRegistrationId: reg.registrationNumber,
      outcome: 'FAILURE', details: `Rejected: Token already consumed on ${reg.linkingTokenConsumedAt}`
    });
    return { success: false, error: 'TOKEN_ALREADY_USED', message: 'This Telegram verification link has already been used.' };
  }

  if (reg.linkingTokenExpiresAt && new Date(reg.linkingTokenExpiresAt) < new Date()) {
    await createAuditLog({
      actorId: 'telegram_bot', actorUsername: 'Telegram Bot',
      action: 'TELEGRAM_LINK_REJECTED', affectedRegistrationId: reg.registrationNumber,
      outcome: 'FAILURE', details: `Rejected: Token expired at ${reg.linkingTokenExpiresAt}`
    });
    return { success: false, error: 'TOKEN_EXPIRED', message: 'This Telegram verification link has expired.' };
  }

  const existingActive = await findActiveRegistrationByChatId(chatId, reg.internalId);
  if (existingActive) {
    return { success: false, error: 'CROSS_ACCOUNT_PROHIBITED', message: `This Telegram account is already linked to another registration.` };
  }

  const sql = getDb();
  const now = new Date().toISOString();
  await sql`
    UPDATE registrations
    SET telegram_chat_id = ${chatId},
        telegram_linked_at = ${now},
        linking_token_consumed_at = ${now},
        updated_at = ${now}
    WHERE id = ${reg.internalId}
  `;

  await createAuditLog({
    actorId: 'participant', actorUsername: 'Participant',
    action: 'TELEGRAM_ACCOUNT_VERIFIED', affectedRegistrationId: reg.registrationNumber,
    outcome: 'SUCCESS', details: `Telegram Chat ID ${chatId} verified and linked.`
  });

  return { success: true, registration: await getRegistrationByIdOrNumber(reg.internalId) };
}

async function updateRegistrationStatus(idOrNumber, { status, confirmedBy, rejectionReason, telegramInviteStatus }) {
  const reg = await getRegistrationByIdOrNumber(idOrNumber);
  if (!reg) return null;

  const sql = getDb();
  const now = new Date().toISOString();
  let confirmedAt = reg.confirmedAt;
  let confirmedById = reg.confirmedBy;

  if (status === 'Confirmed') {
    confirmedAt = now;
    confirmedById = confirmedBy || reg.confirmedBy;
    rejectionReason = null;
  } else if (status === 'Rejected') {
    confirmedAt = null;
    confirmedById = null;
  }

  const inviteStatus = telegramInviteStatus !== undefined ? telegramInviteStatus : reg.telegramInviteStatus;

  await sql`
    UPDATE registrations
    SET status = ${status},
        confirmed_at = ${confirmedAt || null},
        confirmed_by = ${confirmedById || null},
        rejection_reason = ${rejectionReason || null},
        telegram_invite_status = ${inviteStatus},
        updated_at = ${now}
    WHERE id = ${reg.internalId}
  `;
  return getRegistrationByIdOrNumber(reg.internalId);
}

async function updateTelegramInviteStatus(idOrNumber, newStatus) {
  const reg = await getRegistrationByIdOrNumber(idOrNumber);
  if (!reg) return null;
  const sql = getDb();
  const now = new Date().toISOString();
  await sql`
    UPDATE registrations
    SET telegram_invite_status = ${newStatus}, updated_at = ${now}
    WHERE id = ${reg.internalId}
  `;
  return getRegistrationByIdOrNumber(reg.internalId);
}

async function listRegistrations({ search = '', status = 'All', telegramStatus = 'All', page = 1, limit = 10 }) {
  const sql = getDb();
  const safeLimit = Math.max(1, Math.min(limit, 100));
  const offset = (Math.max(1, page) - 1) * safeLimit;

  // Build conditions
  const conditions = [];
  const params = [];

  if (status && status !== 'All') {
    conditions.push(`r.status = $${params.length + 1}`);
    params.push(status);
  }
  if (telegramStatus && telegramStatus !== 'All') {
    conditions.push(`r.telegram_invite_status = $${params.length + 1}`);
    params.push(telegramStatus);
  }
  if (search && search.trim()) {
    const term = `%${search.trim().toLowerCase()}%`;
    conditions.push(`(
      LOWER(r.registration_number) LIKE $${params.length + 1} OR
      LOWER(r.first_name) LIKE $${params.length + 1} OR
      LOWER(r.last_name) LIKE $${params.length + 1} OR
      LOWER(r.first_name || ' ' || r.last_name) LIKE $${params.length + 1} OR
      LOWER(r.telegram_username) LIKE $${params.length + 1}
    )`);
    params.push(term);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // We use raw queries for dynamic filtering with neon
  // neon template tag doesn't support dynamic WHERE easily, use a workaround
  const countQuery = `SELECT COUNT(*) AS total FROM registrations r ${where}`;
  const countRows = await sql(countQuery, params);
  const totalCount = parseInt(countRows[0]?.total || 0, 10);

  const totalPages = Math.max(1, Math.ceil(totalCount / safeLimit));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const actualOffset = (safePage - 1) * safeLimit;

  const dataQuery = `
    SELECT
      r.*,
      a.full_name AS confirmed_by_name,
      a.username AS confirmed_by_username,
      inv.invite_link,
      inv.target_group_identifier,
      inv.expiry_timestamp,
      inv.status AS invitation_status,
      inv.sent_at AS invitation_sent_at,
      inv.last_error AS invitation_error
    FROM registrations r
    LEFT JOIN admins a ON r.confirmed_by = a.id
    LEFT JOIN invitations inv ON inv.registration_id = r.id
    ${where}
    ORDER BY r.created_at DESC
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}
  `;
  const dataRows = await sql(dataQuery, [...params, safeLimit, actualOffset]);

  const items = [];
  for (const row of (dataRows || [])) {
    items.push(await formatRegistrationRecord(sql, row));
  }

  return {
    items,
    page: safePage,
    limit: safeLimit,
    totalCount,
    totalPages,
    summary: await getRegistrationsSummary()
  };
}

async function getRegistrationsSummary() {
  const sql = getDb();
  const rows = await sql`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'Pending' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN status = 'Confirmed' THEN 1 ELSE 0 END) AS confirmed,
      SUM(CASE WHEN status = 'Rejected' THEN 1 ELSE 0 END) AS rejected,
      SUM(CASE WHEN telegram_invite_status = 'Delivered' THEN 1 ELSE 0 END) AS delivered,
      SUM(CASE WHEN telegram_invite_status = 'Pending Linking' THEN 1 ELSE 0 END) AS "pendingLinking",
      SUM(CASE WHEN telegram_invite_status = 'Failed' THEN 1 ELSE 0 END) AS failed
    FROM registrations
  `;
  const row = rows[0];
  return {
    total: parseInt(row.total, 10) || 0,
    pending: parseInt(row.pending, 10) || 0,
    confirmed: parseInt(row.confirmed, 10) || 0,
    rejected: parseInt(row.rejected, 10) || 0,
    delivered: parseInt(row.delivered, 10) || 0,
    pendingLinking: parseInt(row.pendingLinking, 10) || 0,
    failed: parseInt(row.failed, 10) || 0
  };
}

// =====================================================================
// INVITATIONS
// =====================================================================

async function getInvitationByRegistrationId(registrationId) {
  if (!registrationId) return null;
  const sql = getDb();
  const rows = await sql`
    SELECT * FROM invitations
    WHERE registration_id = ${registrationId}
       OR registration_id IN (SELECT id FROM registrations WHERE registration_number = ${registrationId})
    ORDER BY created_at DESC
    LIMIT 1
  `;
  return rows[0] || null;
}

async function saveInvitation({ registrationId, targetGroupIdentifier, inviteLink, expiryTimestamp = 0, status = 'Pending', sentAt = null, revokedAt = null, lastError = null }) {
  const sql = getDb();
  let internalRegId = registrationId;
  const reg = await getRegistrationByIdOrNumber(registrationId);
  if (reg) internalRegId = reg.internalId;

  const existing = await getInvitationByRegistrationId(internalRegId);
  const now = new Date().toISOString();
  const safeStatus = status === 'Pending Linking' ? 'Pending' : status;

  if (existing) {
    await sql`
      UPDATE invitations
      SET target_group_identifier = ${targetGroupIdentifier},
          invite_link = ${inviteLink},
          expiry_timestamp = ${expiryTimestamp},
          status = ${safeStatus},
          sent_at = COALESCE(${sentAt || null}, sent_at),
          revoked_at = COALESCE(${revokedAt || null}, revoked_at),
          last_error = ${lastError || null}
      WHERE id = ${existing.id}
    `;
  } else {
    const invId = crypto.randomUUID();
    await sql`
      INSERT INTO invitations (id, registration_id, target_group_identifier, invite_link, expiry_timestamp, status, sent_at, revoked_at, last_error)
      VALUES (${invId}, ${internalRegId}, ${targetGroupIdentifier}, ${inviteLink}, ${expiryTimestamp}, ${safeStatus}, ${sentAt || null}, ${revokedAt || null}, ${lastError || null})
    `;
  }
  return getInvitationByRegistrationId(internalRegId);
}

async function revokeInvitation(registrationId) {
  const existing = await getInvitationByRegistrationId(registrationId);
  if (!existing) return null;
  const sql = getDb();
  const now = new Date().toISOString();
  await sql`UPDATE invitations SET status = 'Revoked', revoked_at = ${now} WHERE id = ${existing.id}`;
  return getInvitationByRegistrationId(registrationId);
}

// =====================================================================
// AUDIT LOGS
// =====================================================================

async function createAuditLog({ actorId, actorUsername, action, affectedRegistrationId = null, outcome = 'SUCCESS', details = '', ipAddress = null }) {
  const sql = getDb();
  const cleanDetails = typeof details === 'object' ? JSON.stringify(details) : String(details || '');
  await sql`
    INSERT INTO audit_logs (actor_id, actor_username, action, affected_registration_id, outcome, details, ip_address)
    VALUES (
      ${actorId || 'system'}, ${actorUsername || 'system'}, ${action},
      ${affectedRegistrationId || null}, ${outcome},
      ${cleanDetails}, ${ipAddress || null}
    )
  `;
}

async function listAuditLogs({ registrationId = null, actorId = null, limit = 50, offset = 0 } = {}) {
  const sql = getDb();
  if (registrationId && actorId) {
    return sql`SELECT * FROM audit_logs WHERE affected_registration_id = ${registrationId} AND actor_id = ${actorId} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`;
  } else if (registrationId) {
    return sql`SELECT * FROM audit_logs WHERE affected_registration_id = ${registrationId} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`;
  } else if (actorId) {
    return sql`SELECT * FROM audit_logs WHERE actor_id = ${actorId} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`;
  }
  return sql`SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`;
}

// =====================================================================
// INTERNAL HELPER
// =====================================================================

async function formatRegistrationRecord(sql, row) {
  if (!row) return null;

  const history = await sql`
    SELECT action, created_at AS timestamp, actor_username AS "performedBy", details AS note
    FROM audit_logs
    WHERE affected_registration_id = ${row.registration_number}
    ORDER BY created_at ASC
  `;

  let invitationObj = null;
  if (row.invite_link || row.target_group_identifier) {
    invitationObj = {
      inviteLink: row.invite_link,
      targetChatId: row.target_group_identifier,
      memberLimit: 1,
      expireDate: row.expiry_timestamp,
      createdAt: row.created_at,
      deliveryStatus: row.invitation_status || 'Pending',
      deliveryError: row.invitation_error || null,
      sentAt: row.invitation_sent_at || null,
      isRevoked: row.invitation_status === 'Revoked'
    };
  }

  return {
    id: row.registration_number,
    internalId: row.id,
    registrationNumber: row.registration_number,
    firstName: row.first_name,
    lastName: row.last_name,
    telegramUsername: row.telegram_username,
    phoneNumber: row.phone_number,
    normalizedPhone: row.normalized_phone,
    status: row.status,
    telegramLinked: Boolean(row.telegram_chat_id),
    telegramChatId: row.telegram_chat_id,
    linkingToken: row.linking_token,
    linkingTokenExpiresAt: row.linking_token_expires_at || null,
    linkingTokenConsumedAt: row.linking_token_consumed_at || null,
    isLinkingTokenValid: !row.linking_token_consumed_at && (!row.linking_token_expires_at || new Date(row.linking_token_expires_at) > new Date()),
    telegramInviteStatus: row.telegram_invite_status,
    fieldOfStudy: row.field_of_study || '',
    academicYear: row.academic_year || '',
    matricule: row.matricule || '',
    primaryDepartment: row.primary_department || '',
    secondaryDepartment: row.secondary_department || '',
    motivation: row.motivation || '',
    rejectionReason: row.rejection_reason,
    confirmedAt: row.confirmed_at,
    confirmedBy: row.confirmed_by_username || row.confirmed_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    invitation: invitationObj,
    history: history
  };
}

module.exports = {
  initializeSchema,
  ensureDefaultAdmin,
  getSetting,
  getAllSettings,
  setSetting,
  getAdminByUsername,
  getAdminById,
  createAdminSession,
  getAdminSession,
  deleteAdminSession,
  createRegistration,
  findDuplicateActiveRegistration,
  getRegistrationByIdOrNumber,
  getRegistrationByLinkingToken,
  getRegistrationByChatId,
  findActiveRegistrationByChatId,
  linkTelegramChat,
  updateRegistrationStatus,
  updateTelegramInviteStatus,
  listRegistrations,
  getRegistrationsSummary,
  getInvitationByRegistrationId,
  saveInvitation,
  revokeInvitation,
  createAuditLog,
  listAuditLogs
};
