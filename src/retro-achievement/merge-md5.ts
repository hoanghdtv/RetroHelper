// Merge all *-md5.csv files into:
//   output/games-md5.csv        (merged CSV with added "console" column)
//   output/sqlite/games-md5.db  (SQLite database)
//
// Usage: npx ts-node src/retro-achievement/merge-md5.ts

import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import Database from 'better-sqlite3';

const OUTPUT_DIR = path.resolve(__dirname, '../../output');
const SQLITE_DIR = path.join(OUTPUT_DIR, 'sqlite');

// Map filename prefix → console label
const CONSOLE_MAP: Record<string, string> = {
  gamecube : 'GameCube',
  gba      : 'Game Boy Advance',
  gbc      : 'Game Boy Color',
  mame     : 'MAME',
  n64      : 'Nintendo 64',
  nds      : 'Nintendo DS',
  nes      : 'NES/Famicom',
  psp      : 'PSP',
  psx      : 'PlayStation',
  sega     : 'Sega',
  snes     : 'SNES/Super Famicom',
};

// ── 1. Read & merge all *-md5.csv ────────────────────────────────────────────

const md5Files = fs.readdirSync(OUTPUT_DIR)
  .filter(f => f.match(/^[a-z0-9]+-md5\.csv$/) && f !== 'games-md5.csv')
  .sort();

console.log(`Found ${md5Files.length} md5 CSV files:\n  ${md5Files.join('\n  ')}\n`);

interface Row {
  console: string;
  gameId: string;
  gameTitle: string;
  md5: string;
  romName: string;
  labels: string;
  patchUrl: string;
  region: string;
  romFile: string;
  romSize: string;
}

const allRows: Row[] = [];

for (const file of md5Files) {
  const prefix = file.replace('-md5.csv', '');
  const consoleName = CONSOLE_MAP[prefix] ?? prefix;
  const filePath = path.join(OUTPUT_DIR, file);

  const content = fs.readFileSync(filePath, 'utf-8');
  const records: any[] = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_quotes: true,
  });

  for (const r of records) {
    allRows.push({
      console  : consoleName,
      gameId   : r.gameId   ?? '',
      gameTitle: r.gameTitle ?? '',
      md5      : r.md5       ?? '',
      romName  : r.romName   ?? '',
      labels   : r.labels    ?? '',
      patchUrl : r.patchUrl  ?? '',
      region   : r.region    ?? '',
      romFile  : r.romFile   ?? '',
      romSize  : r.romSize   ?? '',
    });
  }

  console.log(`  ✅ ${file}: ${records.length} rows (console="${consoleName}")`);
}

console.log(`\nTotal rows merged: ${allRows.length}`);

// ── 2. Write games-md5.csv ────────────────────────────────────────────────────

const csvOut = path.join(OUTPUT_DIR, 'games-md5.csv');
const csvContent = stringify(allRows, {
  header: true,
  columns: ['console','gameId','gameTitle','md5','romName','labels','patchUrl','region','romFile','romSize'],
});
fs.writeFileSync(csvOut, csvContent, 'utf-8');
console.log(`\n✓ Written: ${csvOut}`);

// ── 3. Write games-md5.db (SQLite) ───────────────────────────────────────────

const dbOut = path.join(SQLITE_DIR, 'games-md5.db');
if (fs.existsSync(dbOut)) fs.unlinkSync(dbOut);

const db = new Database(dbOut);

db.exec(`
  CREATE TABLE games_md5 (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    console   TEXT,
    gameId    INTEGER,
    gameTitle TEXT,
    md5       TEXT,
    romName   TEXT,
    labels    TEXT,
    patchUrl  TEXT,
    region    TEXT,
    romFile   TEXT,
    romSize   INTEGER
  );
  CREATE INDEX idx_md5       ON games_md5(md5);
  CREATE INDEX idx_gameId    ON games_md5(gameId);
  CREATE INDEX idx_console   ON games_md5(console);
  CREATE INDEX idx_romFile   ON games_md5(romFile);
`);

const insert = db.prepare(`
  INSERT INTO games_md5 (console, gameId, gameTitle, md5, romName, labels, patchUrl, region, romFile, romSize)
  VALUES (@console, @gameId, @gameTitle, @md5, @romName, @labels, @patchUrl, @region, @romFile, @romSize)
`);

const insertMany = db.transaction((rows: Row[]) => {
  for (const row of rows) insert.run(row);
});

insertMany(allRows);
db.close();

const dbSize = (fs.statSync(dbOut).size / 1024).toFixed(1);
console.log(`✓ Written: ${dbOut} (${dbSize} KB, ${allRows.length} rows)`);
console.log('\nDone.');
