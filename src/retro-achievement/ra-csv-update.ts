// Tool to read ROM information from CSV file
// Usage: npx ts-node src/retro-achievement/ra-csv-update.ts <csvPath> [options]
// Example:
//   npx ts-node src/retro-achievement/ra-csv-update.ts output/topnes-split/roms.csv
//   npx ts-node src/retro-achievement/ra-csv-update.ts output/topnes-split/roms.csv --limit 10
//   npx ts-node src/retro-achievement/ra-csv-update.ts output/topnes-split/roms.csv --console nes

import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';

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
  }));

  const csvContent = stringify(records, {
    header: true,
    columns: [
      'id', 'title', 'url', 'console', 'description', 'mainImage',
      'screenshots', 'genre', 'releaseDate', 'publisher', 'region',
      'size', 'downloadCount', 'numberOfReviews', 'averageRating',
      'downloadLink', 'directDownloadLink', 'romType', 'relatedRoms',
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
    console.log('  --limit <n>        Show only the first N ROMs');
    console.log('  --console <name>   Filter by console name (e.g. nes, snes, gba)');
    console.log('  --stats            Print statistics summary only');
    console.log('  --add-related      Compute & add relatedRoms column to CSV (saves in place)');
    console.log('  --force            Re-compute relatedRoms even if already filled');
    console.log('  --top <n>          Number of related ROMs per entry (default: 4)');
    console.log('  --help             Show this help message');
    console.log('');
    console.log('Examples:');
    console.log('  npx ts-node src/retro-achievement/ra-csv-update.ts output/topnes-split/roms.csv');
    console.log('  npx ts-node src/retro-achievement/ra-csv-update.ts output/topnes-split/roms.csv --limit 10');
    console.log('  npx ts-node src/retro-achievement/ra-csv-update.ts output/topnes-split/roms.csv --stats');
    console.log('  npx ts-node src/retro-achievement/ra-csv-update.ts output/topnes-split/roms.csv --add-related');
    console.log('  npx ts-node src/retro-achievement/ra-csv-update.ts output/topnes-split/roms.csv --add-related --force');
    process.exit(0);
  }

  const csvPath = argv[0];

  // Parse options
  const statsOnly     = argv.includes('--stats');
  const addRelated    = argv.includes('--add-related');
  const forceRelated  = argv.includes('--force');
  const limitIndex    = argv.indexOf('--limit');
  const limit         = limitIndex !== -1 ? parseInt(argv[limitIndex + 1], 10) : undefined;
  const consoleIndex  = argv.indexOf('--console');
  const consoleFilter = consoleIndex !== -1 ? argv[consoleIndex + 1].toLowerCase() : undefined;
  const topIndex      = argv.indexOf('--top');
  const topN          = topIndex !== -1 ? parseInt(argv[topIndex + 1], 10) : 4;

  // Read CSV
  let roms = parseCSV(csvPath);

  // Filter by console
  if (consoleFilter) {
    roms = roms.filter(r => r.console.toLowerCase() === consoleFilter);
    console.log(`🔎 Filtered to console "${consoleFilter}": ${roms.length} ROMs`);
  }

  // --add-related: compute & save, then exit
  if (addRelated) {
    addRelatedRomsToCSV(roms, csvPath, forceRelated, topN);

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
