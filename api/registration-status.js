/**
 * GET /api/registration-status?query=EPIC-2026-XXXX
 */
const db = require('../../lib/db');
const { jsonResponse, setSecurityHeaders } = require('../../lib/auth');

module.exports = async function handler(req, res) {
  setSecurityHeaders(res);

  if (req.method !== 'GET') {
    return jsonResponse(res, 405, { success: false, error: 'Method not allowed' });
  }

  const query = req.query.query || req.query.id;
  if (!query || typeof query !== 'string' || !query.trim()) {
    return jsonResponse(res, 400, { success: false, error: 'Registration reference is required' });
  }

  const cleanQuery = query.trim();
  const found = await db.getRegistrationByIdOrNumber(cleanQuery);
  if (!found) {
    return jsonResponse(res, 404, {
      success: false,
      error: `No active registration found matching "${cleanQuery}".`
    });
  }

  return jsonResponse(res, 200, {
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
  });
};
