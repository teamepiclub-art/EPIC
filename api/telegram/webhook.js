/**
 * POST /api/telegram/webhook - Receive Telegram bot updates
 * POST /api/telegram/simulate-link - Development: Simulate linking
 */
const db = require('../../lib/db');
const { callTelegramApi } = require('../../lib/telegram');
const { jsonResponse, setSecurityHeaders, parseBody } = require('../../lib/auth');

async function handleTelegramUpdate(payload) {
  const chat = (payload.message && payload.message.chat) ||
               (payload.channel_post && payload.channel_post.chat) ||
               (payload.my_chat_member && payload.my_chat_member.chat);

  if (chat && (chat.type === 'group' || chat.type === 'supergroup' || chat.type === 'channel')) {
    await db.setSetting('lastDetectedGroupChatId', String(chat.id));
    if (chat.title) await db.setSetting('lastDetectedGroupTitle', chat.title);
  }

  const message = payload.message || payload.edited_message || payload.channel_post;
  if (!message || !message.text) return;

  const chatId = message.chat.id;
  const text = message.text.trim();
  const settings = await db.getAllSettings();
  const botToken = settings.telegramBotToken || process.env.TELEGRAM_BOT_TOKEN;

  // Group command: /id or /chatid
  if (message.chat && (message.chat.type === 'group' || message.chat.type === 'supergroup')) {
    if (text.startsWith('/id') || text.startsWith('/chatid')) {
      await callTelegramApi(botToken, 'sendMessage', {
        chat_id: chatId,
        text: `📌 <b>Group Chat ID:</b> <code>${chatId}</code>\n\nCopy this number and paste it into EPIC CLUB Admin Settings.`,
        parse_mode: 'HTML'
      });
      return;
    }
  }

  // Handle /start link_TOKEN
  const match = text.match(/^\/start\s+(link_[A-Za-z0-9\-]+|[A-Za-z0-9\-]+)/i);
  if (match) {
    const rawToken = match[1];
    const record = await db.getRegistrationByLinkingToken(rawToken);

    if (record) {
      const linkResult = await db.linkTelegramChat(record.id, chatId);

      if (!linkResult.success) {
        const errMsg = linkResult.error === 'TOKEN_ALREADY_USED'
          ? `⚠️ <b>Verification Token Already Used</b>\n\nThis verification link has already been used.`
          : `⚠️ <b>Verification Token Expired</b>\n\nThis verification link has expired.`;
        await callTelegramApi(botToken, 'sendMessage', { chat_id: chatId, text: errMsg, parse_mode: 'HTML' });
        return;
      }

      // If already confirmed and invite exists, deliver now
      if (record.status === 'Confirmed' && record.invitation && record.invitation.inviteLink) {
        const sendRes = await callTelegramApi(botToken, 'sendMessage', {
          chat_id: chatId,
          text: `🎉 <b>Welcome to EPIC CLUB, ${record.firstName}!</b>\n\nYour registration (<code>${record.registrationNumber}</code>) is approved.\n\nHere is your unique, single-use invitation link:\n👉 ${record.invitation.inviteLink}\n\n<i>Note: This link is unique to you (limit: 1 member). Please do not share it.</i>`,
          parse_mode: 'HTML'
        });

        if (sendRes.ok) {
          await db.updateTelegramInviteStatus(record.id, 'Delivered');
          await db.saveInvitation({ registrationId: record.id, targetGroupIdentifier: record.invitation.targetChatId, inviteLink: record.invitation.inviteLink, expiryTimestamp: record.invitation.expireDate, status: 'Delivered', sentAt: new Date().toISOString() });
          await db.createAuditLog({ actorId: 'telegram_bot', actorUsername: 'Telegram Bot', action: 'INVITATION_DELIVERED', affectedRegistrationId: record.registrationNumber, outcome: 'SUCCESS', details: `Direct single-use invite delivered to chat ID ${chatId}` });
        }
        return;
      }

      await callTelegramApi(botToken, 'sendMessage', {
        chat_id: chatId,
        text: `✅ <b>Telegram Account Successfully Linked!</b>\n\nHello <b>${record.firstName}</b>, your Telegram account is now connected with your EPIC CLUB registration (<code>${record.registrationNumber}</code>).\n\nOnce the executive committee completes the review of your application, your official single-use invitation link will be sent to you right here.`,
        parse_mode: 'HTML'
      });
    } else {
      await callTelegramApi(botToken, 'sendMessage', {
        chat_id: chatId,
        text: `⚠️ <b>Registration not found</b>\n\nThe linking code provided does not match any active registration.`,
        parse_mode: 'HTML'
      });
    }
  } else if (text === '/start') {
    await callTelegramApi(botToken, 'sendMessage', {
      chat_id: chatId,
      text: `👋 <b>Welcome to the official EPIC CLUB Bot!</b>\n\nTo link your registration, please open the link provided on the EPIC CLUB registration confirmation page.`,
      parse_mode: 'HTML'
    });
  }
}

module.exports = async function handler(req, res) {
  setSecurityHeaders(res);

  const path = req.url.split('?')[0];

  // POST /api/telegram/webhook
  if (req.method === 'POST' && (path.endsWith('/webhook') || req.query.action === 'webhook')) {
    // Verify secret token
    const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (webhookSecret) {
      const secretHeader = req.headers['x-telegram-bot-api-secret-token'];
      if (!secretHeader || secretHeader !== webhookSecret) {
        return jsonResponse(res, 403, { ok: false, error: 'Forbidden' });
      }
    }

    try {
      const payload = await parseBody(req);
      await handleTelegramUpdate(payload);
      return jsonResponse(res, 200, { ok: true });
    } catch (err) {
      console.error('TELEGRAM_WEBHOOK_ERROR', err);
      return jsonResponse(res, 200, { ok: true }); // Always 200 to Telegram
    }
  }

  // POST /api/telegram/simulate-link (dev helper)
  if (req.method === 'POST' && (path.endsWith('/simulate-link') || req.query.action === 'simulate-link')) {
    const { registrationId, chatId } = req.body || {};
    if (!registrationId) return jsonResponse(res, 400, { success: false, error: 'Registration ID is required' });

    const record = await db.getRegistrationByIdOrNumber(registrationId);
    if (!record) return jsonResponse(res, 404, { success: false, error: 'Registration record not found' });

    const assignedChatId = chatId ? parseInt(chatId, 10) || chatId : Math.floor(100000000 + Math.random() * 900000000);
    const updated = await db.linkTelegramChat(record.id, assignedChatId);

    return jsonResponse(res, 200, {
      success: true,
      message: `Telegram account linked with Chat ID ${assignedChatId}`,
      registration: updated
    });
  }

  return jsonResponse(res, 404, { success: false, error: 'Not found' });
};
