/**
 * GET /api/admin/audit-logs
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

  const limit = parseInt(req.query.limit || '50', 10) || 50;
  const offset = parseInt(req.query.offset || '0', 10) || 0;
  const registrationId = req.query.registrationId || null;

  const logs = await db.listAuditLogs({ limit, offset, registrationId });
  return jsonResponse(res, 200, { success: true, logs });
};
