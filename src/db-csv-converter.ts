import { RomDatabase, Rom } from './database';
import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';

/**
 * Database to CSV and CSV to Database Converter
 */
export class DbCsvConverter {
  /**
   * Export database to CSV
   * @param dbPath - Path to SQLite database
   * @param csvPath - Output CSV file path
   * @param consoleName - Optional: Export only specific console
   */
  static async exportToCsv(
    dbPath: string,
    csvPath: string,
    consoleName?: string
  ): Promise<void> {
    console.log(`\n=== Exporting Database to CSV ===`);
    console.log(`Database: ${dbPath}`);
    console.log(`Output CSV: ${csvPath}`);
    if (consoleName) {
      console.log(`Console filter: ${consoleName}`);
    }
    console.log();

    const db = new RomDatabase(dbPath);
    await db.init();

    // Get ROMs
    let roms: Rom[];
    if (consoleName) {
      roms = await db.getRomsByConsole(consoleName);
    } else {
      roms = await db.getAllRoms();
    }

    if (roms.length === 0) {
      console.log('⚠️  No ROMs found in database');
      await db.close();
      return;
    }

    console.log(`Found ${roms.length} ROMs`);

    // Convert ROMs to CSV format
    const csvData = roms.map(rom => ({
      title: rom.title,
      url: rom.url,
      console: rom.console,
      description: rom.description || '',
      mainImage: rom.mainImage || '',
      screenshots: rom.screenshots ? rom.screenshots.join('|') : '',
      genre: rom.genre ? rom.genre.join('|') : '',
      releaseDate: rom.releaseDate || '',
      publisher: rom.publisher || '',
      region: rom.region ? rom.region.join('|') : '',
      size: rom.size || '',
      downloadCount: rom.downloadCount || '',
      numberOfReviews: rom.numberOfReviews || '',
      averageRating: rom.averageRating || '',
      downloadLink: rom.downloadLink || '',
      directDownloadLink: rom.directDownloadLink || '',
      romType: rom.romType || ''
    }));

    // Ensure output directory exists
    const dir = path.dirname(csvPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Write CSV file
    const csv = stringify(csvData, {
      header: true,
      columns: [
        'title',
        'url',
        'console',
        'description',
        'mainImage',
        'screenshots',
        'genre',
        'releaseDate',
        'publisher',
        'region',
        'size',
        'downloadCount',
        'numberOfReviews',
        'averageRating',
        'downloadLink',
        'directDownloadLink',
        'romType'
      ]
    });

    fs.writeFileSync(csvPath, csv, 'utf-8');

    console.log(`✓ Exported ${roms.length} ROMs to ${csvPath}`);

    // Statistics
    const withDirectLinks = roms.filter(r => r.directDownloadLink).length;
    const withDescriptions = roms.filter(r => r.description).length;
    const consoles = [...new Set(roms.map(r => r.console))];

    console.log('\nStatistics:');
    console.log(`  Total ROMs: ${roms.length}`);
    console.log(`  Consoles: ${consoles.length} (${consoles.join(', ')})`);
    console.log(`  With direct links: ${withDirectLinks} (${((withDirectLinks/roms.length)*100).toFixed(1)}%)`);
    console.log(`  With descriptions: ${withDescriptions} (${((withDescriptions/roms.length)*100).toFixed(1)}%)`);

    await db.close();
  }

  /**
   * Import CSV to database
   * @param csvPath - Input CSV file path
   * @param dbPath - Path to SQLite database
   * @param overwrite - Whether to overwrite existing ROMs (default: true)
   */
  static async importFromCsv(
    csvPath: string,
    dbPath: string,
    overwrite: boolean = true
  ): Promise<void> {
    console.log(`\n=== Importing CSV to Database ===`);
    console.log(`CSV file: ${csvPath}`);
    console.log(`Database: ${dbPath}`);
    console.log(`Overwrite mode: ${overwrite ? 'Yes' : 'No'}`);
    console.log();

    // Check if CSV file exists
    if (!fs.existsSync(csvPath)) {
      throw new Error(`CSV file not found: ${csvPath}`);
    }

    // Read CSV file
    const csvContent = fs.readFileSync(csvPath, 'utf-8');
    const records = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true
    });

