/**
 * Authentication helpers for Vercel Serverless Functions
 */
const db = require('./db');
const crypto = require('crypto');

function parseCookies(req) {
  const list = {};
  const rc = req.headers.cookie;
  if (rc) {
    rc.split(';').forEach(cookie => {
      const parts = cookie.split('=');
      list[parts.shift().trim()] = decodeURI(parts.join('='));
    });
  }
  return list;
}

async function authenticateAdmin(req) {
  let token = null;

  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7).trim();
  }

  if (!token) {
    const cookies = parseCookies(req);
    token = cookies['epic_admin_session'];
  }

  if (!token) return { authenticated: false };

  const session = await db.getAdminSession(token);
  if (!session) return { authenticated: false };

  return {
    authenticated: true,
    token,
    session: {
      adminId: session.admin_id,
      username: session.username,
      fullName: session.full_name,
      role: session.role
    }
  };
}

function getClientIp(req) {
  return req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '127.0.0.1';
}

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
}

function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
}

function jsonResponse(res, statusCode, data) {
  res.setHeader('Content-Type', 'application/json');
  res.status(statusCode).json(data);
}

async function parseBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body !== undefined) return resolve(req.body);
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
      if (body.length > 102400) {
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(new Error('Invalid JSON'));
      }
    });
  });
}

function createSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

const SESSION_MAX_AGE_HOURS = parseInt(process.env.SESSION_MAX_AGE_HOURS, 10) || 8;

module.exports = {
  parseCookies,
  authenticateAdmin,
  getClientIp,
  setCorsHeaders,
  setSecurityHeaders,
  jsonResponse,
  parseBody,
  createSessionToken,
  SESSION_MAX_AGE_HOURS
};
