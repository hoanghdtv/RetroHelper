import * as fs from 'fs';
import * as path from 'path';
import { RomsFunPlaywrightClient } from './romsfun-playwright-client';

async function testRomsFunPlaywright() {
  console.log('=== RomsFun Playwright Client Test ===\n');

  // Create client (headless: false to see browser, true to run in background)
  const client = new RomsFunPlaywrightClient({ 
    headless: true  // Set to false to see browser
  });

  try {
    // Test 1: Get consoles
    console.log('1. Fetching available consoles...');
    const consoles = await client.getConsoles();
    console.log(`   ✓ Found ${consoles.length} consoles`);
    console.log('   First 5 consoles:');
    consoles.slice(0, 5).forEach(consoleItem => {
      console.log(`   - ${consoleItem.name} (${consoleItem.slug})`);
    });
    console.log('');

    // Test 2: Search for games
    console.log('2. Searching for "Mario"...');
    const searchResults = await client.searchGames('Mario');
    console.log(`   ✓ Found ${searchResults.games.length} games`);
    console.log('   First 3 results:');
    searchResults.games.slice(0, 3).forEach(game => {
      console.log(`   - ${game.title} [${game.console}]`);
    });
    console.log('');

    // Test 3: Get games by console (example: NES)
    if (consoles.length > 0) {
      const firstConsole = consoles[0];
      console.log(`3. Fetching games for ${firstConsole.name}...`);
      const consoleGames = await client.getGamesByConsole(firstConsole.slug, 1);
      console.log(`   ✓ Found ${consoleGames.games.length} games`);
      console.log('   First 5 games:');
      consoleGames.games.slice(0, 5).forEach(game => {
        console.log(`   - ${game.title}`);
        if (game.size) console.log(`     Size: ${game.size}`);
      });
      console.log('');

      // Test 4: Get game details
      if (consoleGames.games.length > 0) {
        const firstGame = consoleGames.games[0];
        console.log('4. Fetching game details...');
        console.log(`   Game: ${firstGame.title}`);
        const details = await client.getGameDetails(firstGame.url);
        console.log(`   ✓ Title: ${details.title}`);
        console.log(`   ✓ Console: ${details.console}`);
        console.log(`   ✓ Size: ${details.size || 'N/A'}`);
        if (details.description) {
          console.log(`   ✓ Description: ${details.description.substring(0, 100)}...`);
        }
        if (details.downloadLink) {
          console.log(`   ✓ Download: ${details.downloadLink}`);
        }
        console.log('');
      }
    }

    // Test 5: Get popular games
    console.log('5. Fetching popular games...');
    const popularGames = await client.getPopularGames(10);
    console.log(`   ✓ Found ${popularGames.length} popular games`);
    console.log('   Top 5:');
    popularGames.slice(0, 5).forEach(game => {
      console.log(`   - ${game.title} [${game.console}]`);
    });
    console.log('');

    // Test 6: Batch fetch from multiple consoles
    console.log('6. Batch fetching from multiple consoles...');
    const consolesToFetch = consoles.slice(0, 3).map(c => c.slug); // First 3 consoles
    console.log(`   Consoles: ${consolesToFetch.join(', ')}`);
    
    const allGames = await client.getAllGamesByConsoles(
      consolesToFetch,
      5,    // Max 5 games per console
      2000  // 2 second delay between requests
    );

    console.log('\n=== Summary ===');
    let totalGames = 0;
    for (const [consoleSlug, games] of allGames.entries()) {
      console.log(`${consoleSlug}: ${games.length} games`);
      totalGames += games.length;
    }
    console.log(`Total games fetched: ${totalGames}`);

    // Save results to JSON
    const outputDir = path.join(__dirname, '..', 'output');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const gamesObject: Record<string, any> = {
      consoles: consoles.map(c => ({ name: c.name, slug: c.slug })),
      games: Object.fromEntries(allGames),
      popularGames: popularGames,
      searchResults: searchResults.games,
    };

    const outputPath = path.join(outputDir, 'romsfun-playwright-results.json');
    fs.writeFileSync(outputPath, JSON.stringify(gamesObject, null, 2));
    console.log(`\n✓ Data saved to: ${outputPath}`);

  } catch (error) {
    console.error('\n✗ Error:', error);
  } finally {
    // Always close browser
    await client.close();
  }
}

// Run if this file is executed directly
if (require.main === module) {
  testRomsFunPlaywright().catch(console.error);
}

export { testRomsFunPlaywright };
