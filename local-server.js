// Native Node.js Server for EPIC CLUB Portal & Registration System
// Architecture: Node.js HTTP + node:sqlite (ACID, parameterized queries, constraints, migrations)
// Zero external dependencies, preserves existing frontend UI & Telegram bot workflows

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');

const config = require('./utils/env');
const logger = require('./utils/logger');
const { validateRegistrationInput, sanitizeString } = require('./utils/validation');
const db = require('./db');

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : (config.PORT || 3000);
const ROOT_DIR = __dirname;

// =========================================================================
// AUTHENTICATION & AUTHORIZATION HELPERS
// =========================================================================

function parseCookies(req) {
  const list = {};
  const rc = req.headers.cookie;
  if (rc) {
    rc.split(';').forEach(cookie => {
      const parts = cookie.split('=');
      list[parts.shift().trim()] = decodeURI(parts.join('='));
    });
  }
  return list;
}

function authenticateAdmin(req) {
  let token = null;

  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7).trim();
  }

  if (!token) {
    const cookies = parseCookies(req);
    token = cookies['epic_admin_session'];
  }

  if (!token) {
    return { authenticated: false };
  }

  const session = db.getAdminSession(token);
  if (!session) {
    return { authenticated: false };
  }

  return {
    authenticated: true,
    token: session.token,
    session: {
      adminId: session.admin_id,
      username: session.username,
      fullName: session.full_name,
      role: session.role
    }
  };
}

// =========================================================================
// TELEGRAM BOT API CLIENT
// =========================================================================

/**
 * Generic Telegram Bot API caller with HTTPS request handling & sandbox fallback
 */
