const fs = require('fs');
const path = require('path');

function parseCsvLine(text) {
  const result = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (inQuotes && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === ',' && !inQuotes) {
      result.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  result.push(cur);
  return result;
}

function parseCsv(content) {
  if (content.charCodeAt(0) === 0xFEFF) {
    content = content.slice(1);
  }
  const lines = content.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]).map(h => h.trim().replace(/^"|"$/g, ''));
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = parseCsvLine(lines[i]).map(v => v.trim().replace(/^"|"$/g, ''));
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = vals[idx] !== undefined ? vals[idx] : '';
    });
    rows.push(obj);
  }
  return rows;
}

async function run() {
  const backupFolder = path.join(__dirname, '..', 'backups', 'backup_2026-10-30T09-12-38');
  const csvFile = path.join(backupFolder, 'registrations.csv');
  const jsonFile = path.join(backupFolder, 'postgres_data.json');

  let data = null;
  if (fs.existsSync(csvFile)) {
    console.log(`Loading backup from CSV: ${csvFile}`);
    const csvRaw = fs.readFileSync(csvFile, 'utf8');
    const rows = parseCsv(csvRaw);
    data = { registrations: rows };
    console.log(`Loaded ${rows.length} registration records.`);
  } else if (fs.existsSync(jsonFile)) {
    console.log(`Loading backup from JSON: ${jsonFile}`);
    data = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
  } else {
    console.error('No backup file found in', backupFolder);
    process.exit(1);
  }

  // Restore to local SQLite
  const dbLocal = require('../db');
  console.log('Restoring to Local SQLite database...');
  const statsLocal = dbLocal.restoreBackup(data, 'merge');
  console.log(`Local SQLite Restore Complete:`, statsLocal);

  console.log('\n=========================================');
  console.log('Database restore completed successfully!');
  console.log('=========================================');
}

run().catch(err => {
  console.error('Restore failed:', err);
  process.exit(1);
});

