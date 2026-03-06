// Tool to read ROM information from CSV file
// Usage: npx ts-node src/retro-achievement/ra-csv-update.ts <csvPath> [options]
// Example:
//   npx ts-node src/retro-achievement/ra-csv-update.ts output/topnes-split/roms.csv
//   npx ts-node src/retro-achievement/ra-csv-update.ts output/topnes-split/roms.csv --limit 10
//   npx ts-node src/retro-achievement/ra-csv-update.ts output/topnes-split/roms.csv --console nes

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as dotenv from 'dotenv';
import axios from 'axios';
import AdmZip from 'adm-zip';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';

dotenv.config();

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RomRecord {
  id?: number;
  title: string;
  url: string;
  console: string;
  description?: string;
  mainImage?: string;
  screenshots?: string[];
  genre?: string[];
  releaseDate?: string;
  publisher?: string;
  region?: string[];
  size?: string;
  downloadCount?: string;
  numberOfReviews?: string;
  averageRating?: string;
  downloadLink?: string;
  directDownloadLink?: string;
  romType?: string;
  relatedRoms?: string; // comma-separated IDs e.g. "10002,10003,10005,10007"
  raGameId?: number;    // RetroAchievements game ID matched via ROM MD5
}

// ─── CSV Helpers ──────────────────────────────────────────────────────────────

/**
 * Parse a CSV file and return an array of RomRecord objects
 */
export function parseCSV(csvPath: string): RomRecord[] {
  console.log(`📂 Reading CSV from: ${csvPath}`);

  if (!fs.existsSync(csvPath)) {
    throw new Error(`CSV file not found: ${csvPath}`);
  }

  const csvContent = fs.readFileSync(csvPath, 'utf-8');
  const records = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  const parseArray = (value: string | undefined): string[] | undefined => {
    if (!value || value.trim() === '') return undefined;
    if (value.includes('|')) return value.split('|').map(s => s.trim()).filter(Boolean);
    return value.split(',').map(s => s.trim()).filter(Boolean);
  };

  const roms: RomRecord[] = records.map((r: any): RomRecord => ({
    id: r.id ? parseInt(r.id, 10) : undefined,
    title: r.title,
    url: r.url,
    console: r.console,
    description: r.description || undefined,
    mainImage: r.mainImage || undefined,
    screenshots: parseArray(r.screenshots),
    genre: parseArray(r.genre),
    releaseDate: r.releaseDate || undefined,
    publisher: r.publisher || undefined,
    region: parseArray(r.region),
    size: r.size || undefined,
    downloadCount: r.downloadCount || undefined,
    numberOfReviews: r.numberOfReviews || undefined,
    averageRating: r.averageRating || undefined,
    downloadLink: r.downloadLink || undefined,
    directDownloadLink: r.directDownloadLink || undefined,
    romType: r.romType || undefined,
    relatedRoms: r.relatedRoms || undefined,
    raGameId: r.raGameId ? parseInt(r.raGameId, 10) : undefined,
  }));

  console.log(`✅ Parsed ${roms.length} ROMs`);
  return roms;
}

/**
 * Write an array of RomRecord objects back to a CSV file
 */
export function writeCSV(roms: RomRecord[], outputPath: string): void {
  const records = roms.map(rom => ({
    id: rom.id ?? '',
    title: rom.title,
    url: rom.url,
    console: rom.console,
    description: rom.description ?? '',
    mainImage: rom.mainImage ?? '',
    screenshots: Array.isArray(rom.screenshots) ? rom.screenshots.join('|') : '',
    genre: Array.isArray(rom.genre) ? rom.genre.join('|') : '',
    releaseDate: rom.releaseDate ?? '',
    publisher: rom.publisher ?? '',
    region: Array.isArray(rom.region) ? rom.region.join('|') : '',
    size: rom.size ?? '',
    downloadCount: rom.downloadCount ?? '',
    numberOfReviews: rom.numberOfReviews ?? '',
    averageRating: rom.averageRating ?? '',
    downloadLink: rom.downloadLink ?? '',
    directDownloadLink: rom.directDownloadLink ?? '',
    romType: rom.romType ?? '',
    relatedRoms: rom.relatedRoms ?? '',
    raGameId: rom.raGameId ?? '',
  }));

  const csvContent = stringify(records, {
    header: true,
    columns: [
      'id', 'title', 'url', 'console', 'description', 'mainImage',
      'screenshots', 'genre', 'releaseDate', 'publisher', 'region',
      'size', 'downloadCount', 'numberOfReviews', 'averageRating',
      'downloadLink', 'directDownloadLink', 'romType', 'relatedRoms', 'raGameId',
    ],
  });

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, csvContent, 'utf-8');
  console.log(`💾 Written ${roms.length} ROMs to: ${outputPath}`);
}

