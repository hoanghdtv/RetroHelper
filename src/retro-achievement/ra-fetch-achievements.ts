#!/usr/bin/env ts-node
/**
 * ra-fetch-achievements.ts
 *
 * Fetches the full achievement list for one or more games from RetroAchievements
 * and writes a CSV file.
 *
 * Usage:
 *   npx ts-node src/retro-achievement/ra-fetch-achievements.ts --id 1446
 *   npx ts-node src/retro-achievement/ra-fetch-achievements.ts --id 1446,1995,3
 *   npx ts-node src/retro-achievement/ra-fetch-achievements.ts --ids-file output/nes-top200.csv
 *   npx ts-node src/retro-achievement/ra-fetch-achievements.ts --ids-file output/nes-top200.csv --output output/nes-achievements.csv
 *
 * Output columns:
 *   gameId, gameTitle, achievementId, title, description, points, trueRatio,
 *   type, author, badgeUrl, numAwarded, numAwardedHardcore, displayOrder
 *
 * Auth: RA_USERNAME + RA_API_KEY from .env (required)
 */

import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

const RA_API  = 'https://retroachievements.org/API/API_GetGameExtended.php';
const RA_BASE = 'https://media.retroachievements.org';

const http = axios.create({ timeout: 20_000 });

// ─── CLI helpers ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
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

interface Achievement {
  ID: number;
  NumAwarded: number;
  NumAwardedHardcore: number;
  Title: string;
  Description: string;
  Points: number;
  TrueRatio: number;
  Author: string;
  DateModified: string;
  DateCreated: string;
  BadgeName: string;
  DisplayOrder: number;
  type?: string;  // 'win_condition' | 'progression' | 'missable' | '' | null
  MemAddr?: string;
}

interface GameExtended {
  ID: number;
  Title: string;
  Achievements: Record<string, Achievement> | null;
}

interface AchievementRow {
  gameId: string;
  gameTitle: string;
  achievementId: string;
  title: string;
  description: string;
  points: string;
  trueRatio: string;
  type: string;
  author: string;
  badgeUrl: string;
  numAwarded: string;
  numAwardedHardcore: string;
  displayOrder: string;
  memAddr: string;
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

function readIdsFromCSV(filePath: string): string[] {
  const lines = fs.readFileSync(filePath, 'utf-8')
    .split('\n').map(l => l.trimEnd()).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim());
  const idCol = headers.indexOf('id');
  if (idCol === -1) {
    console.error(`No "id" column found in ${filePath}`);
    process.exit(1);
  }
  return lines.slice(1).map(l => parseCSVLine(l)[idCol]?.trim()).filter(Boolean);
}

// ─── Fetch single game ────────────────────────────────────────────────────────

