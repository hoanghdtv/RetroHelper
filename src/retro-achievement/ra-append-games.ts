#!/usr/bin/env ts-node
/**
 * ra-append-games.ts
 *
 * Fetches one or more games from RetroAchievements by gameId and APPENDS them to
 * an existing pair of CSV files:
 *
 *   <prefix>-games.csv   (rank,id,title,consoleName,consoleId,totalPlayers,casualPlayers,
 *                         hardcorePlayers,numAchievements,points,genre,developer,publisher,
 *                         released,description,icon,boxArt,titleScreen,screenshot,rating)
 *   <prefix>-md5.csv     (gameId,gameTitle,md5,romName,labels,patchUrl,region,romFile,romSize)
 *
 * For each gameId it pulls:
 *   - GetGameExtended  → metadata, player counts, genre/dev/publisher/released, RA images
 *   - Wikipedia        → description (best-effort, multi-strategy)
 *   - GetGameHashes    → best MD5 (no-patch preferred, then region priority)
 *
 * The rating column (4.0–5.0) is recomputed from totalPlayers across the COMBINED set
 * (existing rows + new rows) so new games sit on the same scale. Existing rows keep
 * their stored rating unless --reweight is passed.
 *
 * romFile / romSize are left empty for new rows — run match-rom-files.ts afterwards.
 *
 * Usage:
 *   npx ts-node src/retro-achievement/ra-append-games.ts --id 3155
 *   npx ts-node src/retro-achievement/ra-append-games.ts --id 3155,1234,9876
 *   npx ts-node src/retro-achievement/ra-append-games.ts --id 3155 --games output/psp-games.csv --md5 output/psp-md5.csv
 *   npx ts-node src/retro-achievement/ra-append-games.ts --id 3155 --force      # overwrite if already present
 *   npx ts-node src/retro-achievement/ra-append-games.ts --id 3155 --dry-run    # fetch + preview, do not write
 *
 * Defaults to the PSP files (output/psp-games.csv + output/psp-md5.csv).
 *
 * Auth: RA_USERNAME + RA_API_KEY from .env (required)
 */

import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';

dotenv.config();

// ─── Config ─────────────────────────────────────────────────────────────────

const RA_API   = 'https://retroachievements.org/API';
const RA_MEDIA = 'https://media.retroachievements.org';
const WIKI_REST = 'https://en.wikipedia.org/api/rest_v1/page/summary';
const WIKI_API  = 'https://en.wikipedia.org/w/api.php';

const http = axios.create({
  timeout: 20_000,
  headers: { 'User-Agent': 'RetroHelper/1.0' },
});

const raUsername = process.env.RA_USERNAME || '';
const raApiKey   = process.env.RA_API_KEY  || '';

// ─── CLI ────────────────────────────────────────────────────────────────────

const args    = process.argv.slice(2);
const getArg  = (flag: string): string | undefined => {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : undefined;
};
const hasFlag = (flag: string): boolean => args.includes(flag);

// Column orders (must match the existing files exactly)
const GAMES_COLS = [
  'rank', 'id', 'title', 'consoleName', 'consoleId',
  'totalPlayers', 'casualPlayers', 'hardcorePlayers',
  'numAchievements', 'points', 'genre', 'developer', 'publisher',
  'released', 'description', 'icon', 'boxArt', 'titleScreen', 'screenshot', 'rating',
] as const;

const MD5_COLS = [
  'gameId', 'gameTitle', 'md5', 'romName', 'labels', 'patchUrl', 'region', 'romFile', 'romSize',
] as const;

// ─── Region priority (mirrors ra-fetch-md5.ts) ───────────────────────────────

const REGION_PRIORITY: string[] = [
  'usa', 'world', 'europe', 'australia', 'japan', 'korea', 'china', 'brazil',
  'germany', 'france', 'spain', 'italy', 'netherlands', 'sweden', 'denmark',
  'norway', 'finland', 'poland', 'portugal', 'russia',
];

interface RAGameHash {
  Name: string;
  MD5: string;
  Labels: string[];
  PatchUrl: string | null;
}

