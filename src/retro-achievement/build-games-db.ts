// Build games-md5 SQL + SQLite DB from all *-md5.csv files
// Usage:
//   npx ts-node src/retro-achievement/build-games-db.ts [options]
//   npx ts-node src/retro-achievement/build-games-db.ts --input output --out output/games-md5
//
// Options:
//   --input <dir>    Directory containing *-md5.csv files  (default: output)
//   --out <path>     Output base path without extension     (default: output/games-md5)
//                    → produces <path>.sql and <path>.db
//
// Output:
//   games-md5.sql   — SQL dump compatible with both SQLite3 and PostgreSQL
//   games-md5.db    — SQLite3 binary database
//
// Table schema:
//   CREATE TABLE ra_games (
//     id        INTEGER PRIMARY KEY,   -- RA gameId
//     console   TEXT    NOT NULL,      -- derived from filename, e.g. "nes", "snes"
//     title     TEXT    NOT NULL,
//     md5       TEXT    NOT NULL,
//     rom_name  TEXT,
//     labels    TEXT,
//     patch_url TEXT,
//     region    TEXT,
//     rom_file  TEXT,                  -- matched zip filename (may be empty)
//     rom_size  INTEGER                -- zip file size in bytes (may be null)
//   )

import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';
import sqlite3 from 'sqlite3';

// ─── Types ────────────────────────────────────────────────────────────────────