function callTelegramApi(token, method, payload) {
  return new Promise((resolve) => {
    // If real token is configured and valid, call Telegram API
    if (token && token.trim() && !token.startsWith('sim_')) {
      const postData = JSON.stringify(payload || {});
      const requestTimeout = (payload && payload.timeout) ? (payload.timeout + 10) * 1000 : 15000;
      const req = https.request({
        hostname: 'api.telegram.org',
        port: 443,
        path: `/bot${token.trim()}/${method}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        },
        timeout: requestTimeout
      }, res => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            resolve(data);
          } catch (e) {
            resolve({ ok: false, error_code: 500, description: 'Invalid JSON response from Telegram API' });
          }
        });
      });

      req.on('error', err => {
        logger.error('TELEGRAM_API_NETWORK_ERROR', err, { method });
        resolve({ ok: false, error_code: 503, description: `Network connection to Telegram failed: ${logger.sanitize(err.message)}` });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({ ok: false, error_code: 504, description: 'Telegram API request timed out' });
      });

      req.write(postData);
      req.end();
      return;
    }

    // Deterministic Sandbox / Simulator Mode (when bot token is not yet provided or in offline testing)
    logger.info('TELEGRAM_SANDBOX_CALL', { method, payload });

    if (method === 'createChatInviteLink') {
      const rndSuffix = crypto.randomBytes(4).toString('hex');
      const mockInviteLink = `https://t.me/+EPIC_oneTime_${rndSuffix}`;
      resolve({
        ok: true,
        result: {
          invite_link: mockInviteLink,
          creator: { id: 987654321, is_bot: true, first_name: 'EPIC CLUB Bot', username: 'epic_club_setif_bot' },
          creates_join_request: false,
          is_primary: false,
          is_revoked: false,
          name: payload.name || 'EPIC Single-Use Invite',
          expire_date: payload.expire_date || 0,
          member_limit: 1 // strictly member_limit=1
        }
      });
      return;
    }

    if (method === 'revokeChatInviteLink') {
      resolve({
        ok: true,
        result: {
          invite_link: payload.invite_link,
          is_revoked: true
        }
      });
      return;
    }

    if (method === 'sendMessage') {
      if (!payload.chat_id) {
        resolve({ ok: false, error_code: 400, description: 'Bad Request: chat_id is empty' });
        return;
      }
      resolve({
        ok: true,
        result: {
          message_id: Math.floor(10000 + Math.random() * 90000),
          date: Math.floor(Date.now() / 1000),
          chat: { id: payload.chat_id, type: 'private' },
          text: payload.text
        }
      });
      return;
    }

    if (method === 'getMe') {
      resolve({
        ok: true,
        result: {
          id: 987654321,
          is_bot: true,
          first_name: 'EPIC CLUB Official Bot',
          username: 'epic_club_setif_bot',
          can_join_groups: true,
          can_read_all_group_messages: false,
          supports_inline_queries: false
        }
      });
      return;
    }

    resolve({ ok: false, error_code: 404, description: `Unsupported method in sandbox: ${method}` });
  });
}

// =========================================================================
// TELEGRAM MESSAGE PROCESSING & LONG-POLLING ENGINE
// =========================================================================

/**
 * Shared Telegram message and update processor
 * Used by both Webhook and Long-polling loop
 */
async function handleTelegramUpdate(payload) {
  // 1. Group / Channel Detection from messages or bot member updates
  const chat = (payload.message && payload.message.chat) || 
               (payload.channel_post && payload.channel_post.chat) || 
               (payload.my_chat_member && payload.my_chat_member.chat);

  if (chat && (chat.type === 'group' || chat.type === 'supergroup' || chat.type === 'channel')) {
    logger.info('TELEGRAM_GROUP_IDENTIFIED', {
      title: chat.title,
      type: chat.type,
      chatId: chat.id
    });
    db.setSetting('lastDetectedGroupChatId', String(chat.id));
    if (chat.title) db.setSetting('lastDetectedGroupTitle', chat.title);
  }

  const message = payload.message || payload.edited_message || payload.channel_post;
  if (!message || !message.text) return;

  const chatId = message.chat.id;
  const text = message.text.trim();
  const settings = db.getAllSettings();
  const botToken = settings.telegramBotToken || config.TELEGRAM_BOT_TOKEN;

  // Group command: /id or /chatid to report group ID directly
  if (message.chat && (message.chat.type === 'group' || message.chat.type === 'supergroup')) {
    if (text.startsWith('/id') || text.startsWith('/chatid')) {
      await callTelegramApi(botToken, 'sendMessage', {
        chat_id: chatId,
        text: `📌 <b>Group Chat ID:</b> <code>${chatId}</code>\n\nCopy this exact number (including the minus sign) and paste it into EPIC CLUB Admin Settings.`,
        parse_mode: 'HTML'
      });
      return;
    }
  }

  // Check if user sent: /start link_EPIC-2026-XXXX or /start link_TOKEN
  const match = text.match(/^\/start\s+(link_[A-Za-z0-9\-]+|[A-Za-z0-9\-]+)/i);
  if (match) {
    const rawToken = match[1];
    const record = db.getRegistrationByLinkingToken(rawToken);

    if (record) {
      // Link chat ID in database
      const linkResult = db.linkTelegramChat(record.id, chatId);

      if (!linkResult.success) {
        if (linkResult.error === 'TOKEN_ALREADY_USED') {
          await callTelegramApi(botToken, 'sendMessage', {
            chat_id: chatId,
            text: `⚠️ <b>Verification Token Already Used</b>\n\nThis verification link has already been used and cannot be reused.\n\nIf you have questions, please contact the EPIC CLUB committee.`,
            parse_mode: 'HTML'
          });
          return;
        }
        if (linkResult.error === 'TOKEN_EXPIRED') {
          await callTelegramApi(botToken, 'sendMessage', {
            chat_id: chatId,
            text: `⚠️ <b>Verification Token Expired</b>\n\nThis verification link has expired. Please check your registration status or contact support.`,
            parse_mode: 'HTML'
          });
          return;
        }
      }

      // If registration was already confirmed and invite link exists, auto-deliver now!
      let deliveredNow = false;
      if (record.status === 'Confirmed' && record.invitation && record.invitation.invite_link) {
        const sendRes = await callTelegramApi(botToken, 'sendMessage', {
          chat_id: chatId,
          text: `🎉 <b>Welcome to EPIC CLUB, ${record.first_name}!</b>\n\nYour registration (<code>${record.registration_number}</code>) is approved.\n\nHere is your unique, single-use invitation link to join the official group:\n👉 ${record.invitation.invite_link}\n\n<i>Note: This link is unique to you (limit: 1 member). Please do not share it.</i>`,
          parse_mode: 'HTML'
        });

        if (sendRes.ok) {
          db.updateTelegramInviteStatus(record.id, 'Delivered');
          db.saveInvitation({
            registrationId: record.id,
            targetGroupIdentifier: record.invitation.target_group_identifier,
            inviteLink: record.invitation.invite_link,
            expiryTimestamp: record.invitation.expiry_timestamp,
            status: 'Delivered',
            sentAt: new Date().toISOString()
          });

          db.createAuditLog({
            actorId: 'telegram_bot',
            actorUsername: 'Telegram Bot',
            action: 'INVITATION_DELIVERED',
            affectedRegistrationId: record.registration_number,
            outcome: 'SUCCESS',
            details: `Direct single-use invite delivered to chat ID ${chatId}`
          });
          deliveredNow = true;
        }
      }

      // Send confirmation back to participant
      if (!deliveredNow) {
        await callTelegramApi(botToken, 'sendMessage', {
          chat_id: chatId,
          text: `✅ <b>Telegram Account Successfully Linked!</b>\n\nHello <b>${record.first_name}</b>, your Telegram account is now connected with your EPIC CLUB registration (<code>${record.registration_number}</code>).\n\nOnce the executive committee completes the review of your application, your official single-use invitation link will be sent to you right here.`,
          parse_mode: 'HTML'
        });
      }
    } else {
      await callTelegramApi(botToken, 'sendMessage', {
        chat_id: chatId,
        text: `⚠️ <b>Registration not found</b>\n\nThe linking code provided does not match any active registration. Please check your registration reference.`
      });
    }
  } else if (text === '/start') {
    await callTelegramApi(botToken, 'sendMessage', {
      chat_id: chatId,
      text: `👋 <b>Welcome to the official EPIC CLUB Bot!</b>\n\nTo link your registration, please open the link provided on the EPIC CLUB registration confirmation page.`,
      parse_mode: 'HTML'
    });
  }
}

let isPolling = false;
let pollingOffset = 0;
let pollingTimer = null;

async function startTelegramPolling() {
  const token = (config.TELEGRAM_BOT_TOKEN || '').trim();
  if (!token || token.startsWith('sim_')) {
    logger.info('TELEGRAM_POLLING_STANDBY', { reason: 'No real bot token or running in sandbox mode' });
    return;
  }

  try {
    const whInfo = await callTelegramApi(token, 'getWebhookInfo', {});
    if (whInfo && whInfo.ok && whInfo.result && whInfo.result.url) {
      logger.info('TELEGRAM_POLLING_DISABLED', {
        message: `Active webhook found at ${whInfo.result.url}. Long polling will remain off.`
      });
      return;
    }
  } catch (err) {
    logger.warn('TELEGRAM_CHECK_WEBHOOK_WARN', { error: err.message });
  }

  if (isPolling) return;
  isPolling = true;
  logger.info('TELEGRAM_POLLING_STARTED', {
    message: 'Long polling loop active for bot @' + (config.TELEGRAM_BOT_USERNAME || 'bot')
  });

  async function poll() {
    if (!isPolling) return;
    try {
      const res = await callTelegramApi(token, 'getUpdates', {
        offset: pollingOffset,
        timeout: 20,
        allowed_updates: ['message', 'channel_post', 'my_chat_member', 'chat_member']
      });

      if (res && res.ok && Array.isArray(res.result)) {
        for (const update of res.result) {
          pollingOffset = update.update_id + 1;
          try {
            await handleTelegramUpdate(update);
          } catch (updateErr) {
            logger.error('TELEGRAM_UPDATE_PROCESSING_ERROR', updateErr);
          }
        }
      } else if (res && !res.ok && res.error_code === 409) {
        // Conflict: Another instance or webhook set
        logger.warn('TELEGRAM_POLLING_CONFLICT', { description: res.description });
        isPolling = false;
        return;
      }
    } catch (err) {
      logger.error('TELEGRAM_POLL_CYCLE_ERROR', err);
      await new Promise(r => setTimeout(r, 4000));
    }

    if (isPolling) {
      pollingTimer = setTimeout(poll, 300);
    }
  }

  poll();
}

function stopTelegramPolling() {
  isPolling = false;
  if (pollingTimer) {
    clearTimeout(pollingTimer);
    pollingTimer = null;
  }
  logger.info('TELEGRAM_POLLING_STOPPED', { message: 'Long polling paused.' });
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
};

function parseJsonBody(req, res, callback) {
  let body = '';
  req.on('data', chunk => {
    body += chunk.toString();
    if (body.length > 102400) {
      res.writeHead(413, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Payload too large' }));
      req.connection.destroy();
    }
  });
  req.on('end', () => {
    try {
      const parsed = body ? JSON.parse(body) : {};
      callback(parsed);
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Malformed JSON payload' }));
    }
  });
}

function getClientIp(req) {
  return req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
}

// =========================================================================
// HTTP SERVER & ROUTING
// =========================================================================

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  parsedUrl.query = Object.fromEntries(parsedUrl.searchParams);
  let pathname = decodeURIComponent(parsedUrl.pathname);

  if (pathname.length > 1 && pathname.endsWith('/')) {
    pathname = pathname.slice(0, -1);
  }

  // Security & CORS Headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  // Route Aliases
  if (pathname === '/' || pathname === '') {
    pathname = '/index.html';
  } else if (pathname === '/register') {
    pathname = '/register.html';
  } else if (pathname === '/registration-success') {
    pathname = '/registration-success.html';
  } else if (pathname === '/admin') {
    pathname = '/admin.html';
  } else if (pathname === '/status') {
    pathname = '/register.html';
  }

  // =========================================================================
  // PUBLIC REGISTRATION APIS
  // =========================================================================

  // 1. POST /api/register
  if (pathname === '/api/register' && req.method === 'POST') {
    parseJsonBody(req, res, payload => {
      try {
        const validation = validateRegistrationInput(payload);
        if (!validation.isValid) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({
            success: false,
            error: validation.errors[0],
            errors: validation.errors
          }));
        }

        const {
          firstName,
          lastName,
          telegramUsername,
          phoneNumber,
          normalizedPhone,
          fieldOfStudy,
          academicYear,
          matricule,
          primaryDepartment,
          secondaryDepartment,
          motivation
        } = validation.data;

        // Uniqueness & Duplicate Prevention Rule:
        // Phone number is the anchor of unique identity. Check if an active registration exists.
        const duplicate = db.findDuplicateActiveRegistration(normalizedPhone, telegramUsername);
        if (duplicate) {
          res.writeHead(409, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({
            success: false,
            error: 'An active registration with this phone number or Telegram username already exists. Please use your registration reference to check status.'
          }));
        }

        // Create new registration record in SQLite database
        const newRecord = db.createRegistration({
          firstName,
          lastName,
          telegramUsername,
          phoneNumber,
          normalizedPhone,
          fieldOfStudy,
          academicYear,
          matricule,
          primaryDepartment,
          secondaryDepartment,
          motivation
        });

        logger.info('REGISTRATION_CREATED', {
          registrationNumber: newRecord.registrationNumber,
          firstName,
          lastName,
          status: newRecord.status
        });

        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          registrationId: newRecord.registrationNumber,
          status: newRecord.status,
          linkingToken: newRecord.linkingToken,
          message: 'Registration successfully received and saved.'
        }));
      } catch (err) {
        logger.error('REGISTRATION_CREATION_FAILED', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          error: 'An error occurred while saving your registration. Please try again.'
        }));
      }
    });
    return;
  }

  // 2. GET /api/registration-info?id=EPIC-2026-XXXX
  if (pathname === '/api/registration-info' && req.method === 'GET') {
    const regId = parsedUrl.query.id;
    if (!regId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: 'Registration ID required' }));
    }

    const found = db.getRegistrationByIdOrNumber(regId);
    if (!found) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: 'Registration record not found' }));
    }

    const settings = db.getAllSettings();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      success: true,
      data: {
        id: found.registrationNumber,
        status: found.status,
        createdAt: found.createdAt,
        telegramLinked: Boolean(found.telegramLinked),
        linkingToken: found.linkingToken,
        fieldOfStudy: found.fieldOfStudy,
        academicYear: found.academicYear,
        primaryDepartment: found.primaryDepartment,
        botUsername: settings.telegramBotUsername || config.TELEGRAM_BOT_USERNAME
      }
    }));
  }

  // 3. GET /api/registration-status?query=EPIC-2026-XXXX
  if (pathname === '/api/registration-status' && req.method === 'GET') {
    const query = parsedUrl.query.query || parsedUrl.query.id;
    if (!query || typeof query !== 'string' || !query.trim()) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: 'Registration reference is required' }));
    }

    const cleanQuery = query.trim();
    const found = db.getRegistrationByIdOrNumber(cleanQuery);
    if (!found) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        success: false,
        error: `No active registration found matching "${cleanQuery}".`
      }));
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      success: true,
      data: {
        registrationNumber: found.registrationNumber,
        fullName: `${found.firstName} ${found.lastName}`,
        status: found.status,
        telegramLinked: found.telegramLinked,
        fieldOfStudy: found.fieldOfStudy,
        academicYear: found.academicYear,
        primaryDepartment: found.primaryDepartment,
        createdAt: found.createdAt,
        statusNote: found.status === 'Confirmed'
          ? 'Your application has been verified and approved by the executive committee.'
          : found.status === 'Rejected'
            ? (found.rejectionReason || 'Application does not fulfill membership criteria.')
            : 'Your application has been received and is queued for verification.'
      }
    }));
  }

  // =========================================================================
  // TELEGRAM BOT WEBHOOK & ACCOUNT LINKING APIS
  // =========================================================================

  // 4. POST /api/telegram/webhook (Receives Telegram Bot updates)
  if (pathname === '/api/telegram/webhook' && req.method === 'POST') {
    // Verify Telegram secret token if configured
    if (config.TELEGRAM_WEBHOOK_SECRET) {
      const secretHeader = req.headers['x-telegram-bot-api-secret-token'];
      if (!secretHeader || secretHeader !== config.TELEGRAM_WEBHOOK_SECRET) {
        logger.warn('TELEGRAM_WEBHOOK_FORBIDDEN', { reason: 'Secret token missing or invalid' });
        res.writeHead(403, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: 'Forbidden' }));
      }
    }

    parseJsonBody(req, res, async payload => {
      try {
        await handleTelegramUpdate(payload);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        logger.error('TELEGRAM_WEBHOOK_ERROR', err);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      }
    });
    return;
  }

  // 5. POST /api/telegram/simulate-link (Testing & Development Helper for Account Linking)
  if (pathname === '/api/telegram/simulate-link' && req.method === 'POST') {
    parseJsonBody(req, res, payload => {
      const { registrationId, chatId } = payload;
      if (!registrationId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: 'Registration ID is required' }));
      }

      const record = db.getRegistrationByIdOrNumber(registrationId);
      if (!record) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: 'Registration record not found' }));
      }

      const assignedChatId = chatId ? parseInt(chatId, 10) || chatId : Math.floor(100000000 + Math.random() * 900000000);
      const updated = db.linkTelegramChat(record.id, assignedChatId);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        success: true,
        message: `Telegram account successfully linked with Chat ID ${assignedChatId}`,
        registration: updated
      }));
    });
    return;
  }

  // =========================================================================
  // ADMINISTRATIVE APIS (PROTECTED)
  // =========================================================================

  // 6. POST /api/admin/login
  if (pathname === '/api/admin/login' && req.method === 'POST') {
    parseJsonBody(req, res, payload => {
      const { username, password } = payload;
      const clientIp = getClientIp(req);

      if (!username || !password) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: 'Username and password required.' }));
      }

      const adminUser = db.getAdminByUsername(username);
      if (!adminUser) {
        db.createAuditLog({
          actorId: 'anonymous',
          actorUsername: sanitizeString(username, 50),
          action: 'ADMIN_LOGIN_FAILED',
          outcome: 'FAILURE',
          details: 'Username not found',
          ipAddress: clientIp
        });
        res.writeHead(401, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: 'Invalid admin username or password.' }));
      }

      const computedHash = crypto.pbkdf2Sync(password, adminUser.salt, 100000, 64, 'sha512').toString('hex');
      const hashBufA = Buffer.from(computedHash, 'hex');
      const hashBufB = Buffer.from(adminUser.password_hash, 'hex');

      if (hashBufA.length !== hashBufB.length || !crypto.timingSafeEqual(hashBufA, hashBufB)) {
        db.createAuditLog({
          actorId: adminUser.id,
          actorUsername: adminUser.username,
          action: 'ADMIN_LOGIN_FAILED',
          outcome: 'FAILURE',
          details: 'Invalid password provided',
          ipAddress: clientIp
        });
        res.writeHead(401, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: 'Invalid admin username or password.' }));
      }

      const sessionToken = crypto.randomBytes(32).toString('hex');
      const maxAgeMs = config.SESSION_MAX_AGE_HOURS * 3600 * 1000;
      const expiresAt = Date.now() + maxAgeMs;

      db.createAdminSession(adminUser.id, sessionToken, expiresAt);

      db.createAuditLog({
        actorId: adminUser.id,
        actorUsername: adminUser.username,
        action: 'ADMIN_LOGIN_SUCCESS',
        outcome: 'SUCCESS',
        details: 'Admin authenticated successfully',
        ipAddress: clientIp
      });

      res.setHeader('Set-Cookie', `epic_admin_session=${sessionToken}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${config.SESSION_MAX_AGE_HOURS * 3600}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        success: true,
        token: sessionToken,
        user: {
          username: adminUser.username,
          fullName: adminUser.full_name,
          role: adminUser.role
        }
      }));
    });
    return;
  }

  // 7. POST /api/admin/logout
  if (pathname === '/api/admin/logout' && req.method === 'POST') {
    const auth = authenticateAdmin(req);
    if (auth.authenticated && auth.token) {
      db.deleteAdminSession(auth.token);
      db.createAuditLog({
        actorId: auth.session.adminId,
        actorUsername: auth.session.username,
        action: 'ADMIN_LOGOUT',
        outcome: 'SUCCESS',
        details: 'Admin logged out'
      });
    }
    res.setHeader('Set-Cookie', `epic_admin_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: true, message: 'Logged out successfully.' }));
  }

  // 8. GET /api/admin/me
  if (pathname === '/api/admin/me' && req.method === 'GET') {
    const auth = authenticateAdmin(req);
    if (!auth.authenticated) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: 'Unauthorized: Admin session invalid or expired.' }));
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      success: true,
      user: {
        username: auth.session.username,
        fullName: auth.session.fullName,
        role: auth.session.role
      }
    }));
  }

  // 9. GET /api/admin/settings & POST /api/admin/settings
  if (pathname === '/api/admin/settings') {
    const auth = authenticateAdmin(req);
    if (!auth.authenticated) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: 'Unauthorized: Admin authentication required.' }));
    }

    if (req.method === 'GET') {
      const settings = db.getAllSettings();
      const token = settings.telegramBotToken || '';
      const maskedToken = token.length > 8
        ? `${token.slice(0, 6)}••••••••${token.slice(-4)}`
        : '';

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        success: true,
        settings: {
          telegramBotUsername: settings.telegramBotUsername,
          defaultTargetChatId: settings.defaultTargetChatId,
          defaultExpiryHours: parseInt(settings.defaultExpiryHours, 10) || 48,
          hasBotToken: Boolean(token),
          maskedToken: maskedToken
        }
      }));
    }

    if (req.method === 'POST') {
      parseJsonBody(req, res, payload => {
        if (payload.telegramBotToken !== undefined && payload.telegramBotToken.trim() !== '') {
          db.setSetting('telegramBotToken', payload.telegramBotToken.trim());
        }
        if (payload.telegramBotUsername) {
          db.setSetting('telegramBotUsername', payload.telegramBotUsername.trim().replace(/^@+/, ''));
        }
        if (payload.defaultTargetChatId) {
          db.setSetting('defaultTargetChatId', payload.defaultTargetChatId.trim());
        }
        if (payload.defaultExpiryHours) {
          db.setSetting('defaultExpiryHours', parseInt(payload.defaultExpiryHours, 10) || 48);
        }

        db.createAuditLog({
          actorId: auth.session.adminId,
          actorUsername: auth.session.username,
          action: 'SETTINGS_UPDATED',
          outcome: 'SUCCESS',
          details: 'Telegram bot and system settings updated'
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true, message: 'Settings saved successfully' }));
      });
      return;
    }
  }

  // 9b. GET /api/admin/telegram/status
  if (pathname === '/api/admin/telegram/status' && req.method === 'GET') {
    const auth = authenticateAdmin(req);
    if (!auth.authenticated) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: 'Unauthorized: Admin authentication required.' }));
    }

    const settings = db.getAllSettings();
    const token = settings.telegramBotToken || config.TELEGRAM_BOT_TOKEN;

    const [botRes, whRes] = await Promise.all([
      callTelegramApi(token, 'getMe', {}),
      callTelegramApi(token, 'getWebhookInfo', {})
    ]);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      success: true,
      bot: botRes.ok ? botRes.result : null,
      webhook: whRes.ok ? whRes.result : null,
      isPolling: isPolling,
      mode: (whRes.ok && whRes.result && whRes.result.url) ? 'webhook' : (isPolling ? 'polling' : 'idle')
    }));
  }

  // 9c. POST /api/admin/telegram/set-webhook
  if (pathname === '/api/admin/telegram/set-webhook' && req.method === 'POST') {
    const auth = authenticateAdmin(req);
    if (!auth.authenticated) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: 'Unauthorized: Admin authentication required.' }));
    }

    parseJsonBody(req, res, async payload => {
      const { url: webhookUrl } = payload;
      if (!webhookUrl || typeof webhookUrl !== 'string' || !webhookUrl.startsWith('https://')) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: 'A valid HTTPS URL is required for Telegram webhooks.' }));
      }

      const settings = db.getAllSettings();
      const token = settings.telegramBotToken || config.TELEGRAM_BOT_TOKEN;
      const secret = config.TELEGRAM_WEBHOOK_SECRET || '';

      const whRes = await callTelegramApi(token, 'setWebhook', {
        url: webhookUrl,
        secret_token: secret,
        allowed_updates: ['message']
      });

      if (whRes.ok) {
        stopTelegramPolling();
        db.createAuditLog({
          actorId: auth.session.adminId,
          actorUsername: auth.session.username,
          action: 'TELEGRAM_WEBHOOK_SET',
          outcome: 'SUCCESS',
          details: `Webhook set to ${logger.sanitize(webhookUrl)}`
        });
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(whRes));
    });
    return;
  }

  // 9d. POST /api/admin/telegram/delete-webhook
  if (pathname === '/api/admin/telegram/delete-webhook' && req.method === 'POST') {
    const auth = authenticateAdmin(req);
    if (!auth.authenticated) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: 'Unauthorized: Admin authentication required.' }));
    }

    const settings = db.getAllSettings();
    const token = settings.telegramBotToken || config.TELEGRAM_BOT_TOKEN;

    const delRes = await callTelegramApi(token, 'deleteWebhook', { drop_pending_updates: false });
    if (delRes.ok) {
      db.createAuditLog({
        actorId: auth.session.adminId,
        actorUsername: auth.session.username,
        action: 'TELEGRAM_WEBHOOK_DELETED',
        outcome: 'SUCCESS',
        details: 'Webhook deleted. Switching back to long-polling mode.'
      });
      startTelegramPolling().catch(() => {});
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(delRes));
  }

  // 10. GET /api/admin/summary
  if (pathname === '/api/admin/summary' && req.method === 'GET') {
    const auth = authenticateAdmin(req);
    if (!auth.authenticated) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: 'Unauthorized: Admin authentication required.' }));
    }

    const summary = db.getRegistrationsSummary();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: true, summary }));
  }

  // 11. GET /api/admin/registrations
  if (pathname === '/api/admin/registrations' && req.method === 'GET') {
    const auth = authenticateAdmin(req);
    if (!auth.authenticated) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: 'Unauthorized: Admin authentication required.' }));
    }

    const query = parsedUrl.query;
    const search = (query.search || '').trim();
    const statusFilter = (query.status || 'All').trim();
    const telegramFilter = (query.telegramStatus || 'All').trim();
    const fieldFilter = (query.fieldOfStudy || 'All').trim();
    const deptFilter = (query.department || 'All').trim();
    const page = parseInt(query.page || '1', 10) || 1;
    const limit = parseInt(query.limit || '10', 10) || 10;

    const result = db.listRegistrations({
      search,
      status: statusFilter,
      telegramStatus: telegramFilter,
      fieldOfStudy: fieldFilter,
      department: deptFilter,
      page,
      limit
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      success: true,
      data: result.items,
      page: result.page,
      limit: result.limit,
      totalCount: result.totalCount,
      totalPages: result.totalPages,
      summary: result.summary
    }));
  }

  // 12. GET /api/admin/registrations/:id
  const regDetailMatch = pathname.match(/^\/api\/admin\/registrations\/([A-Za-z0-9\-]+)$/);
  if (regDetailMatch && req.method === 'GET') {
    const auth = authenticateAdmin(req);
    if (!auth.authenticated) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: 'Unauthorized: Admin authentication required.' }));
    }

    const regId = regDetailMatch[1];
    const record = db.getRegistrationByIdOrNumber(regId);

    if (!record) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: 'Registration record not found.' }));
    }

    const settings = db.getAllSettings();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      success: true,
      registration: record,
      botUsername: settings.telegramBotUsername || config.TELEGRAM_BOT_USERNAME
    }));
  }

  // 13. POST /api/admin/registrations/:id/confirm (FULL CONFIRMATION & INVITATION WORKFLOW)
  const confirmMatch = pathname.match(/^\/api\/admin\/registrations\/([A-Za-z0-9\-]+)\/confirm$/);
  if (confirmMatch && req.method === 'POST') {
    const auth = authenticateAdmin(req);
    if (!auth.authenticated) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: 'Unauthorized: Admin authentication required.' }));
    }

    const regId = confirmMatch[1];
    parseJsonBody(req, res, async payload => {
      const record = db.getRegistrationByIdOrNumber(regId);
      if (!record) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: 'Registration record not found.' }));
      }

      const settings = db.getAllSettings();
      const targetChatId = (payload.targetChatId || settings.defaultTargetChatId || config.TELEGRAM_TARGET_CHAT_ID).trim();

      if (!targetChatId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          success: false,
          error: 'Target Telegram group or channel identifier is required.'
        }));
      }

      const expiryHours = payload.expiryHours !== undefined && payload.expiryHours !== null && payload.expiryHours !== ''
        ? parseInt(payload.expiryHours, 10)
        : parseInt(settings.defaultExpiryHours, 10) || 48;

      let expireTimestamp = 0;
      if (expiryHours && expiryHours > 0) {
        expireTimestamp = Math.floor(Date.now() / 1000) + (expiryHours * 3600);
      }

      // Check if candidate already has an active, unexpired single-use link for this chat
      let inviteLink = null;
      if (record.invitation && record.invitation.inviteLink && record.invitation.targetChatId === targetChatId && !record.invitation.isRevoked) {
        const nowSec = Math.floor(Date.now() / 1000);
        if (!record.invitation.expireDate || record.invitation.expireDate > nowSec) {
          inviteLink = record.invitation.inviteLink;
        }
      }

      // Generate new single-use invite link via Telegram Bot API if none reusable
      if (!inviteLink) {
        if (targetChatId.startsWith('http://') || targetChatId.startsWith('https://')) {
          // Admin provided a direct group invite link URL (e.g. https://t.me/+...)
          inviteLink = targetChatId;
        } else {
          const invitePayload = {
            chat_id: targetChatId,
            name: `EPIC-${record.registrationNumber}`,
            member_limit: 1 // strictly member_limit=1
          };
          if (expireTimestamp > 0) {
            invitePayload.expire_date = expireTimestamp;
          }

          const inviteRes = await callTelegramApi(settings.telegramBotToken, 'createChatInviteLink', invitePayload);

          if (!inviteRes.ok || !inviteRes.result || !inviteRes.result.invite_link) {
          const safeErr = logger.sanitize(inviteRes.description || 'Failed to create Telegram invite link');
          
          db.updateRegistrationStatus(record.internalId, {
            status: 'Confirmed',
            confirmedBy: auth.session.adminId,
            telegramInviteStatus: 'Failed'
          });

          db.saveInvitation({
            registrationId: record.internalId,
            targetGroupIdentifier: targetChatId,
            inviteLink: null,
            expiryTimestamp: expireTimestamp,
            status: 'Failed',
            lastError: safeErr
          });

          db.createAuditLog({
            actorId: auth.session.adminId,
            actorUsername: auth.session.username,
            action: 'REGISTRATION_CONFIRMED_INVITE_FAILED',
            affectedRegistrationId: record.registrationNumber,
            outcome: 'FAILURE',
            details: `Status set to Confirmed, but Telegram invite generation failed: ${safeErr}`
          });

          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({
            success: true,
            warning: `Registration confirmed, but Telegram Bot reported an error creating the invite link: ${safeErr}.`,
            registration: db.getRegistrationByIdOrNumber(record.id)
          }));
        }

        inviteLink = inviteRes.result.invite_link;
        }
      }

      // Private delivery via Telegram Bot if chat is linked
      let inviteDeliveryStatus = 'Pending Linking';
      let deliveryMessage = 'Invitation link created. Candidate has not connected their Telegram bot yet.';
      let sentAt = null;
      let deliveryError = null;

      if (record.telegramLinked && record.telegramChatId) {
        const expiryNotice = expireTimestamp > 0 ? ` (valid for ${expiryHours} hours)` : '';
        const msgText = `🎉 <b>Congratulations, ${record.firstName}!</b>\n\nYour application for <b>EPIC CLUB</b> (ID: <code>${record.registrationNumber}</code>) has been approved by the executive committee!\n\nHere is your unique, single-use invitation link to join the official cohort group:\n👉 <b>${inviteLink}</b>\n\n<i>Note: This invitation is strictly personal and can only be used by one person${expiryNotice}. Welcome to EPIC!</i>`;

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
          deliveryError = logger.sanitize(sendRes.description || 'Failed to deliver message');
          deliveryMessage = `Invitation link created, but message delivery failed: ${deliveryError}`;
        }
      }

      // Persist Invitation in invitations table
      db.saveInvitation({
        registrationId: record.internalId,
        targetGroupIdentifier: targetChatId,
        inviteLink: inviteLink,
        expiryTimestamp: expireTimestamp,
        status: inviteDeliveryStatus,
        sentAt: sentAt,
        lastError: deliveryError
      });

      // Update registration status
      const updatedRecord = db.updateRegistrationStatus(record.internalId, {
        status: 'Confirmed',
        confirmedBy: auth.session.adminId,
        telegramInviteStatus: inviteDeliveryStatus
      });

      // Log in Audit Trail
      db.createAuditLog({
        actorId: auth.session.adminId,
        actorUsername: auth.session.username,
        action: 'REGISTRATION_CONFIRMED',
        affectedRegistrationId: record.registrationNumber,
        outcome: 'SUCCESS',
        details: payload.note
          ? `Confirmed: ${sanitizeString(payload.note)} (${deliveryMessage})`
          : `Confirmed. ${deliveryMessage}`
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        success: true,
        message: `Registration ${record.registrationNumber} successfully confirmed. ${deliveryMessage}`,
        registration: updatedRecord,
        deliveryStatus: inviteDeliveryStatus
      }));
    });
    return;
  }

  // 14. POST /api/admin/registrations/:id/retry-invite
  const retryMatch = pathname.match(/^\/api\/admin\/registrations\/([A-Za-z0-9\-]+)\/retry-invite$/);
  if (retryMatch && req.method === 'POST') {
    const auth = authenticateAdmin(req);
    if (!auth.authenticated) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: 'Unauthorized: Admin authentication required.' }));
    }

    const regId = retryMatch[1];
    parseJsonBody(req, res, async payload => {
      const record = db.getRegistrationByIdOrNumber(regId);
      if (!record) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: 'Registration record not found.' }));
      }

      const settings = db.getAllSettings();
      let inviteLink = (record.invitation && record.invitation.inviteLink) ? record.invitation.inviteLink : null;
      if (!inviteLink) {
        const target = (record.invitation && record.invitation.targetChatId) || settings.defaultTargetChatId;
        if (target && (target.startsWith('http://') || target.startsWith('https://'))) {
          inviteLink = target;
        }
      }

      if (!inviteLink) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: 'No invitation link exists for this registration. Please re-confirm the registration.' }));
      }

      if (!record.telegramChatId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          success: false,
          error: 'Participant has not linked their Telegram account yet. Candidate must open the bot with their deep link first.'
        }));
      }

      const msgText = `🎉 <b>Welcome to EPIC CLUB, ${record.firstName}!</b>\n\nYour application (ID: <code>${record.registrationNumber}</code>) is approved.\n\nHere is your unique, single-use invitation link:\n👉 <b>${inviteLink}</b>\n\n<i>Note: This invitation is strictly personal (member limit: 1).</i>`;

      const sendRes = await callTelegramApi(settings.telegramBotToken, 'sendMessage', {
        chat_id: record.telegramChatId,
        text: msgText,
        parse_mode: 'HTML'
      });

      if (sendRes.ok) {
        db.updateTelegramInviteStatus(record.internalId, 'Delivered');
        db.saveInvitation({
          registrationId: record.internalId,
          targetGroupIdentifier: record.invitation.targetChatId,
          inviteLink: inviteLink,
          status: 'Delivered',
          sentAt: new Date().toISOString(),
          lastError: null
        });

        db.createAuditLog({
          actorId: auth.session.adminId,
          actorUsername: auth.session.username,
          action: 'INVITE_DELIVERY_RETRY',
          affectedRegistrationId: record.registrationNumber,
          outcome: 'SUCCESS',
          details: `Delivered private invitation link to Telegram Chat ID ${record.telegramChatId}`
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          success: true,
          message: 'Invitation successfully delivered to Telegram chat!',
          registration: db.getRegistrationByIdOrNumber(record.id)
        }));
      } else {
        const safeErr = logger.sanitize(sendRes.description || 'Delivery attempt failed');
        db.updateTelegramInviteStatus(record.internalId, 'Failed');
        db.saveInvitation({
          registrationId: record.internalId,
          targetGroupIdentifier: record.invitation.targetChatId,
          inviteLink: inviteLink,
          status: 'Failed',
          lastError: safeErr
        });

        db.createAuditLog({
          actorId: auth.session.adminId,
          actorUsername: auth.session.username,
          action: 'INVITE_DELIVERY_RETRY_FAILED',
          affectedRegistrationId: record.registrationNumber,
          outcome: 'FAILURE',
          details: `Delivery retry failed: ${safeErr}`
        });

        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          success: false,
          error: `Telegram delivery failed: ${safeErr}`,
          registration: db.getRegistrationByIdOrNumber(record.id)
        }));
      }
    });
    return;
  }

  // 15. POST /api/admin/registrations/:id/revoke-invite
  const revokeMatch = pathname.match(/^\/api\/admin\/registrations\/([A-Za-z0-9\-]+)\/revoke-invite$/);
  if (revokeMatch && req.method === 'POST') {
    const auth = authenticateAdmin(req);
    if (!auth.authenticated) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: 'Unauthorized: Admin authentication required.' }));
    }

    const regId = revokeMatch[1];
    const record = db.getRegistrationByIdOrNumber(regId);

    if (!record || !record.invitation || !record.invitation.inviteLink) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: 'No active invitation to revoke.' }));
    }

    const settings = db.getAllSettings();
    await callTelegramApi(settings.telegramBotToken, 'revokeChatInviteLink', {
      chat_id: record.invitation.targetChatId,
      invite_link: record.invitation.inviteLink
    });

    db.revokeInvitation(record.internalId);
    db.updateTelegramInviteStatus(record.internalId, 'Revoked');

    db.createAuditLog({
      actorId: auth.session.adminId,
      actorUsername: auth.session.username,
      action: 'INVITE_REVOKED',
      affectedRegistrationId: record.registrationNumber,
      outcome: 'SUCCESS',
      details: `Revoked single-use link: ${record.invitation.inviteLink}`
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      success: true,
      message: 'Invitation link revoked.',
      registration: db.getRegistrationByIdOrNumber(record.id)
    }));
  }

  // 16. POST /api/admin/registrations/:id/reject
  const rejectMatch = pathname.match(/^\/api\/admin\/registrations\/([A-Za-z0-9\-]+)\/reject$/);
  if (rejectMatch && req.method === 'POST') {
    const auth = authenticateAdmin(req);
    if (!auth.authenticated) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: 'Unauthorized: Admin authentication required.' }));
    }

    const regId = rejectMatch[1];
    parseJsonBody(req, res, payload => {
      const record = db.getRegistrationByIdOrNumber(regId);
      if (!record) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: 'Registration record not found.' }));
      }

      const reason = sanitizeString(payload.reason || 'Does not fulfill membership criteria', 255);
      const updated = db.updateRegistrationStatus(record.internalId, {
        status: 'Rejected',
        rejectionReason: reason
      });

      db.createAuditLog({
        actorId: auth.session.adminId,
        actorUsername: auth.session.username,
        action: 'REGISTRATION_REJECTED',
        affectedRegistrationId: record.registrationNumber,
        outcome: 'SUCCESS',
        details: `Rejected: ${reason}`
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        success: true,
        message: `Registration ${record.registrationNumber} marked as Rejected.`,
        registration: updated
      }));
    });
    return;
  }

  // 17. POST /api/admin/registrations/:id/telegram-status (Manual Delivery Override)
  const telegramMatch = pathname.match(/^\/api\/admin\/registrations\/([A-Za-z0-9\-]+)\/telegram-status$/);
  if (telegramMatch && req.method === 'POST') {
    const auth = authenticateAdmin(req);
    if (!auth.authenticated) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: 'Unauthorized: Admin authentication required.' }));
    }

    const regId = telegramMatch[1];
    parseJsonBody(req, res, payload => {
      const record = db.getRegistrationByIdOrNumber(regId);
      if (!record) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: 'Registration record not found.' }));
      }

      const allowedStatuses = ['Not Sent', 'Pending Linking', 'Sent', 'Delivered', 'Failed', 'Joined', 'Revoked'];
      const newStatus = payload.telegramInviteStatus;
      if (!allowedStatuses.includes(newStatus)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          success: false,
          error: `Invalid status. Must be one of: ${allowedStatuses.join(', ')}`
        }));
      }

      const previousStatus = record.telegramInviteStatus || 'Not Sent';
      const updated = db.updateTelegramInviteStatus(record.internalId, newStatus);

      db.createAuditLog({
        actorId: auth.session.adminId,
        actorUsername: auth.session.username,
        action: 'TELEGRAM_STATUS_OVERRIDE',
        affectedRegistrationId: record.registrationNumber,
        outcome: 'SUCCESS',
        details: `Telegram invite delivery updated from "${previousStatus}" to "${newStatus}"`
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        success: true,
        message: 'Telegram invite status updated.',
        registration: updated
      }));
    });
    return;
  }

  // 18. GET /api/admin/audit-logs
  if (pathname === '/api/admin/audit-logs' && req.method === 'GET') {
    const auth = authenticateAdmin(req);
    if (!auth.authenticated) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: 'Unauthorized: Admin authentication required.' }));
    }

    const query = parsedUrl.query;
    const limit = parseInt(query.limit || '50', 10) || 50;
    const offset = parseInt(query.offset || '0', 10) || 0;
    const regId = query.registrationId || null;

    const logs = db.listAuditLogs({ limit, offset, registrationId: regId });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: true, logs }));
  }

  // 19. GET /api/admin/backup
  if (pathname === '/api/admin/backup' && req.method === 'GET') {
    const auth = authenticateAdmin(req);
    if (!auth.authenticated) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: 'Unauthorized: Admin authentication required.' }));
    }

    const backup = db.exportFullBackup();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: true, backup }));
  }

  // 20. POST /api/admin/restore
  if (pathname === '/api/admin/restore' && req.method === 'POST') {
    const auth = authenticateAdmin(req);
    if (!auth.authenticated) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: 'Unauthorized: Admin authentication required.' }));
    }

    let rawBody = '';
    req.on('data', chunk => { rawBody += chunk; });
    req.on('end', () => {
      try {
        const body = JSON.parse(rawBody || '{}');
        const { data, mode = 'merge' } = body;

        if (!data) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: 'بيانات النسخة الاحتياطية مطلوبة.' }));
        }

        const stats = db.restoreBackup(data, mode);

        db.createAuditLog({
          actorId: auth.session.adminId,
          actorUsername: auth.session.username,
          action: 'DATABASE_RESTORE',
          outcome: 'SUCCESS',
          details: `Restored ${stats.registrationsRestored} registrations (mode: ${mode})`,
          ipAddress: req.socket.remoteAddress
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          success: true,
          message: `تمت استعادة البيانات بنجاح (${stats.registrationsRestored} طالب مسجل).`,
          stats
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: 'خطأ أثناء استعادة البيانات: ' + err.message }));
      }
    });
    return;
  }

  // =========================================================================
  // STATIC FILE SERVING
  // =========================================================================
  let filePath = path.join(ROOT_DIR, pathname);

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      const publicPath = path.join(ROOT_DIR, 'public', pathname);
      fs.stat(publicPath, (errPub, statsPub) => {
        if (!errPub && statsPub.isFile()) {
          serveFile(publicPath, res);
        } else {
          if (!path.extname(pathname) || pathname.endsWith('.html')) {
            serveFile(path.join(ROOT_DIR, 'index.html'), res);
          } else {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('404 Not Found');
          }
        }
      });
      return;
    }

    serveFile(filePath, res);
  });
});

function serveFile(filePath, res) {
  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('500 Internal Server Error');
      return;
    }
    res.writeHead(200, {
      'Content-Type': mime,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
    });
    res.end(content);
  });
}

if (require.main === module) {
  server.listen(PORT, () => {
    logger.info('SERVER_START', {
      port: PORT,
      database: config.DATABASE_PATH,
      url: `http://localhost:${PORT}`
    });
    console.log(`\n✨ EPIC CLUB Portal is running at: http://localhost:${PORT}`);
    console.log(`👉 Home:                 http://localhost:${PORT}/`);
    console.log(`👉 Register:             http://localhost:${PORT}/register`);
    console.log(`👉 Registration Success: http://localhost:${PORT}/registration-success`);
    console.log(`🔒 Admin Dashboard:      http://localhost:${PORT}/admin\n`);

    // Initiate Telegram long-polling (auto-activated if no webhook registered)
    startTelegramPolling().catch(err => {
      logger.error('TELEGRAM_POLLING_INIT_ERROR', err);
    });
  });
}

module.exports = server;
