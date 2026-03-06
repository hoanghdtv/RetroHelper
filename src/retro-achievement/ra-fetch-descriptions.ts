/**
 * ra-fetch-descriptions.ts
 *
 * Reads a RA top-games CSV, fetches for each game:
 *   - description  : Wikipedia extract
 *   - icon         : RA ImageIcon   (game badge/icon)
 *   - boxArt       : RA ImageBoxArt (physical box art)
 *   - titleScreen  : RA ImageTitle  (title screen)
 *   - screenshot   : RA ImageIngame (in-game screenshot)
 *   - rating       : RAWG.io score 0–5  (requires --rawg-key, else empty)
 *
 * Usage:
 *   npx ts-node src/retro-achievement/ra-fetch-descriptions.ts \
 *     --input  output/nes-top200.csv \
 *     --output output/nes-top200-descriptions.csv \
 *     [--concurrency 3] \
 *     [--rawg-key YOUR_KEY] \
 *     [--resume]
 *
 * RAWG free API key: https://rawg.io/apidocs  (sign up → free key)
 */

import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

const RA_BASE   = 'https://media.retroachievements.org';
const WIKI_REST = 'https://en.wikipedia.org/api/rest_v1/page/summary';
const WIKI_API  = 'https://en.wikipedia.org/w/api.php';

// ─── Types ────────────────────────────────────────────────────────────────────

interface WikiResult {
  description: string;
  source: 'direct' | 'search' | 'none' | 'cached';
}

interface RAImages {
  icon: string;        // full URL of ImageIcon
  boxArt: string;      // full URL of ImageBoxArt
  titleScreen: string; // full URL of ImageTitle
  screenshot: string;  // full URL of ImageIngame
}

interface ResultRow {
  id: string;
  title: string;
  description: string;
  icon: string;
  boxArt: string;
  titleScreen: string;
  screenshot: string;
  _source: string;
}

interface GameRow {
  id: string;
  title: string;
  consoleName: string;
  [key: string]: string;
}

const http = axios.create({
  timeout: 20000,
  headers: { 'User-Agent': 'RetroHelper/1.0' },
});

// ─── Wikipedia ────────────────────────────────────────────────────────────────

async function wikiSummary(pageTitle: string): Promise<string | null> {
  try {
    const res = await http.get(`${WIKI_REST}/${encodeURIComponent(pageTitle)}`);
    const d = res.data;
    if (!d?.extract || d.type === 'disambiguation') return null;
    return d.extract as string;
  } catch {
    return null;
  }
}

async function wikiSearch(query: string): Promise<string | null> {
  try {
    const searchRes = await http.get(WIKI_API, {
      params: { action: 'query', list: 'search', srsearch: query, srlimit: 3, format: 'json', origin: '*' },
    });
    const hits: any[] = searchRes.data?.query?.search || [];
    for (const hit of hits) {
      if (hit.title.toLowerCase().includes('disambiguation')) continue;
      const result = await wikiSummary(hit.title);
      if (result) return result;
    }
  } catch { /* ignore */ }
  return null;
}