interface GameRow {
  id: number;
  console: string;
  title: string;
  md5: string;
  romName: string;
  labels: string;
  patchUrl: string;
  region: string;
  romFile: string;
  romSize: number | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Derive console slug from CSV filename, e.g. "nes-md5.csv" → "nes" */
function consoleFromFilename(filename: string): string {
  return path.basename(filename).replace(/-md5\.csv$/i, '').toLowerCase();
}

/** Escape a string value for SQL (single-quote escaping) */
function sqlStr(v: string | null | undefined): string {
  if (v === null || v === undefined || v === '') return 'NULL';
  return `'${String(v).replace(/'/g, "''")}'`;
}

/** Wrap run/all/get into promises for sqlite3 */
function dbRun(db: sqlite3.Database, sql: string, params: any[] = []): Promise<void> {
  return new Promise((resolve, reject) =>
    db.run(sql, params, err => (err ? reject(err) : resolve()))
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  let inputDir = 'output';
  let outBase = 'output/games-md5';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--input' && args[i + 1]) inputDir = args[++i];
    else if (args[i] === '--out' && args[i + 1]) outBase = args[++i];
  }

  const sqlPath = `${outBase}.sql`;
  const dbPath  = `${outBase}.db`;

  console.log(`\n=== Build Games MD5 DB ===`);
  console.log(`Input dir : ${inputDir}`);
  console.log(`SQL output: ${sqlPath}`);
  console.log(`DB output : ${dbPath}\n`);

  // ── 1. Discover CSV files ──────────────────────────────────────────────────
  if (!fs.existsSync(inputDir)) {
    console.error(`❌ Input directory not found: ${inputDir}`);
    process.exit(1);
  }

  const csvFiles = fs
    .readdirSync(inputDir)
    .filter(f => /^.+-md5\.csv$/i.test(f))
    .sort()
    .map(f => path.join(inputDir, f));

  if (csvFiles.length === 0) {
    console.error(`❌ No *-md5.csv files found in ${inputDir}`);
    process.exit(1);
  }

  console.log(`Found ${csvFiles.length} CSV files:`);
  csvFiles.forEach(f => console.log(`  - ${path.basename(f)}`));
  console.log();

  // ── 2. Parse all CSV files into GameRow[] ─────────────────────────────────
  const allRows: GameRow[] = [];
  const seenKeys = new Set<string>(); // dedup by "console:md5"

  for (const csvFile of csvFiles) {
    const consoleName = consoleFromFilename(csvFile);
    const content = fs.readFileSync(csvFile, 'utf-8');
    const records: any[] = parse(content, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    let added = 0;
    let dupes = 0;
    for (const r of records) {
      const md5 = (r.md5 || '').trim().toLowerCase();
      if (!md5 || !r.gameId) continue;

      const key = `${consoleName}:${md5}`;
      if (seenKeys.has(key)) { dupes++; continue; }
      seenKeys.add(key);

      allRows.push({
        id:       parseInt(r.gameId, 10),
        console:  consoleName,
        title:    (r.gameTitle || '').trim(),
        md5,
        romName:  (r.romName  || '').trim(),
        labels:   (r.labels   || '').trim(),
        patchUrl: (r.patchUrl || '').trim(),
        region:   (r.region   || '').trim(),
        romFile:  (r.romFile  || '').trim(),
        romSize:  r.romSize ? parseInt(r.romSize, 10) : null,
      });
      added++;
    }

    console.log(`  ✓ ${path.basename(csvFile)}: ${added} rows loaded${dupes ? ` (${dupes} dupes skipped)` : ''}`);
  }

  console.log(`\nTotal rows: ${allRows.length}\n`);

  // Ensure output directory exists
  const outDir = path.dirname(outBase);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  // ── 3. Generate SQL file ───────────────────────────────────────────────────
  console.log(`Writing ${sqlPath}...`);

  const sqlLines: string[] = [];

  // Header comment
  sqlLines.push(`-- games-md5.sql`);
  sqlLines.push(`-- Generated: ${new Date().toISOString()}`);
  sqlLines.push(`-- Total rows: ${allRows.length}`);
  sqlLines.push(`-- Compatible with SQLite3 and PostgreSQL`);
  sqlLines.push(``);

  // Drop + create
  sqlLines.push(`DROP TABLE IF EXISTS ra_games;`);
  sqlLines.push(``);
  sqlLines.push(`CREATE TABLE ra_games (`);
  sqlLines.push(`  id        INTEGER NOT NULL,`);
  sqlLines.push(`  console   TEXT    NOT NULL,`);
  sqlLines.push(`  title     TEXT    NOT NULL,`);
  sqlLines.push(`  md5       TEXT    NOT NULL,`);
  sqlLines.push(`  rom_name  TEXT,`);
  sqlLines.push(`  labels    TEXT,`);
  sqlLines.push(`  patch_url TEXT,`);
  sqlLines.push(`  region    TEXT,`);
  sqlLines.push(`  rom_file  TEXT,`);
  sqlLines.push(`  rom_size  INTEGER,`);
  sqlLines.push(`  PRIMARY KEY (id, console)`);
  sqlLines.push(`);`);
  sqlLines.push(``);
  sqlLines.push(`CREATE INDEX IF NOT EXISTS idx_ra_games_md5     ON ra_games (md5);`);
  sqlLines.push(`CREATE INDEX IF NOT EXISTS idx_ra_games_console ON ra_games (console);`);
  sqlLines.push(``);

  // INSERT rows in batches of 500
  const BATCH = 500;
  for (let i = 0; i < allRows.length; i += BATCH) {
    const batch = allRows.slice(i, i + BATCH);
    const values = batch.map(r =>
      `(${r.id}, ${sqlStr(r.console)}, ${sqlStr(r.title)}, ${sqlStr(r.md5)}, ` +
      `${sqlStr(r.romName)}, ${sqlStr(r.labels)}, ${sqlStr(r.patchUrl)}, ` +
      `${sqlStr(r.region)}, ${sqlStr(r.romFile)}, ` +
      `${r.romSize !== null ? r.romSize : 'NULL'})`
    );
    sqlLines.push(
      `INSERT INTO ra_games (id, console, title, md5, rom_name, labels, patch_url, region, rom_file, rom_size) VALUES`
    );
    sqlLines.push(values.join(',\n') + ';');
    sqlLines.push(``);
  }

  fs.writeFileSync(sqlPath, sqlLines.join('\n'), 'utf-8');
  const sqlSize = (fs.statSync(sqlPath).size / 1024).toFixed(1);
  console.log(`✓ SQL written: ${sqlPath} (${sqlSize} KB)\n`);

  // ── 4. Build SQLite3 DB ────────────────────────────────────────────────────
  console.log(`Building ${dbPath}...`);

  // Remove old DB if exists
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

  const db = new sqlite3.Database(dbPath);

  // Wrap everything in a helper
  const run = (sql: string, params: any[] = []) => dbRun(db, sql, params);

  await run('PRAGMA journal_mode = OFF');
  await run('PRAGMA synchronous  = OFF');

  await run(`
    CREATE TABLE ra_games (
      id        INTEGER NOT NULL,
      console   TEXT    NOT NULL,
      title     TEXT    NOT NULL,
      md5       TEXT    NOT NULL,
      rom_name  TEXT,
      labels    TEXT,
      patch_url TEXT,
      region    TEXT,
      rom_file  TEXT,
      rom_size  INTEGER,
      PRIMARY KEY (id, console)
    )
  `);

  await run(`CREATE INDEX idx_ra_games_md5     ON ra_games (md5)`);
  await run(`CREATE INDEX idx_ra_games_console ON ra_games (console)`);

  // Insert all rows inside a single transaction for speed
  await run('BEGIN');
  const stmt = db.prepare(
    `INSERT OR REPLACE INTO ra_games
       (id, console, title, md5, rom_name, labels, patch_url, region, rom_file, rom_size)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  let insertCount = 0;
  for (const r of allRows) {
    await new Promise<void>((resolve, reject) =>
      stmt.run(
        [r.id, r.console, r.title, r.md5,
         r.romName || null, r.labels || null,
         r.patchUrl || null, r.region || null,
         r.romFile || null, r.romSize ?? null],
        err => (err ? reject(err) : resolve())
      )
    );
    insertCount++;
    if (insertCount % 500 === 0) {
      process.stdout.write(`  … inserted ${insertCount}/${allRows.length}\r`);
    }
  }

  await new Promise<void>((resolve, reject) => stmt.finalize(err => err ? reject(err) : resolve()));
  await run('COMMIT');
  await run('PRAGMA optimize');

  await new Promise<void>((resolve, reject) =>
    db.close(err => (err ? reject(err) : resolve()))
  );

  const dbSize = (fs.statSync(dbPath).size / 1024).toFixed(1);
  console.log(`✓ SQLite DB written: ${dbPath} (${dbSize} KB)\n`);

  // ── 5. Summary ─────────────────────────────────────────────────────────────
  console.log(`=== Summary ===`);
  const byCons = allRows.reduce((acc, r) => {
    acc[r.console] = (acc[r.console] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const withRomFile = allRows.filter(r => r.romFile).length;

  for (const [c, n] of Object.entries(byCons).sort()) {
    const matched = allRows.filter(r => r.console === c && r.romFile).length;
    const pct = ((matched / n) * 100).toFixed(0);
    console.log(`  ${c.padEnd(12)} ${String(n).padStart(4)} rows   ${String(matched).padStart(4)} with romFile (${pct}%)`);
  }
  console.log(`  ${'TOTAL'.padEnd(12)} ${String(allRows.length).padStart(4)} rows   ${String(withRomFile).padStart(4)} with romFile`);
  console.log();
  console.log(`  Output files:`);
  console.log(`    ${sqlPath}`);
  console.log(`    ${dbPath}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
