/**
 * POST /api/admin/logout
 */
const db = require('../../lib/db');
const { jsonResponse, setSecurityHeaders, authenticateAdmin } = require('../../lib/auth');

module.exports = async function handler(req, res) {
  setSecurityHeaders(res);

  if (req.method !== 'POST') {
    return jsonResponse(res, 405, { success: false, error: 'Method not allowed' });
  }

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
};
