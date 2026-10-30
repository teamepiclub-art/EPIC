/**
 * Database Access Layer for EPIC CLUB Registration System
 * Built on node:sqlite (Node.js 22.5+ / 25+ native SQLite engine)
 * Zero external dependencies, ACID compliant, full parameterized SQL injection protection
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const config = require('../utils/env');
const logger = require('../utils/logger');
const { runMigrations } = require('./migrations');

// Ensure database directory exists
const dbDir = path.dirname(config.DATABASE_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// Initialize SQLite connection
const db = new DatabaseSync(config.DATABASE_PATH);

// Configure SQLite PRAGMAs for performance, concurrency and data integrity
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA synchronous = NORMAL;');

// Run automatic migrations
runMigrations(db);

// Initial bootstrap: seed settings, admin, and import existing JSON records if database is empty
bootstrapDatabase(db);

function bootstrapDatabase(database) {
  // 1. Seed or import admins
  const countAdminsStmt = database.prepare('SELECT COUNT(*) AS count FROM admins');
  const adminCount = countAdminsStmt.get().count;

  if (adminCount === 0) {
    const jsonAdminsFile = path.join(dbDir, 'admins.json');
    let imported = false;

    if (fs.existsSync(jsonAdminsFile)) {
      try {
        const raw = fs.readFileSync(jsonAdminsFile, 'utf8');
        const jsonAdmins = JSON.parse(raw);
        if (Array.isArray(jsonAdmins) && jsonAdmins.length > 0) {
          const insertStmt = database.prepare(`
            INSERT INTO admins (id, username, full_name, role, password_hash, salt, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `);
          for (const a of jsonAdmins) {
            insertStmt.run(
              a.id || `admin-${crypto.randomUUID()}`,
              a.username,
              a.fullName || 'Administrator',
              a.role || 'SuperAdmin',
              a.hash,
              a.salt,
              a.createdAt || new Date().toISOString(),
              new Date().toISOString()
            );
          }
          logger.info('DB_BOOTSTRAP', { message: `Imported ${jsonAdmins.length} admins from JSON` });
          imported = true;
        }
      } catch (e) {
        logger.error('DB_BOOTSTRAP', e, { message: 'Failed to import admins.json' });
      }
    }

    if (!imported) {
      // Seed default admin account
      const salt = crypto.randomBytes(16).toString('hex');
      const hash = crypto.pbkdf2Sync(config.ADMIN_DEFAULT_PASSWORD, salt, 100000, 64, 'sha512').toString('hex');
      const insertDefaultAdmin = database.prepare(`
        INSERT INTO admins (id, username, full_name, role, password_hash, salt, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const now = new Date().toISOString();
      insertDefaultAdmin.run(
        'admin-root-01',
        config.ADMIN_DEFAULT_USERNAME,
        'EPIC System Administrator',
        'SuperAdmin',
        hash,
        salt,
        now,
        now
      );
      logger.info('DB_BOOTSTRAP', { message: 'Seeded default SuperAdmin account' });
    }
  }

  // 2. Seed or import system settings
  const countSettingsStmt = database.prepare('SELECT COUNT(*) AS count FROM system_settings');
  if (countSettingsStmt.get().count === 0) {
    const jsonSettingsFile = path.join(dbDir, 'settings.json');
    let settingsObj = {
      telegramBotToken: config.TELEGRAM_BOT_TOKEN,
      telegramBotUsername: config.TELEGRAM_BOT_USERNAME,
      defaultTargetChatId: config.TELEGRAM_TARGET_CHAT_ID,
      defaultExpiryHours: String(config.DEFAULT_EXPIRY_HOURS)
    };

    if (fs.existsSync(jsonSettingsFile)) {
      try {
        const raw = fs.readFileSync(jsonSettingsFile, 'utf8');
        const parsed = JSON.parse(raw);
        settingsObj = Object.assign(settingsObj, parsed);
      } catch (e) {
        logger.error('DB_BOOTSTRAP', e, { message: 'Failed to read settings.json' });
      }
    }

    const insertSettingStmt = database.prepare(`
      INSERT OR REPLACE INTO system_settings (key, value, updated_at)
      VALUES (?, ?, ?)
    `);
    const now = new Date().toISOString();
    for (const [k, v] of Object.entries(settingsObj)) {
      insertSettingStmt.run(k, String(v || ''), now);
    }
  }

  // 3. Import existing registrations if table is empty
  const countRegsStmt = database.prepare('SELECT COUNT(*) AS count FROM registrations');
  if (countRegsStmt.get().count === 0) {
    const jsonRegsFile = path.join(dbDir, 'registrations.json');
    if (fs.existsSync(jsonRegsFile)) {
      try {
        const raw = fs.readFileSync(jsonRegsFile, 'utf8');
        const records = JSON.parse(raw);
        if (Array.isArray(records) && records.length > 0) {
          const insertRegStmt = database.prepare(`
            INSERT INTO registrations (
              id, registration_number, first_name, last_name, telegram_username,
              telegram_chat_id, phone_number, normalized_phone, status,
              linking_token, telegram_linked_at, telegram_invite_status,
              rejection_reason, created_at, updated_at, confirmed_at, confirmed_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);

          const insertAuditStmt = database.prepare(`
            INSERT INTO audit_logs (
              actor_id, actor_username, action, affected_registration_id, outcome, details, ip_address, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `);

          const firstAdmin = database.prepare('SELECT id FROM admins LIMIT 1').get();
          const defaultAdminId = firstAdmin ? firstAdmin.id : null;

          for (const r of records) {
            const internalId = crypto.randomUUID();
            const regNumber = r.id || `EPIC-2026-${Math.floor(1000 + Math.random() * 9000)}`;
            const linkingToken = r.linkingToken || `link_${regNumber}`;
            const now = r.createdAt || new Date().toISOString();

            insertRegStmt.run(
              internalId,
              regNumber,
              r.firstName || 'Unknown',
              r.lastName || 'Applicant',
              (r.telegramUsername || '').replace(/^@+/, ''),
              r.telegramChatId ? parseInt(r.telegramChatId, 10) : null,
              r.phoneNumber || '0555000000',
              r.normalizedPhone || (r.phoneNumber || '').replace(/\D/g, ''),
              r.status || 'Pending',
              linkingToken,
              r.telegramLinkedAt || null,
              r.telegramInviteStatus || 'Not Sent',
              r.rejectionReason || null,
              now,
              now,
              r.status === 'Confirmed' ? now : null,
              r.status === 'Confirmed' ? defaultAdminId : null
            );

            // Import existing history as audit logs
            if (Array.isArray(r.history)) {
              for (const h of r.history) {
                insertAuditStmt.run(
                  h.performedBy || 'system',
                  h.performedBy || 'system',
                  h.action || 'REGISTRATION_UPDATE',
                  regNumber,
                  'SUCCESS',
                  h.note || '',
                  '127.0.0.1',
                  h.timestamp || now
                );
              }
            }
          }
          logger.info('DB_BOOTSTRAP', { message: `Imported ${records.length} registrations from JSON` });
        }
      } catch (err) {
        logger.error('DB_BOOTSTRAP', err, { message: 'Failed to import registrations.json' });
      }
    }
  }
}

// =============================================================================
// DATABASE QUERY API
// =============================================================================

const dbService = {
  // Raw instance access for testing if needed
  raw: db,

  // ---------------------------------------------------------------------------
  // SETTINGS
  // ---------------------------------------------------------------------------
  getSetting(key, defaultValue = '') {
    const stmt = db.prepare('SELECT value FROM system_settings WHERE key = ?');
    const row = stmt.get(key);
    return row ? row.value : defaultValue;
  },

  getAllSettings() {
    const stmt = db.prepare('SELECT key, value FROM system_settings');
    const rows = stmt.all();
    const map = {};
    for (const r of rows) {
      map[r.key] = r.value;
    }
    // Environment variables take precedence if specified
    if (config.TELEGRAM_BOT_TOKEN) map.telegramBotToken = config.TELEGRAM_BOT_TOKEN;
    if (config.TELEGRAM_BOT_USERNAME) map.telegramBotUsername = config.TELEGRAM_BOT_USERNAME;
    return map;
  },

  setSetting(key, value) {
    const stmt = db.prepare(`
      INSERT INTO system_settings (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `);
    stmt.run(key, String(value), new Date().toISOString());
  },

  // ---------------------------------------------------------------------------
  // ADMINISTRATORS & SESSIONS
  // ---------------------------------------------------------------------------
  getAdminByUsername(username) {
    if (!username) return null;
    const stmt = db.prepare('SELECT * FROM admins WHERE username = ? COLLATE NOCASE');
    return stmt.get(username.trim()) || null;
  },

  getAdminById(adminId) {
    if (!adminId) return null;
    const stmt = db.prepare('SELECT id, username, full_name, role, created_at FROM admins WHERE id = ?');
    return stmt.get(adminId) || null;
  },

  createAdminSession(adminId, token, expiresAt) {
    const stmt = db.prepare(`
      INSERT INTO admin_sessions (token, admin_id, created_at, expires_at)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(token, adminId, new Date().toISOString(), expiresAt);
  },

  getAdminSession(token) {
    if (!token) return null;
    const stmt = db.prepare(`
      SELECT s.token, s.expires_at, a.id AS admin_id, a.username, a.full_name, a.role
      FROM admin_sessions s
      JOIN admins a ON s.admin_id = a.id
      WHERE s.token = ?
    `);
    const session = stmt.get(token);
    if (!session) return null;

    if (Date.now() > session.expires_at) {
      this.deleteAdminSession(token);
      return null;
    }
    return session;
  },

  deleteAdminSession(token) {
    if (!token) return;
    const stmt = db.prepare('DELETE FROM admin_sessions WHERE token = ?');
    stmt.run(token);
  },

  // ---------------------------------------------------------------------------
  // REGISTRATIONS
  // ---------------------------------------------------------------------------
  createRegistration({
    firstName,
    lastName,
    telegramUsername,
    phoneNumber,
    normalizedPhone,
    fieldOfStudy = null,
    academicYear = null,
    matricule = null,
    primaryDepartment = null,
    secondaryDepartment = null,
    motivation = null
  }) {
    const internalId = crypto.randomUUID();
    let registrationNumber = '';
    let isUnique = false;

    // Generate unique public reference (EPIC-2026-XXXX)
    const checkStmt = db.prepare('SELECT 1 FROM registrations WHERE registration_number = ?');
    while (!isUnique) {
      const randNum = Math.floor(1000 + Math.random() * 9000);
      registrationNumber = `EPIC-2026-${randNum}`;
      if (!checkStmt.get(registrationNumber)) {
        isUnique = true;
      }
    }

    // Generate cryptographically secure, random, short-lived Telegram deep-link token
    const tokenSecret = crypto.randomBytes(16).toString('base64url'); // alphanumeric, URL-safe
    const linkingToken = `link_${tokenSecret}`;
    const tokenExpiryHours = config.LINKING_TOKEN_EXPIRY_HOURS || 48;
    const linkingTokenExpiresAt = new Date(Date.now() + (tokenExpiryHours * 3600 * 1000)).toISOString();
    const now = new Date().toISOString();

    const insertStmt = db.prepare(`
      INSERT INTO registrations (
        id, registration_number, first_name, last_name, telegram_username,
        telegram_chat_id, phone_number, normalized_phone, status,
        linking_token, linking_token_expires_at, linking_token_consumed_at,
        telegram_invite_status, created_at, updated_at,
        field_of_study, academic_year, matricule,
        primary_department, secondary_department, motivation
      ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, 'Pending', ?, ?, NULL, 'Not Sent', ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertStmt.run(
      internalId,
      registrationNumber,
      firstName,
      lastName,
      telegramUsername,
      phoneNumber,
      normalizedPhone,
      linkingToken,
      linkingTokenExpiresAt,
      now,
      now,
      fieldOfStudy,
      academicYear,
      matricule,
      primaryDepartment,
      secondaryDepartment,
      motivation
    );

    // Record registration audit log
    this.createAuditLog({
      actorId: 'applicant',
      actorUsername: 'Applicant',
      action: 'REGISTRATION_SUBMITTED',
      affectedRegistrationId: registrationNumber,
      outcome: 'SUCCESS',
      details: 'Initial online application received',
      ipAddress: 'client'
    });

    return this.getRegistrationByIdOrNumber(registrationNumber);
  },

  findDuplicateActiveRegistration(normalizedPhone, telegramUsername) {
    // Uniqueness rule: Phone number is the guaranteed unique identity anchor.
    // Also check active telegram username as a safeguard against immediate duplicate spam.
    const stmt = db.prepare(`
      SELECT registration_number, status, phone_number, telegram_username, created_at
      FROM registrations
      WHERE status IN ('Pending', 'Confirmed')
        AND (normalized_phone = ? OR telegram_username = ? COLLATE NOCASE)
      LIMIT 1
    `);
    return stmt.get(normalizedPhone, telegramUsername) || null;
  },

  getRegistrationByIdOrNumber(idOrNumber) {
    if (!idOrNumber) return null;
    const stmt = db.prepare(`
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
      WHERE r.id = ? OR r.registration_number = ?
    `);
    const reg = stmt.get(idOrNumber, idOrNumber);
    if (!reg) return null;
    return formatRegistrationRecord(reg);
  },

  getRegistrationByLinkingToken(token) {
    if (!token) return null;
    const stmt = db.prepare(`
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
      WHERE r.linking_token = ? COLLATE NOCASE
         OR r.registration_number = ? COLLATE NOCASE
         OR ('link_' || r.registration_number) = ? COLLATE NOCASE
    `);
    const reg = stmt.get(token, token, token);
    if (!reg) return null;
    return formatRegistrationRecord(reg);
  },

  getRegistrationByChatId(chatId) {
    if (!chatId) return null;
    const stmt = db.prepare(`
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
      WHERE r.telegram_chat_id = ?
    `);
    const reg = stmt.get(chatId);
    if (!reg) return null;
    return formatRegistrationRecord(reg);
  },

  findActiveRegistrationByChatId(chatId, excludeInternalId = null) {
    if (!chatId) return null;
    const stmt = db.prepare(`
      SELECT registration_number, first_name, last_name, status
      FROM registrations
      WHERE telegram_chat_id = ?
        AND status IN ('Pending', 'Confirmed')
        AND (? IS NULL OR id != ?)
      LIMIT 1
    `);
    return stmt.get(chatId, excludeInternalId, excludeInternalId) || null;
  },

  linkTelegramChat(idOrNumber, chatId) {
    const reg = this.getRegistrationByIdOrNumber(idOrNumber);
    if (!reg) {
      return { success: false, error: 'NOT_FOUND', message: 'Registration record not found.' };
    }

    // 1. Invalidate and reject consumed token (Token reuse protection)
    if (reg.linkingTokenConsumedAt) {
      this.createAuditLog({
        actorId: 'telegram_bot',
        actorUsername: 'Telegram Bot',
        action: 'TELEGRAM_LINK_REJECTED',
        affectedRegistrationId: reg.registrationNumber,
        outcome: 'FAILURE',
        details: `Rejected: Deep link token has already been consumed on ${reg.linkingTokenConsumedAt}`
      });
      return {
        success: false,
        error: 'TOKEN_ALREADY_USED',
        message: 'This Telegram verification link has already been used and is no longer valid.'
      };
    }

    // 2. Reject expired token (Short-lived token enforcement)
    if (reg.linkingTokenExpiresAt && new Date(reg.linkingTokenExpiresAt) < new Date()) {
      this.createAuditLog({
        actorId: 'telegram_bot',
        actorUsername: 'Telegram Bot',
        action: 'TELEGRAM_LINK_REJECTED',
        affectedRegistrationId: reg.registrationNumber,
        outcome: 'FAILURE',
        details: `Rejected: Deep link token expired at ${reg.linkingTokenExpiresAt}`
      });
      return {
        success: false,
        error: 'TOKEN_EXPIRED',
        message: 'This Telegram verification link has expired. Please check your registration reference for a new link.'
      };
    }

    // 3. Prevent cross-account registration linking (same Telegram account claiming multiple applicants)
    const existingActive = this.findActiveRegistrationByChatId(chatId, reg.internalId);
    if (existingActive) {
      this.createAuditLog({
        actorId: 'telegram_bot',
        actorUsername: 'Telegram Bot',
        action: 'TELEGRAM_LINK_REJECTED',
        affectedRegistrationId: reg.registrationNumber,
        outcome: 'FAILURE',
        details: `Rejected cross-account linking: Chat ID ${chatId} is already linked to registration ${existingActive.registration_number}`
      });
      return {
        success: false,
        error: 'CROSS_ACCOUNT_PROHIBITED',
        message: `This Telegram account is already associated with another active registration (${existingActive.registration_number}). Each applicant must verify through their personal Telegram account.`
      };
    }

    // 4. Update registration: bind chat ID, set linked_at, consume and invalidate token
    const now = new Date().toISOString();
    const updateStmt = db.prepare(`
      UPDATE registrations
      SET telegram_chat_id = ?,
          telegram_linked_at = ?,
          linking_token_consumed_at = ?,
          updated_at = ?
      WHERE id = ?
    `);
    updateStmt.run(chatId, now, now, now, reg.internalId);

    this.createAuditLog({
      actorId: 'participant',
      actorUsername: 'Participant',
      action: 'TELEGRAM_ACCOUNT_VERIFIED',
      affectedRegistrationId: reg.registrationNumber,
      outcome: 'SUCCESS',
      details: `Telegram Chat ID ${chatId} verified and linked. Single-use token consumed and invalidated.`
    });

    return {
      success: true,
      registration: this.getRegistrationByIdOrNumber(reg.internalId)
    };
  },

  updateRegistrationStatus(idOrNumber, { status, confirmedBy, rejectionReason, telegramInviteStatus }) {
    const reg = this.getRegistrationByIdOrNumber(idOrNumber);
    if (!reg) return null;

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

    const stmt = db.prepare(`
      UPDATE registrations
      SET status = ?,
          confirmed_at = ?,
          confirmed_by = ?,
          rejection_reason = ?,
          telegram_invite_status = ?,
          updated_at = ?
      WHERE id = ?
    `);

    stmt.run(status, confirmedAt, confirmedById, rejectionReason || null, inviteStatus, now, reg.internalId);
    return this.getRegistrationByIdOrNumber(reg.internalId);
  },

  updateTelegramInviteStatus(idOrNumber, newStatus) {
    const reg = this.getRegistrationByIdOrNumber(idOrNumber);
    if (!reg) return null;

    const now = new Date().toISOString();
    const stmt = db.prepare(`
      UPDATE registrations
      SET telegram_invite_status = ?, updated_at = ?
      WHERE id = ?
    `);
    stmt.run(newStatus, now, reg.internalId);
    return this.getRegistrationByIdOrNumber(reg.internalId);
  },

  listRegistrations({ search = '', status = 'All', telegramStatus = 'All', fieldOfStudy = 'All', department = 'All', page = 1, limit = 10 }) {
    const conditions = [];
    const params = [];

    if (status && status !== 'All') {
      conditions.push('r.status = ?');
      params.push(status);
    }

    if (telegramStatus && telegramStatus !== 'All') {
      conditions.push('r.telegram_invite_status = ?');
      params.push(telegramStatus);
    }

    if (fieldOfStudy && fieldOfStudy !== 'All') {
      conditions.push('r.field_of_study = ?');
      params.push(fieldOfStudy);
    }

    if (department && department !== 'All') {
      conditions.push('(r.primary_department = ? OR r.secondary_department = ?)');
      params.push(department, department);
    }

    if (search && search.trim()) {
      const term = `%${search.trim().toLowerCase()}%`;
      conditions.push(`(
        LOWER(r.registration_number) LIKE ? OR
        LOWER(r.first_name) LIKE ? OR
        LOWER(r.last_name) LIKE ? OR
        LOWER(r.first_name || ' ' || r.last_name) LIKE ? OR
        LOWER(r.telegram_username) LIKE ? OR
        REPLACE(r.phone_number, ' ', '') LIKE ?
      )`);
      params.push(term, term, term, term, term, `%${search.replace(/\s+/g, '')}%`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Total count query
    const countSql = `SELECT COUNT(*) AS total FROM registrations r ${whereClause}`;
    const countStmt = db.prepare(countSql);
    const totalCount = countStmt.get(...params).total;

    // Pagination bounds
    const safeLimit = Math.max(1, Math.min(limit, 10000));
    const totalPages = Math.max(1, Math.ceil(totalCount / safeLimit));
    const safePage = Math.min(Math.max(1, page), totalPages);
    const offset = (safePage - 1) * safeLimit;

    // Main records query
    const dataSql = `
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
      ${whereClause}
      ORDER BY r.created_at DESC
      LIMIT ? OFFSET ?
    `;

    const dataStmt = db.prepare(dataSql);
    const rawRows = dataStmt.all(...params, safeLimit, offset);

    // Format rows to match frontend contract expectations
    const items = rawRows.map(r => formatRegistrationRecord(r));

    return {
      items,
      page: safePage,
      limit: safeLimit,
      totalCount,
      totalPages,
      summary: this.getRegistrationsSummary()
    };
  },

  getRegistrationsSummary() {
    const stmt = db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'Pending' THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN status = 'Confirmed' THEN 1 ELSE 0 END) AS confirmed,
        SUM(CASE WHEN status = 'Rejected' THEN 1 ELSE 0 END) AS rejected,
        SUM(CASE WHEN telegram_invite_status = 'Delivered' THEN 1 ELSE 0 END) AS delivered,
        SUM(CASE WHEN telegram_invite_status = 'Pending Linking' THEN 1 ELSE 0 END) AS pendingLinking,
        SUM(CASE WHEN telegram_invite_status = 'Failed' THEN 1 ELSE 0 END) AS failed
      FROM registrations
    `);
    const row = stmt.get();
    return {
      total: row.total || 0,
      pending: row.pending || 0,
      confirmed: row.confirmed || 0,
      rejected: row.rejected || 0,
      delivered: row.delivered || 0,
      pendingLinking: row.pendingLinking || 0,
      failed: row.failed || 0
    };
  },

  // ---------------------------------------------------------------------------
  // INVITATIONS
  // ---------------------------------------------------------------------------
  getInvitationByRegistrationId(registrationId) {
    if (!registrationId) return null;
    const stmt = db.prepare(`
      SELECT * FROM invitations 
      WHERE registration_id = ? 
         OR registration_id IN (SELECT id FROM registrations WHERE registration_number = ?)
      ORDER BY created_at DESC 
      LIMIT 1
    `);
    return stmt.get(registrationId, registrationId) || null;
  },

  saveInvitation({
    registrationId,
    targetGroupIdentifier,
    inviteLink,
    expiryTimestamp = 0,
    status = 'Pending',
    sentAt = null,
    revokedAt = null,
    lastError = null
  }) {
    let internalRegId = registrationId;
    const reg = this.getRegistrationByIdOrNumber(registrationId);
    if (reg) {
      internalRegId = reg.internalId;
    }

    const existing = this.getInvitationByRegistrationId(internalRegId);
    const now = new Date().toISOString();
    const cleanError = logger.sanitize(lastError);
    const safeStatus = status === 'Pending Linking' ? 'Pending' : status;

    if (existing) {
      const updateStmt = db.prepare(`
        UPDATE invitations
        SET target_group_identifier = ?,
            invite_link = ?,
            expiry_timestamp = ?,
            status = ?,
            sent_at = COALESCE(?, sent_at),
            revoked_at = COALESCE(?, revoked_at),
            last_error = ?
        WHERE id = ?
      `);
      updateStmt.run(
        targetGroupIdentifier,
        inviteLink,
        expiryTimestamp,
        safeStatus,
        sentAt,
        revokedAt,
        cleanError || null,
        existing.id
      );
      return this.getInvitationByRegistrationId(internalRegId);
    } else {
      const invId = crypto.randomUUID();
      const insertStmt = db.prepare(`
        INSERT INTO invitations (
          id, registration_id, target_group_identifier, invite_link,
          expiry_timestamp, status, created_at, sent_at, revoked_at, last_error
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      insertStmt.run(
        invId,
        internalRegId,
        targetGroupIdentifier,
        inviteLink,
        expiryTimestamp,
        safeStatus,
        now,
        sentAt,
        revokedAt,
        cleanError || null
      );
      return this.getInvitationByRegistrationId(internalRegId);
    }
  },

  revokeInvitation(registrationId) {
    const existing = this.getInvitationByRegistrationId(registrationId);
    if (!existing) return null;

    const now = new Date().toISOString();
    const updateStmt = db.prepare(`
      UPDATE invitations
      SET status = 'Revoked', revoked_at = ?
      WHERE id = ?
    `);
    updateStmt.run(now, existing.id);
    return this.getInvitationByRegistrationId(registrationId);
  },

  // ---------------------------------------------------------------------------
  // AUDIT LOGS
  // ---------------------------------------------------------------------------
  createAuditLog({
    actorId,
    actorUsername,
    action,
    affectedRegistrationId = null,
    outcome = 'SUCCESS',
    details = '',
    ipAddress = null
  }) {
    const stmt = db.prepare(`
      INSERT INTO audit_logs (
        actor_id, actor_username, action, affected_registration_id, outcome, details, ip_address, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const cleanDetails = logger.sanitize(typeof details === 'object' ? JSON.stringify(details) : String(details || ''));
    stmt.run(
      actorId || 'system',
      actorUsername || 'system',
      action,
      affectedRegistrationId,
      outcome,
      cleanDetails,
      ipAddress,
      new Date().toISOString()
    );
  },

  listAuditLogs({ registrationId = null, actorId = null, limit = 50, offset = 0 } = {}) {
    const conditions = [];
    const params = [];

    if (registrationId) {
      conditions.push('affected_registration_id = ?');
      params.push(registrationId);
    }
    if (actorId) {
      conditions.push('actor_id = ?');
      params.push(actorId);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const stmt = db.prepare(`
      SELECT * FROM audit_logs
      ${where}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `);
    return stmt.all(...params, limit, offset);
  },

  // ---------------------------------------------------------------------------
  // BACKUP & RESTORE
  // ---------------------------------------------------------------------------
  exportFullBackup() {
    const result = {
      exportedAt: new Date().toISOString(),
      system: 'EPIC CLUB Registration Portal',
      version: '2.0.0'
    };
    const tables = ['admins', 'system_settings', 'registrations', 'invitations', 'audit_logs'];
    for (const tbl of tables) {
      try {
        result[tbl] = db.prepare(`SELECT * FROM ${tbl}`).all();
      } catch (_) {
        result[tbl] = [];
      }
    }
    return result;
  },

  restoreBackup(backupData, mode = 'merge') {
    let registrationsList = [];
    let settingsList = [];
    let invitationsList = [];

    if (Array.isArray(backupData)) {
      registrationsList = backupData;
    } else if (typeof backupData === 'object' && backupData !== null) {
      if (Array.isArray(backupData.registrations)) {
        registrationsList = backupData.registrations;
      }
      if (Array.isArray(backupData.system_settings)) {
        settingsList = backupData.system_settings;
      } else if (backupData.settings && typeof backupData.settings === 'object') {
        settingsList = Object.entries(backupData.settings).map(([k, v]) => ({ key: k, value: String(v) }));
      }
      if (Array.isArray(backupData.invitations)) {
        invitationsList = backupData.invitations;
      }
    }

    const stats = {
      registrationsRestored: 0,
      settingsRestored: 0,
      invitationsRestored: 0
    };

    db.exec('BEGIN TRANSACTION;');
    try {
      if (mode === 'replace') {
        db.exec('DELETE FROM audit_logs;');
        db.exec('DELETE FROM invitations;');
        db.exec('DELETE FROM registrations;');
      }

      const insertRegStmt = db.prepare(`
        INSERT INTO registrations (
          id, registration_number, first_name, last_name, telegram_username,
          telegram_chat_id, phone_number, normalized_phone, status, linking_token,
          linking_token_expires_at, linking_token_consumed_at, telegram_linked_at,
          telegram_invite_status, rejection_reason, field_of_study, academic_year,
          matricule, primary_department, secondary_department, motivation,
          created_at, updated_at, confirmed_at, confirmed_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (id) DO UPDATE SET
          registration_number = excluded.registration_number,
          first_name = excluded.first_name,
          last_name = excluded.last_name,
          telegram_username = excluded.telegram_username,
          telegram_chat_id = excluded.telegram_chat_id,
          phone_number = excluded.phone_number,
          normalized_phone = excluded.normalized_phone,
          status = excluded.status,
          linking_token = excluded.linking_token,
          linking_token_expires_at = excluded.linking_token_expires_at,
          linking_token_consumed_at = excluded.linking_token_consumed_at,
          telegram_linked_at = excluded.telegram_linked_at,
          telegram_invite_status = excluded.telegram_invite_status,
          rejection_reason = excluded.rejection_reason,
          field_of_study = excluded.field_of_study,
          academic_year = excluded.academic_year,
          matricule = excluded.matricule,
          primary_department = excluded.primary_department,
          secondary_department = excluded.secondary_department,
          motivation = excluded.motivation,
          updated_at = excluded.updated_at,
          confirmed_at = excluded.confirmed_at,
          confirmed_by = excluded.confirmed_by
      `);

      const validAdminIds = new Set(db.prepare('SELECT id FROM admins').all().map(a => a.id));

      for (const reg of registrationsList) {
        const id = reg.id || crypto.randomUUID();
        const regNum = reg.registration_number || reg.registrationNumber || `EPIC-2026-${Math.floor(1000 + Math.random() * 9000)}`;
        const firstName = reg.first_name || reg.firstName || '';
        const lastName = reg.last_name || reg.lastName || '';
        const tgUser = (reg.telegram_username || reg.telegramUsername || '').replace(/^@/, '');
        const tgChatId = reg.telegram_chat_id || reg.telegramChatId || null;
        const phone = reg.phone_number || reg.phoneNumber || '';
        const normPhone = reg.normalized_phone || reg.normalizedPhone || phone.replace(/[^0-9]/g, '');
        const status = ['Pending', 'Confirmed', 'Rejected'].includes(reg.status) ? reg.status : 'Pending';
        const linkToken = reg.linking_token || reg.linkingToken || `link_${crypto.randomBytes(16).toString('base64url')}`;
        const linkExpAt = reg.linking_token_expires_at || reg.linkingTokenExpiresAt || null;
        const linkConsAt = reg.linking_token_consumed_at || reg.linkingTokenConsumedAt || null;
        const tgLinkedAt = reg.telegram_linked_at || reg.telegramLinkedAt || null;
        const inviteStatus = reg.telegram_invite_status || reg.telegramInviteStatus || 'Not Sent';
        const rejReason = reg.rejection_reason || reg.rejectionReason || null;
        const fieldStudy = reg.field_of_study || reg.fieldOfStudy || null;
        const acadYear = reg.academic_year || reg.academicYear || null;
        const matricule = reg.matricule || null;
        const priDept = reg.primary_department || reg.primaryDepartment || null;
        const secDept = reg.secondary_department || reg.secondaryDepartment || null;
        const motivation = reg.motivation || null;
        const createdAt = reg.created_at || reg.createdAt || new Date().toISOString();
        const updatedAt = reg.updated_at || reg.updatedAt || new Date().toISOString();
        const confirmedAt = reg.confirmed_at || reg.confirmedAt || null;
        let confirmedBy = reg.confirmed_by || reg.confirmedBy || null;
        if (confirmedBy && !validAdminIds.has(confirmedBy)) {
          confirmedBy = null;
        }

        insertRegStmt.run(
          id, regNum, firstName, lastName, tgUser,
          tgChatId, phone, normPhone, status, linkToken,
          linkExpAt, linkConsAt, tgLinkedAt,
          inviteStatus, rejReason, fieldStudy, acadYear,
          matricule, priDept, secDept, motivation,
          createdAt, updatedAt, confirmedAt, confirmedBy
        );
        stats.registrationsRestored++;
      }

      // Settings
      const insertSettingStmt = db.prepare(`
        INSERT INTO system_settings (key, value, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT (key) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at
      `);
      for (const s of settingsList) {
        if (s.key && s.value !== undefined) {
          insertSettingStmt.run(s.key, String(s.value), new Date().toISOString());
          stats.settingsRestored++;
        }
      }

      // Invitations
      const insertInvStmt = db.prepare(`
        INSERT INTO invitations (
          id, registration_id, target_group_identifier, invite_link,
          status, created_at, sent_at, expiry_timestamp, last_error
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (id) DO UPDATE SET
          target_group_identifier = excluded.target_group_identifier,
          invite_link = excluded.invite_link,
          status = excluded.status,
          sent_at = excluded.sent_at,
          expiry_timestamp = excluded.expiry_timestamp,
          last_error = excluded.last_error
      `);
      for (const inv of invitationsList) {
        if (inv.registration_id) {
          const invId = inv.id || crypto.randomUUID();
          insertInvStmt.run(
            invId, inv.registration_id, inv.target_group_identifier || '',
            inv.invite_link || null, inv.status || 'Delivered',
            inv.created_at || new Date().toISOString(), inv.sent_at || null,
            inv.expiry_timestamp || null, inv.last_error || null
          );
          stats.invitationsRestored++;
        }
      }

      db.exec('COMMIT;');
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    }

    return stats;
  }
};

/**
 * Format database row into standard frontend response object preserving exact UI compatibility
 */
function formatRegistrationRecord(row) {
  if (!row) return null;

  // Retrieve audit log trail for this registration
  const historyStmt = db.prepare(`
    SELECT action, created_at AS timestamp, actor_username AS performedBy, details AS note
    FROM audit_logs
    WHERE affected_registration_id = ?
    ORDER BY created_at ASC
  `);
  const history = historyStmt.all(row.registration_number);

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
    id: row.registration_number,              // Public ID expected by frontend
    internalId: row.id,                       // Internal UUID
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

module.exports = dbService;
