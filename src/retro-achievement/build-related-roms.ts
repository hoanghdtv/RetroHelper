#!/usr/bin/env ts-node
/**
 * build-related-roms.ts
 *
 * Reads all base CSV files (no "-descriptions" suffix) from the output folder
 * to get genre / consoleName / totalPlayers, then picks the 4 most-related
 * games for each title using a weighted similarity score:
 *
 *   score = 0.60 × genre_jaccard
 *         + 0.20 × same_console   (1 or 0)
 *         + 0.20 × players_proximity
 *
 * genre_jaccard    = |genres_a ∩ genres_b| / |genres_a ∪ genres_b|
 * players_proximity = 1 − |log(players_a) − log(players_b)| / log_range
 *                     (uses log scale so 1000 vs 5000 ≈ 50000 vs 250000)
 *
 * Output: output/related-roms.csv
 *   id,related
 *   1446,"1995,11240,..."
 */

import * as fs from 'fs';
import * as path from 'path';

// ─── CSV helpers ─────────────────────────────────────────────────────────────

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

function parseCSV(content: string): Record<string, string>[] {
  const lines = content.split('\n').map(l => l.trimEnd()).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim());
  return lines.slice(1).map(line => {
    const cols = parseCSVLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = (cols[i] ?? '').trim(); });
    return row;
  });
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface Game {
  id: string;
  title: string;
  console: string;
  totalPlayers: number;
  genres: Set<string>;  // normalised genre tokens
}

// ─── Similarity helpers ───────────────────────────────────────────────────────

/** Jaccard similarity between two sets */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  a.forEach(g => { if (b.has(g)) inter++; });
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** Parse genre string into normalised tokens */
function parseGenres(raw: string): Set<string> {
  return new Set(
    raw.split(',')
       .map(g => g.trim().toLowerCase())
       .filter(Boolean)
  );
}

// ─── Main ────────────────────────────────────────────────────────────────────

const OUTPUT_DIR = path.resolve(__dirname, '../../output');
const OUT_FILE   = path.join(OUTPUT_DIR, 'related-roms.csv');
const RELATED_COUNT = 4;

// Load all base CSVs (exclude *-descriptions.csv and split sub-folders)
const allFiles = fs.readdirSync(OUTPUT_DIR);
const baseFiles = allFiles
  .filter(f =>
    f.endsWith('.csv') &&
    !f.includes('-descriptions') &&
    !f.includes('-split') &&
    f !== 'related-roms.csv'
  )
  .sort();

console.log(`Found ${baseFiles.length} base CSV files:`);

const games: Game[] = [];
const seen = new Set<string>();

for (const file of baseFiles) {
  const rows = parseCSV(fs.readFileSync(path.join(OUTPUT_DIR, file), 'utf-8'));
  let added = 0;
  for (const row of rows) {
    const id = row['id']?.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    games.push({
      id,
      title:        row['title'] ?? '',
      console:      (row['consoleName'] ?? '').trim().toLowerCase(),
      totalPlayers: Math.max(1, parseInt(row['totalPlayers'] ?? '1', 10)),
      genres:       parseGenres(row['genre'] ?? ''),
    });
    added++;
  }
  console.log(`  ${file}: ${added} games`);
}

console.log(`\nTotal unique games: ${games.length}`);
if (games.length === 0) { console.error('No games found — exiting.'); process.exit(1); }

// Pre-compute log(totalPlayers) range for proximity normalisation
const logPlayers = games.map(g => Math.log(g.totalPlayers));
const logMin = Math.min(...logPlayers);
const logMax = Math.max(...logPlayers);
const logRange = logMax - logMin || 1;

const logOf = new Map<string, number>();
games.forEach(g => logOf.set(g.id, Math.log(g.totalPlayers)));

// Build related list
const csvLines: string[] = ['id,related'];

for (const game of games) {
  const logA = logOf.get(game.id)!;

  const scored = games
    .filter(g => g.id !== game.id)
    .map(g => {
      const genreScore   = jaccard(game.genres, g.genres);                   // 0..1
      const consoleScore = game.console === g.console ? 1 : 0;              // 0 or 1
      const logB         = logOf.get(g.id)!;
      const playersScore = 1 - Math.abs(logA - logB) / logRange;            // 0..1

      const score = 0.60 * genreScore
                  + 0.20 * consoleScore
                  + 0.20 * playersScore;

      return { id: g.id, score };
    })
    .sort((a, b) => b.score - a.score || Number(a.id) - Number(b.id));

  const related = scored.slice(0, RELATED_COUNT).map(g => g.id).join(',');
  csvLines.push(`${game.id},"${related}"`);
}

fs.writeFileSync(OUT_FILE, csvLines.join('\n') + '\n', 'utf-8');
console.log(`Written ${csvLines.length - 1} rows → ${OUT_FILE}`);

// ─── Spot-check a few results ─────────────────────────────────────────────────
console.log('\nSpot-check (first 5 games):');
const gameMap = new Map<string, Game>(games.map(g => [g.id, g]));
csvLines.slice(1, 6).forEach(line => {
  const [rawId, rawRelated] = line.split(',', 2);
  const id = rawId.trim();
  const relIds = rawRelated.replace(/"/g, '').split(',');
  const g = gameMap.get(id)!;
  console.log(`  [${g.console}] ${g.title} (${g.totalPlayers} players, genres: ${[...g.genres].join('/')})`);
  relIds.forEach(rid => {
    const r = gameMap.get(rid);
    if (r) console.log(`    → [${r.console}] ${r.title} (${r.totalPlayers} players, genres: ${[...r.genres].join('/')})`);
  });
});
