#!/usr/bin/env ts-node
/**
 * ra-merge-descriptions.ts
 *
 * Merges a *-descriptions.csv into the matching *-games.csv (joined on `id`),
 * adding columns: description, icon, boxArt, titleScreen, screenshot, rating
 *
 * Usage:
 *   # Single pair — explicit files:
 *   npx ts-node src/retro-achievement/ra-merge-descriptions.ts \
 *     --games output/nes-games.csv \
 *     --descriptions output/nes-descriptions.csv \
 *     --output output/nes-games.csv
 *
 *   # Single pair — auto-resolve descriptions + output from games path:
 *   npx ts-node src/retro-achievement/ra-merge-descriptions.ts \
 *     --games output/nes-games.csv
 *
 *   # All pairs in the output directory:
 *   npx ts-node src/retro-achievement/ra-merge-descriptions.ts --all
 *   npx ts-node src/retro-achievement/ra-merge-descriptions.ts --all --dir output
 *
 * The merged file keeps all columns from *-games.csv and appends:
 *   description, icon, boxArt, titleScreen, screenshot, rating
 *
 * Rows in games that have no matching description row get empty values.
 * The output overwrites the games file by default (or --output to redirect).
 */

import * as fs   from 'fs';
import * as path from 'path';

// ─── CLI ──────────────────────────────────────────────────────────────────────

const args    = process.argv.slice(2);
const getArg  = (flag: string) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : undefined; };
const hasFlag = (flag: string) => args.includes(flag);

// ─── CSV helpers ──────────────────────────────────────────────────────────────

function esc(s: string): string {
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/** Parse a single CSV line respecting quoted fields. */
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

/** Parse a CSV file into an array of header→value maps. */
function readCSV(filePath: string): Array<Record<string, string>> {
  const lines = fs.readFileSync(filePath, 'utf-8')
    .split('\n').map(l => l.trimEnd()).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = parseCSVLine(lines[0]).map(h => h.trim());
  return lines.slice(1).map(line => {
    const cols = parseCSVLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = cols[i] ?? ''; });
    return row;
  });
}

// ─── Merge logic ─────────────────────────────────────────────────────────────

const EXTRA_COLS = ['description', 'icon', 'boxArt', 'titleScreen', 'screenshot', 'rating'] as const;

function mergeFiles(gamesPath: string, descriptionsPath: string, outputPath: string) {
  if (!fs.existsSync(gamesPath)) {
    console.error(`  ✗ Games file not found: ${gamesPath}`);
    return false;
  }
  if (!fs.existsSync(descriptionsPath)) {
    console.error(`  ✗ Descriptions file not found: ${descriptionsPath}`);
    return false;
  }

  const games        = readCSV(gamesPath);
  const descriptions = readCSV(descriptionsPath);

  if (games.length === 0) {
    console.warn(`  ⚠ No rows in ${gamesPath}`);
    return false;
  }

  // Build lookup: id → description row
  const descMap = new Map<string, Record<string, string>>();
  for (const d of descriptions) {
    if (d.id) descMap.set(d.id.trim(), d);
  }

  // Determine output headers = all game columns + extra columns
  const gameHeaders = Object.keys(games[0]);
  // Remove any extra cols that might already exist in games (idempotent)
  const baseHeaders = gameHeaders.filter(h => !(EXTRA_COLS as readonly string[]).includes(h));
  const outHeaders  = [...baseHeaders, ...EXTRA_COLS];

  // Build merged rows
  let matched = 0;
  const csvLines = games.map(row => {
    const id   = row.id?.trim() ?? '';
    const desc = descMap.get(id);
    if (desc) matched++;

    return outHeaders.map(col => {
      if ((EXTRA_COLS as readonly string[]).includes(col)) {
        return esc(desc?.[col] ?? '');
      }
      return esc(row[col] ?? '');
    }).join(',');
  });

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, [outHeaders.join(','), ...csvLines].join('\n') + '\n', 'utf-8');

  console.log(
    `  ✓ ${path.basename(gamesPath).padEnd(30)} ` +
    `${games.length} games, ${matched}/${games.length} matched → ${path.basename(outputPath)}`
  );
  return true;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const all = hasFlag('--all');

  if (all) {
    // ── Process all *-games.csv files in the directory ──────────────────────
    const dir = path.resolve(getArg('--dir') ?? 'output');
    if (!fs.existsSync(dir)) {
      console.error(`Directory not found: ${dir}`);
      process.exit(1);
    }

    const gameFiles = fs.readdirSync(dir)
      .filter(f => f.endsWith('-games.csv'))
      .sort();

    if (gameFiles.length === 0) {
      console.error(`No *-games.csv files found in ${dir}`);
      process.exit(1);
    }

    console.log(`Merging descriptions for ${gameFiles.length} file(s) in ${dir}\n`);

    let ok = 0, fail = 0;
    for (const gf of gameFiles) {
      const prefix     = gf.replace(/-games\.csv$/, '');
      const gamesPath  = path.join(dir, gf);
      const descPath   = path.join(dir, `${prefix}-descriptions.csv`);
      const outPath    = getArg('--output') ?? gamesPath;   // overwrite in-place by default

      const success = mergeFiles(gamesPath, descPath, outPath === getArg('--output') ? outPath : gamesPath);
      success ? ok++ : fail++;
    }

    console.log(`\nDone: ${ok} merged, ${fail} skipped.`);

  } else {
    // ── Single pair ──────────────────────────────────────────────────────────
    const gamesArg = getArg('--games');
    if (!gamesArg) {
      console.error(
        'Usage:\n' +
        '  --games output/nes-games.csv [--descriptions output/nes-descriptions.csv] [--output output/nes-games.csv]\n' +
        '  --all [--dir output]'
      );
      process.exit(1);
    }

    const gamesPath = path.resolve(gamesArg);
    const prefix    = path.basename(gamesPath).replace(/-games\.csv$/, '');
    const dir       = path.dirname(gamesPath);

    const descPath  = path.resolve(getArg('--descriptions') ?? path.join(dir, `${prefix}-descriptions.csv`));
    const outPath   = path.resolve(getArg('--output')       ?? gamesPath);  // overwrite in-place by default

    console.log(`Merging: ${path.basename(gamesPath)} + ${path.basename(descPath)} → ${path.basename(outPath)}\n`);
    const ok = mergeFiles(gamesPath, descPath, outPath);
    process.exit(ok ? 0 : 1);
  }
}

main();