// ─── Related ROMs ─────────────────────────────────────────────────────────────

/**
 * Extract the "series base name" from a title.
 * e.g. "Adventure Island II" → "adventure island"
 *      "Super Mario Bros. 3" → "super mario bros"
 *      "Mega Man 5"          → "mega man"
 */
function extractSeriesName(title: string): string {
  return title
    .toLowerCase()
    .replace(/[\s:]+[ivxlcdm]+$/i, '')
    .replace(/[\s]+\d+$/, '')
    .replace(/\s+(ii|iii|iv|vi|vii|viii|ix|xi|xii)$/i, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Tokenise a title into meaningful words (ignore short stop-words).
 */
function titleTokens(title: string): Set<string> {
  const STOP = new Set(['the', 'of', 'a', 'an', 'and', 'in', 'to', 'for', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x']);
  return new Set(
    title.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 1 && !STOP.has(w))
  );
}

/**
 * Score how "related" `candidate` is to `target`.
 *
 * Scoring:
 *  +40  same series base name (e.g. both "adventure island …")
 *  +5   per shared title token
 *  +8   per shared genre
 *  +10  same publisher
 *  +3   per shared region
 *  -999 self
 */
function scoreRelated(target: RomRecord, candidate: RomRecord): number {
  if (target.id !== undefined && target.id === candidate.id) return -999;

  let score = 0;

  // Series name match
  const ts = extractSeriesName(target.title);
  const cs = extractSeriesName(candidate.title);
  if (ts && cs && ts === cs) score += 40;

  // Shared title tokens
  const tt = titleTokens(target.title);
  const ct = titleTokens(candidate.title);
  for (const w of tt) if (ct.has(w)) score += 5;

  // Shared genre
  const tg = new Set(target.genre ?? []);
  for (const g of candidate.genre ?? []) if (tg.has(g)) score += 8;

  // Same publisher
  if (target.publisher && candidate.publisher &&
      target.publisher.toLowerCase() === candidate.publisher.toLowerCase()) {
    score += 10;
  }

  // Shared region
  const tr = new Set(target.region ?? []);
  for (const r of candidate.region ?? []) if (tr.has(r)) score += 3;

  return score;
}

/**
 * Find the top-N related ROMs for a given ROM from the full list.
 * Returns their IDs as a comma-separated string, e.g. "10002,10003,10005,10007"
 */
export function findRelatedRoms(target: RomRecord, allRoms: RomRecord[], topN = 4): string {
  const scored = allRoms
    .filter(r => r.id !== undefined && r.id !== target.id)
    .map(r => ({ id: r.id as number, score: scoreRelated(target, r) }))
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);

  return scored.map(r => r.id).join(',');
}

/**
 * Add/refresh `relatedRoms` column for every ROM in the list.
 * Skips ROMs that already have relatedRoms unless `force` is true.
 */
export function addRelatedRomsToCSV(
  roms: RomRecord[],
  csvPath: string,
  force = false,
  topN = 4,
): void {
  console.log(`\n🔗 Computing related ROMs (top ${topN} per entry)…`);

  let updated = 0;
  let skipped = 0;

  for (const rom of roms) {
    if (!force && rom.relatedRoms) {
      skipped++;
      continue;
    }
    rom.relatedRoms = findRelatedRoms(rom, roms, topN);
    updated++;
  }

  writeCSV(roms, csvPath);

  console.log(`✅ Updated : ${updated}`);
  console.log(`⏭️  Skipped  : ${skipped} (already had relatedRoms)`);
  console.log(`📄 Saved to: ${csvPath}`);
}

// ─── RA Game ID via MD5 ───────────────────────────────────────────────────────

/**
 * Map console short-name (as used in CSV) → RetroAchievements system ID.
 * https://retroachievements.org/API/API_GetConsoleIDs.php
 */
const RA_CONSOLE_IDS: Record<string, number> = {
  nes:     7,
  snes:    3,
  gb:     4,
  gbc:    6,
  gba:    5,
  n64:    2,
  nds:   18,
  psx:    12,
  psp:    41,
  genesis: 1,
  md:     1,
  sms:    11,
  gg:     15,
  pce:    8,
  saturn: 39,
  dc:     40,
};

/**
 * Compute MD5 of a Buffer.
 */
function md5(buf: Buffer): string {
  return crypto.createHash('md5').update(buf).digest('hex');
}

/**
 * ROM file extensions that RA uses for hashing.
 */
const ROM_EXTENSIONS = new Set([
  '.nes', '.sfc', '.smc', '.gb', '.gbc', '.gba',
  '.n64', '.z64', '.v64', '.nds', '.iso', '.bin',
  '.cue', '.img', '.pbp', '.psp', '.md', '.gen',
  '.sms', '.gg', '.pce', '.ccd',
]);

/** Magic bytes for formats where RA strips a fixed header before hashing */
const INES_MAGIC  = Buffer.from([0x4e, 0x45, 0x53, 0x1a]); // NES\x1a  → skip 16 bytes
const UNIF_MAGIC  = Buffer.from([0x55, 0x4e, 0x49, 0x46]); // UNIF     → skip 32 bytes (rare)

/**
 * Return the Buffer that RetroAchievements actually hashes for a given ROM file.
 *
 * NES (.nes): if the file starts with the iNES header (NES\x1a), RA hashes the
 *             ROM data WITHOUT the 16-byte header.
 * All other formats: hash the full file content.
 */
function raHashBuffer(data: Buffer, ext: string): Buffer {
  if (ext === '.nes') {
    if (data.length > 16 && data.slice(0, 4).equals(INES_MAGIC)) {
      return data.slice(16);
    }
    if (data.length > 32 && data.slice(0, 4).equals(UNIF_MAGIC)) {
      return data.slice(32);
    }
  }
  return data;
}

/**
 * Given a rom file path (.zip or bare ROM), return the MD5 hash
 * using the same hashing strategy as RetroAchievements.
 * - If .zip: extracts the first ROM-like entry and hashes it.
 * - Otherwise: hashes the file directly.
 */
function getRomMd5(filePath: string): string | null {
  try {
    const fileExt = path.extname(filePath).toLowerCase();

    if (fileExt === '.zip') {
      const zip = new AdmZip(filePath);
      const entries = zip.getEntries();

      // Find the first entry that looks like a ROM file
      const romEntry = entries.find(e =>
        !e.isDirectory && ROM_EXTENSIONS.has(path.extname(e.entryName).toLowerCase())
      );

      if (!romEntry) {
        const first = entries.find(e => !e.isDirectory);
        if (!first) return null;
        return md5(first.getData());
      }

      const romExt = path.extname(romEntry.entryName).toLowerCase();
      return md5(raHashBuffer(romEntry.getData(), romExt));
    }

    // Bare ROM file
    if (ROM_EXTENSIONS.has(fileExt)) {
      return md5(raHashBuffer(fs.readFileSync(filePath), fileExt));
    }

    return null;
  } catch (err) {
    return null;
  }
}

/**
 * Try to find the ROM file for a given ROM record inside downloadsDir.
 * Looks for: <sanitized title>.zip, <sanitized title>.<romExt>, etc.
 */
function findRomFile(rom: RomRecord, downloadsDir: string): string | null {
  if (!fs.existsSync(downloadsDir)) return null;

  const files = fs.readdirSync(downloadsDir);

  // Build candidate base-names from the directDownloadLink or title
  const candidates: string[] = [];

  if (rom.directDownloadLink) {
    // Extract filename from URL (before query string), decoded
    const urlFile = decodeURIComponent(
      rom.directDownloadLink.split('/').pop()?.split('?')[0] ?? ''
    );
    if (urlFile) candidates.push(urlFile);
  }

  // Also try the raw title sanitised the same way rom-csv-download does
  const sanitized = rom.title
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, '_')
    .substring(0, 200);
  candidates.push(sanitized);

  for (const candidate of candidates) {
    const base = path.parse(candidate).name;
    // Exact filename match
    const exact = files.find(f => f === candidate);
    if (exact) return path.join(downloadsDir, exact);

    // Match by base name + any extension
    const byBase = files.find(f => path.parse(f).name === base);
    if (byBase) return path.join(downloadsDir, byBase);
  }

  return null;
}

/**
 * Fetch the MD5→GameID map for a given RA console ID.
 * Uses API_GetGameList.php?h=1 which includes hashes.
 * Result is cached in memory for the duration of the run.
 */
const hashMapCache: Map<number, Map<string, number>> = new Map();

async function fetchHashMap(consoleId: number, apiKey: string): Promise<Map<string, number>> {
  if (hashMapCache.has(consoleId)) return hashMapCache.get(consoleId)!;

  const username = process.env.RA_USERNAME;
  if (!username) throw new Error('RA_USERNAME not set in .env');

  console.log(`  📡 Fetching hash list for RA console ID ${consoleId}…`);
  const resp = await axios.get('https://retroachievements.org/API/API_GetGameList.php', {
    params: { z: username, y: apiKey, i: consoleId, h: 1, f: 0 },
    timeout: 60000,
  });

  const map = new Map<string, number>();
  for (const game of resp.data as any[]) {
    for (const hash of (game.Hashes ?? []) as string[]) {
      map.set(hash.toLowerCase(), game.ID);
    }
  }

  console.log(`  ✅ Loaded ${map.size} hashes for console ${consoleId}`);
  hashMapCache.set(consoleId, map);
  return map;
}

/**
 * Look up the RA game ID for a single ROM by its MD5.
 */
async function lookupRaGameId(
  md5Hash: string,
  consoleId: number,
  apiKey: string,
): Promise<number | null> {
  const map = await fetchHashMap(consoleId, apiKey);
  return map.get(md5Hash.toLowerCase()) ?? null;
}

/**
 * Add/refresh `raGameId` column for every ROM in the list.
 * Steps per ROM:
 *  1. Skip if already has raGameId (unless --force)
 *  2. Locate the ROM file in downloadsDir
 *  3. Compute MD5 of the ROM inside the zip
 *  4. Look up game ID via RA API hash list
 *  5. Save result to CSV after each ROM
 */
export async function addRaGameIds(
  roms: RomRecord[],
  csvPath: string,
  downloadsDir: string,
  force = false,
): Promise<void> {
  const apiKey = process.env.RA_API_KEY;
  if (!apiKey) throw new Error('RA_API_KEY not set in .env');

  console.log(`\n🏆 Fetching RetroAchievements Game IDs…`);
  console.log(`   Downloads dir : ${downloadsDir}`);

  // Determine RA console ID from the first ROM's console field
  const consoleSlug = roms[0]?.console?.toLowerCase() ?? '';
  const raConsoleId = RA_CONSOLE_IDS[consoleSlug];
  if (!raConsoleId) {
    throw new Error(`Unknown console "${consoleSlug}". Add it to RA_CONSOLE_IDS map.`);
  }
  console.log(`   RA console ID : ${raConsoleId} (${consoleSlug})\n`);

  // Pre-fetch hash map once for entire run
  await fetchHashMap(raConsoleId, apiKey);

  let found = 0;
  let notFound = 0;
  let noFile = 0;
  let skipped = 0;

  for (let i = 0; i < roms.length; i++) {
    const rom = roms[i];
    process.stdout.write(`[${i + 1}/${roms.length}] 🎮 ${rom.title} … `);

    if (!force && rom.raGameId) {
      console.log(`⏭️  already has raGameId=${rom.raGameId}`);
      skipped++;
      continue;
    }

    // 1. Find file
    const filePath = findRomFile(rom, downloadsDir);
    if (!filePath) {
      console.log(`⚠️  ROM file not found`);
      noFile++;
      continue;
    }

    // 2. Compute MD5
    const hash = getRomMd5(filePath);
    if (!hash) {
      console.log(`⚠️  Could not compute MD5 for ${path.basename(filePath)}`);
      noFile++;
      continue;
    }

    // 3. Lookup
    const gameId = await lookupRaGameId(hash, raConsoleId, apiKey);
    if (gameId) {
      rom.raGameId = gameId;
      console.log(`✅ raGameId=${gameId}  (md5=${hash})`);
      found++;
    } else {
      console.log(`❌ No match on RA  (md5=${hash})`);
      notFound++;
    }

    // 4. Persist after each ROM so progress is not lost on interruption
    writeCSV(roms, csvPath);
  }

  console.log(`\n=== RA Game ID Summary ===`);
  console.log(`✅ Found    : ${found}`);
  console.log(`❌ No match : ${notFound}`);
  console.log(`⚠️  No file  : ${noFile}`);
  console.log(`⏭️  Skipped  : ${skipped}`);
  console.log(`📄 Saved to : ${csvPath}`);
}

// ─── RA Screenshots ───────────────────────────────────────────────────────────

const RA_MEDIA_BASE = 'https://media.retroachievements.org';

interface RaGameImages {
  imageTitle: string;   // title screen  → /Images/xxxxxx.png
  imageIngame: string;  // in-game shot  → /Images/xxxxxx.png
  imageBoxArt: string;  // box art       → /Images/xxxxxx.png
  imageIcon: string;    // icon          → /Images/xxxxxx.png
}

/**
 * Fetch image paths for a single RA game via API_GetGame.php.
 * Returns full URLs using the media CDN base.
 */
async function fetchRaGameImages(
  raGameId: number,
  apiKey: string,
  username: string,
): Promise<RaGameImages | null> {
  try {
    const resp = await axios.get('https://retroachievements.org/API/API_GetGame.php', {
      params: { z: username, y: apiKey, i: raGameId },
      timeout: 15000,
    });
    const g = resp.data;
    if (!g || !g.ImageIngame) return null;
    return {
      imageTitle:  g.ImageTitle  ? `${RA_MEDIA_BASE}${g.ImageTitle}`  : '',
      imageIngame: g.ImageIngame ? `${RA_MEDIA_BASE}${g.ImageIngame}` : '',
      imageBoxArt: g.ImageBoxArt ? `${RA_MEDIA_BASE}${g.ImageBoxArt}` : '',
      imageIcon:   g.ImageIcon   ? `${RA_MEDIA_BASE}${g.ImageIcon}`   : '',
    };
  } catch {
    return null;
  }
}

/**
 * Update the `screenshots` column for every ROM that has a `raGameId`.
 * Screenshots are stored as pipe-separated URLs: "imageTitle|imageIngame"
 *
 * Also updates `mainImage` if it is empty, using imageBoxArt (falling back to imageIcon).
 *
 * Skips ROMs that already have screenshots unless `force` is true.
 */
export async function updateScreenshotsFromRA(
  roms: RomRecord[],
  csvPath: string,
  force = false,
): Promise<void> {
  const apiKey  = process.env.RA_API_KEY;
  const username = process.env.RA_USERNAME;
  if (!apiKey || !username) throw new Error('RA_API_KEY / RA_USERNAME not set in .env');

  const eligible = roms.filter(r => r.raGameId);
  console.log(`\n🖼️  Updating screenshots from RetroAchievements…`);
  console.log(`   ROMs with raGameId : ${eligible.length}`);
  console.log(`   Force re-fetch     : ${force}\n`);

  let updated = 0;
  let skipped = 0;
  let failed  = 0;

  for (let i = 0; i < roms.length; i++) {
    const rom = roms[i];

    if (!rom.raGameId) continue;

    process.stdout.write(`[${i + 1}/${roms.length}] 🎮 ${rom.title} … `);

    // Skip if screenshots already present and not forcing
    if (!force && rom.screenshots && rom.screenshots.length > 0) {
      console.log(`⏭️  already has screenshots`);
      skipped++;
      continue;
    }

    const images = await fetchRaGameImages(rom.raGameId, apiKey, username);

    if (!images) {
      console.log(`❌ Failed to fetch images`);
      failed++;
      continue;
    }

    // Build screenshots list: title screen + in-game (skip empty strings)
    const shots = [images.imageTitle, images.imageIngame].filter(Boolean);
    rom.screenshots = shots;

    // Fill mainImage if missing
    if (!rom.mainImage) {
      rom.mainImage = images.imageBoxArt || images.imageIcon || '';
    }

    console.log(`✅ ${shots.length} screenshot(s)`);
    updated++;

    // Persist after each ROM
    writeCSV(roms, csvPath);

    // Small delay to respect RA API rate limits
    await new Promise(r => setTimeout(r, 300));
  }

  console.log(`\n=== Screenshots Summary ===`);
  console.log(`✅ Updated  : ${updated}`);
  console.log(`⏭️  Skipped  : ${skipped}`);
  console.log(`❌ Failed   : ${failed}`);
  console.log(`📄 Saved to : ${csvPath}`);
}

// ─── Display Helpers ──────────────────────────────────────────────────────────

function printRomSummary(rom: RomRecord, index: number, total: number): void {
  console.log(`\n[${index + 1}/${total}] 🎮 ${rom.title}`);
  console.log(`   Console   : ${rom.console}`);
  if (rom.genre?.length)       console.log(`   Genre     : ${rom.genre.join(', ')}`);
  if (rom.region?.length)      console.log(`   Region    : ${rom.region.join(', ')}`);
  if (rom.releaseDate)         console.log(`   Released  : ${rom.releaseDate}`);
  if (rom.publisher)           console.log(`   Publisher : ${rom.publisher}`);
  if (rom.size)                console.log(`   Size      : ${rom.size}`);
  if (rom.averageRating)       console.log(`   Rating    : ${rom.averageRating} ⭐ (${rom.numberOfReviews} reviews)`);
  if (rom.downloadCount)       console.log(`   Downloads : ${rom.downloadCount}`);
  if (rom.romType)             console.log(`   Type      : ${rom.romType}`);
  if (rom.directDownloadLink)  console.log(`   Direct    : ${rom.directDownloadLink}`);
  else if (rom.downloadLink)   console.log(`   Download  : ${rom.downloadLink}`);
}

function printStats(roms: RomRecord[]): void {
  const withDirect   = roms.filter(r => r.directDownloadLink).length;
  const withDownload = roms.filter(r => r.downloadLink).length;
  const consoles     = [...new Set(roms.map(r => r.console))];
  const genres       = [...new Set(roms.flatMap(r => r.genre ?? []))];
  const romTypes     = [...new Set(roms.map(r => r.romType).filter(Boolean))];

  console.log('\n📊 ─── Statistics ────────────────────────────────────');
  console.log(`   Total ROMs          : ${roms.length}`);
  console.log(`   With direct link    : ${withDirect} (${Math.round(withDirect / roms.length * 100)}%)`);
  console.log(`   With download link  : ${withDownload}`);
  console.log(`   Consoles            : ${consoles.join(', ')}`);
  if (genres.length)   console.log(`   Genres              : ${genres.slice(0, 10).join(', ')}${genres.length > 10 ? ` … (+${genres.length - 10})` : ''}`);
  if (romTypes.length) console.log(`   ROM types           : ${romTypes.join(', ')}`);
  console.log('─────────────────────────────────────────────────────\n');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const argv = process.argv.slice(2);

  if (argv.length === 0 || argv.includes('--help')) {
    console.log('Usage: npx ts-node src/retro-achievement/ra-csv-update.ts <csvPath> [options]');
    console.log('');
    console.log('Options:');
    console.log('  --limit <n>           Show only the first N ROMs');
    console.log('  --console <name>      Filter by console name (e.g. nes, snes, gba)');
    console.log('  --stats               Print statistics summary only');
    console.log('  --add-related         Compute & add relatedRoms column to CSV (saves in place)');
    console.log('  --add-ra-ids          Look up RetroAchievements game IDs via ROM MD5 and save');
    console.log('  --update-screenshots  Fetch screenshots from RA using raGameId and save to CSV');
    console.log('  --downloads <dir>     ROM downloads directory (default: downloads/<console>)');
    console.log('  --force               Re-compute even if column already filled');
    console.log('  --top <n>             Number of related ROMs per entry (default: 4)');
    console.log('  --help                Show this help message');
    console.log('');
    console.log('Examples:');
    console.log('  npx ts-node src/retro-achievement/ra-csv-update.ts output/topnes-split/roms.csv');
    console.log('  npx ts-node src/retro-achievement/ra-csv-update.ts output/topnes-split/roms.csv --stats');
    console.log('  npx ts-node src/retro-achievement/ra-csv-update.ts output/topnes-split/roms.csv --add-related');
    console.log('  npx ts-node src/retro-achievement/ra-csv-update.ts output/topnes-split/roms.csv --add-ra-ids --downloads downloads/nes');
    console.log('  npx ts-node src/retro-achievement/ra-csv-update.ts output/topnes-split/roms.csv --update-screenshots');
    console.log('  npx ts-node src/retro-achievement/ra-csv-update.ts output/topnes-split/roms.csv --update-screenshots --force');
    process.exit(0);
  }

  const csvPath = argv[0];

  // Parse options
  const statsOnly        = argv.includes('--stats');
  const addRelated       = argv.includes('--add-related');
  const addRaIds         = argv.includes('--add-ra-ids');
  const updateScreenshots = argv.includes('--update-screenshots');
  const forceFlag        = argv.includes('--force');
  const limitIndex    = argv.indexOf('--limit');
  const limit         = limitIndex !== -1 ? parseInt(argv[limitIndex + 1], 10) : undefined;
  const consoleIndex  = argv.indexOf('--console');
  const consoleFilter = consoleIndex !== -1 ? argv[consoleIndex + 1].toLowerCase() : undefined;
  const topIndex      = argv.indexOf('--top');
  const topN          = topIndex !== -1 ? parseInt(argv[topIndex + 1], 10) : 4;
  const dlIndex       = argv.indexOf('--downloads');

  // Read CSV
  let roms = parseCSV(csvPath);

  // Infer downloads dir: --downloads flag, or downloads/<console>
  const consoleSlug   = roms[0]?.console?.toLowerCase() ?? 'roms';
  const downloadsDir  = dlIndex !== -1 ? argv[dlIndex + 1] : path.join('downloads', consoleSlug);

  // Filter by console
  if (consoleFilter) {
    roms = roms.filter(r => r.console.toLowerCase() === consoleFilter);
    console.log(`🔎 Filtered to console "${consoleFilter}": ${roms.length} ROMs`);
  }

  // --add-ra-ids
  if (addRaIds) {
    await addRaGameIds(roms, csvPath, downloadsDir, forceFlag);
    return;
  }

  // --update-screenshots
  if (updateScreenshots) {
    await updateScreenshotsFromRA(roms, csvPath, forceFlag);
    return;
  }

  // --add-related: compute & save, then exit
  if (addRelated) {
    addRelatedRomsToCSV(roms, csvPath, forceFlag, topN);

    // Print a few examples so the user can verify
    console.log('\n📋 Sample results:');
    const idMap = new Map(roms.map(r => [r.id, r.title]));
    roms.slice(0, 5).forEach(rom => {
      const relTitles = (rom.relatedRoms ?? '')
        .split(',')
        .filter(Boolean)
        .map(id => idMap.get(parseInt(id)) ?? id)
        .join(' | ');
      console.log(`  🎮 ${rom.title}`);
      console.log(`     → ${relTitles || '(none)'}`);
    });
    return;
  }

  // Always print stats
  printStats(roms);

  if (statsOnly) {
    return;
  }

  // Apply limit
  const displayRoms = limit ? roms.slice(0, limit) : roms;

  // Print each ROM
  for (let i = 0; i < displayRoms.length; i++) {
    printRomSummary(displayRoms[i], i, displayRoms.length);
  }

  if (limit && roms.length > limit) {
    console.log(`\n… and ${roms.length - limit} more ROMs (use --limit to show more)`);
  }
}

main().catch(err => {
  console.error('❌ Error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
