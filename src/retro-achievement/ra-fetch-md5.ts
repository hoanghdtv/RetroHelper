#!/usr/bin/env ts-node
/**
 * ra-fetch-md5.ts
 *
 * Reads game IDs from a top-N CSV (e.g. nes-top200.csv), fetches supported
 * ROM hashes from RetroAchievements for each game, selects the single BEST
 * MD5 per game using this priority:
 *   1. If only one hash → use it.
 *   2. If multiple     → prefer hash with NO patch file (PatchUrl = null),
 *                        then sort by region: USA > World > Europe > Japan > ...
 *
 * Usage:
 *   npx ts-node src/retro-achievement/ra-fetch-md5.ts
 *   npx ts-node src/retro-achievement/ra-fetch-md5.ts --ids-file output/nes-top200.csv
 *   npx ts-node src/retro-achievement/ra-fetch-md5.ts --ids-file output/nes-top200.csv --output output/nes-md5.csv
 *   npx ts-node src/retro-achievement/ra-fetch-md5.ts --id 1446,1995,1454
 *
 * Output columns:
 *   gameId, gameTitle, md5, romName, labels, patchUrl, region
 *
 * Auth: RA_USERNAME + RA_API_KEY from .env (required)
 */

import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

// ─── Config ───────────────────────────────────────────────────────────────────

const RA_HASHES_API = 'https://retroachievements.org/API/API_GetGameHashes.php';
const RA_GAME_API   = 'https://retroachievements.org/API/API_GetGame.php';

const http = axios.create({ timeout: 20_000 });

// ─── CLI helpers ──────────────────────────────────────────────────────────────

const args   = process.argv.slice(2);
const getArg = (flag: string): string | undefined => {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : undefined;
};

const raUsername = process.env.RA_USERNAME || '';
const raApiKey   = process.env.RA_API_KEY   || '';

if (!raUsername || !raApiKey) {
  console.error('Error: RA_USERNAME and RA_API_KEY must be set in .env');
  process.exit(1);
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface RAGameHash {
  Name:     string;
  MD5:      string;
  Labels:   string[];
  PatchUrl: string | null;
}

interface MD5Row {
  gameId:    string;
  gameTitle: string;
  md5:       string;
  romName:   string;
  labels:    string;
  patchUrl:  string;
  region:    string;
}

// ─── Region detection ─────────────────────────────────────────────────────────

/**
 * Ordered region keywords. Earlier index = higher priority.
 * Match is attempted against:
 *   - Labels array items (exact, case-insensitive)
 *   - ROM Name parenthetical tokens, e.g. "(USA, Europe)"
 */
const REGION_PRIORITY: string[] = [
  'usa',
  'world',
  'europe',
  'australia',
  'japan',
  'korea',
  'china',
  'brazil',
  'germany',
  'france',
  'spain',
  'italy',
  'netherlands',
  'sweden',
  'denmark',
  'norway',
  'finland',
  'poland',
  'portugal',
  'russia',
];

function detectRegion(h: RAGameHash): string {
  const labels = h.Labels.map(l => l.toLowerCase());
  const name   = h.Name.toLowerCase();

  // Check labels first
  for (const region of REGION_PRIORITY) {
    if (labels.includes(region)) return region;
  }

  // Fallback: look inside parenthetical groups in rom name
  const parens = [...name.matchAll(/\(([^)]+)\)/g)].map(m => m[1]);
  for (const group of parens) {
    const tokens = group.split(/[,/]/).map(t => t.trim());
    for (const region of REGION_PRIORITY) {
      if (tokens.includes(region)) return region;
    }
  }

  return 'unknown';
}

function regionRank(h: RAGameHash): number {
  const region = detectRegion(h);
  const idx    = REGION_PRIORITY.indexOf(region);
  return idx === -1 ? REGION_PRIORITY.length : idx;
}

// ─── Hash selection ───────────────────────────────────────────────────────────

function selectBestHash(hashes: RAGameHash[]): RAGameHash | null {
  if (hashes.length === 0) return null;
  if (hashes.length === 1) return hashes[0];

  const sorted = [...hashes].sort((a, b) => {
    // 1. Prefer no patch URL
    const aPatch = a.PatchUrl !== null ? 1 : 0;
    const bPatch = b.PatchUrl !== null ? 1 : 0;
    if (aPatch !== bPatch) return aPatch - bPatch;

    // 2. Region priority
    return regionRank(a) - regionRank(b);
  });

  return sorted[0];
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
  let cur      = '';
  let inQuote  = false;
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

function readIdsFromCSV(filePath: string): Array<{ id: string; title: string }> {
  const lines = fs.readFileSync(filePath, 'utf-8')
    .split('\n').map(l => l.trimEnd()).filter(Boolean);
  if (lines.length < 2) return [];

  const headers = parseCSVLine(lines[0]).map(h => h.trim());
  const idCol    = headers.indexOf('id');
  const titleCol = headers.indexOf('title');

  if (idCol === -1) {
    console.error(`No "id" column found in ${filePath}`);
    process.exit(1);
  }

  return lines.slice(1).map(l => {
    const cols = parseCSVLine(l);
    return {
      id:    cols[idCol]?.trim()    ?? '',
      title: cols[titleCol]?.trim() ?? '',
    };
  }).filter(r => r.id);
}

// ─── Fetch hashes for one game ────────────────────────────────────────────────

async function fetchHashes(
  gameId: string,
  retries = 4
): Promise<RAGameHash[]> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await http.get(RA_HASHES_API, {
        params: { z: raUsername, y: raApiKey, i: gameId },
      });
      const results = res.data?.Results;
      if (!Array.isArray(results)) return [];
      return results as RAGameHash[];
    } catch (err: any) {
      const status = err?.response?.status;
      if ((status === 429 || status === 503 || !status) && attempt < retries) {
        await new Promise(r => setTimeout(r, (attempt + 1) * 2_000));
        continue;
      }
      console.warn(`  [${gameId}] Error ${status ?? err.message} — skipping`);
      return [];
    }
  }
  return [];
}

