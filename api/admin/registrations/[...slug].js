/**
 * GET /api/admin/registrations/[id]
 * POST /api/admin/registrations/[id]/confirm
 * POST /api/admin/registrations/[id]/reject
 * POST /api/admin/registrations/[id]/retry-invite
 * POST /api/admin/registrations/[id]/revoke-invite
 * POST /api/admin/registrations/[id]/telegram-status
 *
 * Dynamic route: /api/admin/registrations/[...slug]
 */
const db = require('../../../lib/db');
const { callTelegramApi } = require('../../../lib/telegram');
const { jsonResponse, setSecurityHeaders, authenticateAdmin, parseBody } = require('../../../lib/auth');

function sanitizeStr(str, max = 255) {
  if (!str) return '';
  return String(str).replace(/[\u0000-\u001F]/g, '').slice(0, max);
}

module.exports = async function handler(req, res) {
  setSecurityHeaders(res);

  const auth = await authenticateAdmin(req);
  if (!auth.authenticated) {
    return jsonResponse(res, 401, { success: false, error: 'Unauthorized: Admin authentication required.' });
  }

  // Robust slug extraction: checks req.query.slug or extracts from req.url
  let slug = [];
  if (Array.isArray(req.query.slug)) {
    slug = req.query.slug;
  } else if (typeof req.query.slug === 'string' && req.query.slug.length > 0) {
    slug = req.query.slug.split('/').filter(Boolean);
  } else {
    const pathname = (req.url || '').split('?')[0];
    const prefix = '/api/admin/registrations/';
    if (pathname.includes(prefix)) {
      slug = pathname.slice(pathname.indexOf(prefix) + prefix.length).split('/').filter(Boolean);
    }
  }
  const regId = slug[0];
  const action = slug[1]; // confirm | reject | retry-invite | revoke-invite | telegram-status

  if (!regId) {
    return jsonResponse(res, 400, { success: false, error: 'Registration ID is required.' });
  }

  // GET /api/admin/registrations/[id]
  if (!action && req.method === 'GET') {
    const record = await db.getRegistrationByIdOrNumber(regId);
    if (!record) {
      return jsonResponse(res, 404, { success: false, error: 'Registration record not found.' });
    }
    const settings = await db.getAllSettings();
    return jsonResponse(res, 200, {
      success: true,
      registration: record,
      botUsername: settings.telegramBotUsername || process.env.TELEGRAM_BOT_USERNAME
    });
  }

  // POST /api/admin/registrations/[id]/confirm
  if (action === 'confirm' && req.method === 'POST') {
    const payload = (await parseBody(req)) || {};
    const record = await db.getRegistrationByIdOrNumber(regId);
    if (!record) return jsonResponse(res, 404, { success: false, error: 'Registration record not found.' });

    const settings = await db.getAllSettings();
    const targetChatId = (payload.targetChatId || settings.defaultTargetChatId || process.env.TELEGRAM_TARGET_CHAT_ID || '').toString().trim();

    if (!targetChatId) {
      return jsonResponse(res, 400, { success: false, error: 'Target Telegram group or channel identifier is required.' });
    }

    const expiryHours = payload.expiryHours !== undefined && payload.expiryHours !== null && payload.expiryHours !== ''
      ? parseInt(payload.expiryHours, 10)
      : parseInt(settings.defaultExpiryHours, 10) || 48;

    let expireTimestamp = 0;
    if (expiryHours && expiryHours > 0) {
      expireTimestamp = Math.floor(Date.now() / 1000) + (expiryHours * 3600);
    }

    // Check for existing valid invite link
    let inviteLink = null;
    if (record.invitation && record.invitation.inviteLink && record.invitation.targetChatId === targetChatId && !record.invitation.isRevoked) {
      const nowSec = Math.floor(Date.now() / 1000);
      if (!record.invitation.expireDate || record.invitation.expireDate > nowSec) {
        inviteLink = record.invitation.inviteLink;
      }
    }

    // Generate new invite link
    if (!inviteLink) {
      if (targetChatId.startsWith('http://') || targetChatId.startsWith('https://')) {
        inviteLink = targetChatId;
      } else {
        const invitePayload = {
          chat_id: targetChatId,
          name: `EPIC-${record.registrationNumber}`,
          member_limit: 1
        };
        if (expireTimestamp > 0) invitePayload.expire_date = expireTimestamp;

        const inviteRes = await callTelegramApi(settings.telegramBotToken, 'createChatInviteLink', invitePayload);

        if (!inviteRes.ok || !inviteRes.result || !inviteRes.result.invite_link) {
          const safeErr = sanitizeStr(inviteRes.description || 'Failed to create Telegram invite link', 200);
          await db.updateRegistrationStatus(record.internalId, { status: 'Confirmed', confirmedBy: auth.session.adminId, telegramInviteStatus: 'Failed' });
          await db.saveInvitation({ registrationId: record.internalId, targetGroupIdentifier: targetChatId, inviteLink: null, expiryTimestamp: expireTimestamp, status: 'Failed', lastError: safeErr });
          await db.createAuditLog({ actorId: auth.session.adminId, actorUsername: auth.session.username, action: 'REGISTRATION_CONFIRMED_INVITE_FAILED', affectedRegistrationId: record.registrationNumber, outcome: 'FAILURE', details: `Confirmed but invite failed: ${safeErr}` });
          return jsonResponse(res, 200, { success: true, warning: `Registration confirmed, but Telegram Bot error: ${safeErr}.`, registration: await db.getRegistrationByIdOrNumber(record.id) });
        }

        inviteLink = inviteRes.result.invite_link;
      }
    }

    // Deliver privately if Telegram is linked
    let inviteDeliveryStatus = 'Pending Linking';
    let deliveryMessage = 'Invitation link created. Candidate has not connected their Telegram bot yet.';
    let sentAt = null;
    let deliveryError = null;

    if (record.telegramLinked && record.telegramChatId) {
      const expiryNotice = expireTimestamp > 0 ? ` (valid for ${expiryHours} hours)` : '';
      const msgText = `🎉 <b>Congratulations, ${record.firstName}!</b>\n\nYour application for <b>EPIC CLUB</b> (ID: <code>${record.registrationNumber}</code>) has been approved!\n\nHere is your unique, single-use invitation link:\n👉 <b>${inviteLink}</b>\n\n<i>Note: This invitation is strictly personal and can only be used by one person${expiryNotice}. Welcome to EPIC!</i>`;

      const sendRes = await callTelegramApi(settings.telegramBotToken, 'sendMessage', {
        chat_id: record.telegramChatId,
        text: msgText,
        parse_mode: 'HTML'
      });

      if (sendRes.ok) {
        inviteDeliveryStatus = 'Delivered';
        sentAt = new Date().toISOString();
        deliveryMessage = `Delivered privately to Telegram Chat ID ${record.telegramChatId}`;
      } else {
        inviteDeliveryStatus = 'Failed';
        deliveryError = sanitizeStr(sendRes.description || 'Failed to deliver message', 200);
        deliveryMessage = `Invitation link created, but message delivery failed: ${deliveryError}`;
      }
    }

    await db.saveInvitation({ registrationId: record.internalId, targetGroupIdentifier: targetChatId, inviteLink, expiryTimestamp: expireTimestamp, status: inviteDeliveryStatus, sentAt, lastError: deliveryError });
    const updatedRecord = await db.updateRegistrationStatus(record.internalId, { status: 'Confirmed', confirmedBy: auth.session.adminId, telegramInviteStatus: inviteDeliveryStatus });
    await db.createAuditLog({ actorId: auth.session.adminId, actorUsername: auth.session.username, action: 'REGISTRATION_CONFIRMED', affectedRegistrationId: record.registrationNumber, outcome: 'SUCCESS', details: payload.note ? `Confirmed: ${sanitizeStr(payload.note)} (${deliveryMessage})` : `Confirmed. ${deliveryMessage}` });

    return jsonResponse(res, 200, { success: true, message: `Registration ${record.registrationNumber} confirmed. ${deliveryMessage}`, registration: updatedRecord, deliveryStatus: inviteDeliveryStatus });
  }

  // POST /api/admin/registrations/[id]/reject
  if (action === 'reject' && req.method === 'POST') {
    const payload = (await parseBody(req)) || {};
    const record = await db.getRegistrationByIdOrNumber(regId);
    if (!record) return jsonResponse(res, 404, { success: false, error: 'Registration record not found.' });

    const reason = sanitizeStr(payload.reason || 'Does not fulfill membership criteria', 255);
    const updated = await db.updateRegistrationStatus(record.internalId, { status: 'Rejected', rejectionReason: reason });
    await db.createAuditLog({ actorId: auth.session.adminId, actorUsername: auth.session.username, action: 'REGISTRATION_REJECTED', affectedRegistrationId: record.registrationNumber, outcome: 'SUCCESS', details: `Rejected: ${reason}` });

    return jsonResponse(res, 200, { success: true, message: `Registration ${record.registrationNumber} marked as Rejected.`, registration: updated });
  }

  // POST /api/admin/registrations/[id]/retry-invite
  if (action === 'retry-invite' && req.method === 'POST') {
    const record = await db.getRegistrationByIdOrNumber(regId);
    if (!record) return jsonResponse(res, 404, { success: false, error: 'Registration record not found.' });

    let inviteLink = (record.invitation && record.invitation.inviteLink) ? record.invitation.inviteLink : null;
    if (!inviteLink) {
      const settings = await db.getAllSettings();
      const target = (record.invitation && record.invitation.targetChatId) || settings.defaultTargetChatId;
      if (target && (target.startsWith('http://') || target.startsWith('https://'))) inviteLink = target;
    }

    if (!inviteLink) return jsonResponse(res, 400, { success: false, error: 'No invitation link exists. Please re-confirm the registration.' });
    if (!record.telegramChatId) return jsonResponse(res, 400, { success: false, error: 'Participant has not linked their Telegram account yet.' });

    const settings = await db.getAllSettings();
    const msgText = `🎉 <b>Welcome to EPIC CLUB, ${record.firstName}!</b>\n\nYour application (ID: <code>${record.registrationNumber}</code>) is approved.\n\nHere is your unique, single-use invitation link:\n👉 <b>${inviteLink}</b>\n\n<i>Note: This invitation is strictly personal (member limit: 1).</i>`;
    const sendRes = await callTelegramApi(settings.telegramBotToken, 'sendMessage', { chat_id: record.telegramChatId, text: msgText, parse_mode: 'HTML' });

    if (sendRes.ok) {
      await db.updateTelegramInviteStatus(record.internalId, 'Delivered');
      await db.saveInvitation({ registrationId: record.internalId, targetGroupIdentifier: record.invitation?.targetChatId || '', inviteLink, status: 'Delivered', sentAt: new Date().toISOString(), lastError: null });
      await db.createAuditLog({ actorId: auth.session.adminId, actorUsername: auth.session.username, action: 'INVITE_DELIVERY_RETRY', affectedRegistrationId: record.registrationNumber, outcome: 'SUCCESS', details: `Delivered to Telegram Chat ID ${record.telegramChatId}` });
      return jsonResponse(res, 200, { success: true, message: 'Invitation successfully delivered to Telegram chat!', registration: await db.getRegistrationByIdOrNumber(record.id) });
    } else {
      const safeErr = sanitizeStr(sendRes.description || 'Delivery attempt failed', 200);
      await db.updateTelegramInviteStatus(record.internalId, 'Failed');
      await db.saveInvitation({ registrationId: record.internalId, targetGroupIdentifier: record.invitation?.targetChatId || '', inviteLink, status: 'Failed', lastError: safeErr });
      await db.createAuditLog({ actorId: auth.session.adminId, actorUsername: auth.session.username, action: 'INVITE_DELIVERY_RETRY_FAILED', affectedRegistrationId: record.registrationNumber, outcome: 'FAILURE', details: `Delivery retry failed: ${safeErr}` });
      return jsonResponse(res, 400, { success: false, error: `Telegram delivery failed: ${safeErr}`, registration: await db.getRegistrationByIdOrNumber(record.id) });
    }
  }

  // POST /api/admin/registrations/[id]/revoke-invite
  if (action === 'revoke-invite' && req.method === 'POST') {
    const record = await db.getRegistrationByIdOrNumber(regId);
    if (!record || !record.invitation || !record.invitation.inviteLink) {
      return jsonResponse(res, 400, { success: false, error: 'No active invitation to revoke.' });
    }

    const settings = await db.getAllSettings();
    await callTelegramApi(settings.telegramBotToken, 'revokeChatInviteLink', { chat_id: record.invitation.targetChatId, invite_link: record.invitation.inviteLink });
    await db.revokeInvitation(record.internalId);
    await db.updateTelegramInviteStatus(record.internalId, 'Revoked');
    await db.createAuditLog({ actorId: auth.session.adminId, actorUsername: auth.session.username, action: 'INVITE_REVOKED', affectedRegistrationId: record.registrationNumber, outcome: 'SUCCESS', details: `Revoked link: ${record.invitation.inviteLink}` });

    return jsonResponse(res, 200, { success: true, message: 'Invitation link revoked.', registration: await db.getRegistrationByIdOrNumber(record.id) });
  }

  // POST /api/admin/registrations/[id]/telegram-status
  if (action === 'telegram-status' && req.method === 'POST') {
    const payload = req.body || {};
    const record = await db.getRegistrationByIdOrNumber(regId);
    if (!record) return jsonResponse(res, 404, { success: false, error: 'Registration record not found.' });

    const allowedStatuses = ['Not Sent', 'Pending Linking', 'Sent', 'Delivered', 'Failed', 'Joined', 'Revoked'];
    const newStatus = payload.telegramInviteStatus;
    if (!allowedStatuses.includes(newStatus)) {
      return jsonResponse(res, 400, { success: false, error: `Invalid status. Must be one of: ${allowedStatuses.join(', ')}` });
    }

    const previousStatus = record.telegramInviteStatus || 'Not Sent';
    const updated = await db.updateTelegramInviteStatus(record.internalId, newStatus);
    await db.createAuditLog({ actorId: auth.session.adminId, actorUsername: auth.session.username, action: 'TELEGRAM_STATUS_OVERRIDE', affectedRegistrationId: record.registrationNumber, outcome: 'SUCCESS', details: `Updated from "${previousStatus}" to "${newStatus}"` });

    return jsonResponse(res, 200, { success: true, message: 'Telegram invite status updated.', registration: updated });
  }

  return jsonResponse(res, 404, { success: false, error: 'Route not found.' });
};
