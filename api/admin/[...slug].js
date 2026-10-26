/**
 * Unified Admin Serverless Function
 * Handles all /api/admin/* endpoints in a single serverless function
 * to stay well within Vercel's Hobby plan limit (max 12 functions).
 *
 * Routes handled:
 * - POST /api/admin/login
 * - POST /api/admin/logout
 * - GET  /api/admin/me
 * - GET  /api/admin/summary
 * - GET  /api/admin/settings
 * - POST /api/admin/settings
 * - GET  /api/admin/audit-logs
 * - POST /api/admin/init-db
 * - GET  /api/admin/registrations
 * - GET  /api/admin/registrations/[id]
 * - POST /api/admin/registrations/[id]/confirm
 * - POST /api/admin/registrations/[id]/reject
 * - POST /api/admin/registrations/[id]/retry-invite
 * - POST /api/admin/registrations/[id]/revoke-invite
 * - POST /api/admin/registrations/[id]/telegram-status
 */

const crypto = require('crypto');
const db = require('../../lib/db');
const { callTelegramApi } = require('../../lib/telegram');
const {
  jsonResponse,
  setSecurityHeaders,
  authenticateAdmin,
  parseBody,
  getClientIp,
  createSessionToken,
  SESSION_MAX_AGE_HOURS
} = require('../../lib/auth');

function sanitizeStr(str, max = 255) {
  if (!str) return '';
  return String(str).replace(/[\u0000-\u001F]/g, '').slice(0, max);
}