    console.log(`Found ${records.length} rows in CSV`);

    if (records.length === 0) {
      console.log('⚠️  No data found in CSV file');
      return;
    }

    // Initialize database
    const db = new RomDatabase(dbPath);
    await db.init();

    // Import ROMs
    let successCount = 0;
    let skipCount = 0;
    let errorCount = 0;

    for (let i = 0; i < records.length; i++) {
      const record = records[i] as any;
      const progress = `[${i + 1}/${records.length}]`;

      try {
        // Convert CSV row to Rom object
        const rom: Rom = {
          title: record.title,
          url: record.url,
          console: record.console,
          description: record.description || undefined,
          mainImage: record.mainImage || undefined,
          screenshots: record.screenshots ? record.screenshots.split('|').filter((s: string) => s) : undefined,
          genre: record.genre ? record.genre.split('|').filter((g: string) => g) : undefined,
          releaseDate: record.releaseDate || undefined,
          publisher: record.publisher || undefined,
          region: record.region ? record.region.split('|').filter((r: string) => r) : undefined,
          size: record.size || undefined,
          downloadCount: record.downloadCount || undefined,
          numberOfReviews: record.numberOfReviews || undefined,
          averageRating: record.averageRating || undefined,
          downloadLink: record.downloadLink || undefined,
          directDownloadLink: record.directDownloadLink || undefined,
          romType: record.romType || undefined
        };

        // Check if ROM already exists (if not overwriting)
        if (!overwrite) {
          const existing = await db.getRomByUrl(rom.url);
          if (existing) {
            skipCount++;
            if ((skipCount + successCount + errorCount) % 50 === 0) {
              console.log(`${progress} Skipped: ${rom.title} (already exists)`);
            }
            continue;
          }
        }

        await db.saveRom(rom);
        successCount++;

        if (successCount % 50 === 0) {
          console.log(`${progress} Imported ${successCount} ROMs...`);
        }
      } catch (error) {
        errorCount++;
        console.error(`${progress} ✗ Failed to import: ${record.title} - ${error}`);
      }
    }

    console.log(`\n=== Import Summary ===`);
    console.log(`  Success: ${successCount}`);
    console.log(`  Skipped: ${skipCount}`);
    console.log(`  Failed: ${errorCount}`);
    console.log(`  Total: ${records.length}`);

    await db.close();
  }

  /**
   * Export specific console to CSV
   */
  static async exportConsole(
    dbPath: string,
    consoleName: string,
    outputDir: string = './output'
  ): Promise<void> {
    const csvPath = path.join(outputDir, `${consoleName}.csv`);
    await this.exportToCsv(dbPath, csvPath, consoleName);
  }

  /**
   * Export all consoles to separate CSV files
   */
  static async exportAllConsoles(
    dbPath: string,
    outputDir: string = './output/csv'
  ): Promise<void> {
    console.log(`\n=== Exporting All Consoles ===`);
    console.log(`Database: ${dbPath}`);
    console.log(`Output directory: ${outputDir}`);
    console.log();

    const db = new RomDatabase(dbPath);
    await db.init();

    // Get all consoles
    const stats = await db.getStats();
    const consoles = stats.romsByConsole?.map((c: any) => c.console) || [];

    if (consoles.length === 0) {
      console.log('⚠️  No consoles found in database');
      await db.close();
      return;
    }

    console.log(`Found ${consoles.length} consoles\n`);

    // Export each console
    for (let i = 0; i < consoles.length; i++) {
      const consoleName = consoles[i];
      const csvPath = path.join(outputDir, `${consoleName}.csv`);
      
      console.log(`[${i + 1}/${consoles.length}] Exporting ${consoleName}...`);
      
      const roms = await db.getRomsByConsole(consoleName);
      
      if (roms.length === 0) {
        console.log(`  ⚠️  No ROMs found for ${consoleName}`);
        continue;
      }

      // Convert to CSV format
      const csvData = roms.map(rom => ({
        title: rom.title,
        url: rom.url,
        console: rom.console,
        description: rom.description || '',
        mainImage: rom.mainImage || '',
        screenshots: rom.screenshots ? rom.screenshots.join('|') : '',
        genre: rom.genre ? rom.genre.join('|') : '',
        releaseDate: rom.releaseDate || '',
        publisher: rom.publisher || '',
        region: rom.region ? rom.region.join('|') : '',
        size: rom.size || '',
        downloadCount: rom.downloadCount || '',
        numberOfReviews: rom.numberOfReviews || '',
        averageRating: rom.averageRating || '',
        downloadLink: rom.downloadLink || '',
        directDownloadLink: rom.directDownloadLink || '',
        romType: rom.romType || ''
      }));

      // Ensure output directory exists
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      // Write CSV file
      const csv = stringify(csvData, {
        header: true,
        columns: [
          'title',
          'url',
          'console',
          'description',
          'mainImage',
          'screenshots',
          'genre',
          'releaseDate',
          'publisher',
          'region',
          'size',
          'downloadCount',
          'numberOfReviews',
          'averageRating',
          'downloadLink',
          'directDownloadLink',
          'romType'
        ]
      });

      fs.writeFileSync(csvPath, csv, 'utf-8');
      console.log(`  ✓ Exported ${roms.length} ROMs to ${csvPath}`);
    }

    console.log(`\n✓ Exported all ${consoles.length} consoles`);
    await db.close();
  }
}

