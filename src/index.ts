import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { RetroAchievementsAPI } from './retroachievements';

// Load environment variables
dotenv.config();

// Configuration options
const FETCH_WITH_ACHIEVEMENTS = process.env.FETCH_ACHIEVEMENTS === 'true';
const SPECIFIC_CONSOLE_IDS = process.env.CONSOLE_IDS
  ? process.env.CONSOLE_IDS.split(',').map(id => parseInt(id.trim()))
  : undefined;
const MAX_GAMES_PER_CONSOLE = process.env.MAX_GAMES
  ? parseInt(process.env.MAX_GAMES)
  : undefined;

async function main() {
  console.log('=== RetroAchievements ROM Database Fetcher ===\n');

  // Check for API credentials
  const username = process.env.RA_USERNAME;
  const apiKey = process.env.RA_API_KEY;

  if (!username || !apiKey) {
    console.error('Error: Missing API credentials!');
    console.error('Please create a .env file with RA_USERNAME and RA_API_KEY');
    console.error('You can get your API key from: https://retroachievements.org/controlpanel.php');
    process.exit(1);
  }

  // Initialize API client
  const raAPI = new RetroAchievementsAPI({ username, apiKey });

  try {
    if (FETCH_WITH_ACHIEVEMENTS) {
      console.log('Mode: Fetching games WITH detailed achievements\n');
      if (SPECIFIC_CONSOLE_IDS) {
        console.log(`Console IDs: ${SPECIFIC_CONSOLE_IDS.join(', ')}`);
      }
      if (MAX_GAMES_PER_CONSOLE) {
        console.log(`Max games per console: ${MAX_GAMES_PER_CONSOLE}`);
      }
      console.log('');

      // Fetch games with achievements
      const allGamesWithAchievements = await raAPI.getAllGamesWithAchievements(
        SPECIFIC_CONSOLE_IDS,
        MAX_GAMES_PER_CONSOLE
      );

      // Convert Map to object for JSON serialization
      const gamesObject: Record<string, any[]> = {};
      let totalGames = 0;
      let totalAchievements = 0;

      for (const [consoleName, games] of allGamesWithAchievements.entries()) {
        gamesObject[consoleName] = games;
        totalGames += games.length;
        
        // Count achievements
        games.forEach(game => {
          if (game.Achievements) {
            totalAchievements += Object.keys(game.Achievements).length;
          }
        });
      }

      // Create output directory if it doesn't exist
      const outputDir = path.join(__dirname, '..', 'output');
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      // Save to JSON file with timestamp
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const outputPath = path.join(outputDir, `retroachievements-with-achievements-${timestamp}.json`);

      fs.writeFileSync(outputPath, JSON.stringify(gamesObject, null, 2));

      // Also save a "latest" version for easy access
      const latestPath = path.join(outputDir, 'retroachievements-with-achievements-latest.json');
      fs.writeFileSync(latestPath, JSON.stringify(gamesObject, null, 2));

      console.log('\n=== Summary ===');
      console.log(`Total consoles: ${allGamesWithAchievements.size}`);
      console.log(`Total games: ${totalGames}`);
      console.log(`Total achievements: ${totalAchievements}`);
      console.log(`\nData saved to:`);
      console.log(`  - ${outputPath}`);
      console.log(`  - ${latestPath}`);

      // Save a summary file
      const summary = {
        generatedAt: new Date().toISOString(),
        mode: 'with_achievements',
        totalConsoles: allGamesWithAchievements.size,
        totalGames: totalGames,
        totalAchievements: totalAchievements,
        consoles: Array.from(allGamesWithAchievements.entries()).map(([name, games]) => {
          const achievementCount = games.reduce((sum, game) => {
            return sum + (game.Achievements ? Object.keys(game.Achievements).length : 0);
          }, 0);
          return {
            name,
            gameCount: games.length,
            achievementCount,
          };
        }),
      };

      const summaryPath = path.join(outputDir, 'summary-with-achievements.json');
      fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
      console.log(`  - ${summaryPath}`);

    } else {
      console.log('Mode: Fetching games WITHOUT achievements (basic info only)\n');
      
      // Fetch all games from all consoles
      const allGames = await raAPI.getAllGames();

      // Convert Map to object for JSON serialization
      const gamesObject: Record<string, any[]> = {};
      let totalGames = 0;

      for (const [consoleName, games] of allGames.entries()) {
        gamesObject[consoleName] = games;
        totalGames += games.length;
      }

      // Create output directory if it doesn't exist
      const outputDir = path.join(__dirname, '..', 'output');
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      // Save to JSON file with timestamp
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const outputPath = path.join(outputDir, `retroachievements-roms-${timestamp}.json`);

    //   fs.writeFileSync(outputPath, JSON.stringify(gamesObject, null, 2));

      // Also save a "latest" version for easy access
      const latestPath = path.join(outputDir, 'retroachievements-roms-latest.json');
      fs.writeFileSync(latestPath, JSON.stringify(gamesObject, null, 2));

      console.log('\n=== Summary ===');
      console.log(`Total consoles: ${allGames.size}`);
      console.log(`Total games: ${totalGames}`);
      console.log(`\nData saved to:`);
      console.log(`  - ${outputPath}`);
      console.log(`  - ${latestPath}`);

      // Save a summary file
      const summary = {
        generatedAt: new Date().toISOString(),
        mode: 'basic',
        totalConsoles: allGames.size,
        totalGames: totalGames,
        consoles: Array.from(allGames.entries()).map(([name, games]) => ({
          name,
          gameCount: games.length,
        })),
      };

      const summaryPath = path.join(outputDir, 'summary.json');
      fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
      console.log(`  - ${summaryPath}`);
    }

  } catch (error) {
    console.error('\nError:', error);
    process.exit(1);
  }
}

// Run the main function
main();