function detectRegion(h: RAGameHash): string {
  const labels = (h.Labels || []).map(l => l.toLowerCase());
  const name   = (h.Name || '').toLowerCase();
  for (const region of REGION_PRIORITY) if (labels.includes(region)) return region;
  const parens = [...name.matchAll(/\(([^)]+)\)/g)].map(m => m[1]);
  for (const group of parens) {
    const tokens = group.split(/[,/]/).map(t => t.trim());
    for (const region of REGION_PRIORITY) if (tokens.includes(region)) return region;
  }
  return 'unknown';
}

function regionRank(h: RAGameHash): number {
  const idx = REGION_PRIORITY.indexOf(detectRegion(h));
  return idx === -1 ? REGION_PRIORITY.length : idx;
}

function selectBestHash(hashes: RAGameHash[]): RAGameHash | null {
  if (hashes.length === 0) return null;
  if (hashes.length === 1) return hashes[0];
  return [...hashes].sort((a, b) => {
    const aPatch = a.PatchUrl !== null ? 1 : 0;
    const bPatch = b.PatchUrl !== null ? 1 : 0;
    if (aPatch !== bPatch) return aPatch - bPatch;     // prefer no patch
    return regionRank(a) - regionRank(b);              // then region priority
  })[0];
}

// ─── Rating (mirrors ra-fetch-descriptions.ts calcRating) ─────────────────────

function calcRating(totalPlayers: number, minPlayers: number, maxPlayers: number): string {
  if (maxPlayers <= minPlayers) return '4.0';
  const logVal = Math.log(Math.max(totalPlayers, 1));
  const logMin = Math.log(Math.max(minPlayers, 1));
  const logMax = Math.log(Math.max(maxPlayers, 1));
  const norm = Math.min(1, Math.max(0, (logVal - logMin) / (logMax - logMin)));
  return String(Math.round((4.0 + norm * 1.0) * 10) / 10);
}

// ─── RA fetchers ──────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

interface ExtendedInfo {
  id: number;
  title: string;
  consoleName: string;
  consoleId: number;
  casualPlayers: number;
  hardcorePlayers: number;
  totalPlayers: number;
  numAchievements: number;
  points: number;
  genre: string;
  developer: string;
  publisher: string;
  released: string;
  icon: string;
  boxArt: string;
  titleScreen: string;
  screenshot: string;
}

async function fetchExtended(gameId: string, retries = 4): Promise<ExtendedInfo | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await http.get(`${RA_API}/API_GetGameExtended.php`, {
        params: { z: raUsername, y: raApiKey, i: gameId },
      });
      const d = res.data;
      if (!d || typeof d !== 'object' || !d.ID) {
        if (attempt < retries) { await sleep((attempt + 1) * 1500); continue; }
        return null;
      }
      const toUrl = (p: string | null | undefined) => (p ? `${RA_MEDIA}${p}` : '');

      // RA has migrated the player-count field names across API versions. Read every
      // known variant so we don't silently end up with empty totalPlayers.
      const pickNum = (...keys: string[]): number => {
        for (const k of keys) {
          const v = Number((d as any)[k]);
          if (Number.isFinite(v) && v > 0) return v;
        }
        return 0;
      };
      // "casual" is the superset (all players); "hardcore" is the subset.
      const casual = pickNum(
        'NumDistinctPlayersCasual', 'players_total', 'NumDistinctPlayers',
        'numDistinctPlayersCasual', 'numDistinctPlayers',
      );
      const hardcore = pickNum(
        'NumDistinctPlayersHardcore', 'players_hardcore', 'numDistinctPlayersHardcore',
      );
      const total = casual || hardcore;

      // Released may come back as a full date or a year; keep the YYYY-MM-DD portion if present
      const released = (d.Released || '').toString().slice(0, 10);
      return {
        id: d.ID,
        title: d.Title || '',
        consoleName: d.ConsoleName || '',
        consoleId: d.ConsoleID || 0,
        casualPlayers: total,
        hardcorePlayers: hardcore,
        totalPlayers: total,
        numAchievements: d.NumAchievements || (d.Achievements ? Object.keys(d.Achievements).length : 0),
        points: pickNum('points', 'Points'),
        genre: d.Genre || '',
        developer: d.Developer || '',
        publisher: d.Publisher || '',
        released,
        icon: toUrl(d.ImageIcon),
        boxArt: toUrl(d.ImageBoxArt),
        titleScreen: toUrl(d.ImageTitle),
        screenshot: toUrl(d.ImageIngame),
      };
    } catch (err: any) {
      const status = err?.response?.status;
      if ((status === 429 || status === 503 || !status) && attempt < retries) {
        await sleep((attempt + 1) * 2000); continue;
      }
      return null;
    }
  }
  return null;
}

