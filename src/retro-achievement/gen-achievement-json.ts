// Generate per-game achievement JSON files from achievements.csv
// Usage:
//   npx ts-node src/retro-achievement/gen-achievement-json.ts [options]
//
// Options:
//   --input  <file>   Path to achievements CSV  (default: output/achievements.csv)
//   --outdir <dir>    Output directory           (default: output/achievements)
//   --game   <id>     Only generate for one gameId (for testing)
//   --force           Overwrite existing JSON files (default: skip existing)
//
// Output:
//   output/achievements/<gameId>.json
//
// JSON structure:
// {
//   "gameId": 6049,
//   "gameTitle": "Super Mario Sunshine",
//   "achievements": [
//     {
//       "id": 395001,
//       "title": "Delfino's Dilemma",
//       "description": "Collect the first Shine Sprite...",
//       "points": 1,
//       "trueRatio": 1,
//       "type": "progression",
//       "author": "timenoe",
//       "badgeUrl": "https://media.retroachievements.org/Badge/446460.png",
//       "numAwarded": 10672,
//       "numAwardedHardcore": 8231,
//       "displayOrder": 1,
//       "memAddr": "..."
//     },
//     ...
//   ]
// }

import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AchievementRow {
  gameId: number;
  gameTitle: string;
  achievementId: number;
  title: string;
  description: string;
  points: number;
  trueRatio: number;
  type: string;
  author: string;
  badgeUrl: string;
  numAwarded: number;
  numAwardedHardcore: number;
  displayOrder: number;
  memAddr: string;
}

interface GameAchievements {
  gameId: number;
  gameTitle: string;
  achievements: Omit<AchievementRow, 'gameId' | 'gameTitle'>[];
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  let inputFile = 'output/achievements.csv';
  let outDir    = 'output/achievements';
  let onlyGame: number | null = null;
  let force = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--input'  && args[i + 1]) inputFile = args[++i];
    else if (args[i] === '--outdir' && args[i + 1]) outDir = args[++i];
    else if (args[i] === '--game'   && args[i + 1]) onlyGame = parseInt(args[++i], 10);
    else if (args[i] === '--force') force = true;
  }

  console.log(`\n=== Generate Achievement JSON Files ===`);
  console.log(`Input CSV : ${inputFile}`);
  console.log(`Output dir: ${outDir}`);
  if (onlyGame) console.log(`Filter    : gameId = ${onlyGame}`);
  if (force)    console.log(`Mode      : force (overwrite existing)`);
  console.log();

  // ── 1. Read CSV ─────────────────────────────────────────────────────────────
  if (!fs.existsSync(inputFile)) {
    console.error(`❌ CSV not found: ${inputFile}`);
    process.exit(1);
  }

  console.log(`Reading ${inputFile}...`);
  const content = fs.readFileSync(inputFile, 'utf-8');
  const rawRows: any[] = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  console.log(`Loaded ${rawRows.length} rows\n`);

  // ── 2. Group rows by gameId ──────────────────────────────────────────────────
  const gameMap = new Map<number, GameAchievements>();

  for (const r of rawRows) {
    const gameId = parseInt(r.gameId, 10);
    if (isNaN(gameId)) continue;
    if (onlyGame !== null && gameId !== onlyGame) continue;

    if (!gameMap.has(gameId)) {
      gameMap.set(gameId, {
        gameId,
        gameTitle: (r.gameTitle || '').trim(),
        achievements: [],
      });
    }

    gameMap.get(gameId)!.achievements.push({
      achievementId:      parseInt(r.achievementId, 10),
      title:              (r.title       || '').trim(),
      description:        (r.description || '').trim(),
      points:             parseInt(r.points,    10) || 0,
      trueRatio:          parseInt(r.trueRatio, 10) || 0,
      type:               (r.type   || '').trim(),
      author:             (r.author || '').trim(),
      badgeUrl:           (r.badgeUrl || '').trim(),
      numAwarded:         parseInt(r.numAwarded,         10) || 0,
      numAwardedHardcore: parseInt(r.numAwardedHardcore, 10) || 0,
      displayOrder:       parseInt(r.displayOrder, 10) || 0,
      memAddr:            (r.memAddr || '').trim(),
    });
  }

  console.log(`Found ${gameMap.size} unique game(s)\n`);

  // ── 3. Ensure output directory exists ──────────────────────────────────────
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
    console.log(`Created output directory: ${outDir}\n`);
  }

  // ── 4. Write one JSON per game ──────────────────────────────────────────────
  let written  = 0;
  let skipped  = 0;
  let total    = gameMap.size;
  let progress = 0;

  for (const [gameId, data] of gameMap) {
    progress++;
    const jsonPath = path.join(outDir, `${gameId}.json`);

    if (!force && fs.existsSync(jsonPath)) {
      skipped++;
      if (skipped % 100 === 0) {
        process.stdout.write(`  ⏭  [${progress}/${total}] Skipped ${skipped} existing files\r`);
      }
      continue;
    }

    // Sort achievements by displayOrder before writing
    data.achievements.sort((a, b) => a.displayOrder - b.displayOrder);

    fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2), 'utf-8');
    written++;

    if (written % 100 === 0 || written <= 5) {
      process.stdout.write(`  ✓ [${progress}/${total}] Written ${written} files...\r`);
    }
  }

  // Clear the progress line
  process.stdout.write('\n');

  // ── 5. Summary ──────────────────────────────────────────────────────────────
  console.log(`\n=== Summary ===`);
  console.log(`  Total games   : ${total}`);
  console.log(`  JSON written  : ${written}`);
  console.log(`  Skipped       : ${skipped} (already existed)`);
  console.log(`  Output dir    : ${outDir}`);
  if (written > 0) {
    // Show a sample
    const sample = [...gameMap.values()][0];
    console.log(`\n  Sample: ${outDir}/${sample.gameId}.json`);
    console.log(`    gameTitle   : ${sample.gameTitle}`);
    console.log(`    achievements: ${sample.achievements.length}`);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
