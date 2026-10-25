/**
 * Database Migration Runner for EPIC CLUB System
 * Applies versioned SQL files incrementally and records execution in schema_migrations
 */

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

function runMigrations(db) {
  logger.info('DATABASE_MIGRATION', { message: 'Checking schema migrations...' });

  // 1. Create migrations tracking table
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const migrationsDir = path.resolve(__dirname, '..', 'migrations');
  if (!fs.existsSync(migrationsDir)) {
    logger.warn('DATABASE_MIGRATION', { message: 'Migrations directory not found, skipping' });
    return;
  }

  const files = fs.readdirSync(migrationsDir)
    .filter(file => file.endsWith('.sql'))
    .sort();

  const getMigrationStmt = db.prepare('SELECT name FROM schema_migrations WHERE name = ?');
  const recordMigrationStmt = db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)');

  for (const file of files) {
    const existing = getMigrationStmt.get(file);
    if (existing) {
      continue; // already applied
    }

    logger.info('DATABASE_MIGRATION_APPLYING', { file });
    const filePath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(filePath, 'utf8');

    // Execute migration in transaction
    db.exec('BEGIN TRANSACTION;');
    try {
      db.exec(sql);
      recordMigrationStmt.run(file, new Date().toISOString());
      db.exec('COMMIT;');
      logger.info('DATABASE_MIGRATION_SUCCESS', { file });
    } catch (err) {
      db.exec('ROLLBACK;');
      logger.error('DATABASE_MIGRATION_FAILED', err, { file });
      throw err;
    }
  }

  logger.info('DATABASE_MIGRATION', { message: 'All database migrations are up to date' });
}

module.exports = { runMigrations };