async function fetchHashes(gameId: string, retries = 4): Promise<RAGameHash[]> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await http.get(`${RA_API}/API_GetGameHashes.php`, {
        params: { z: raUsername, y: raApiKey, i: gameId },
      });
      const results = res.data?.Results;
      return Array.isArray(results) ? (results as RAGameHash[]) : [];
    } catch (err: any) {
      const status = err?.response?.status;
      if ((status === 429 || status === 503 || !status) && attempt < retries) {
        await sleep((attempt + 1) * 2000); continue;
      }
      return [];
    }
  }
  return [];
}

// ─── Wikipedia description (mirrors ra-fetch-descriptions.ts) ──────────────────

async function wikiSummary(pageTitle: string): Promise<string | null> {
  try {
    const res = await http.get(`${WIKI_REST}/${encodeURIComponent(pageTitle)}`);
    const d = res.data;
    if (!d?.extract || d.type === 'disambiguation') return null;
    return d.extract as string;
  } catch { return null; }
}

async function wikiSearch(query: string): Promise<string | null> {
  try {
    const res = await http.get(WIKI_API, {
      params: { action: 'query', list: 'search', srsearch: query, srlimit: 3, format: 'json', origin: '*' },
    });
    const hits: any[] = res.data?.query?.search || [];
    for (const hit of hits) {
      if (hit.title.toLowerCase().includes('disambiguation')) continue;
      const r = await wikiSummary(hit.title);
      if (r) return r;
    }
  } catch { /* ignore */ }
  return null;
}

async function fetchDescription(title: string, consoleName: string): Promise<string> {
  const clean = title
    .replace(/~[^~]+~/g, '').replace(/\[[^\]]+\]/g, '').replace(/\([^)]+\)/g, '').trim();
  const short = consoleName
    .replace('PlayStation Portable', 'PSP')
    .replace('Super Nintendo Entertainment System', 'SNES')
    .replace('Nintendo Entertainment System', 'NES')
    .replace('PlayStation', 'PS1')
    .replace('Nintendo 64', 'N64')
    .replace('Game Boy Advance', 'GBA')
    .replace('Game Boy Color', 'GBC')
    .replace('Game Boy', 'GB')
    .trim();

  const strategies = [
    () => wikiSummary(clean),
    () => wikiSummary(`${clean} (video game)`),
    () => wikiSummary(`${clean} (${short} video game)`),
    () => wikiSearch(`${clean} ${short} video game`),
    () => wikiSearch(clean),
  ];
  for (const s of strategies) {
    const r = await s();
    if (r) return r;
  }
  return '';
}

// ─── CSV file helpers ──────────────────────────────────────────────────────────

function readRecords(filePath: string): Record<string, string>[] {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf-8');
  return parse(content, { columns: true, skip_empty_lines: true, relax_quotes: true }) as Record<string, string>[];
}

