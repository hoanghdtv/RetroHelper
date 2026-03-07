#!/usr/bin/env ts-node
/**
 * ra-consoles.ts
 *
 * Fetches the full list of gaming consoles from RetroAchievements
 * and writes a CSV file.
 *
 * Usage:
 *   npx ts-node src/retro-achievement/ra-consoles.ts
 *   npx ts-node src/retro-achievement/ra-consoles.ts --output output/ra-consoles.csv
 *   npx ts-node src/retro-achievement/ra-consoles.ts --only-games    # exclude non-game systems
 *
 * Output columns:
 *   id, name, iconUrl, active, isGameSystem
 *
 * Auth: RA_USERNAME + RA_API_KEY from .env (required)
 */

import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

// ─── Config ───────────────────────────────────────────────────────────────────

const RA_API_BASE = 'https://retroachievements.org/API';
const RA_MEDIA    = 'https://media.retroachievements.org';

const http = axios.create({ timeout: 20_000 });

// ─── CLI ──────────────────────────────────────────────────────────────────────

const args      = process.argv.slice(2);
const getArg    = (flag: string) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : undefined; };
const hasFlag   = (flag: string) => args.includes(flag);

const raUsername = process.env.RA_USERNAME || '';
const raApiKey   = process.env.RA_API_KEY   || '';

if (!raUsername || !raApiKey) {
  console.error('Error: RA_USERNAME and RA_API_KEY must be set in .env');
  process.exit(1);
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface RAConsoleRaw {
  ID:           number;
  Name:         string;
  IconURL?:     string;
  Active?:      boolean | number;
  IsGameSystem?: boolean | number;
}

interface ConsoleRow {
  id:           string;
  name:         string;
  iconUrl:      string;
  active:       string;
  isGameSystem: string;
}

// ─── CSV helpers ──────────────────────────────────────────────────────────────

function esc(s: string): string {
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

// ─── Fetch ────────────────────────────────────────────────────────────────────

async function fetchConsoles(retries = 4): Promise<RAConsoleRaw[]> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await http.get(`${RA_API_BASE}/API_GetConsoleIDs.php`, {
        params: { z: raUsername, y: raApiKey },
      });
      const data = res.data;
      if (!Array.isArray(data)) {
        console.error('Unexpected response format:', typeof data);
        return [];
      }
      return data as RAConsoleRaw[];
    } catch (err: any) {
      const status = err?.response?.status;
      if ((status === 429 || status === 503 || !status) && attempt < retries) {
        const wait = (attempt + 1) * 2_000;
        console.warn(`  Rate limited / error (${status ?? err.message}), retrying in ${wait}ms...`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      console.error(`Failed to fetch consoles: ${status ?? err.message}`);
      return [];
    }
  }
  return [];
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const outputArg  = getArg('--output') ?? 'output/ra-consoles.csv';
  const onlyGames  = hasFlag('--only-games');
  const outputPath = path.resolve(outputArg);

  console.log('Fetching console list from RetroAchievements...');

  const consoles = await fetchConsoles();
  if (consoles.length === 0) {
    console.error('No consoles returned.');
    process.exit(1);
  }

  console.log(`  Total consoles received: ${consoles.length}`);

  // Map to rows
  let rows: ConsoleRow[] = consoles.map(c => {
    const iconUrl = c.IconURL
      ? (c.IconURL.startsWith('http') ? c.IconURL : `${RA_MEDIA}${c.IconURL}`)
      : '';

    const active       = c.Active       === undefined ? 'true'  : String(Boolean(c.Active));
    const isGameSystem = c.IsGameSystem === undefined ? 'true'  : String(Boolean(c.IsGameSystem));

    return {
      id:           String(c.ID),
      name:         c.Name ?? '',
      iconUrl,
      active,
      isGameSystem,
    };
  });

  // Optional filter
  if (onlyGames) {
    const before = rows.length;
    rows = rows.filter(r => r.isGameSystem === 'true');
    console.log(`  Filtered to game systems only: ${rows.length} (removed ${before - rows.length})`);
  }

  // Sort by numeric ID
  rows.sort((a, b) => parseInt(a.id) - parseInt(b.id));

  // Write CSV
  const HEADER = 'id,name,iconUrl,active,isGameSystem';
  const csvLines = rows.map(r =>
    [r.id, esc(r.name), esc(r.iconUrl), r.active, r.isGameSystem].join(',')
  );

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, [HEADER, ...csvLines].join('\n') + '\n', 'utf-8');

  console.log(`\nDone: ${rows.length} console(s) → ${outputPath}`);

  // Print a quick preview
  console.log('\nSample (first 10 rows):');
  rows.slice(0, 10).forEach(r =>
    console.log(`  [${r.id.padStart(3)}] ${r.name}`)
  );
  if (rows.length > 10) console.log(`  ... and ${rows.length - 10} more`);
}

main().catch(e => { console.error(e); process.exit(1); });