module.exports = async function handler(req, res) {
  setSecurityHeaders(res);

  // Extract path segments (slug)
  let slug = [];
  if (Array.isArray(req.query.slug)) {
    slug = req.query.slug;
  } else if (typeof req.query.slug === 'string' && req.query.slug.length > 0) {
    slug = req.query.slug.split('/').filter(Boolean);
  } else {
    const pathname = (req.url || '').split('?')[0];
    const prefix = '/api/admin/';
    if (pathname.includes(prefix)) {
      slug = pathname.slice(pathname.indexOf(prefix) + prefix.length).split('/').filter(Boolean);
    }
  }

  const endpoint = slug[0] || '';

  // Helper to extract query parameters safely
  const urlObj = new URL(req.url, 'http://localhost');
  const getQuery = (param, fallback = '') => {
    if (req.query && req.query[param] !== undefined) return req.query[param];
    return urlObj.searchParams.get(param) || fallback;
  };

  // -------------------------------------------------------------
  // 1. POST /api/admin/login
  // -------------------------------------------------------------
  if (endpoint === 'login') {
    if (req.method !== 'POST') return jsonResponse(res, 405, { success: false, error: 'Method not allowed' });

    const body = await parseBody(req);
    const { username, password } = body || {};
    const clientIp = getClientIp(req);

    if (!username || !password) {
      return jsonResponse(res, 400, { success: false, error: 'Username and password required.' });
    }

    try {
      let adminUser = null;
      try {
        adminUser = await db.getAdminByUsername(username);
      } catch (dbErr) {
        // Auto-initialize schema on first login if tables don't exist
        console.log('Admins table not found, auto-initializing schema...');
        await db.initializeSchema();
        await db.ensureDefaultAdmin();
        adminUser = await db.getAdminByUsername(username);
      }

      if (!adminUser) {
        await db.createAuditLog({
          actorId: 'anonymous', actorUsername: String(username).slice(0, 50),
          action: 'ADMIN_LOGIN_FAILED', outcome: 'FAILURE',
          details: 'Username not found', ipAddress: clientIp
        });
        return jsonResponse(res, 401, { success: false, error: 'Invalid admin username or password.' });
      }

      const computedHash = crypto.pbkdf2Sync(password, adminUser.salt, 100000, 64, 'sha512').toString('hex');
      const hashBufA = Buffer.from(computedHash, 'hex');
      const hashBufB = Buffer.from(adminUser.password_hash, 'hex');

      if (hashBufA.length !== hashBufB.length || !crypto.timingSafeEqual(hashBufA, hashBufB)) {
        await db.createAuditLog({
          actorId: adminUser.id, actorUsername: adminUser.username,
          action: 'ADMIN_LOGIN_FAILED', outcome: 'FAILURE',
          details: 'Invalid password', ipAddress: clientIp
        });
        return jsonResponse(res, 401, { success: false, error: 'Invalid admin username or password.' });
      }

      const sessionToken = createSessionToken();
      const maxAgeMs = SESSION_MAX_AGE_HOURS * 3600 * 1000;
      const expiresAt = Date.now() + maxAgeMs;

      await db.createAdminSession(adminUser.id, sessionToken, expiresAt);
      await db.createAuditLog({
        actorId: adminUser.id, actorUsername: adminUser.username,
        action: 'ADMIN_LOGIN_SUCCESS', outcome: 'SUCCESS',
        details: 'Admin authenticated successfully', ipAddress: clientIp
      });

      res.setHeader('Set-Cookie', `epic_admin_session=${sessionToken}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MAX_AGE_HOURS * 3600}`);
      return jsonResponse(res, 200, {
        success: true,
        token: sessionToken,
        user: {
          username: adminUser.username,
          fullName: adminUser.full_name,
          role: adminUser.role
        }
      });
    } catch (err) {
      console.error('LOGIN_ERROR', err);
      return jsonResponse(res, 500, { success: false, error: 'Login system error: ' + err.message });
    }
  }

  // -------------------------------------------------------------
  // 2. POST /api/admin/init-db
  // -------------------------------------------------------------
  if (endpoint === 'init-db') {
    if (req.method !== 'POST') return jsonResponse(res, 405, { success: false, error: 'Method not allowed' });
    const body = await parseBody(req);
    const initSecret = process.env.INIT_SECRET;
    const providedSecret = req.headers['x-init-secret'] || (body && body.secret);

    if (initSecret && providedSecret !== initSecret) {
      return jsonResponse(res, 403, { success: false, error: 'Forbidden: Invalid init secret.' });
    }

    try {
      await db.initializeSchema();
      await db.ensureDefaultAdmin();
      return jsonResponse(res, 200, { success: true, message: 'Database schema initialized and default admin seeded successfully.' });
    } catch (err) {
      console.error('DB_INIT_ERROR', err);
      return jsonResponse(res, 500, { success: false, error: 'Database initialization failed: ' + err.message });
    }
  }

  // -------------------------------------------------------------
  // 3. POST /api/admin/logout
  // -------------------------------------------------------------
  if (endpoint === 'logout') {
    if (req.method !== 'POST') return jsonResponse(res, 405, { success: false, error: 'Method not allowed' });
    const auth = await authenticateAdmin(req);
    if (auth.authenticated && auth.token) {
      await db.deleteAdminSession(auth.token);
      await db.createAuditLog({
        actorId: auth.session.adminId, actorUsername: auth.session.username,
        action: 'ADMIN_LOGOUT', outcome: 'SUCCESS', details: 'Admin logged out'
      });
    }
    res.setHeader('Set-Cookie', 'epic_admin_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
    return jsonResponse(res, 200, { success: true, message: 'Logged out successfully.' });
  }

  // ALL FOLLOWING ENDPOINTS REQUIRE ADMIN AUTHENTICATION
  const auth = await authenticateAdmin(req);
  if (!auth.authenticated) {
    return jsonResponse(res, 401, { success: false, error: 'Unauthorized: Admin authentication required.' });
  }

  // -------------------------------------------------------------
  // 4. GET /api/admin/me
  // -------------------------------------------------------------
  if (endpoint === 'me') {
    if (req.method !== 'GET') return jsonResponse(res, 405, { success: false, error: 'Method not allowed' });
    return jsonResponse(res, 200, {
      success: true,
      user: {
        username: auth.session.username,
        fullName: auth.session.fullName,
        role: auth.session.role
      }
    });
  }

  // -------------------------------------------------------------
  // 5. GET /api/admin/summary
  // -------------------------------------------------------------
  if (endpoint === 'summary') {
    if (req.method !== 'GET') return jsonResponse(res, 405, { success: false, error: 'Method not allowed' });
    const summary = await db.getRegistrationsSummary();
    return jsonResponse(res, 200, { success: true, summary });
  }

  // -------------------------------------------------------------
  // 6. GET / POST /api/admin/settings
  // -------------------------------------------------------------
  if (endpoint === 'settings') {
    if (req.method === 'GET') {
      const settings = await db.getAllSettings();
      const token = settings.telegramBotToken || '';
      const maskedToken = token.length > 8 ? `${token.slice(0, 6)}••••••••${token.slice(-4)}` : '';
      return jsonResponse(res, 200, {
        success: true,
        settings: {
          telegramBotUsername: settings.telegramBotUsername,
          defaultTargetChatId: settings.defaultTargetChatId,
          defaultExpiryHours: parseInt(settings.defaultExpiryHours, 10) || 48,
          hasBotToken: Boolean(token),
          maskedToken
        }
      });
    }

    if (req.method === 'POST') {
      const payload = await parseBody(req);
      if (payload.telegramBotToken !== undefined && payload.telegramBotToken.trim() !== '') {
        await db.setSetting('telegramBotToken', payload.telegramBotToken.trim());
      }
      if (payload.telegramBotUsername) {
        await db.setSetting('telegramBotUsername', payload.telegramBotUsername.trim().replace(/^@+/, ''));
      }
      if (payload.defaultTargetChatId) {
        await db.setSetting('defaultTargetChatId', payload.defaultTargetChatId.trim());
      }
      if (payload.defaultExpiryHours) {
        await db.setSetting('defaultExpiryHours', String(parseInt(payload.defaultExpiryHours, 10) || 48));
      }

      await db.createAuditLog({
        actorId: auth.session.adminId, actorUsername: auth.session.username,
        action: 'SETTINGS_UPDATED', outcome: 'SUCCESS',
        details: 'Telegram bot and system settings updated'
      });
      return jsonResponse(res, 200, { success: true, message: 'Settings saved successfully' });
    }

    return jsonResponse(res, 405, { success: false, error: 'Method not allowed' });
  }

  // -------------------------------------------------------------
  // 7. GET /api/admin/audit-logs
  // -------------------------------------------------------------
  if (endpoint === 'audit-logs') {
    if (req.method !== 'GET') return jsonResponse(res, 405, { success: false, error: 'Method not allowed' });
    const limit = parseInt(getQuery('limit', '50'), 10) || 50;
    const offset = parseInt(getQuery('offset', '0'), 10) || 0;
    const registrationId = getQuery('registrationId', null);

    const logs = await db.listAuditLogs({ limit, offset, registrationId });
    return jsonResponse(res, 200, { success: true, logs });
  }

  // -------------------------------------------------------------
  // 8. /api/admin/registrations...
  // -------------------------------------------------------------
  if (endpoint === 'registrations') {
    const regId = slug[1];
    const action = slug[2];

    // List all registrations: GET /api/admin/registrations
    if (!regId && req.method === 'GET') {
      const search = getQuery('search', '');
      const status = getQuery('status', 'All');
      const telegramStatus = getQuery('telegramStatus', 'All');
      const page = parseInt(getQuery('page', '1'), 10) || 1;
      const limit = parseInt(getQuery('limit', '10'), 10) || 10;

      try {
        const result = await db.listRegistrations({
          search: search.trim(),
          status: status.trim(),
          telegramStatus: telegramStatus.trim(),
          page,
          limit
        });

        return jsonResponse(res, 200, {
          success: true,
          data: result.items,
          page: result.page,
          limit: result.limit,
          totalCount: result.totalCount,
          totalPages: result.totalPages,
          summary: result.summary
        });
      } catch (err) {
        console.error('LIST_REGISTRATIONS_ERROR', err);
        return jsonResponse(res, 500, { success: false, error: 'Failed to fetch registrations.' });
      }
    }

    // Single registration lookup: GET /api/admin/registrations/[id]
    if (regId && !action && req.method === 'GET') {
      const record = await db.getRegistrationByIdOrNumber(regId);
      if (!record) return jsonResponse(res, 404, { success: false, error: 'Registration record not found.' });
      const settings = await db.getAllSettings();
      return jsonResponse(res, 200, {
        success: true,
        registration: record,
        botUsername: settings.telegramBotUsername || process.env.TELEGRAM_BOT_USERNAME
      });
    }

    // Action: POST /api/admin/registrations/[id]/confirm
    if (regId && action === 'confirm' && req.method === 'POST') {
      const payload = (await parseBody(req)) || {};
      const record = await db.getRegistrationByIdOrNumber(regId);
      if (!record) return jsonResponse(res, 404, { success: false, error: 'Registration record not found.' });

      const settings = await db.getAllSettings();
      const targetChatId = (payload.targetChatId || settings.defaultTargetChatId || process.env.TELEGRAM_TARGET_CHAT_ID || '').toString().trim();
      if (!targetChatId) {
        return jsonResponse(res, 400, { success: false, error: 'Target Telegram group or channel identifier is required.' });
      }

      const expiryHours = payload.expiryHours !== undefined && payload.expiryHours !== null && payload.expiryHours !== ''
        ? parseInt(payload.expiryHours, 10)
        : parseInt(settings.defaultExpiryHours, 10) || 48;

      let expireTimestamp = 0;
      if (expiryHours && expiryHours > 0) {
        expireTimestamp = Math.floor(Date.now() / 1000) + (expiryHours * 3600);
      }

      let inviteLink = null;
      if (record.invitation && record.invitation.inviteLink && record.invitation.targetChatId === targetChatId && !record.invitation.isRevoked) {
        const nowSec = Math.floor(Date.now() / 1000);
        if (!record.invitation.expireDate || record.invitation.expireDate > nowSec) {
          inviteLink = record.invitation.inviteLink;
        }
      }

      if (!inviteLink) {
        if (targetChatId.startsWith('http://') || targetChatId.startsWith('https://')) {
          inviteLink = targetChatId;
        } else {
          const invitePayload = {
            chat_id: targetChatId,
            name: `EPIC-${record.registrationNumber}`,
            member_limit: 1
          };
          if (expireTimestamp > 0) invitePayload.expire_date = expireTimestamp;

          const inviteRes = await callTelegramApi(settings.telegramBotToken, 'createChatInviteLink', invitePayload);
          if (!inviteRes.ok || !inviteRes.result || !inviteRes.result.invite_link) {
            const safeErr = sanitizeStr(inviteRes.description || 'Failed to create Telegram invite link', 200);
            await db.updateRegistrationStatus(record.internalId, { status: 'Confirmed', confirmedBy: auth.session.adminId, telegramInviteStatus: 'Failed' });
            await db.saveInvitation({ registrationId: record.internalId, targetGroupIdentifier: targetChatId, inviteLink: null, expiryTimestamp: expireTimestamp, status: 'Failed', lastError: safeErr });
            await db.createAuditLog({ actorId: auth.session.adminId, actorUsername: auth.session.username, action: 'REGISTRATION_CONFIRMED_INVITE_FAILED', affectedRegistrationId: record.registrationNumber, outcome: 'FAILURE', details: `Confirmed but invite failed: ${safeErr}` });
            return jsonResponse(res, 200, { success: true, warning: `Registration confirmed, but Telegram Bot error: ${safeErr}.`, registration: await db.getRegistrationByIdOrNumber(record.id) });
          }
          inviteLink = inviteRes.result.invite_link;
        }
      }

      let inviteDeliveryStatus = 'Pending Linking';
      let deliveryMessage = 'Invitation link created. Candidate has not connected their Telegram bot yet.';
      let sentAt = null;
      let deliveryError = null;

      if (record.telegramLinked && record.telegramChatId) {
        const expiryNotice = expireTimestamp > 0 ? ` (valid for ${expiryHours} hours)` : '';
        const msgText = `🎉 <b>Congratulations, ${record.firstName}!</b>\n\nYour application for <b>EPIC CLUB</b> (ID: <code>${record.registrationNumber}</code>) has been approved!\n\nHere is your unique, single-use invitation link:\n👉 <b>${inviteLink}</b>\n\n<i>Note: This invitation is strictly personal and can only be used by one person${expiryNotice}. Welcome to EPIC!</i>`;

        const sendRes = await callTelegramApi(settings.telegramBotToken, 'sendMessage', {
          chat_id: record.telegramChatId,
          text: msgText,
          parse_mode: 'HTML'
        });

        if (sendRes.ok) {
          inviteDeliveryStatus = 'Delivered';
          sentAt = new Date().toISOString();
          deliveryMessage = `Delivered privately to Telegram Chat ID ${record.telegramChatId}`;
        } else {
          inviteDeliveryStatus = 'Failed';
          deliveryError = sanitizeStr(sendRes.description || 'Failed to deliver message', 200);
          deliveryMessage = `Invitation link created, but message delivery failed: ${deliveryError}`;
        }
      }

      await db.saveInvitation({ registrationId: record.internalId, targetGroupIdentifier: targetChatId, inviteLink, expiryTimestamp: expireTimestamp, status: inviteDeliveryStatus, sentAt, lastError: deliveryError });
      const updatedRecord = await db.updateRegistrationStatus(record.internalId, { status: 'Confirmed', confirmedBy: auth.session.adminId, telegramInviteStatus: inviteDeliveryStatus });
      await db.createAuditLog({ actorId: auth.session.adminId, actorUsername: auth.session.username, action: 'REGISTRATION_CONFIRMED', affectedRegistrationId: record.registrationNumber, outcome: 'SUCCESS', details: payload.note ? `Confirmed: ${sanitizeStr(payload.note)} (${deliveryMessage})` : `Confirmed. ${deliveryMessage}` });

      return jsonResponse(res, 200, { success: true, message: `Registration ${record.registrationNumber} confirmed. ${deliveryMessage}`, registration: updatedRecord, deliveryStatus: inviteDeliveryStatus });
    }

    // Action: POST /api/admin/registrations/[id]/reject
    if (regId && action === 'reject' && req.method === 'POST') {
      const payload = (await parseBody(req)) || {};
      const record = await db.getRegistrationByIdOrNumber(regId);
      if (!record) return jsonResponse(res, 404, { success: false, error: 'Registration record not found.' });

      const reason = sanitizeStr(payload.reason || 'Does not fulfill membership criteria', 255);
      const updated = await db.updateRegistrationStatus(record.internalId, { status: 'Rejected', rejectionReason: reason });
      await db.createAuditLog({ actorId: auth.session.adminId, actorUsername: auth.session.username, action: 'REGISTRATION_REJECTED', affectedRegistrationId: record.registrationNumber, outcome: 'SUCCESS', details: `Rejected: ${reason}` });

      return jsonResponse(res, 200, { success: true, message: `Registration ${record.registrationNumber} marked as Rejected.`, registration: updated });
    }

    // Action: POST /api/admin/registrations/[id]/retry-invite
    if (regId && action === 'retry-invite' && req.method === 'POST') {
      const record = await db.getRegistrationByIdOrNumber(regId);
      if (!record) return jsonResponse(res, 404, { success: false, error: 'Registration record not found.' });

      let inviteLink = (record.invitation && record.invitation.inviteLink) ? record.invitation.inviteLink : null;
      if (!inviteLink) {
        const settings = await db.getAllSettings();
        const target = (record.invitation && record.invitation.targetChatId) || settings.defaultTargetChatId;
        if (target && (target.startsWith('http://') || target.startsWith('https://'))) inviteLink = target;
      }

      if (!inviteLink) return jsonResponse(res, 400, { success: false, error: 'No invitation link exists. Please re-confirm the registration.' });
      if (!record.telegramChatId) return jsonResponse(res, 400, { success: false, error: 'Participant has not linked their Telegram account yet.' });

      const settings = await db.getAllSettings();
      const msgText = `🎉 <b>Welcome to EPIC CLUB, ${record.firstName}!</b>\n\nYour application (ID: <code>${record.registrationNumber}</code>) is approved.\n\nHere is your unique, single-use invitation link:\n👉 <b>${inviteLink}</b>\n\n<i>Note: This invitation is strictly personal (member limit: 1).</i>`;
      const sendRes = await callTelegramApi(settings.telegramBotToken, 'sendMessage', { chat_id: record.telegramChatId, text: msgText, parse_mode: 'HTML' });

      if (sendRes.ok) {
        await db.updateTelegramInviteStatus(record.internalId, 'Delivered');
        await db.saveInvitation({ registrationId: record.internalId, targetGroupIdentifier: record.invitation?.targetChatId || '', inviteLink, status: 'Delivered', sentAt: new Date().toISOString(), lastError: null });
        await db.createAuditLog({ actorId: auth.session.adminId, actorUsername: auth.session.username, action: 'INVITE_DELIVERY_RETRY', affectedRegistrationId: record.registrationNumber, outcome: 'SUCCESS', details: `Delivered to Telegram Chat ID ${record.telegramChatId}` });
        return jsonResponse(res, 200, { success: true, message: 'Invitation successfully delivered to Telegram chat!', registration: await db.getRegistrationByIdOrNumber(record.id) });
      } else {
        const safeErr = sanitizeStr(sendRes.description || 'Delivery attempt failed', 200);
        await db.updateTelegramInviteStatus(record.internalId, 'Failed');
        await db.saveInvitation({ registrationId: record.internalId, targetGroupIdentifier: record.invitation?.targetChatId || '', inviteLink, status: 'Failed', lastError: safeErr });
        await db.createAuditLog({ actorId: auth.session.adminId, actorUsername: auth.session.username, action: 'INVITE_DELIVERY_RETRY_FAILED', affectedRegistrationId: record.registrationNumber, outcome: 'FAILURE', details: `Delivery retry failed: ${safeErr}` });
        return jsonResponse(res, 400, { success: false, error: `Telegram delivery failed: ${safeErr}`, registration: await db.getRegistrationByIdOrNumber(record.id) });
      }
    }

    // Action: POST /api/admin/registrations/[id]/revoke-invite
    if (regId && action === 'revoke-invite' && req.method === 'POST') {
      const record = await db.getRegistrationByIdOrNumber(regId);
      if (!record || !record.invitation || !record.invitation.inviteLink) {
        return jsonResponse(res, 400, { success: false, error: 'No active invitation to revoke.' });
      }

      const settings = await db.getAllSettings();
      await callTelegramApi(settings.telegramBotToken, 'revokeChatInviteLink', { chat_id: record.invitation.targetChatId, invite_link: record.invitation.inviteLink });
      await db.revokeInvitation(record.internalId);
      await db.updateTelegramInviteStatus(record.internalId, 'Revoked');
      await db.createAuditLog({ actorId: auth.session.adminId, actorUsername: auth.session.username, action: 'INVITE_REVOKED', affectedRegistrationId: record.registrationNumber, outcome: 'SUCCESS', details: `Revoked link: ${record.invitation.inviteLink}` });

      return jsonResponse(res, 200, { success: true, message: 'Invitation link revoked.', registration: await db.getRegistrationByIdOrNumber(record.id) });
    }

    // Action: POST /api/admin/registrations/[id]/telegram-status
    if (regId && action === 'telegram-status' && req.method === 'POST') {
      const payload = req.body || {};
      const record = await db.getRegistrationByIdOrNumber(regId);
      if (!record) return jsonResponse(res, 404, { success: false, error: 'Registration record not found.' });

      const allowedStatuses = ['Not Sent', 'Pending Linking', 'Sent', 'Delivered', 'Failed', 'Joined', 'Revoked'];
      const newStatus = payload.telegramInviteStatus;
      if (!allowedStatuses.includes(newStatus)) {
        return jsonResponse(res, 400, { success: false, error: `Invalid status. Must be one of: ${allowedStatuses.join(', ')}` });
      }

      const previousStatus = record.telegramInviteStatus || 'Not Sent';
      const updated = await db.updateTelegramInviteStatus(record.internalId, newStatus);
      await db.createAuditLog({ actorId: auth.session.adminId, actorUsername: auth.session.username, action: 'TELEGRAM_STATUS_OVERRIDE', affectedRegistrationId: record.registrationNumber, outcome: 'SUCCESS', details: `Updated from "${previousStatus}" to "${newStatus}"` });

      return jsonResponse(res, 200, { success: true, message: 'Telegram invite status updated.', registration: updated });
    }
  }

  return jsonResponse(res, 404, { success: false, error: `Admin route not found: /${slug.join('/')}` });
};
