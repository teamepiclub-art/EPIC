/**
 * Telegram Bot API client for Vercel Serverless Functions
 */

const https = require('https');
const crypto = require('crypto');

function callTelegramApi(token, method, payload) {
  return new Promise((resolve) => {
    if (token && token.trim() && !token.startsWith('sim_')) {
      const postData = JSON.stringify(payload || {});
      const req = https.request({
        hostname: 'api.telegram.org',
        port: 443,
        path: `/bot${token.trim()}/${method}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        },
        timeout: 15000
      }, res => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try { resolve(JSON.parse(body)); }
          catch (e) { resolve({ ok: false, error_code: 500, description: 'Invalid JSON from Telegram' }); }
        });
      });

      req.on('error', err => resolve({ ok: false, error_code: 503, description: `Network error: ${err.message}` }));
      req.on('timeout', () => { req.destroy(); resolve({ ok: false, error_code: 504, description: 'Timeout' }); });
      req.write(postData);
      req.end();
      return;
    }

    // Sandbox mode
    if (method === 'createChatInviteLink') {
      const rnd = crypto.randomBytes(4).toString('hex');
      resolve({ ok: true, result: { invite_link: `https://t.me/+EPIC_oneTime_${rnd}`, member_limit: 1, is_revoked: false } });
      return;
    }
    if (method === 'revokeChatInviteLink') {
      resolve({ ok: true, result: { invite_link: payload.invite_link, is_revoked: true } });
      return;
    }
    if (method === 'sendMessage') {
      if (!payload.chat_id) { resolve({ ok: false, error_code: 400, description: 'chat_id is empty' }); return; }
      resolve({ ok: true, result: { message_id: Math.floor(10000 + Math.random() * 90000), date: Math.floor(Date.now() / 1000), text: payload.text } });
      return;
    }
    if (method === 'getMe') {
      resolve({ ok: true, result: { id: 987654321, is_bot: true, first_name: 'EPIC CLUB Official Bot', username: 'epic_club_setif_bot' } });
      return;
    }
    if (method === 'getWebhookInfo') {
      resolve({ ok: true, result: { url: '' } });
      return;
    }
    resolve({ ok: false, error_code: 404, description: `Unsupported method in sandbox: ${method}` });
  });
}

module.exports = { callTelegramApi };
