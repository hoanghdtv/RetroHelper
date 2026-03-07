#!/usr/bin/env ts-node
/**
 * ra-csv-to-sql.ts
 *
 * Converts every CSV file in the output directory into SQL dump files,
 * one set for SQLite and one set for PostgreSQL.
 *
 * Output:
 *   output/sqlite/<table_name>.sql
 *   output/postgre/<table_name>.sql
 *
 * Usage:
 *   npx ts-node src/retro-achievement/ra-csv-to-sql.ts
 *   npx ts-node src/retro-achievement/ra-csv-to-sql.ts --dir output
 *   npx ts-node src/retro-achievement/ra-csv-to-sql.ts --file output/nes-games.csv
 *
 * Table name is derived from the CSV filename:
 *   nes-games.csv  → nes_games
 *   ra-consoles.csv → ra_consoles
 */

import * as fs   from 'fs';
import * as path from 'path';

// ─── CLI ──────────────────────────────────────────────────────────────────────

const args    = process.argv.slice(2);
const getArg  = (flag: string) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : undefined; };

// ─── CSV parser ───────────────────────────────────────────────────────────────

function parseCSVLine(line: string): string[] {
  const cols: string[] = [];
  let cur     = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuote = !inQuote;
    } else if (ch === ',' && !inQuote) {
      cols.push(cur); cur = '';
    } else {
      cur += ch;
    }
  }
  cols.push(cur);
  return cols;
}

function readCSV(filePath: string): { headers: string[]; rows: string[][] } {
  const lines = fs.readFileSync(filePath, 'utf-8')
    .split('\n').map(l => l.trimEnd()).filter(Boolean);
  if (lines.length < 1) return { headers: [], rows: [] };
  const headers = parseCSVLine(lines[0]).map(h => h.trim());
  const rows    = lines.slice(1).map(l => parseCSVLine(l));
  return { headers, rows };
}

// ─── Type inference ───────────────────────────────────────────────────────────

type ColType = 'INTEGER' | 'REAL' | 'BOOLEAN' | 'TEXT';

const RE_INT   = /^-?\d+$/;
const RE_FLOAT = /^-?\d+(\.\d+)?$/;
const RE_BOOL  = /^(true|false)$/i;

function inferColumnTypes(headers: string[], rows: string[][]): ColType[] {
  return headers.map((_, colIdx) => {
    const values = rows
      .map(r => r[colIdx] ?? '')
      .filter(v => v !== '');   // ignore empty (NULL)

    if (values.length === 0) return 'TEXT';

    if (values.every(v => RE_BOOL.test(v)))  return 'BOOLEAN';
    if (values.every(v => RE_INT.test(v)))   return 'INTEGER';
    if (values.every(v => RE_FLOAT.test(v))) return 'REAL';
    return 'TEXT';
  });
}

// ─── SQL escaping ─────────────────────────────────────────────────────────────

function sqlStr(v: string): string {
  return "'" + v.replace(/'/g, "''") + "'";
}

function sqliteLiteral(v: string, type: ColType): string {
  if (v === '') return 'NULL';
  if (type === 'INTEGER') return v;
  if (type === 'REAL')    return v;
  if (type === 'BOOLEAN') return v.toLowerCase() === 'true' ? '1' : '0';
  return sqlStr(v);
}

function pgLiteral(v: string, type: ColType): string {
  if (v === '') return 'NULL';
  if (type === 'INTEGER') return v;
  if (type === 'REAL')    return v;
  if (type === 'BOOLEAN') return v.toLowerCase() === 'true' ? 'TRUE' : 'FALSE';
  return sqlStr(v);
}

// ─── SQL generation ───────────────────────────────────────────────────────────

const BATCH = 500;  // INSERT rows per statement

function tableName(csvFile: string): string {
  return path.basename(csvFile, '.csv').replace(/-/g, '_');
}

function generateSQLite(table: string, headers: string[], types: ColType[], rows: string[][]): string {
  const sqliteType = (t: ColType) => t === 'BOOLEAN' ? 'INTEGER' : t;

  const colDefs = headers.map((h, i) => `  ${h} ${sqliteType(types[i])}`).join(',\n');

  const lines: string[] = [
    `-- SQLite dump: ${table}`,
    `-- Generated: ${new Date().toISOString()}`,
    '',
    `DROP TABLE IF EXISTS ${table};`,
    `CREATE TABLE IF NOT EXISTS ${table} (`,
    colDefs,
    ');',
    '',
  ];

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const values = batch.map(row => {
      const vals = headers.map((_, ci) => sqliteLiteral(row[ci] ?? '', types[ci]));
      return `  (${vals.join(', ')})`;
    });
    lines.push(`INSERT INTO ${table} (${headers.join(', ')}) VALUES`);
    lines.push(values.join(',\n') + ';');
    lines.push('');
  }

  return lines.join('\n');
}