// CLI Usage
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log(`
=== DB-CSV Converter Usage ===

Commands:
  export <db-path> <csv-path> [console]  - Export database to CSV
  import <csv-path> <db-path>            - Import CSV to database
  export-console <db-path> <console>     - Export specific console to CSV
  export-all <db-path> [output-dir]      - Export all consoles to separate CSV files

Options:
  --no-overwrite    - Don't overwrite existing ROMs when importing

Examples:
  # Export entire database
  npm run convert -- export ./output/roms.db ./output/roms.csv

  # Export specific console
  npm run convert -- export ./output/roms.db ./output/nes.csv nes

  # Export all consoles to separate files
  npm run convert -- export-all ./output/roms.db ./output/csv

  # Import CSV to database
  npm run convert -- import ./output/roms.csv ./output/new_roms.db

  # Import without overwriting
  npm run convert -- import ./output/roms.csv ./output/roms.db --no-overwrite
`);
    process.exit(0);
  }

  const command = args[0];

  try {
    switch (command) {
      case 'export': {
        const dbPath = args[1];
        const csvPath = args[2];
        const consoleName = args[3];
        
        if (!dbPath || !csvPath) {
          console.error('Error: Database path and CSV path required');
          process.exit(1);
        }
        
        await DbCsvConverter.exportToCsv(dbPath, csvPath, consoleName);
        break;
      }

      case 'import': {
        const csvPath = args[1];
        const dbPath = args[2];
        const overwrite = !args.includes('--no-overwrite');
        
        if (!csvPath || !dbPath) {
          console.error('Error: CSV path and database path required');
          process.exit(1);
        }
        
        await DbCsvConverter.importFromCsv(csvPath, dbPath, overwrite);
        break;
      }

      case 'export-console': {
        const dbPath = args[1];
        const consoleName = args[2];
        
        if (!dbPath || !consoleName) {
          console.error('Error: Database path and console name required');
          process.exit(1);
        }
        
        await DbCsvConverter.exportConsole(dbPath, consoleName);
        break;
      }

      case 'export-all': {
        const dbPath = args[1];
        const outputDir = args[2] || './output/csv';
        
        if (!dbPath) {
          console.error('Error: Database path required');
          process.exit(1);
        }
        
        await DbCsvConverter.exportAllConsoles(dbPath, outputDir);
        break;
      }

      default:
        console.error(`Unknown command: ${command}`);
        console.log('Run without arguments to see usage help');
        process.exit(1);
    }
  } catch (error) {
    console.error(`Error: ${error}`);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}
