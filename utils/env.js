/**
 * Environment Variables Loader & Config Manager
 * Lightweight, zero-dependency .env parser and validator for EPIC CLUB
 */

const fs = require('fs');
const path = require('path');

function loadEnvFile(envFilePath) {
  if (!fs.existsSync(envFilePath)) {
    return;
  }

  try {
    const content = fs.readFileSync(envFilePath, 'utf8');
    const lines = content.split('\n');

    for (const rawLine of lines) {
      const line = rawLine.trim();
      // Skip empty lines or comments
      if (!line || line.startsWith('#')) continue;

      const equalIndex = line.indexOf('=');
      if (equalIndex === -1) continue;

      const key = line.slice(0, equalIndex).trim();
      let value = line.slice(equalIndex + 1).trim();

      // Remove surrounding quotes if present
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      // Do not overwrite existing process.env values passed via system/CLI
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  } catch (err) {
    console.error('Warning: Failed to parse .env file:', err.message);
  }
}

// Load default .env in root directory if present
const rootDir = path.resolve(__dirname, '..');
loadEnvFile(path.join(rootDir, '.env'));

const config = {
  PORT: parseInt(process.env.PORT, 10) || 3000,
  NODE_ENV: process.env.NODE_ENV || 'development',
  DATABASE_PATH: process.env.DATABASE_PATH || path.join(rootDir, 'data', 'epic_club.db'),
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
  TELEGRAM_BOT_USERNAME: process.env.TELEGRAM_BOT_USERNAME || 'epic_club_setif_bot',
  TELEGRAM_TARGET_CHAT_ID: process.env.TELEGRAM_TARGET_CHAT_ID || '-1002345678901',
  TELEGRAM_WEBHOOK_SECRET: process.env.TELEGRAM_WEBHOOK_SECRET || '',
  DEFAULT_EXPIRY_HOURS: parseInt(process.env.DEFAULT_EXPIRY_HOURS, 10) || 48,
  LINKING_TOKEN_EXPIRY_HOURS: parseInt(process.env.LINKING_TOKEN_EXPIRY_HOURS, 10) || 48,
  ADMIN_DEFAULT_USERNAME: process.env.ADMIN_DEFAULT_USERNAME || 'admin',
  ADMIN_DEFAULT_PASSWORD: process.env.ADMIN_DEFAULT_PASSWORD || 'EpicAdmin2026!',
  SESSION_SECRET: process.env.SESSION_SECRET || 'epic_super_secure_session_secret_2026',
  SESSION_MAX_AGE_HOURS: parseInt(process.env.SESSION_MAX_AGE_HOURS, 10) || 8
};

module.exports = config;
