import axios, { AxiosInstance } from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RAConsole {
  ID: number;
  Name: string;
}

export interface RAGameBasic {
  ID: number;
  Title: string;
  ConsoleID: number;
  ConsoleName: string;
  ImageIcon: string;
  NumAchievements: number;
  NumLeaderboards: number;
  Points: number;
  DateModified: string;
  ForumTopicID?: number;
}

export interface RAGameExtended extends RAGameBasic {
  NumDistinctPlayersCasual: number;
  NumDistinctPlayersHardcore: number;
  Publisher?: string;
  Developer?: string;
  Genre?: string;
  Released?: string;
}

export interface RAGameHash {
  Name: string;
  MD5: string;
  Labels: string[];
  PatchUrl: string | null;
}

export interface TopGame extends RAGameExtended {
  totalPlayers: number;
  md5?: string[];         // populated only when fetchHashes=true
  directLinks?: string[]; // PatchUrl values when available
}

export interface FetchTopOptions {
  consoleId?: number;    // single console, omit = all consoles
  limit?: number;        // default 100
  concurrency?: number;  // concurrent API calls, default 5
  onlyWithAchievements?: boolean; // default true, skip games with 0 achievements
  fetchHashes?: boolean; // default false — fetch MD5 hashes for top N games
  output?: string;       // path to save JSON
  verbose?: boolean;
}

// ─── RATool class ─────────────────────────────────────────────────────────────

export class RATool {
  private api: AxiosInstance;
  private username: string;
  private apiKey: string;

  constructor(username?: string, apiKey?: string) {
    this.username = username || process.env.RA_USERNAME || '';
    this.apiKey = apiKey || process.env.RA_API_KEY || '';

    if (!this.username || !this.apiKey) {
      throw new Error('RA_USERNAME and RA_API_KEY must be set in .env or passed as arguments');
    }

    this.api = axios.create({
      baseURL: 'https://retroachievements.org/API',
      timeout: 30000,
      headers: {
        'User-Agent': 'RetroHelper/1.0',
      },
    });
  }

  private authParams() {
    return { z: this.username, y: this.apiKey };
  }

  // Delay helper
  private delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ── Fetch ROM hashes for a single game ─────────────────────────────────

