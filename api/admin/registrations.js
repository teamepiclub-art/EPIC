/**
 * GET /api/admin/registrations - List all registrations with filters
 * GET /api/admin/summary - Dashboard summary stats
 */
const db = require('../../lib/db');
const { jsonResponse, setSecurityHeaders, authenticateAdmin } = require('../../lib/auth');

module.exports = async function handler(req, res) {
  setSecurityHeaders(res);

  const auth = await authenticateAdmin(req);
  if (!auth.authenticated) {
    return jsonResponse(res, 401, { success: false, error: 'Unauthorized: Admin authentication required.' });
  }

  if (req.method !== 'GET') {
    return jsonResponse(res, 405, { success: false, error: 'Method not allowed' });
  }

  const { search = '', status = 'All', telegramStatus = 'All', page = '1', limit = '10' } = req.query;

  try {
    const result = await db.listRegistrations({
      search: search.trim(),
      status: status.trim(),
      telegramStatus: telegramStatus.trim(),
      page: parseInt(page, 10) || 1,
      limit: parseInt(limit, 10) || 10
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
};
