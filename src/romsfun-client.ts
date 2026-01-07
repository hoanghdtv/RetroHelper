import { RomsFunEnhancedClient } from './romsfun-enhanced';
import { RomDatabase, Rom } from './database';
import { RomDownloader } from './rom-downloader';
import * as fs from 'fs';
import * as path from 'path';

/**
 * High-level client for fetching ROMs with direct links and downloading them
 */
export class RomsFunClient {
  private enhancedClient: RomsFunEnhancedClient;
  private database: RomDatabase;
  private downloader: RomDownloader;

  constructor(
    dbPath: string = './output/roms.db',
    downloadDir: string = './downloads'
  ) {
    this.enhancedClient = new RomsFunEnhancedClient();
    this.database = new RomDatabase(dbPath);
    this.downloader = new RomDownloader(downloadDir);
  }

  /**
   * Fetch ROMs for a console, get direct download links, and optionally download them
   * Uses immediate download to avoid short-lived CDN link expiration
   * @param consoleName - Console slug (e.g., 'game-boy', 'nes', 'snes')
   * @param pageCount - Number of pages to fetch (default: 1)
   * @param autoDownload - Whether to automatically download ROMs after fetching (default: false)
   * @returns Array of fetched ROMs
   */
  async fetchAndDownloadRoms(
    consoleName: string,
    pageCount: number = 1,
    autoDownload: boolean = false
  ): Promise<Rom[]> {
    try {
      // Initialize database
      await this.database.init();
      
      console.log(`\n=== Fetching ROMs: ${consoleName} ===`);
      console.log(`Pages: ${pageCount}`);
      console.log(`Auto-download: ${autoDownload ? 'Yes' : 'No'}\n`);

      let roms: Rom[];

      if (autoDownload) {
        // Use getRomsByConsoleAndDownload to fetch and download immediately
        // This prevents CDN links from expiring
        console.log('⚡ Using immediate download mode (prevents link expiration)\n');
        roms = await this.enhancedClient.getRomsByConsoleAndDownload(
          consoleName,
          pageCount,
          './downloads'
        );
      } else {
        // Fetch ROMs with enhanced client (includes direct download links)
        roms = await this.enhancedClient.getRomsByConsoleDetailed(
          consoleName,
          pageCount
        );
      }

      console.log(`\n✓ Fetched ${roms.length} ROMs\n`);

      // Save to database
      console.log('Saving to database...');
      let savedCount = 0;
      for (const rom of roms) {
        try {
          await this.database.saveRom(rom);
          savedCount++;
        } catch (error) {
          console.error(`  ✗ Failed to save ${rom.title}: ${error}`);
        }
      }
      console.log(`✓ Saved ${savedCount}/${roms.length} ROMs to database\n`);

      // Statistics
      const withDirectLinks = roms.filter(r => r.directDownloadLink).length;
      const withDownloaded = roms.filter((r: any) => r.downloaded === true).length;
      
      console.log('Statistics:');
      console.log(`  Total ROMs: ${roms.length}`);
      console.log(`  With direct links: ${withDirectLinks} (${((withDirectLinks/roms.length)*100).toFixed(1)}%)`);
      if (autoDownload) {
        console.log(`  Successfully downloaded: ${withDownloaded} (${((withDownloaded/roms.length)*100).toFixed(1)}%)`);
      }
      console.log(`  With descriptions: ${roms.filter(r => r.description).length}`);
      console.log(`  With screenshots: ${roms.filter(r => r.screenshots && r.screenshots.length > 0).length}`);
      console.log(`  With related ROMs: ${roms.filter(r => r.relatedRoms && r.relatedRoms.length > 0).length}\n`);

      return roms;
    } catch (error) {
      console.error(`Failed to fetch ROMs: ${error}`);
      throw error;
    }
  }

