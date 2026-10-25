/**
 * GET /api/admin/me - Get current admin session info
 */
const { jsonResponse, setSecurityHeaders, authenticateAdmin } = require('../../lib/auth');

module.exports = async function handler(req, res) {
  setSecurityHeaders(res);

  if (req.method !== 'GET') {
    return jsonResponse(res, 405, { success: false, error: 'Method not allowed' });
  }

  const auth = await authenticateAdmin(req);
  if (!auth.authenticated) {
    return jsonResponse(res, 401, { success: false, error: 'Unauthorized: Admin session invalid or expired.' });
  }

  return jsonResponse(res, 200, {
    success: true,
    user: {
      username: auth.session.username,
      fullName: auth.session.fullName,
      role: auth.session.role
    }
  });
};
