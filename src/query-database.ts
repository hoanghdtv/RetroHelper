import { RomDatabase } from './database';

async function main() {
  const db = new RomDatabase();
  
  // Ensure database schema exists
  await db.init();
  try {
    console.log('=== ROM Database Query Tool ===\n');
    
    // Get stats
    const stats = await db.getStats();
    console.log('Database Statistics:');
    console.log(`  Total ROMs: ${stats.totalRoms}`);
    console.log(`  Total Consoles: ${stats.totalConsoles}`);
    console.log(`  ROMs with Direct Links: ${stats.romsWithDirectLinks}`);
    console.log(`  ROMs with Descriptions: ${stats.romsWithDescriptions}\n`);
    
    // Show consoles
    console.log('ROMs per Console:');
    stats.consoles.forEach((c: any) => {
      console.log(`  ${c.console}: ${c.count} ROMs`);
    });
    
    // Search example
    console.log('\n\nSearching for "Pokemon"...');
    const pokemonRoms = await db.searchRoms('Pokemon');
    console.log(`Found ${pokemonRoms.length} ROMs:`);
    pokemonRoms.forEach((rom) => {
      console.log(`  - ${rom.title}`);
      if (rom.directDownloadLink) {
        console.log(`    Direct Link: ${rom.directDownloadLink.substring(0, 80)}...`);
      }
    });
    
    // Get one ROM with full details
    if (pokemonRoms.length > 0) {
      const rom = pokemonRoms[0];
      console.log('\n\nFull ROM Details:');
      console.log(JSON.stringify(rom, null, 2));
    }
    
  } finally {
    await db.close();
  }
}

main().catch(console.error);
