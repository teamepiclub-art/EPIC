const fs = require('fs');
const path = require('path');

const backupFolder = path.join(__dirname, '..', 'backups', 'backup_2026-10-30T09-12-38');
const dataFile = path.join(backupFolder, 'postgres_data.json');

if (!fs.existsSync(dataFile)) {
  console.error('File not found:', dataFile);
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));

if (data.registrations && data.registrations.length > 0) {
  const headers = Object.keys(data.registrations[0]);
  const csvRows = [];
  csvRows.push(headers.map(h => `"${h.replace(/"/g, '""')}"`).join(','));

  for (const row of data.registrations) {
    const vals = headers.map(h => {
      let val = row[h];
      if (val === null || val === undefined) return '""';
      val = String(val).replace(/"/g, '""').replace(/\r?\n/g, ' ');
      return `"${val}"`;
    });
    csvRows.push(vals.join(','));
  }

  // UTF-8 BOM so Excel displays Arabic and French correctly
  const csvContent = '\uFEFF' + csvRows.join('\r\n');
  const targetCsv = path.join(backupFolder, 'registrations.csv');
  fs.writeFileSync(targetCsv, csvContent, 'utf8');
  console.log(`Successfully generated registrations.csv (${data.registrations.length} rows)`);
} else {
  console.log('No registrations found to export.');
}