async function fetchGameAchievements(gameId: string, retries = 4): Promise<AchievementRow[]> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await http.get<GameExtended>(RA_API, {
        params: { z: raUsername, y: raApiKey, i: gameId },
      });
      const d = res.data;
      if (!d || !d.ID) {
        if (attempt < retries) {
          await new Promise(r => setTimeout(r, (attempt + 1) * 1500));
          continue;
        }
        console.warn(`  [${gameId}] Empty response — skipping`);
        return [];
      }

      const achievements = d.Achievements;
      if (!achievements || Object.keys(achievements).length === 0) {
        console.log(`  [${gameId}] ${d.Title} — no achievements`);
        return [];
      }

      const rows: AchievementRow[] = Object.values(achievements)
        .sort((a, b) => (a.DisplayOrder ?? 0) - (b.DisplayOrder ?? 0))
        .map(a => ({
          gameId,
          gameTitle:          d.Title,
          achievementId:      String(a.ID),
          title:              a.Title ?? '',
          description:        a.Description ?? '',
          points:             String(a.Points ?? 0),
          trueRatio:          String(a.TrueRatio ?? 0),
          type:               a.type ?? '',
          author:             a.Author ?? '',
          badgeUrl:           a.BadgeName
                                ? `${RA_BASE}/Badge/${a.BadgeName}.png`
                                : '',
          numAwarded:         String(a.NumAwarded ?? 0),
          numAwardedHardcore: String(a.NumAwardedHardcore ?? 0),
          displayOrder:       String(a.DisplayOrder ?? 0),
          memAddr:            a.MemAddr ?? '',
        }));

      console.log(`  [${gameId}] ${d.Title} — ${rows.length} achievements`);
      return rows;

    } catch (err: any) {
      const status = err?.response?.status;
      if ((status === 429 || status === 503 || !status) && attempt < retries) {
        await new Promise(r => setTimeout(r, (attempt + 1) * 2000));
        continue;
      }
      console.warn(`  [${gameId}] Error ${status ?? err.message} — skipping`);
      return [];
    }
  }
  return [];
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // Collect game IDs
  let gameIds: string[] = [];

  const idArg      = getArg('--id');
  const idsFileArg = getArg('--ids-file');

  if (idArg) {
    gameIds = idArg.split(',').map(s => s.trim()).filter(Boolean);
  } else if (idsFileArg) {
    gameIds = readIdsFromCSV(path.resolve(idsFileArg));
  } else {
    console.error('Usage:\n  --id 1446[,1995,...]            single or comma-separated IDs\n  --ids-file output/nes-top200.csv read IDs from CSV');
    process.exit(1);
  }

  if (gameIds.length === 0) {
    console.error('No game IDs found.');
    process.exit(1);
  }

  // Determine output path
  let outputArg = getArg('--output');
  if (!outputArg) {
    if (idsFileArg) {
      const base = path.basename(idsFileArg, '.csv');
      outputArg = path.join(path.dirname(idsFileArg), `${base}-achievements.csv`);
    } else {
      outputArg = path.join(
        path.resolve(__dirname, '../../output'),
        `achievements-${gameIds.join('-').slice(0, 40)}.csv`
      );
    }
  }
  outputArg = path.resolve(outputArg);

  const concurrency = parseInt(getArg('--concurrency') ?? '5', 10);

  console.log(`Fetching achievements for ${gameIds.length} game(s)`);
  console.log(`  Concurrency : ${concurrency}`);
  console.log(`  Output      : ${outputArg}`);

  // Fetch with limited concurrency
  const allRows: AchievementRow[] = [];

  for (let i = 0; i < gameIds.length; i += concurrency) {
    const chunk = gameIds.slice(i, i + concurrency);
    const results = await Promise.all(
      chunk.map((id, idx) =>
        new Promise<AchievementRow[]>(async resolve => {
          if (idx > 0) await new Promise(r => setTimeout(r, idx * 100));
          resolve(await fetchGameAchievements(id));
        })
      )
    );
    results.forEach(rows => allRows.push(...rows));
  }

  if (allRows.length === 0) {
    console.log('No achievements fetched.');
    process.exit(0);
  }

  // Write CSV
  const HEADER = 'gameId,gameTitle,achievementId,title,description,points,trueRatio,type,author,badgeUrl,numAwarded,numAwardedHardcore,displayOrder,memAddr';
  const csvRows = allRows.map(r =>
    [
      r.gameId,
      esc(r.gameTitle),
      r.achievementId,
      esc(r.title),
      esc(r.description),
      r.points,
      r.trueRatio,
      esc(r.type),
      esc(r.author),
      esc(r.badgeUrl),
      r.numAwarded,
      r.numAwardedHardcore,
      r.displayOrder,
      esc(r.memAddr),
    ].join(',')
  );

  fs.mkdirSync(path.dirname(outputArg), { recursive: true });
  fs.writeFileSync(outputArg, [HEADER, ...csvRows].join('\n') + '\n', 'utf-8');

  console.log(`\nDone: ${allRows.length} achievements across ${gameIds.length} game(s) → ${outputArg}`);
}

main().catch(e => { console.error(e); process.exit(1); });