  /**
   * Download ROMs that were already fetched
   * @param roms - Array of ROMs to download
   */
  async downloadFetchedRoms(roms: Rom[]): Promise<void> {
    console.log(`\n=== Downloading ${roms.length} ROMs ===\n`);

    const downloadableRoms = roms.filter(r => r.directDownloadLink);
    console.log(`Downloadable ROMs: ${downloadableRoms.length}/${roms.length}\n`);

    let successCount = 0;
    let skipCount = 0;
    let failCount = 0;

    for (let i = 0; i < downloadableRoms.length; i++) {
      const rom = downloadableRoms[i];
      const progress = `[${i + 1}/${downloadableRoms.length}]`;

      try {
        // Generate filename
        const filename = this.sanitizeFilename(rom.title) + '.zip';
        
        console.log(`${progress} ${rom.title}`);

        // Download
        await this.downloader.downloadRom(
          rom.directDownloadLink!,
          filename,
          (downloaded, total, percent) => {
            if (percent % 10 === 0) {
              console.log(`  Progress: ${percent}% (${this.formatBytes(downloaded)} / ${this.formatBytes(total)})`);
            }
          }
        );

        successCount++;
        
        // Rate limiting
        if (i < downloadableRoms.length - 1) {
          await this.sleep(2000);
        }
      } catch (error) {
        console.error(`  ✗ Failed: ${error}`);
        failCount++;
      }
    }

    skipCount = roms.length - downloadableRoms.length;

    console.log(`\n=== Download Summary ===`);
    console.log(`  Success: ${successCount}`);
    console.log(`  Skipped (no direct link): ${skipCount}`);
    console.log(`  Failed: ${failCount}`);
  }

  /**
   * Download ROMs from database by console name
   * @param consoleName - Console slug
   * @param limit - Max number of ROMs to download (undefined = all)
   */
  async downloadRomsFromDatabase(consoleName: string, limit?: number): Promise<void> {
    await this.database.init();
    
    const roms = await this.database.getRomsByConsole(consoleName);
    
    let romsToDownload = roms;
    if (limit !== undefined) {
      romsToDownload = roms.slice(0, limit);
    }
    
    await this.downloadFetchedRoms(romsToDownload);
  }

  /**
   * Download a specific ROM by title search
   * @param searchQuery - Search query (title or description)
   */
  async downloadRomBySearch(searchQuery: string): Promise<void> {
    await this.database.init();
    
    const roms = await this.database.searchRoms(searchQuery);
    
    if (roms.length === 0) {
      console.log(`No ROMs found matching: ${searchQuery}`);
      return;
    }

    console.log(`\nFound ${roms.length} ROMs matching "${searchQuery}":\n`);
    
    await this.downloadFetchedRoms(roms);
  }

  /**
   * List ROMs from database without downloading
   * @param consoleName - Console slug
   * @param limit - Max number of ROMs to list
   */
  async listRoms(consoleName: string, limit: number = 50): Promise<void> {
    await this.database.init();
    
    const roms = await this.database.getRomsByConsole(consoleName);
    
    console.log(`\n=== ROMs for ${consoleName} ===`);
    console.log(`Total: ${roms.length}\n`);

    const displayRoms = roms.slice(0, limit);
    
    for (let i = 0; i < displayRoms.length; i++) {
      const rom = displayRoms[i];
      const hasLink = rom.directDownloadLink ? '✓' : '✗';
      const size = rom.size || 'Unknown';
      const genre = rom.genre?.join(', ') || 'N/A';
      
      console.log(`${i + 1}. ${rom.title}`);
      console.log(`   Download: ${hasLink} | Size: ${size} | Genre: ${genre}`);
      console.log(`   URL: ${rom.url}`);
      console.log();
    }

    if (roms.length > limit) {
      console.log(`... and ${roms.length - limit} more ROMs\n`);
    }

    // Statistics
    const withLinks = roms.filter(r => r.directDownloadLink).length;
    console.log('Statistics:');
    console.log(`  Total: ${roms.length}`);
    console.log(`  With direct links: ${withLinks} (${((withLinks/roms.length)*100).toFixed(1)}%)`);
    console.log(`  Without direct links: ${roms.length - withLinks}`);
  }