function generatePostgre(table: string, headers: string[], types: ColType[], rows: string[][]): string {
  const pgType = (t: ColType): string => {
    if (t === 'INTEGER') return 'INTEGER';
    if (t === 'REAL')    return 'REAL';
    if (t === 'BOOLEAN') return 'BOOLEAN';
    return 'TEXT';
  };

  const colDefs = headers.map((h, i) => `  ${h} ${pgType(types[i])}`).join(',\n');

  const lines: string[] = [
    `-- PostgreSQL dump: ${table}`,
    `-- Generated: ${new Date().toISOString()}`,
    '',
    `DROP TABLE IF EXISTS ${table};`,
    `CREATE TABLE IF NOT EXISTS ${table} (`,
    colDefs,
    ');',
    '',
  ];

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const values = batch.map(row => {
      const vals = headers.map((_, ci) => pgLiteral(row[ci] ?? '', types[ci]));
      return `  (${vals.join(', ')})`;
    });
    lines.push(`INSERT INTO ${table} (${headers.join(', ')}) VALUES`);
    lines.push(values.join(',\n') + ';');
    lines.push('');
  }

  return lines.join('\n');
}

// ─── Process one CSV ──────────────────────────────────────────────────────────

function processCSV(csvPath: string, sqliteDir: string, postgreDir: string) {
  const { headers, rows } = readCSV(csvPath);
  if (headers.length === 0) {
    console.warn(`  ⚠ Empty or invalid: ${path.basename(csvPath)}`);
    return;
  }

  const table = tableName(csvPath);
  const types = inferColumnTypes(headers, rows);

  const sqliteSQL  = generateSQLite(table, headers, types, rows);
  const postgreSQL = generatePostgre(table, headers, types, rows);

  const sqliteOut  = path.join(sqliteDir,  `${table}.sql`);
  const postgreOut = path.join(postgreDir, `${table}.sql`);

  fs.writeFileSync(sqliteOut,  sqliteSQL,  'utf-8');
  fs.writeFileSync(postgreOut, postgreSQL, 'utf-8');

  const typeInfo = headers.map((h, i) => `${h}:${types[i]}`).join(' ');
  console.log(`  ✓ ${table.padEnd(32)} ${rows.length} rows | ${typeInfo}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const fileArg = getArg('--file');
  const dirArg  = getArg('--dir') ?? 'output';
  const dir     = path.resolve(dirArg);

  const sqliteDir  = path.join(dir, 'sqlite');
  const postgreDir = path.join(dir, 'postgre');
  fs.mkdirSync(sqliteDir,  { recursive: true });
  fs.mkdirSync(postgreDir, { recursive: true });

  if (fileArg) {
    const csvPath = path.resolve(fileArg);
    if (!fs.existsSync(csvPath)) {
      console.error(`File not found: ${csvPath}`);
      process.exit(1);
    }
    console.log(`Processing single file: ${path.basename(csvPath)}\n`);
    processCSV(csvPath, sqliteDir, postgreDir);
  } else {
    const csvFiles = fs.readdirSync(dir)
      .filter(f => f.endsWith('.csv'))
      .sort();

    if (csvFiles.length === 0) {
      console.error(`No CSV files found in ${dir}`);
      process.exit(1);
    }

    console.log(`Converting ${csvFiles.length} CSV file(s) in ${dir}`);
    console.log(`  SQLite  → ${sqliteDir}`);
    console.log(`  Postgre → ${postgreDir}\n`);

    for (const f of csvFiles) {
      processCSV(path.join(dir, f), sqliteDir, postgreDir);
    }
  }

  console.log('\nDone.');
}

main();
