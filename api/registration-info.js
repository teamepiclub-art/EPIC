/**
 * GET /api/registration-info?id=EPIC-2026-XXXX
 * GET /api/registration-status?query=EPIC-2026-XXXX
 */
const db = require('../lib/db');
const { jsonResponse, setSecurityHeaders } = require('../lib/auth');

module.exports = async function handler(req, res) {
  setSecurityHeaders(res);

  if (req.method !== 'GET') {
    return jsonResponse(res, 405, { success: false, error: 'Method not allowed' });
  }

  const { id, query } = req.query;
  const lookup = id || query;

  if (!lookup || typeof lookup !== 'string' || !lookup.trim()) {
    return jsonResponse(res, 400, { success: false, error: 'Registration ID or reference is required' });
  }

  const found = await db.getRegistrationByIdOrNumber(lookup.trim());
  if (!found) {
    return jsonResponse(res, 404, {
      success: false,
      error: `No active registration found matching "${lookup.trim()}".`
    });
  }

  const settings = await db.getAllSettings();

  // Return appropriate response based on query param
  if (id) {
    // /api/registration-info style
    return jsonResponse(res, 200, {
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
        botUsername: settings.telegramBotUsername || process.env.TELEGRAM_BOT_USERNAME
      }
    });
  }

  // /api/registration-status style
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