async function fetchWikiInfo(title: string, consoleName: string): Promise<WikiResult> {
  const clean = title
    .replace(/~[^~]+~/g, '')
    .replace(/\[[^\]]+\]/g, '')
    .replace(/\([^)]+\)/g, '')
    .trim();

  const consolShort = consoleName
    .replace('/Famicom', '').replace('/Game Boy Color', '').replace('/Game Boy Advance', '')
    .replace('Super Nintendo Entertainment System', 'SNES')
    .replace('Super Nintendo', 'SNES')
    .replace('Nintendo Entertainment System', 'NES')
    .replace('PlayStation', 'PS1')
    .replace('Nintendo 64', 'N64')
    .replace('Game Boy Advance', 'GBA')
    .replace('Game Boy Color', 'GBC')
    .replace('Game Boy', 'GB')
    .trim();

  const strategies: Array<() => Promise<string | null>> = [
    () => wikiSummary(clean),
    () => wikiSummary(`${clean} (video game)`),
    () => wikiSummary(`${clean} (${consolShort} video game)`),
    () => wikiSearch(`${clean} ${consolShort} video game`),
    () => wikiSearch(clean),
    () => wikiSearch(clean.replace(/[:!?']/g, '').replace(/\s+/g, ' ').trim() + ' video game'),
  ];

  for (let i = 0; i < strategies.length; i++) {
    const result = await strategies[i]();
    if (result) {
      return { description: result, source: i <= 2 ? 'direct' : 'search' };
    }
  }

  return { description: '', source: 'none' };
}

// ─── RetroAchievements images ─────────────────────────────────────────────────

let raUsername = process.env.RA_USERNAME || '';
let raApiKey   = process.env.RA_API_KEY   || '';

async function fetchRAImages(gameId: string): Promise<RAImages> {
  if (!raUsername || !raApiKey) return { icon: '', boxArt: '', titleScreen: '', screenshot: '' };
  try {
    const res = await http.get('https://retroachievements.org/API/API_GetGameExtended.php', {
      params: { z: raUsername, y: raApiKey, i: gameId },
    });
    const d = res.data;
    const toUrl = (p: string | null | undefined) => (p ? `${RA_BASE}${p}` : '');
    return {
      icon:        toUrl(d.ImageIcon),
      boxArt:      toUrl(d.ImageBoxArt),
      titleScreen: toUrl(d.ImageTitle),
      screenshot:  toUrl(d.ImageIngame),
    };
  } catch {
    return { icon: '', boxArt: '', titleScreen: '', screenshot: '' };
  }
}

// ─── Rating from player count ────────────────────────────────────────────────

/**
 * Normalize totalPlayers to a 4.0–5.0 rating using log scale
 * (log scale so mid-tier games aren't all squashed near 3.0)
 */
function calcRating(totalPlayers: number, minPlayers: number, maxPlayers: number): string {
  if (maxPlayers <= minPlayers) return '4.0';
  const logVal = Math.log(Math.max(totalPlayers, 1));
  const logMin = Math.log(Math.max(minPlayers, 1));
  const logMax = Math.log(Math.max(maxPlayers, 1));
  const norm = (logVal - logMin) / (logMax - logMin);   // 0..1
  const rating = 4.0 + norm * 1.0;                      // 4.0..5.0
  return String(Math.round(rating * 10) / 10);
}

// ─── CSV helpers ──────────────────────────────────────────────────────────────

function parseCSV(content: string): GameRow[] {
  const lines = content.trim().split('\n');
  const headers = lines[0].split(',').map(h => h.trim());
  return lines.slice(1).map(line => {
    const values: string[] = [];
    let inQuote = false;
    let cur = '';
    for (const ch of line) {
      if (ch === '"') { inQuote = !inQuote; continue; }
      if (ch === ',' && !inQuote) { values.push(cur); cur = ''; continue; }
      cur += ch;
    }
    values.push(cur);
    const row: GameRow = { id: '', title: '', consoleName: '' };
    headers.forEach((h, i) => { row[h] = (values[i] || '').trim(); });
    return row;
  });
}

function esc(value: string): string {
  return `"${(value || '').replace(/"/g, '""').replace(/\n/g, ' ')}"`;
}

// ─── Concurrency limiter ──────────────────────────────────────────────────────

async function runConcurrent<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number,
  onProgress?: (done: number, total: number) => void
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let index = 0; let done = 0;
  async function worker() {
    while (index < tasks.length) {
      const i = index++;
      results[i] = await tasks[i]();
      done++;
      onProgress?.(done, tasks.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  return results;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const getArg = (flag: string) => {
    const i = args.indexOf(flag);
    if (i === -1) return undefined;
    const next = args[i + 1];
    return (next && !next.startsWith('--')) ? next : undefined;
  };
  const hasFlag = (flag: string) => args.includes(flag);

  const inputPath   = getArg('--input');
  const outputPath  = getArg('--output');
  const concurrency = Number(getArg('--concurrency') || '3');
  const resume      = hasFlag('--resume');

  raUsername = getArg('--ra-user')  || process.env.RA_USERNAME  || '';
  raApiKey   = getArg('--ra-key')   || process.env.RA_API_KEY   || '';

  if (!inputPath || !outputPath) {
    console.log(`
Usage: ra-fetch-descriptions.ts --input <csv> --output <csv> [options]

Options:
  --input <path>    Input CSV from RATool (must have id, title, consoleName columns)
  --output <path>   Output CSV
  --concurrency N   Parallel fetches (default: 3)
  --resume          Skip games already complete; re-fetch only missing fields
  --force-images    With --resume: retry image fetching even for games with empty images
`);
    process.exit(1);
  }

  if (!fs.existsSync(inputPath)) { console.error(`Input not found: ${inputPath}`); process.exit(1); }

  const rows = parseCSV(fs.readFileSync(inputPath, 'utf-8'));
  console.log(`Read ${rows.length} games from ${inputPath}`);
  console.log(`  Images  : ${raApiKey ? 'RA API (icon + box art + title screen + screenshot)' : 'disabled (set RA_API_KEY / --ra-key for RA images)'}`);
  console.log(`  Rating  : disabled`);

  const forceImages = hasFlag('--force-images');

  // Load existing data for --resume
  const existingMap = new Map<string, ResultRow>();

  if (resume && fs.existsSync(outputPath)) {
    const existing = parseCSV(fs.readFileSync(outputPath, 'utf-8'));
    existing.forEach(r => existingMap.set(r.id, r as unknown as ResultRow));

    const complete = existing.filter(r =>
      !!r.description &&
      (!raApiKey || (r.icon && r.boxArt && r.titleScreen && r.screenshot))
    ).length;
    const partial = existing.length - complete;
    console.log(`  Resume  : ${complete} complete, ${partial} to process\n`);
  }

  // With --resume: only skip rows where description is filled AND images are filled (or no raApiKey)
  const toFetch = resume
    ? rows.filter(r => {
        const prev = existingMap.get(r.id);
        if (!prev) return true;                          // new row
        if (!prev.description) return true;              // missing description
        if (raApiKey && (forceImages || !prev.icon || !prev.boxArt || !prev.titleScreen || !prev.screenshot)) return true;
        return false;
      })
    : rows;  // no --resume: process everything

  console.log(`Fetching ${toFetch.length} games (concurrency=${concurrency})...\n`);

  const fetched: ResultRow[] = new Array(toFetch.length);
  let lastPct = -1;

  const tasks = toFetch.map((row, i) => async () => {
    const { id, title, consoleName } = row;
    const prev = existingMap.get(id);

    // Per-field skip logic
    const needDesc   = !prev?.description;
    const needImages = !!raApiKey && (forceImages ||
      !prev?.icon || !prev?.boxArt || !prev?.titleScreen || !prev?.screenshot);

    const [wikiResult, raImages] = await Promise.all([
      needDesc   ? fetchWikiInfo(title, consoleName || '') : Promise.resolve({ description: prev!.description, source: 'cached' as const }),
      needImages ? fetchRAImages(id) : Promise.resolve({
        icon:        prev?.icon        || '',
        boxArt:      prev?.boxArt      || '',
        titleScreen: prev?.titleScreen || '',
        screenshot:  prev?.screenshot  || '',
      }),
    ]);

    fetched[i] = {
      id, title,
      description: wikiResult.description,
      icon:        raImages.icon,
      boxArt:      raImages.boxArt,
      titleScreen: raImages.titleScreen,
      screenshot:  raImages.screenshot,
      _source:     wikiResult.source,
    };
  });

  await runConcurrent(tasks, concurrency, (done, total) => {
    const pct = Math.floor((done / total) * 100);
    if (pct !== lastPct && pct % 5 === 0) {
      lastPct = pct;
      const last = fetched.slice(0, done).filter(Boolean).pop();
      const status = last ? `[${last._source}] ${last.title.slice(0, 28)}` : '';
      process.stdout.write(`\r  ${done}/${total} (${pct}%) ${status.padEnd(48)}`);
    }
  });

  console.log('\n');

  // Merge into final list preserving original order
  // fetchedMap wins over existingMap (may contain updated fields for partial rows)
  const fetchedMap = new Map<string, ResultRow>();
  fetched.filter(Boolean).forEach(r => fetchedMap.set(r.id, r));

  const allResults: ResultRow[] = rows.map(row => {
    const result = fetchedMap.get(row.id) || existingMap.get(row.id) || {
      id: row.id, title: row.title,
      description: '', icon: '', boxArt: '', titleScreen: '', screenshot: '', _source: 'none',
    };
    return result;
  });

  // Stats
  console.log(`  Description : ${allResults.filter(r => r.description).length}/${allResults.length}`);
  console.log(`  Icon        : ${allResults.filter(r => r.icon).length}/${allResults.length}${!raApiKey ? '  (use --ra-key to enable)' : ''}`);
  console.log(`  Box art     : ${allResults.filter(r => r.boxArt).length}/${allResults.length}${!raApiKey ? '  (use --ra-key to enable)' : ''}`);
  console.log(`  Title screen: ${allResults.filter(r => r.titleScreen).length}/${allResults.length}${!raApiKey ? '  (use --ra-key to enable)' : ''}`);
  console.log(`  Screenshot  : ${allResults.filter(r => r.screenshot).length}/${allResults.length}${!raApiKey ? '  (use --ra-key to enable)' : ''}`);
  // Write CSV
  const outDir = path.dirname(outputPath);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const header = 'id,title,description,icon,boxArt,titleScreen,screenshot';
  const csvRows = allResults.map(r =>
    [r.id, esc(r.title), esc(r.description), esc(r.icon), esc(r.boxArt), esc(r.titleScreen), esc(r.screenshot)].join(',')
  );

  fs.writeFileSync(outputPath, [header, ...csvRows].join('\n'), 'utf-8');
  console.log(`\nSaved to ${outputPath}`);

  const missing = allResults.filter(r => !r.description);
  if (missing.length > 0) {
    console.log(`\nNo description (${missing.length}):`);
    missing.forEach(r => console.log(`  [${r.id}] ${r.title}`));
  }
}

main().catch(err => { console.error('Error:', err.message || err); process.exit(1); });

