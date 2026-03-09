#!/usr/bin/env ts-node
/**
 * ra-update-memaddr.ts
 *
 * Re-fetches the real MemAddr (memory condition expressions) for achievements
 * using the dorequest.php?r=patch endpoint, which returns the actual condition
 * strings (e.g. "0xH075a>=6_0xH075a!=255") instead of MD5 hashes.
 *
 * Usage:
 *   # Update a specific achievements CSV in-place:
 *   npx ts-node src/retro-achievement/ra-update-memaddr.ts --file output/nes-achievements.csv
 *
 *   # Update and write to a different output file:
 *   npx ts-node src/retro-achievement/ra-update-memaddr.ts --file output/nes-achievements.csv --output output/nes-achievements-updated.csv
 *
 *   # Fetch only specific game IDs (comma-separated) and patch a CSV:
 *   npx ts-node src/retro-achievement/ra-update-memaddr.ts --file output/nes-achievements.csv --id 1446,1995
 *
 *   # Dry-run: print summary without writing:
 *   npx ts-node src/retro-achievement/ra-update-memaddr.ts --file output/nes-achievements.csv --dry-run
 *
 * Auth: RA_USERNAME + RA_TOKEN from .env (required)
 *   RA_TOKEN is the login token obtained via dorequest.php?r=login
 *   RA_USERNAME is your RetroAchievements username
 */

import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

// ─── Config ───────────────────────────────────────────────────────────────────

const DOREQUEST_URL = 'https://retroachievements.org/dorequest.php';

// dorequest.php requires a supported client User-Agent
const http = axios.create({
  timeout: 20_000,
  headers: { 'User-Agent': 'RetroArch/1.19.1' },
});

// ─── CLI helpers ──────────────────────────────────────────────────────────────

const args   = process.argv.slice(2);
const getArg = (flag: string): string | undefined => {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : undefined;
};
const hasFlag = (flag: string): boolean => args.includes(flag);

const raUsername = process.env.RA_USERNAME || '';
const raToken    = process.env.RA_TOKEN    || '';

