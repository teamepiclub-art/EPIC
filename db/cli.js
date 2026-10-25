/**
 * Standalone CLI for Database Migrations & Status
 * Usage: node db/cli.js
 */

const { DatabaseSync } = require('node:sqlite');
const config = require('../utils/env');
const logger = require('../utils/logger');
const { runMigrations } = require('./migrations');

console.log('='.repeat(70));
console.log('EPIC CLUB — DATABASE MIGRATION CLI');
console.log('Database Path:', config.DATABASE_PATH);
console.log('='.repeat(70));

const db = new DatabaseSync(config.DATABASE_PATH);
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA journal_mode = WAL;');

runMigrations(db);

const migrations = db.prepare('SELECT name, applied_at FROM schema_migrations ORDER BY applied_at ASC').all();
console.log('\nApplied Migrations:');
console.table(migrations);

const summary = db.prepare(`
  SELECT 
    (SELECT COUNT(*) FROM admins) AS admin_count,
    (SELECT COUNT(*) FROM registrations) AS registration_count,
    (SELECT COUNT(*) FROM invitations) AS invitation_count,
    (SELECT COUNT(*) FROM audit_logs) AS audit_log_count
`).get();

console.log('\nDatabase Statistics:');
console.table([summary]);
console.log('Database verification completed successfully.\n');
