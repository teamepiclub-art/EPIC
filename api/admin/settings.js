/**
 * GET /api/admin/settings - Get system settings
 * POST /api/admin/settings - Update system settings
 */
const db = require('../../lib/db');
const { jsonResponse, setSecurityHeaders, authenticateAdmin } = require('../../lib/auth');

module.exports = async function handler(req, res) {
  setSecurityHeaders(res);

  const auth = await authenticateAdmin(req);
  if (!auth.authenticated) {
    return jsonResponse(res, 401, { success: false, error: 'Unauthorized: Admin authentication required.' });
  }

  if (req.method === 'GET') {
    const settings = await db.getAllSettings();
    const token = settings.telegramBotToken || '';
    const maskedToken = token.length > 8 ? `${token.slice(0, 6)}••••••••${token.slice(-4)}` : '';

    return jsonResponse(res, 200, {
      success: true,
      settings: {
        telegramBotUsername: settings.telegramBotUsername,
        defaultTargetChatId: settings.defaultTargetChatId,
        defaultExpiryHours: parseInt(settings.defaultExpiryHours, 10) || 48,
        hasBotToken: Boolean(token),
        maskedToken
      }
    });
  }

  if (req.method === 'POST') {
    const payload = req.body || {};

    if (payload.telegramBotToken !== undefined && payload.telegramBotToken.trim() !== '') {
      await db.setSetting('telegramBotToken', payload.telegramBotToken.trim());
    }
    if (payload.telegramBotUsername) {
      await db.setSetting('telegramBotUsername', payload.telegramBotUsername.trim().replace(/^@+/, ''));
    }
    if (payload.defaultTargetChatId) {
      await db.setSetting('defaultTargetChatId', payload.defaultTargetChatId.trim());
    }
    if (payload.defaultExpiryHours) {
      await db.setSetting('defaultExpiryHours', String(parseInt(payload.defaultExpiryHours, 10) || 48));
    }

    await db.createAuditLog({
      actorId: auth.session.adminId, actorUsername: auth.session.username,
      action: 'SETTINGS_UPDATED', outcome: 'SUCCESS',
      details: 'Telegram bot and system settings updated'
    });

    return jsonResponse(res, 200, { success: true, message: 'Settings saved successfully' });
  }

  return jsonResponse(res, 405, { success: false, error: 'Method not allowed' });
};
