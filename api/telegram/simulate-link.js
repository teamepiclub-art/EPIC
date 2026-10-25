/**
 * POST /api/telegram/simulate-link - Dev helper to simulate Telegram linking
 */
const db = require('../../lib/db');
const { jsonResponse, setSecurityHeaders } = require('../../lib/auth');

module.exports = async function handler(req, res) {
  setSecurityHeaders(res);

  if (req.method !== 'POST') {
    return jsonResponse(res, 405, { success: false, error: 'Method not allowed' });
  }

  const { registrationId, chatId } = req.body || {};
  if (!registrationId) {
    return jsonResponse(res, 400, { success: false, error: 'Registration ID is required' });
  }

  const record = await db.getRegistrationByIdOrNumber(registrationId);
  if (!record) {
    return jsonResponse(res, 404, { success: false, error: 'Registration record not found' });
  }

  const assignedChatId = chatId
    ? parseInt(chatId, 10) || chatId
    : Math.floor(100000000 + Math.random() * 900000000);

  const updated = await db.linkTelegramChat(record.id, assignedChatId);

  return jsonResponse(res, 200, {
    success: true,
    message: `Telegram account successfully linked with Chat ID ${assignedChatId}`,
    registration: updated
  });
};
