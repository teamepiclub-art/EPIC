const fs = require('fs');
const path = require('path');
const sqlite = require('node:sqlite');

// Load .env manually if not using dotenv
function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx !== -1) {
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
}

loadEnv();

async function run() {
  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backupDir = path.join(__dirname, '..', 'backups', `backup_${timestamp}`);

  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  console.log(`=========================================`);
  console.log(`Starting Database Backup Process...`);
  console.log(`Target Directory: ${backupDir}`);
  console.log(`=========================================\n`);

  // 1. BACKUP LOCAL SQLITE DATABASE
  const sqliteDbPath = path.join(__dirname, '..', 'data', 'epic_club.db');
  if (fs.existsSync(sqliteDbPath)) {
    console.log(`[1/2] Backing up Local SQLite Database...`);
    try {
      const db = new sqlite.DatabaseSync(sqliteDbPath);
      
      // Checkpoint WAL
      try {
        db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
        console.log(`  - WAL checkpoint executed successfully.`);
      } catch (e) {
        console.warn(`  - WAL checkpoint warning: ${e.message}`);
      }

      // Safe VACUUM INTO backup
      const backupDbFile = path.join(backupDir, 'epic_club.db');
      // Normalize slashes for SQLite VACUUM statement
      const escapedBackupPath = backupDbFile.replace(/\\/g, '/');
      db.exec(`VACUUM INTO '${escapedBackupPath}';`);
      console.log(`  - SQLite binary backup created: epic_club.db (${fs.statSync(backupDbFile).size} bytes)`);

      // Also export all tables to JSON and SQL
      const tables = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
      const sqliteExport = {};
      let sqlDump = `-- SQLite Dump Created At ${now.toISOString()}\n\n`;

      for (const tbl of tables) {
        sqlDump += `${tbl.sql};\n`;
        const rows = db.prepare(`SELECT * FROM ${tbl.name}`).all();
        sqliteExport[tbl.name] = rows;
        console.log(`  - Table "${tbl.name}": ${rows.length} rows exported.`);

        for (const row of rows) {
          const cols = Object.keys(row);
          const vals = cols.map(c => {
            const v = row[c];
            if (v === null || v === undefined) return 'NULL';
            if (typeof v === 'number') return v;
            return `'${String(v).replace(/'/g, "''")}'`;
          });
          sqlDump += `INSERT INTO ${tbl.name} (${cols.join(', ')}) VALUES (${vals.join(', ')});\n`;
        }
        sqlDump += `\n`;
      }

      fs.writeFileSync(path.join(backupDir, 'sqlite_data.json'), JSON.stringify(sqliteExport, null, 2), 'utf8');
      fs.writeFileSync(path.join(backupDir, 'sqlite_dump.sql'), sqlDump, 'utf8');
      console.log(`  - SQLite JSON export: sqlite_data.json`);
      console.log(`  - SQLite SQL dump: sqlite_dump.sql`);

      // Close db connection if method exists
      try { db.close(); } catch (_) {}
    } catch (err) {
      console.error(`  [!] Error during SQLite backup:`, err);
    }

    // Also copy any json files in data/
    const dataDir = path.join(__dirname, '..', 'data');
    const jsonFiles = fs.readdirSync(dataDir).filter(f => f.endsWith('.json'));
    const dataJsonBackupDir = path.join(backupDir, 'data_json_files');
    fs.mkdirSync(dataJsonBackupDir, { recursive: true });
    for (const jf of jsonFiles) {
      fs.copyFileSync(path.join(dataDir, jf), path.join(dataJsonBackupDir, jf));
      console.log(`  - Copied data file: ${jf}`);
    }
  } else {
    console.log(`[1/2] Local SQLite Database not found at ${sqliteDbPath}. Skipping.`);
  }

  // 2. BACKUP POSTGRESQL (SUPABASE / NEON)
  console.log(`\n[2/2] Checking PostgreSQL (DATABASE_URL)...`);
  const connStr = process.env.DATABASE_URL;
  if (!connStr) {
    console.log(`  - No DATABASE_URL found in environment. Skipping PostgreSQL backup.`);
  } else {
    console.log(`  - Found DATABASE_URL: ${connStr.replace(/:[^:@]+@/, ':****@')}`);
    try {
      const postgres = require('postgres');
      const sql = postgres(connStr, {
        ssl: 'require',
        max: 1,
        connect_timeout: 10,
        idle_timeout: 10
      });

      console.log(`  - Connecting to PostgreSQL database...`);
      const tables = await sql`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      `;

      console.log(`  - Found ${tables.length} tables in PostgreSQL: ${tables.map(t => t.table_name).join(', ')}`);
      
      const pgExport = {};
      let pgSqlDump = `-- PostgreSQL Dump Created At ${now.toISOString()}\n\n`;

      for (const t of tables) {
        const tableName = t.table_name;
        // Fetch rows safely
        const rows = await sql`SELECT * FROM ${sql(tableName)}`;
        pgExport[tableName] = rows;
        console.log(`  - Table "${tableName}": ${rows.length} rows exported.`);

        for (const row of rows) {
          const cols = Object.keys(row);
          const vals = cols.map(c => {
            const v = row[c];
            if (v === null || v === undefined) return 'NULL';
            if (typeof v === 'number' || typeof v === 'boolean') return v;
            if (typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "''")}'`;
            return `'${String(v).replace(/'/g, "''")}'`;
          });
          pgSqlDump += `INSERT INTO "${tableName}" ("${cols.join('", "')}") VALUES (${vals.join(', ')});\n`;
        }
        pgSqlDump += `\n`;
      }

      fs.writeFileSync(path.join(backupDir, 'postgres_data.json'), JSON.stringify(pgExport, null, 2), 'utf8');
      fs.writeFileSync(path.join(backupDir, 'postgres_dump.sql'), pgSqlDump, 'utf8');
      console.log(`  - PostgreSQL JSON export: postgres_data.json`);
      console.log(`  - PostgreSQL SQL dump: postgres_dump.sql`);

      await sql.end({ timeout: 5 });
    } catch (pgErr) {
      console.error(`  [!] PostgreSQL backup attempt note/error:`, pgErr.message);
    }
  }

  // Write a metadata/summary file
  const meta = {
    backupDate: now.toISOString(),
    backupDir: backupDir,
    timestamp: timestamp,
    files: fs.readdirSync(backupDir)
  };
  fs.writeFileSync(path.join(backupDir, 'backup_info.json'), JSON.stringify(meta, null, 2), 'utf8');

  console.log(`\n=========================================`);
  console.log(`Backup completed successfully!`);
  console.log(`Saved in: ${backupDir}`);
  console.log(`=========================================`);
}

run().catch(err => {
  console.error('Fatal error during backup:', err);
  process.exit(1);
});

