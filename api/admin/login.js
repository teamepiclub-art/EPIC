/**
 * POST /api/admin/login
 */
const db = require('../../lib/db');
const { jsonResponse, setSecurityHeaders, getClientIp, createSessionToken, parseBody, SESSION_MAX_AGE_HOURS } = require('../../lib/auth');
const crypto = require('crypto');

module.exports = async function handler(req, res) {
  setSecurityHeaders(res);

  if (req.method !== 'POST') {
    return jsonResponse(res, 405, { success: false, error: 'Method not allowed' });
  }

  const body = await parseBody(req);
  const { username, password } = body || {};
  const clientIp = getClientIp(req);

  if (!username || !password) {
    return jsonResponse(res, 400, { success: false, error: 'Username and password required.' });
  }

  const adminUser = await db.getAdminByUsername(username);
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
};
