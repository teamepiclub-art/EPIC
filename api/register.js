/**
 * POST /api/register
 * Public endpoint - Submit new club membership registration
 */
const db = require('../../lib/db');
const { jsonResponse, setSecurityHeaders } = require('../../lib/auth');
const { validateRegistrationInput, sanitizeString } = require('../../utils/validation');

module.exports = async function handler(req, res) {
  setSecurityHeaders(res);

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return jsonResponse(res, 405, { success: false, error: 'Method not allowed' });
  }

  try {
    const payload = req.body || {};
    const validation = validateRegistrationInput(payload);
    if (!validation.isValid) {
      return jsonResponse(res, 400, {
        success: false,
        error: validation.errors[0],
        errors: validation.errors
      });
    }

    const {
      firstName, lastName, telegramUsername, phoneNumber, normalizedPhone,
      fieldOfStudy, academicYear, matricule,
      primaryDepartment, secondaryDepartment, motivation
    } = validation.data;

    const duplicate = await db.findDuplicateActiveRegistration(normalizedPhone, telegramUsername);
    if (duplicate) {
      return jsonResponse(res, 409, {
        success: false,
        error: 'An active registration with this phone number or Telegram username already exists.'
      });
    }

    const newRecord = await db.createRegistration({
      firstName, lastName, telegramUsername, phoneNumber, normalizedPhone,
      fieldOfStudy, academicYear, matricule,
      primaryDepartment, secondaryDepartment, motivation
    });

    return jsonResponse(res, 201, {
      success: true,
      registrationId: newRecord.registrationNumber,
      status: newRecord.status,
      linkingToken: newRecord.linkingToken,
      message: 'Registration successfully received and saved.'
    });
  } catch (err) {
    console.error('REGISTRATION_CREATION_FAILED', err);
    return jsonResponse(res, 500, {
      success: false,
      error: 'An error occurred while saving your registration. Please try again.'
    });
  }
};