function writeRecords(filePath: string, columns: readonly string[], records: Record<string, string>[]) {
  const csv = stringify(records, { header: true, columns: columns as string[] });
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, csv, 'utf-8');
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  if (!raUsername || !raApiKey) {
    console.error('Error: RA_USERNAME and RA_API_KEY must be set in .env');
    process.exit(1);
  }

  const idArg     = getArg('--id');
  const gamesPath = path.resolve(getArg('--games') ?? 'output/psp-games.csv');
  const md5Path   = path.resolve(getArg('--md5')   ?? 'output/psp-md5.csv');
  const force     = hasFlag('--force');
  const dryRun    = hasFlag('--dry-run');
  const reweight  = hasFlag('--reweight');

  if (!idArg) {
    console.log(`
Usage: ra-append-games.ts --id <id[,id,...]> [options]

Options:
  --id <ids>        Comma-separated RA game IDs to append (required)
  --games <path>    Target games CSV  (default: output/psp-games.csv)
  --md5 <path>      Target md5 CSV    (default: output/psp-md5.csv)
  --force           Overwrite rows for IDs that already exist
  --reweight        Recompute the rating column for ALL rows (not just new ones)
  --dry-run         Fetch and preview, but do not write files
`);
    process.exit(1);
  }

  const ids = idArg.split(',').map(s => s.trim()).filter(Boolean);
  if (ids.length === 0) { console.error('No valid game IDs provided.'); process.exit(1); }

  console.log(`\n=== Append games to CSV ===`);
  console.log(`  Games CSV : ${gamesPath}`);
  console.log(`  MD5 CSV   : ${md5Path}`);
  console.log(`  Game IDs  : ${ids.join(', ')}`);
  console.log(`  Mode      : ${force ? 'force (overwrite existing)' : 'append (skip existing)'}${dryRun ? ' + dry-run' : ''}\n`);

  // ── Load existing data ──────────────────────────────────────────────────────
  const gamesRecords = readRecords(gamesPath);
  const md5Records   = readRecords(md5Path);

  const existingGameIds = new Set(gamesRecords.map(r => String(r.id).trim()));
  const existingMd5Ids  = new Set(md5Records.map(r => String(r.gameId).trim()));

  const maxRank = gamesRecords.reduce((m, r) => Math.max(m, parseInt(r.rank, 10) || 0), 0);

  // ── Decide which IDs to actually fetch ──────────────────────────────────────
  const toProcess = ids.filter(id => {
    const inGames = existingGameIds.has(id);
    const inMd5   = existingMd5Ids.has(id);
    if ((inGames || inMd5) && !force) {
      console.log(`  ⏭  [${id}] already present — skipping (use --force to overwrite)`);
      return false;
    }
    return true;
  });

  if (toProcess.length === 0) {
    console.log('\nNothing to do.');
    return;
  }

  // ── Fetch each game (sequential — small batches, polite to the API) ─────────
  interface Fetched { ext: ExtendedInfo; description: string; best: RAGameHash | null; }
  const fetched: Fetched[] = [];

  for (const id of toProcess) {
    process.stdout.write(`  ↓ [${id}] fetching... `);
    const ext = await fetchExtended(id);
    if (!ext) { console.log('NOT FOUND / empty response — skipped'); continue; }

    const [description, hashes] = await Promise.all([
      fetchDescription(ext.title, ext.consoleName),
      fetchHashes(id),
    ]);
    const best = selectBestHash(hashes);

    console.log(
      `${ext.title} | ${ext.totalPlayers} players | ${ext.numAchievements} ach | ` +
      `${hashes.length} hash(es)${best ? ` → ${best.MD5} (${detectRegion(best)})` : ' (no md5)'}` +
      `${description ? '' : ' | no wiki desc'}`
    );
    fetched.push({ ext, description, best });
    await sleep(150);
  }

  if (fetched.length === 0) { console.log('\nNo games fetched.'); return; }

  // ── Recompute rating scale over combined player set ─────────────────────────
  const allPlayers = [
    ...gamesRecords.map(r => Number(r.totalPlayers) || 0),
    ...fetched.map(f => f.ext.totalPlayers),
  ].filter(p => p > 0);
  const minPlayers = allPlayers.length ? Math.min(...allPlayers) : 1;
  const maxPlayers = allPlayers.length ? Math.max(...allPlayers) : 1;

  // ── Build / merge games records ─────────────────────────────────────────────
  const gamesById = new Map(gamesRecords.map(r => [String(r.id).trim(), r]));
  let nextRank = maxRank;

  for (const { ext, description } of fetched) {
    const id = String(ext.id);
    const existing = gamesById.get(id);
    const rank = existing ? existing.rank : String(++nextRank);
    const row: Record<string, string> = {
      rank,
      id,
      title: ext.title,
      consoleName: ext.consoleName,
      consoleId: String(ext.consoleId),
      totalPlayers: String(ext.totalPlayers),
      casualPlayers: String(ext.casualPlayers),
      hardcorePlayers: String(ext.hardcorePlayers),
      numAchievements: String(ext.numAchievements),
      points: String(ext.points),
      genre: ext.genre,
      developer: ext.developer,
      publisher: ext.publisher,
      released: ext.released,
      description,
      icon: ext.icon,
      boxArt: ext.boxArt,
      titleScreen: ext.titleScreen,
      screenshot: ext.screenshot,
      rating: calcRating(ext.totalPlayers, minPlayers, maxPlayers),
    };
    if (existing) {
      gamesById.set(id, { ...existing, ...row });
    } else {
      gamesRecords.push(row);
      gamesById.set(id, row);
    }
  }

  // Reflect merged map back into gamesRecords (preserve order; updates applied in place)
  const finalGames = gamesRecords.map(r => gamesById.get(String(r.id).trim()) ?? r);

  // Optionally recompute rating for ALL rows on the same scale
  if (reweight) {
    for (const r of finalGames) {
      r.rating = calcRating(Number(r.totalPlayers) || 0, minPlayers, maxPlayers);
    }
  }

  // ── Build / merge md5 records ───────────────────────────────────────────────
  const md5ById = new Map(md5Records.map(r => [String(r.gameId).trim(), r]));
  for (const { ext, best } of fetched) {
    if (!best) {
      console.log(`  ⚠️  [${ext.id}] no MD5 hash — md5 row not added`);
      continue;
    }
    const id = String(ext.id);
    const existing = md5ById.get(id);
    const row: Record<string, string> = {
      gameId: id,
      gameTitle: ext.title,
      md5: best.MD5,
      romName: best.Name || '',
      labels: (best.Labels || []).join('|'),
      patchUrl: best.PatchUrl ?? '',
      region: detectRegion(best),
      romFile: existing?.romFile ?? '',   // preserve any prior match; empty for new
      romSize: existing?.romSize ?? '',
    };
    if (existing) {
      md5ById.set(id, { ...existing, ...row });
    } else {
      md5Records.push(row);
      md5ById.set(id, row);
    }
  }
  const finalMd5 = md5Records.map(r => md5ById.get(String(r.gameId).trim()) ?? r);

  // ── Preview ─────────────────────────────────────────────────────────────────
  console.log(`\n=== Preview ===`);
  for (const { ext, best } of fetched) {
    console.log(`  [${ext.id}] ${ext.title}`);
    console.log(`        console : ${ext.consoleName} (${ext.consoleId}) | rating ${calcRating(ext.totalPlayers, minPlayers, maxPlayers)}`);
    console.log(`        md5     : ${best ? `${best.MD5} (${detectRegion(best)})` : '— none —'}`);
  }

  if (dryRun) {
    console.log('\nDry-run — no files written.');
    return;
  }

  // ── Write both files ─────────────────────────────────────────────────────────
  writeRecords(gamesPath, GAMES_COLS, finalGames);
  writeRecords(md5Path,   MD5_COLS,   finalMd5);

  console.log(`\n✓ ${gamesPath}  → now ${finalGames.length} rows`);
  console.log(`✓ ${md5Path}    → now ${finalMd5.length} rows`);
  console.log(`\nNote: romFile/romSize for new rows are empty — run match-rom-files.ts to fill them:`);
  console.log(`  npx ts-node src/retro-achievement/match-rom-files.ts ${path.relative(process.cwd(), md5Path)} downloads/PSP --resume`);
}

main().catch(err => { console.error('Fatal:', err?.message || err); process.exit(1); });
