/**
 * GET /api/admin/summary - Dashboard summary stats
 */
const db = require('../../../lib/db');
const { jsonResponse, setSecurityHeaders, authenticateAdmin } = require('../../../lib/auth');

module.exports = async function handler(req, res) {
  setSecurityHeaders(res);

  const auth = await authenticateAdmin(req);
  if (!auth.authenticated) {
    return jsonResponse(res, 401, { success: false, error: 'Unauthorized: Admin authentication required.' });
  }

  if (req.method !== 'GET') {
    return jsonResponse(res, 405, { success: false, error: 'Method not allowed' });
  }

  const summary = await db.getRegistrationsSummary();
  return jsonResponse(res, 200, { success: true, summary });
};