  async fetchGameHashes(gameId: number, retries = 3): Promise<RAGameHash[]> {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const res = await this.api.get('/API_GetGameHashes.php', {
          params: { ...this.authParams(), i: gameId },
        });
        const results = res.data?.Results;
        if (!Array.isArray(results)) return [];
        return results as RAGameHash[];
      } catch (err: any) {
        const status = err?.response?.status;
        if ((status === 429 || status === 503) && attempt < retries) {
          await this.delay(attempt * 2000);
        } else if (attempt === retries) {
          return [];
        }
      }
    }
    return [];
  }

  // ── Fetch console list ───────────────────────────────────────────────────

  async fetchConsoleList(): Promise<RAConsole[]> {
    const res = await this.api.get('/API_GetConsoleIDs.php', {
      params: this.authParams(),
    });
    return res.data as RAConsole[];
  }

  // ── Fetch basic game list for a console ─────────────────────────────────

  async fetchGameList(consoleId: number, onlyWithAchievements = true): Promise<RAGameBasic[]> {
    const res = await this.api.get('/API_GetGameList.php', {
      params: {
        ...this.authParams(),
        i: consoleId,
        f: onlyWithAchievements ? 1 : 0, // f=1 means only games with achievements
      },
    });
    const data = res.data;
    if (!Array.isArray(data)) return [];
    return data as RAGameBasic[];
  }

  // ── Fetch extended info for a single game (includes player counts) ───────

  async fetchGameExtended(gameId: number, retries = 3): Promise<RAGameExtended | null> {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const res = await this.api.get('/API_GetGameExtended.php', {
          params: {
            ...this.authParams(),
            i: gameId,
          },
        });
        const d = res.data;
        // API returns empty object {} when game not found
        if (!d || !d.ID) return null;
        return {
          ID: d.ID,
          Title: d.Title,
          ConsoleID: d.ConsoleID,
          ConsoleName: d.ConsoleName,
          ImageIcon: d.ImageIcon,
          NumAchievements: d.NumAchievements || 0,
          NumLeaderboards: d.NumLeaderboards || 0,
          Points: d.Points || 0,
          DateModified: d.DateModified,
          ForumTopicID: d.ForumTopicID,
          NumDistinctPlayersCasual: d.NumDistinctPlayersCasual || 0,
          NumDistinctPlayersHardcore: d.NumDistinctPlayersHardcore || 0,
          Publisher: d.Publisher,
          Developer: d.Developer,
          Genre: d.Genre,
          Released: d.Released,
        };
      } catch (err: any) {
        const status = err?.response?.status;
        if (status === 429 || status === 503) {
          // Rate limited — wait and retry
          const wait = attempt * 2000;
          await this.delay(wait);
        } else if (attempt === retries) {
          return null;
        }
      }
    }
    return null;
  }

  // ── Run N tasks concurrently with a concurrency limit ───────────────────

  private async runConcurrent<T>(
    tasks: (() => Promise<T>)[],
    concurrency: number,
    onProgress?: (done: number, total: number) => void
  ): Promise<T[]> {
    const results: T[] = new Array(tasks.length);
    let index = 0;
    let done = 0;

    async function worker() {
      while (index < tasks.length) {
        const i = index++;
        results[i] = await tasks[i]();
        done++;
        onProgress?.(done, tasks.length);
        // Small delay between each request to avoid rate limiting
        await new Promise(r => setTimeout(r, 50));
      }
    }

    const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker());
    await Promise.all(workers);
    return results;
  }

  // ── Main: fetch top N games by player count ──────────────────────────────

  async fetchTopGamesByPlayers(options: FetchTopOptions = {}): Promise<TopGame[]> {
    const {
      consoleId,
      limit = 100,
      concurrency = 5,
      onlyWithAchievements = true,
      fetchHashes = false,
      verbose = true,
    } = options;

    // Step 1: collect all basic game entries
    let allBasicGames: RAGameBasic[] = [];

    if (consoleId !== undefined) {
      if (verbose) console.log(`Fetching game list for console ${consoleId}...`);
      const games = await this.fetchGameList(consoleId, onlyWithAchievements);
      allBasicGames = games;
      if (verbose) console.log(`  Found ${games.length} games`);
    } else {
      if (verbose) console.log('Fetching console list...');
      const consoles = await this.fetchConsoleList();
      // Only real game consoles (skip misc/hubs — typically ID > 100 are hubs)
      const gameConsoles = consoles.filter(c => c.ID <= 100);
      if (verbose) console.log(`  Found ${gameConsoles.length} consoles`);

      for (const con of gameConsoles) {
        if (verbose) process.stdout.write(`  Fetching games for ${con.Name} (ID:${con.ID})... `);
        try {
          const games = await this.fetchGameList(con.ID, onlyWithAchievements);
          allBasicGames.push(...games);
          if (verbose) console.log(`${games.length} games`);
        } catch (e) {
          if (verbose) console.log(`failed: ${e}`);
        }
        await this.delay(150);
      }
    }

    if (allBasicGames.length === 0) {
      console.log('No games found.');
      return [];
    }

    if (verbose) console.log(`\nTotal games to query: ${allBasicGames.length}`);
    if (verbose) console.log(`Fetching player counts (concurrency=${concurrency})...\n`);

    // Step 2: fetch extended info for each game to get player counts
    let lastPct = -1;
    const tasks = allBasicGames.map(game => async (): Promise<RAGameExtended | null> => {
      const ext = await this.fetchGameExtended(game.ID);
      return ext;
    });

    const extResults = await this.runConcurrent(tasks, concurrency, (done, total) => {
      if (!verbose) return;
      const pct = Math.floor((done / total) * 100);
      if (pct !== lastPct && pct % 5 === 0) {
        lastPct = pct;
        process.stdout.write(`\r  Progress: ${done}/${total} (${pct}%)   `);
      }
    });

    if (verbose) console.log('\n');

    // Step 3: build TopGame list, sort by totalPlayers desc
    const topGames: TopGame[] = extResults
      .filter((g): g is RAGameExtended => g !== null)
      // Exclude subset/bonus sets (e.g. "Game [Subset - Bonus]") - not standalone games
      .filter(g => !g.Title?.includes('[Subset'))
      .map(g => ({
        ...g,
        // NumDistinctPlayersCasual is the superset (all players); hardcore is a subset
        totalPlayers: g.NumDistinctPlayersCasual || 0,
      }))
      .sort((a, b) => b.totalPlayers - a.totalPlayers)
      .slice(0, limit);

    // Step 4 (optional): fetch ROM hashes only for the final top N games
    if (fetchHashes) {
      if (verbose) console.log(`Fetching ROM hashes for top ${topGames.length} games...\n`);
      let hashPct = -1;
      const hashTasks = topGames.map(game => async () => {
        const hashes = await this.fetchGameHashes(game.ID);
        game.md5 = hashes.map(h => h.MD5);
        game.directLinks = hashes.map(h => h.PatchUrl).filter((u): u is string => !!u);
      });
      await this.runConcurrent(hashTasks, concurrency, (done, total) => {
        if (!verbose) return;
        const pct = Math.floor((done / total) * 100);
        if (pct !== hashPct && pct % 10 === 0) {
          hashPct = pct;
          process.stdout.write(`\r  Hashes: ${done}/${total} (${pct}%)   `);
        }
      });
      if (verbose) console.log('\n');
    }

    return topGames;
  }

  // ── Save results ─────────────────────────────────────────────────────────

  saveToJson(games: TopGame[], outputPath: string) {
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(games, null, 2), 'utf-8');
    console.log(`Saved ${games.length} games to ${outputPath}`);
  }

  saveToCSV(games: TopGame[], outputPath: string) {
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const hasHashes = games.some(g => g.md5 !== undefined);

    const header = [
      'rank', 'id', 'title', 'consoleName', 'consoleId',
      'totalPlayers', 'casualPlayers', 'hardcorePlayers',
      'numAchievements', 'points', 'genre', 'developer', 'publisher', 'released',
      ...(hasHashes ? ['md5', 'directLink'] : []),
    ].join(',');

    const rows = games.map((g, i) => [
      i + 1,
      g.ID,
      `"${(g.Title || '').replace(/"/g, '""')}"`,
      `"${(g.ConsoleName || '').replace(/"/g, '""')}"`,
      g.ConsoleID,
      g.totalPlayers,
      g.NumDistinctPlayersCasual,
      g.NumDistinctPlayersHardcore,
      g.NumAchievements,
      g.Points,
      `"${(g.Genre || '').replace(/"/g, '""')}"`,
      `"${(g.Developer || '').replace(/"/g, '""')}"`,
      `"${(g.Publisher || '').replace(/"/g, '""')}"`,
      `"${(g.Released || '').replace(/"/g, '""')}"`,
      ...(hasHashes ? [
        `"${(g.md5 || []).join('|')}"`,
        `"${(g.directLinks || []).join('|')}"`,
      ] : []),
    ].join(','));

    fs.writeFileSync(outputPath, [header, ...rows].join('\n'), 'utf-8');
    console.log(`Saved ${games.length} games to ${outputPath}`);
  }

  // ── Print ASCII table ─────────────────────────────────────────────────────

  printTable(games: TopGame[]) {
    console.log(
      '\n' +
        ['Rank', 'ID', 'Title'.padEnd(40), 'Console'.padEnd(12), 'Players', 'Casual', 'Hardcore', 'Achiev', 'Points']
          .join(' | ')
    );
    console.log('-'.repeat(130));

    games.forEach((g, i) => {
      const title = (g.Title || '').slice(0, 40).padEnd(40);
      const console_ = (g.ConsoleName || '').slice(0, 12).padEnd(12);
      console.log(
        [
          String(i + 1).padStart(4),
          String(g.ID).padStart(6),
          title,
          console_,
          String(g.totalPlayers).padStart(7),
          String(g.NumDistinctPlayersCasual).padStart(6),
          String(g.NumDistinctPlayersHardcore).padStart(8),
          String(g.NumAchievements).padStart(6),
          String(g.Points).padStart(6),
        ].join(' | ')
      );
    });
  }
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  const getArg = (flag: string) => {
    const i = args.indexOf(flag);
    return i !== -1 && i + 1 < args.length ? args[i + 1] : undefined;
  };
  const hasFlag = (flag: string) => args.includes(flag);

  const consoleId = getArg('--console-id') ? Number(getArg('--console-id')) : undefined;
  const limit = Number(getArg('--limit') || getArg('--top') || '100');
  const concurrency = Number(getArg('--concurrency') || '5');
  const output = getArg('--output');
  const format = getArg('--format') || 'table'; // table | json | csv
  const noAch = hasFlag('--include-all'); // include games without achievements
  const withHashes = hasFlag('--hashes');
  const quiet = hasFlag('--quiet');

  if (hasFlag('--help') || hasFlag('-h')) {
    console.log(`
RATool - Fetch top games by player count from RetroAchievements API

Usage:
  npx ts-node src/retro-achievement/RATool.ts [options]

Options:
  --console-id N     Console ID to fetch (omit to search all consoles)
  --top N            Number of top games to return (default: 100)
  --limit N          Alias for --top
  --concurrency N    Concurrent API calls (default: 5)
  --format <type>    Output format: table | json | csv (default: table)
  --output <path>    Save to file (format inferred from extension if not set)
  --include-all      Include games without achievements (default: only with achievements)
  --hashes           Also fetch MD5 hashes and direct patch links per game
  --quiet            Suppress progress output
  --help             Show this help

Examples:
  npx ts-node src/retro-achievement/RATool.ts --console-id 7 --top 20
  npx ts-node src/retro-achievement/RATool.ts --console-id 1 --format json --output output/nes-top100.json
  npx ts-node src/retro-achievement/RATool.ts --all-consoles --top 100 --output output/top100.csv
`);
    process.exit(0);
  }

  const tool = new RATool();
  const verbose = !quiet;

  if (verbose) {
    console.log('═'.repeat(60));
    console.log('  RATool — Top Games by Player Count');
    console.log('═'.repeat(60));
    if (consoleId !== undefined) {
      console.log(`  Console ID : ${consoleId}`);
    } else {
      console.log('  Console    : ALL');
    }
    console.log(`  Top        : ${limit}`);
    console.log(`  Concurrency: ${concurrency}`);
    console.log('═'.repeat(60) + '\n');
  }

  const games = await tool.fetchTopGamesByPlayers({
    consoleId,
    limit,
    concurrency,
    onlyWithAchievements: !noAch,
    fetchHashes: withHashes,
    verbose,
  });

  if (games.length === 0) {
    console.log('No results.');
    process.exit(0);
  }

  // Output
  const resolvedFormat =
    format !== 'table'
      ? format
      : output?.endsWith('.json')
        ? 'json'
        : output?.endsWith('.csv')
          ? 'csv'
          : 'table';

  if (resolvedFormat === 'json') {
    const dest = output || `output/top${limit}-games.json`;
    tool.saveToJson(games, dest);
  } else if (resolvedFormat === 'csv') {
    const dest = output || `output/top${limit}-games.csv`;
    tool.saveToCSV(games, dest);
  } else {
    tool.printTable(games);
  }

  if (output && resolvedFormat === 'table') {
    // Also save JSON alongside table display
    tool.saveToJson(games, output);
  }

  console.log(`\nDone. Top ${games.length} games fetched.`);
}

main().catch(err => {
  console.error('Error:', err.message || err);
  process.exit(1);
});