if (!raUsername || !raToken) {
  console.error('Error: RA_USERNAME and RA_TOKEN must be set in .env');
  process.exit(1);
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface PatchAchievement {
  ID:      number;
  Title:   string;
  MemAddr: string;
}

interface PatchResponse {
  Success:   boolean;
  PatchData?: {
    ID:           number;
    Title:        string;
    Achievements: PatchAchievement[];
  };
  Error?: string;
}

// ─── CSV helpers ──────────────────────────────────────────────────────────────

function esc(s: string): string {
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function parseCSVLine(line: string): string[] {
  const cols: string[] = [];
  let cur = '';
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

// ─── Fetch patch data for one game ───────────────────────────────────────────

/**
 * Returns a map: achievementId (string) → real MemAddr condition string
 */
async function fetchMemAddrMap(
  gameId: string,
  retries = 4
): Promise<Map<string, string>> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await http.get<PatchResponse>(DOREQUEST_URL, {
        params: {
          r: 'patch',
          g: gameId,
          u: raUsername,
          t: raToken,
        },
      });

      const data = res.data;

      if (!data.Success || !data.PatchData) {
        const msg = data.Error ?? 'unknown error';
        if (attempt < retries) {
          await sleep((attempt + 1) * 1500);
          continue;
        }
        console.warn(`  [${gameId}] Patch failed: ${msg} — skipping`);
        return new Map();
      }

      const map = new Map<string, string>();
      for (const ach of data.PatchData.Achievements ?? []) {
        map.set(String(ach.ID), ach.MemAddr ?? '');
      }

      console.log(`  [${gameId}] ${data.PatchData.Title} — ${map.size} achievements`);
      return map;

    } catch (err: any) {
      const status = err?.response?.status;
      if ((status === 429 || status === 503 || !status) && attempt < retries) {
        await sleep((attempt + 1) * 2000);
        continue;
      }
      console.warn(`  [${gameId}] HTTP ${status ?? err.message} — skipping`);
      return new Map();
    }
  }
  return new Map();
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const fileArg    = getArg('--file');
  const outputArg  = getArg('--output');
  const idArg      = getArg('--id');
  const dryRun     = hasFlag('--dry-run');
  const concurrency = parseInt(getArg('--concurrency') ?? '4', 10);

  if (!fileArg) {
    console.error(
      'Usage:\n' +
      '  --file output/nes-achievements.csv   achievements CSV to update\n' +
      '  --output output/updated.csv          write to different file (optional)\n' +
      '  --id 1446,1995                       only refetch these game IDs (optional)\n' +
      '  --concurrency 4                      parallel requests (default 4)\n' +
      '  --dry-run                            do not write, just report'
    );
    process.exit(1);
  }

  const inputPath  = path.resolve(fileArg);
  const outputPath = path.resolve(outputArg ?? fileArg);

  if (!fs.existsSync(inputPath)) {
    console.error(`File not found: ${inputPath}`);
    process.exit(1);
  }

  // ─── Read CSV ───────────────────────────────────────────────────────────────

  const rawLines = fs.readFileSync(inputPath, 'utf-8')
    .split('\n').map(l => l.trimEnd()).filter(Boolean);

  if (rawLines.length < 2) {
    console.error('CSV has no data rows.');
    process.exit(1);
  }

  const header  = rawLines[0];
  const dataLines = rawLines.slice(1);
  const cols    = header.split(',').map(h => h.trim());

  const idxGameId  = cols.indexOf('gameId');
  const idxAchId   = cols.indexOf('achievementId');
  const idxMemAddr = cols.indexOf('memAddr');

  if (idxGameId === -1 || idxAchId === -1 || idxMemAddr === -1) {
    console.error(`CSV must have columns: gameId, achievementId, memAddr`);
    process.exit(1);
  }

  // ─── Collect game IDs to fetch ─────────────────────────────────────────────

  const filterIds: Set<string> | null = idArg
    ? new Set(idArg.split(',').map(s => s.trim()))
    : null;

  const allGameIds = new Set<string>();
  for (const line of dataLines) {
    const row = parseCSVLine(line);
    const gid = row[idxGameId]?.trim() ?? '';
    if (gid && (!filterIds || filterIds.has(gid))) {
      allGameIds.add(gid);
    }
  }

  const gameIds = [...allGameIds];
  console.log(`Input : ${inputPath}`);
  console.log(`Output: ${outputPath}${dryRun ? ' (dry-run — not written)' : ''}`);
  console.log(`Games : ${gameIds.length} unique game IDs to fetch`);
  console.log(`Concurrency: ${concurrency}\n`);

  // ─── Fetch memAddr maps for all games ──────────────────────────────────────

  // gameId → Map<achievementId, memAddr>
  const patchMaps = new Map<string, Map<string, string>>();

  for (let i = 0; i < gameIds.length; i += concurrency) {
    const chunk = gameIds.slice(i, i + concurrency);
    const results = await Promise.all(
      chunk.map((gid, idx) =>
        sleep(idx * 120).then(() => fetchMemAddrMap(gid))
      )
    );
    chunk.forEach((gid, k) => patchMaps.set(gid, results[k]));
  }

  // ─── Patch CSV rows ────────────────────────────────────────────────────────

  let updated = 0;
  let skipped = 0;
  let unchanged = 0;

  const updatedLines = dataLines.map(line => {
    const cells = parseCSVLine(line);
    const gid   = cells[idxGameId]?.trim() ?? '';
    const achId = cells[idxAchId]?.trim() ?? '';

    // Only patch rows for requested game IDs
    if (filterIds && !filterIds.has(gid)) return line;

    const map = patchMaps.get(gid);
    if (!map || !map.has(achId)) {
      skipped++;
      return line;
    }

    const newMemAddr = map.get(achId)!;
    const oldMemAddr = cells[idxMemAddr] ?? '';

    if (newMemAddr === oldMemAddr) {
      unchanged++;
      return line;
    }

    // Replace memAddr cell in-place
    cells[idxMemAddr] = newMemAddr;

    // Re-serialise: non-memAddr cells keep their raw quoting; memAddr is re-escaped
    // Rebuild line by replacing only the memAddr position
    const rebuilt = cells.map((cell, i) => {
      if (i === idxMemAddr) return esc(cell);
      // Preserve original quoting for other fields
      return cell.includes(',') || cell.includes('"') || cell.includes('\n')
        ? esc(cell)
        : cell;
    }).join(',');

    updated++;
    return rebuilt;
  });

  console.log(`\nResults:`);
  console.log(`  Updated  : ${updated}`);
  console.log(`  Unchanged: ${unchanged}`);
  console.log(`  Skipped  : ${skipped} (game not in patch response)`);

  if (dryRun) {
    console.log('\nDry-run mode — no file written.');
    return;
  }

  // ─── Write output ──────────────────────────────────────────────────────────

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, [header, ...updatedLines].join('\n') + '\n', 'utf-8');
  console.log(`\nWritten: ${outputPath}`);
}

main().catch(e => { console.error(e); process.exit(1); });