  /**
   * Get database statistics
   */
  async getStats(): Promise<void> {
    await this.database.init();
    const stats = await this.database.getStats();
    
    console.log('\n=== Database Statistics ===');
    console.log(`Total ROMs: ${stats.totalRoms}`);
    console.log(`Total Consoles: ${stats.totalConsoles}`);
    console.log(`ROMs with Direct Links: ${stats.romsWithDirectLinks}`);
    console.log(`ROMs with Descriptions: ${stats.romsWithDescriptions}\n`);
    
    if (stats.romsByConsole && stats.romsByConsole.length > 0) {
      console.log('ROMs per Console:');
      for (const item of stats.romsByConsole) {
        console.log(`  ${item.console}: ${item.count}`);
      }
    }
  }

  /**
   * Close all connections
   */
  async close(): Promise<void> {
    await this.enhancedClient.close();
    await this.database.close();
  }

  // Helper methods
  private sanitizeFilename(filename: string): string {
    return filename
      .replace(/[^a-zA-Z0-9\s\-_\.]/g, '')
      .replace(/\s+/g, '-')
      .substring(0, 200);
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// CLI Usage
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log(`
=== RomsFun Client Usage ===

Commands:
  fetch <console> <pages> [--download]   - Fetch ROMs and optionally download
  download <console> [limit]              - Download ROMs from database
  search <query>                          - Search and download ROMs
  list <console> [limit]                  - List ROMs without downloading
  stats                                   - Show database statistics

Examples:
  npm run client -- fetch nes 5           # Fetch 5 pages of NES ROMs
  npm run client -- fetch nes 5 --download # Fetch and download
  npm run client -- download nes 10       # Download first 10 NES ROMs from DB
  npm run client -- download nes all      # Download all NES ROMs from DB
  npm run client -- search "Pokemon"      # Search and download Pokemon ROMs
  npm run client -- list game-boy 20      # List first 20 Game Boy ROMs
  npm run client -- stats                 # Show database statistics
`);
    process.exit(0);
  }

  const command = args[0];
  const client = new RomsFunClient();

  try {
    switch (command) {
      case 'fetch': {
        const consoleName = args[1];
        const pageCount = parseInt(args[2]) || 1;
        const autoDownload = args.includes('--download');
        
        if (!consoleName) {
          console.error('Error: Console name required');
          process.exit(1);
        }
        
        await client.fetchAndDownloadRoms(consoleName, pageCount, autoDownload);
        break;
      }

      case 'download': {
        const consoleName = args[1];
        const limitArg = args[2];
        
        if (!consoleName) {
          console.error('Error: Console name required');
          process.exit(1);
        }
        
        // Use the public downloadRomsFromDatabase method
        const limit = limitArg === 'all' ? undefined : parseInt(limitArg);
        await client.downloadRomsFromDatabase(consoleName, limit);
        break;
      }

      case 'search': {
        const query = args.slice(1).join(' ');
        
        if (!query) {
          console.error('Error: Search query required');
          process.exit(1);
        }
        
        await client.downloadRomBySearch(query);
        break;
      }

      case 'list': {
        const consoleName = args[1];
        const limit = parseInt(args[2]) || 50;
        
        if (!consoleName) {
          console.error('Error: Console name required');
          process.exit(1);
        }
        
        await client.listRoms(consoleName, limit);
        break;
      }

      case 'stats': {
        await client.getStats();
        break;
      }

      default:
        console.error(`Unknown command: ${command}`);
        process.exit(1);
    }
  } catch (error) {
    console.error(`Error: ${error}`);
    process.exit(1);
  } finally {
    await client.close();
  }
}

// Run if called directly
if (require.main === module) {
  main();
}
