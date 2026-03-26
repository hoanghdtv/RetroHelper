// Merge all *-games.csv files into:
//   output/games.csv           (merged CSV)
//   output/sqlite/games.db     (SQLite database)
//
// Usage: npx ts-node src/retro-achievement/merge-games.ts

import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import Database from 'better-sqlite3';

const OUTPUT_DIR = path.resolve(__dirname, '../../output');
const SQLITE_DIR = path.join(OUTPUT_DIR, 'sqlite');

const COLUMNS = [
  'rank', 'id', 'title', 'consoleName', 'consoleId',
  'totalPlayers', 'casualPlayers', 'hardcorePlayers',
  'numAchievements', 'points', 'genre', 'developer', 'publisher',
  'released', 'description', 'icon', 'boxArt', 'titleScreen', 'screenshot', 'rating',
];

// ── 1. Read & merge all *-games.csv ──────────────────────────────────────────

const gamesFiles = fs.readdirSync(OUTPUT_DIR)
  .filter(f => f.match(/^[a-z0-9]+-games\.csv$/) && f !== 'games.csv')
  .sort();

console.log(`Found ${gamesFiles.length} games CSV files:\n  ${gamesFiles.join('\n  ')}\n`);

const allRows: any[] = [];

for (const file of gamesFiles) {
  const filePath = path.join(OUTPUT_DIR, file);
  const content = fs.readFileSync(filePath, 'utf-8');
  const records: any[] = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_quotes: true,
  });

  for (const r of records) {
    const row: any = {};
    for (const col of COLUMNS) row[col] = r[col] ?? '';
    allRows.push(row);
  }

  console.log(`  ✅ ${file}: ${records.length} rows`);
}

console.log(`\nTotal rows merged: ${allRows.length}`);

// ── 2. Write games.csv ────────────────────────────────────────────────────────

const csvOut = path.join(OUTPUT_DIR, 'games.csv');
const csvContent = stringify(allRows, { header: true, columns: COLUMNS });
fs.writeFileSync(csvOut, csvContent, 'utf-8');
console.log(`\n✓ Written: ${csvOut}`);

// ── 3. Write games.db (SQLite) ────────────────────────────────────────────────

const dbOut = path.join(SQLITE_DIR, 'games.db');
if (fs.existsSync(dbOut)) fs.unlinkSync(dbOut);

const db = new Database(dbOut);

db.exec(`
  CREATE TABLE games (
    rank             INTEGER,
    id               INTEGER PRIMARY KEY,
    title            TEXT,
    consoleName      TEXT,
    consoleId        INTEGER,
    totalPlayers     INTEGER,
    casualPlayers    INTEGER,
    hardcorePlayers  INTEGER,
    numAchievements  INTEGER,
    points           INTEGER,
    genre            TEXT,
    developer        TEXT,
    publisher        TEXT,
    released         TEXT,
    description      TEXT,
    icon             TEXT,
    boxArt           TEXT,
    titleScreen      TEXT,
    screenshot       TEXT,
    rating           REAL
  );
  CREATE INDEX idx_consoleName ON games(consoleName);
  CREATE INDEX idx_consoleId   ON games(consoleId);
  CREATE INDEX idx_title       ON games(title);
  CREATE INDEX idx_rank        ON games(rank);
`);

const insert = db.prepare(`
  INSERT OR REPLACE INTO games
    (rank, id, title, consoleName, consoleId, totalPlayers, casualPlayers, hardcorePlayers,
     numAchievements, points, genre, developer, publisher, released, description,
     icon, boxArt, titleScreen, screenshot, rating)
  VALUES
    (@rank, @id, @title, @consoleName, @consoleId, @totalPlayers, @casualPlayers, @hardcorePlayers,
     @numAchievements, @points, @genre, @developer, @publisher, @released, @description,
     @icon, @boxArt, @titleScreen, @screenshot, @rating)
`);

const insertMany = db.transaction((rows: any[]) => {
  for (const row of rows) insert.run(row);
});

insertMany(allRows);
db.close();

const dbSize = (fs.statSync(dbOut).size / 1024).toFixed(1);
console.log(`✓ Written: ${dbOut} (${dbSize} KB, ${allRows.length} rows)`);
console.log('\nDone.');