// ─── Fetch game title if not already known ────────────────────────────────────

async function fetchGameTitle(gameId: string, retries = 3): Promise<string> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await http.get(RA_GAME_API, {
        params: { z: raUsername, y: raApiKey, i: gameId },
      });
      return res.data?.Title ?? '';
    } catch (err: any) {
      const status = err?.response?.status;
      if ((status === 429 || status === 503) && attempt < retries) {
        await new Promise(r => setTimeout(r, (attempt + 1) * 1_500));
        continue;
      }
      return '';
    }
  }
  return '';
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // ── Collect game entries ───────────────────────────────────────────────────
  let games: Array<{ id: string; title: string }> = [];

  const idArg      = getArg('--id');
  const idsFileArg = getArg('--ids-file') ?? 'output/nes-top200.csv';

  if (idArg) {
    games = idArg.split(',').map(s => ({ id: s.trim(), title: '' })).filter(g => g.id);
  } else {
    const resolved = path.resolve(idsFileArg);
    if (!fs.existsSync(resolved)) {
      console.error(`File not found: ${resolved}`);
      process.exit(1);
    }
    games = readIdsFromCSV(resolved);
  }

  if (games.length === 0) {
    console.error('No game IDs found.');
    process.exit(1);
  }

  // ── Determine output path ─────────────────────────────────────────────────
  let outputPath = getArg('--output');
  if (!outputPath) {
    const base = idArg
      ? `games-${idArg.replace(/,/g, '-').slice(0, 40)}`
      : path.basename(idsFileArg, '.csv');
    outputPath = path.join(
      idArg
        ? path.resolve(__dirname, '../../output')
        : path.dirname(path.resolve(idsFileArg)),
      `${base}-md5.csv`
    );
  }
  outputPath = path.resolve(outputPath);

  const concurrency = parseInt(getArg('--concurrency') ?? '5', 10);

  console.log(`Fetching ROM hashes for ${games.length} game(s)`);
  console.log(`  Source      : ${idsFileArg}`);
  console.log(`  Concurrency : ${concurrency}`);
  console.log(`  Output      : ${outputPath}`);
  console.log('');

  // ── Fetch all games with limited concurrency ──────────────────────────────
  const rows: MD5Row[] = [];
  let done = 0;

  for (let i = 0; i < games.length; i += concurrency) {
    const chunk = games.slice(i, i + concurrency);

    const chunkResults = await Promise.all(
      chunk.map(async (game, idx) => {
        // Small stagger to avoid hammering the API
        if (idx > 0) await new Promise(r => setTimeout(r, idx * 150));

        const hashes = await fetchHashes(game.id);

        // If title not available from CSV, fetch it
        let title = game.title;
        if (!title && hashes.length > 0) {
          title = await fetchGameTitle(game.id);
        }

        const best = selectBestHash(hashes);

        done++;
        const pct = ((done / games.length) * 100).toFixed(1);

        if (!best) {
          console.log(`  [${done}/${games.length}] (${pct}%) [${game.id}] ${title || '?'} — no hashes found`);
          return null;
        }

        const region = detectRegion(best);
        console.log(
          `  [${done}/${games.length}] (${pct}%) [${game.id}] ${title || '?'}` +
          ` — ${hashes.length} hash(es), selected ${best.MD5}` +
          ` (${region}${best.PatchUrl ? ', patched' : ''})`
        );

        return {
          gameId:    game.id,
          gameTitle: title,
          md5:       best.MD5,
          romName:   best.Name,
          labels:    best.Labels.join('|'),
          patchUrl:  best.PatchUrl ?? '',
          region,
        } satisfies MD5Row;
      })
    );

    chunkResults.forEach(r => { if (r) rows.push(r); });
  }

  // ── Write CSV ─────────────────────────────────────────────────────────────
  if (rows.length === 0) {
    console.log('\nNo hashes fetched — nothing to write.');
    process.exit(0);
  }

  const HEADER = 'gameId,gameTitle,md5,romName,labels,patchUrl,region';
  const csvLines = rows.map(r =>
    [
      r.gameId,
      esc(r.gameTitle),
      r.md5,
      esc(r.romName),
      esc(r.labels),
      esc(r.patchUrl),
      r.region,
    ].join(',')
  );

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, [HEADER, ...csvLines].join('\n') + '\n', 'utf-8');

  const skipped = games.length - rows.length;
  console.log(`\nDone: ${rows.length} game(s) written → ${outputPath}`);
  if (skipped > 0) console.log(`      ${skipped} game(s) had no hashes and were skipped.`);
}

main().catch(e => { console.error(e); process.exit(1); });
