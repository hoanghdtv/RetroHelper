import axios, { AxiosInstance } from 'axios';
import { GameInfo, ConsoleInfo, GameExtended, RetroAchievementsConfig, GameWithAchievements } from './types';

export class RetroAchievementsAPI {
  private api: AxiosInstance;
  private username: string;
  private apiKey: string;

  constructor(config: RetroAchievementsConfig) {
    this.username = config.username;
    this.apiKey = config.apiKey;

    this.api = axios.create({
      baseURL: 'https://retroachievements.org/API',
      timeout: 30000,
    });
  }

  /**
   * Get list of all consoles
   */
  async getConsoleList(): Promise<ConsoleInfo[]> {
    try {
      const response = await this.api.get('/API_GetConsoleIDs.php', {
        params: {
          z: this.username,
          y: this.apiKey,
        },
      });
      return response.data;
    } catch (error) {
      throw new Error(`Failed to fetch console list: ${error}`);
    }
  }

  /**
   * Get all games for a specific console
   */
  async getGameList(consoleId: number): Promise<GameInfo[]> {
    try {
      const response = await this.api.get('/API_GetGameList.php', {
        params: {
          z: this.username,
          y: this.apiKey,
          i: consoleId,
        },
      });
      return response.data;
    } catch (error) {
      throw new Error(`Failed to fetch games for console ${consoleId}: ${error}`);
    }
  }

  /**
   * Get extended game info including achievements
   */
  async getGameExtended(gameId: number): Promise<GameExtended> {
    try {
      const response = await this.api.get('/API_GetGameExtended.php', {
        params: {
          z: this.username,
          y: this.apiKey,
          i: gameId,
        },
      });
      return response.data;
    } catch (error) {
      throw new Error(`Failed to fetch extended info for game ${gameId}: ${error}`);
    }
  }

  /**
   * Get game info with achievements using API_GetGame.php
   */
  async getGame(gameId: number): Promise<GameWithAchievements> {
    try {
      const response = await this.api.get('/API_GetGame.php', {
        params: {
          z: this.username,
          y: this.apiKey,
          i: gameId,
        },
      });
      return response.data;
    } catch (error) {
      throw new Error(`Failed to fetch game info for game ${gameId}: ${error}`);
    }
  }

  /**
   * Get all games from all consoles
   */
  async getAllGames(): Promise<Map<string, GameInfo[]>> {
    const consoles = await this.getConsoleList();
    const allGames = new Map<string, GameInfo[]>();

    console.log(`Found ${consoles.length} consoles\n`);

    for (const consoleInfo of consoles) {
      console.log(`Fetching games for ${consoleInfo.Name} (ID: ${consoleInfo.ID})...`);
      try {
        const games = await this.getGameList(consoleInfo.ID);
        if (games && games.length > 0) {
          allGames.set(consoleInfo.Name, [games[0]]);
          console.log(`  ✓ Found ${games.length} games`);
        } else {
          console.log(`  - No games found`);
        }
        // Rate limiting: wait a bit between requests
        await this.sleep(500);
      } catch (error) {
        console.error(`  ✗ Error fetching games: ${error}`);
      }
      return allGames;
    }

    return allGames;
  }

  /**
   * Get all games with detailed achievement information
   */
  async getAllGamesWithAchievements(
    consoleIds?: number[],
    maxGamesPerConsole?: number
  ): Promise<Map<string, GameExtended[]>> {
    const consoles = await this.getConsoleList();
    const allGamesWithAchievements = new Map<string, GameExtended[]>();

    // Filter consoles if specific IDs are provided
    const consolesToFetch = consoleIds
      ? consoles.filter((c) => consoleIds.includes(c.ID))
      : consoles;

    console.log(`Found ${consolesToFetch.length} consoles to process\n`);

    for (const consoleInfo of consolesToFetch) {
      console.log(`\n=== ${consoleInfo.Name} (ID: ${consoleInfo.ID}) ===`);
      try {
        const games = await this.getGameList(consoleInfo.ID);
        if (!games || games.length === 0) {
          console.log(`  - No games found`);
          continue;
        }

        console.log(`  Found ${games.length} games, fetching achievements...`);
        const gamesWithAchievements: GameExtended[] = [];

        // Limit number of games if specified
        const gamesToFetch = maxGamesPerConsole
          ? games.slice(0, maxGamesPerConsole)
          : games;

        let processed = 0;
        for (const game of gamesToFetch) {
          try {
            // Use getGameExtended to get full achievement data including MemAddr
            const gameDetails = await this.getGameExtended(game.ID);
            gamesWithAchievements.push(gameDetails);
            processed++;

            // Show progress every 10 games
            if (processed % 10 === 0) {
              console.log(`    Progress: ${processed}/${gamesToFetch.length} games`);
            }

            // Rate limiting: wait between requests
            await this.sleep(300);
          } catch (error) {
            console.error(`    ✗ Error fetching game ${game.ID} (${game.Title}): ${error}`);
            // Continue with next game even if one fails
          }
        }

        if (gamesWithAchievements.length > 0) {
          allGamesWithAchievements.set(consoleInfo.Name, gamesWithAchievements);
          console.log(`  ✓ Successfully fetched ${gamesWithAchievements.length} games with achievements`);
        }

        // Rate limiting between consoles
        await this.sleep(500);
      } catch (error) {
        console.error(`  ✗ Error processing console: ${error}`);
      }
    }

    return allGamesWithAchievements;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
