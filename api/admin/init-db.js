/**
 * POST /api/admin/init-db
 * One-time database schema initialization for Neon PostgreSQL
 * Protected with a secret token
 */
const db = require('../../lib/db');
const { jsonResponse, setSecurityHeaders } = require('../../lib/auth');

module.exports = async function handler(req, res) {
  setSecurityHeaders(res);

  if (req.method !== 'POST') {
    return jsonResponse(res, 405, { success: false, error: 'Method not allowed' });
  }

  // Protect with INIT_SECRET env variable
  const initSecret = process.env.INIT_SECRET;
  const providedSecret = req.headers['x-init-secret'] || (req.body && req.body.secret);

  if (initSecret && providedSecret !== initSecret) {
    return jsonResponse(res, 403, { success: false, error: 'Forbidden: Invalid init secret.' });
  }

  try {
    await db.initializeSchema();
    await db.ensureDefaultAdmin();
    return jsonResponse(res, 200, {
      success: true,
      message: 'Database schema initialized and default admin seeded successfully.'
    });
  } catch (err) {
    console.error('DB_INIT_ERROR', err);
    return jsonResponse(res, 500, {
      success: false,
      error: 'Database initialization failed: ' + err.message
    });
  }
};
