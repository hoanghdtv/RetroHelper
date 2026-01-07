import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { RomDatabase } from './database';

export class RomDownloader {
  private downloadDir: string;

  constructor(downloadDir: string = './downloads') {
    this.downloadDir = downloadDir;
    
    // Create download directory if not exists
    if (!fs.existsSync(this.downloadDir)) {
      fs.mkdirSync(this.downloadDir, { recursive: true });
    }
  }

  /**
   * Download a ROM file from direct download link
   */
  async downloadRom(url: string, filename: string, onProgress?: (progress: number, downloaded: number, total: number) => void): Promise<string> {
    try {
      console.log(`\n📥 Downloading: ${filename}`);
      console.log(`   URL: ${url.substring(0, 80)}...`);

      const response = await axios({
        method: 'GET',
        url: url,
        responseType: 'stream',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        },
      });

      const totalSize = parseInt(response.headers['content-length'] || '0', 10);
      let downloadedSize = 0;

      // Ensure filename is safe
      const safeFilename = filename.replace(/[^a-zA-Z0-9.-]/g, '_');
      const filePath = path.join(this.downloadDir, safeFilename);

      // Create write stream
      const writer = fs.createWriteStream(filePath);

      // Track download progress
      response.data.on('data', (chunk: Buffer) => {
        downloadedSize += chunk.length;
        if (onProgress && totalSize > 0) {
          const progress = Math.round((downloadedSize / totalSize) * 100);
          onProgress(progress, downloadedSize, totalSize);
        }
      });

      // Pipe response to file
      response.data.pipe(writer);

      // Wait for download to complete
      await new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
      });

      console.log(`   ✓ Downloaded: ${this.formatBytes(downloadedSize)}`);
      console.log(`   💾 Saved to: ${filePath}`);

      return filePath;
    } catch (error: any) {
      throw new Error(`Failed to download: ${error.message}`);
    }
  }

  /**
   * Download ROM by searching in database
   */
  async downloadRomByTitle(db: RomDatabase, searchQuery: string): Promise<string[]> {
    console.log(`\n🔍 Searching for: "${searchQuery}"`);
    
    const roms = await db.searchRoms(searchQuery);
    
    if (roms.length === 0) {
      console.log('   ✗ No ROMs found');
      return [];
    }

    console.log(`   ✓ Found ${roms.length} ROM(s)`);
    
    const downloadedFiles: string[] = [];

    for (let i = 0; i < roms.length; i++) {
      const rom = roms[i];
      
      if (!rom.directDownloadLink) {
        console.log(`\n[${i + 1}/${roms.length}] ${rom.title}`);
        console.log('   ✗ No direct download link available');
        continue;
      }

      try {
        // Extract file extension from URL
        const urlPath = rom.directDownloadLink.split('?')[0];
        const ext = path.extname(urlPath) || '.zip';
        const filename = `${rom.title.substring(0, 50)}${ext}`;

        let lastProgress = 0;
        const filePath = await this.downloadRom(
          rom.directDownloadLink,
          filename,
          (progress, downloaded, total) => {
            // Only log every 10%
            if (progress >= lastProgress + 10) {
              console.log(`   Progress: ${progress}% (${this.formatBytes(downloaded)} / ${this.formatBytes(total)})`);
              lastProgress = progress;
            }
          }
        );

        downloadedFiles.push(filePath);
        
        // Wait a bit between downloads to be respectful
        if (i < roms.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      } catch (error: any) {
        console.log(`   ✗ Error: ${error.message}`);
      }
    }

    return downloadedFiles;
  }

  /**
   * List ROMs available for download (without downloading)
   */
  async listRomsByConsole(db: RomDatabase, consoleName: string): Promise<void> {
    console.log(`\n📋 ROMs available for console: ${consoleName}\n`);
    
    const roms = await db.getRomsByConsole(consoleName);
    
    if (roms.length === 0) {
      console.log('   ✗ No ROMs found for this console');
      return;
    }

    console.log(`Found ${roms.length} ROM(s):\n`);
    
    let withLinks = 0;
    let totalSize = 0;
    
    roms.forEach((rom, index) => {
      console.log(`${index + 1}. ${rom.title}`);
      if (rom.directDownloadLink) {
        console.log(`   ✓ Download: Available`);
        withLinks++;
      } else {
        console.log(`   ✗ Download: Not available`);
      }
      if (rom.size) {
        console.log(`   📦 Size: ${rom.size}`);
      }
      if (rom.genre && rom.genre.length > 0) {
        console.log(`   🎮 Genre: ${rom.genre.join(', ')}`);
      }
      console.log('');
    });
    
    console.log(`\n📊 Summary:`);
    console.log(`   Total ROMs: ${roms.length}`);
    console.log(`   With Download Links: ${withLinks} (${Math.round(withLinks/roms.length*100)}%)`);
    console.log(`   Without Links: ${roms.length - withLinks}`);
  }

  /**
   * Download ROM by console
   */
  async downloadRomsByConsole(db: RomDatabase, consoleName: string, limit?: number): Promise<string[]> {
    console.log(`\n🎮 Downloading ROMs for console: ${consoleName}`);
    if (limit) {
      console.log(`   Limit: ${limit} ROMs`);
    } else {
      console.log(`   Limit: ALL ROMs`);
    }
    
    const roms = await db.getRomsByConsole(consoleName);
    
    if (roms.length === 0) {
      console.log('   ✗ No ROMs found for this console');
      return [];
    }

    console.log(`   ✓ Found ${roms.length} ROM(s) in database`);
    
    const romsToDownload = limit ? roms.slice(0, limit) : roms;
    console.log(`   📦 Will download ${romsToDownload.length} ROM(s)`);
    
    const downloadedFiles: string[] = [];
    let successCount = 0;
    let skipCount = 0;
    let errorCount = 0;

    for (let i = 0; i < romsToDownload.length; i++) {
      const rom = romsToDownload[i];
      
      console.log(`\n[${i + 1}/${romsToDownload.length}] ${rom.title}`);
      
      if (!rom.directDownloadLink) {
        console.log('   ✗ No direct download link available');
        skipCount++;
        continue;
      }

      try {
        const urlPath = rom.directDownloadLink.split('?')[0];
        const ext = path.extname(urlPath) || '.zip';
        const filename = `${rom.title.substring(0, 50)}${ext}`;

        let lastProgress = 0;
        const filePath = await this.downloadRom(
          rom.directDownloadLink,
          filename,
          (progress, downloaded, total) => {
            if (progress >= lastProgress + 10) {
              console.log(`   Progress: ${progress}% (${this.formatBytes(downloaded)} / ${this.formatBytes(total)})`);
              lastProgress = progress;
            }
          }
        );

        downloadedFiles.push(filePath);
        successCount++;
        
        // Wait between downloads
        if (i < romsToDownload.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      } catch (error: any) {
        console.log(`   ✗ Error: ${error.message}`);
        errorCount++;
      }
    }

    console.log(`\n\n📊 Download Summary:`);
    console.log(`   ✅ Success: ${successCount}`);
    console.log(`   ⚠️  Skipped: ${skipCount}`);
    console.log(`   ❌ Failed: ${errorCount}`);
    console.log(`   📦 Total: ${romsToDownload.length}`);

    return downloadedFiles;
  }

  /**
   * Download single ROM by URL
   */
  async downloadRomByUrl(db: RomDatabase, romUrl: string): Promise<string | null> {
    console.log(`\n🔗 Loading ROM from URL: ${romUrl}`);
    
    const rom = await db.getRomByUrl(romUrl);
    
    if (!rom) {
      console.log('   ✗ ROM not found in database');
      return null;
    }

    console.log(`   ✓ Found: ${rom.title}`);

    if (!rom.directDownloadLink) {
      console.log('   ✗ No direct download link available');
      return null;
    }

    try {
      const urlPath = rom.directDownloadLink.split('?')[0];
      const ext = path.extname(urlPath) || '.zip';
      const filename = `${rom.title.substring(0, 50)}${ext}`;

      let lastProgress = 0;
      const filePath = await this.downloadRom(
        rom.directDownloadLink,
        filename,
        (progress, downloaded, total) => {
          if (progress >= lastProgress + 10) {
            console.log(`   Progress: ${progress}% (${this.formatBytes(downloaded)} / ${this.formatBytes(total)})`);
            lastProgress = progress;
          }
        }
      );

      return filePath;
    } catch (error: any) {
      console.log(`   ✗ Error: ${error.message}`);
      return null;
    }
  }

  /**
   * Format bytes to human readable string
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  }

  /**
   * Get download directory path
   */
  getDownloadDir(): string {
    return this.downloadDir;
  }
}

// Example usage
async function main() {
  const db = new RomDatabase();
  const downloader = new RomDownloader('./downloads');

  try {
    // Example 1: Download by search
    const args = process.argv.slice(2);
    
    if (args.length === 0) {
      console.log('ROM Downloader - Usage:');
      console.log('  npm run download -- list "game-boy"           # List all available ROMs');
      console.log('  npm run download -- search "Pokemon"          # Search and download matching ROMs');
      console.log('  npm run download -- console "game-boy" 5      # Download first 5 ROMs');
      console.log('  npm run download -- console "game-boy" all    # Download ALL ROMs of console');
      console.log('  npm run download -- url "https://romsfun.com/roms/..."  # Download by URL');
      return;
    }

    const command = args[0];

    if (command === 'list') {
      const consoleName = args[1] || 'game-boy';
      await downloader.listRomsByConsole(db, consoleName);
    } else if (command === 'search') {
      const query = args[1] || 'Pokemon';
      await downloader.downloadRomByTitle(db, query);
    } else if (command === 'console') {
      const consoleName = args[1] || 'game-boy';
      const limitArg = args[2];
      const limit = limitArg === 'all' || limitArg === 'ALL' ? undefined : parseInt(limitArg) || 5;
      await downloader.downloadRomsByConsole(db, consoleName, limit);
    } else if (command === 'url') {
      const url = args[1];
      await downloader.downloadRomByUrl(db, url);
    } else {
      console.log('Unknown command. Use: list, search, console, or url');
    }

    if (command !== 'list') {
      console.log('\n✅ Download completed!');
      console.log(`📁 Files saved to: ${downloader.getDownloadDir()}`);
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await db.close();
  }
}

if (require.main === module) {
  main().catch(console.error);
}

export default RomDownloader;
