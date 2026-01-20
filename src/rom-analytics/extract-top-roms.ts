import sqlite3 from 'sqlite3';
import * as fs from 'fs';
import * as path from 'path';

// This script extracts top N ROMs by download count and their related ROMs into a new DB
// Usage:
//   npx ts-node src/rom-analytics/extract-top-roms.ts <sourceDbPath> <outputDbPath> [topN]
// Example:
//   npx ts-node src/rom-analytics/extract-top-roms.ts ./output/roms_gba.db ./output/top200.db 200

function parseDownloadCount(countStr: string | null): number {
  if (!countStr) return 0;
  
  const cleaned = countStr.trim().toLowerCase().replace(/,/g, '');
  
  if (cleaned.includes('m')) {
    return parseFloat(cleaned) * 1_000_000;
  } else if (cleaned.includes('k')) {
    return parseFloat(cleaned) * 1_000;
  }
  
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? 0 : parsed;
}

async function main() {
  const argv = process.argv.slice(2);
  
  if (argv.length < 2) {
    console.log('Usage: npx ts-node src/rom-analytics/extract-top-roms.ts <sourceDbPath> <outputDbPath> [topN]');
    console.log('Example: npx ts-node src/rom-analytics/extract-top-roms.ts ./output/roms_gba.db ./output/top200.db 200');
    process.exit(1);
  }

  const sourceDbPath = argv[0];
  const outputDbPath = argv[1];
  const topN = argv[2] ? parseInt(argv[2], 10) : 200;

  if (!fs.existsSync(sourceDbPath)) {
    console.error(`Source DB not found at ${sourceDbPath}`);
    process.exit(1);
  }

  if (isNaN(topN) || topN <= 0) {
    console.error('topN must be a positive integer');
    process.exit(1);
  }

  // Ensure output directory exists
  const outputDir = path.dirname(outputDbPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // If output DB exists, delete it
  if (fs.existsSync(outputDbPath)) {
    console.log(`Removing existing output DB at ${outputDbPath}`);
    fs.unlinkSync(outputDbPath);
  }

  console.log(`Extracting top ${topN} ROMs from ${sourceDbPath} to ${outputDbPath}...`);

  const sourceDb = new sqlite3.Database(sourceDbPath);
  const outputDb = new sqlite3.Database(outputDbPath);

  // Promisify helpers
  const sourceAll = (sql: string, params: any[] = []) => 
    new Promise<any[]>((res, rej) => sourceDb.all(sql, params, (err, rows) => { if (err) rej(err); else res(rows); }));
  
  const outputRun = (sql: string, params: any[] = []) => 
    new Promise<void>((res, rej) => outputDb.run(sql, params, function(err) { if (err) rej(err); else res(); }));

  try {
    // Step 1: Create schema in output DB
    console.log('Creating schema in output DB...');
    await outputRun(`CREATE TABLE IF NOT EXISTS roms (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      url TEXT UNIQUE NOT NULL,
      console TEXT NOT NULL,
      description TEXT,
      mainImage TEXT,
      screenshots TEXT,
      genre TEXT,
      releaseDate TEXT,
      publisher TEXT,
      region TEXT,
      size TEXT,
      downloadCount TEXT,
      numberOfReviews TEXT,
      averageRating TEXT,
      downloadLink TEXT,
      directDownloadLink TEXT,
      createdAt DATETIME,
      updatedAt DATETIME,
      romType TEXT
    )`);

    await outputRun(`CREATE TABLE IF NOT EXISTS related_roms (
      id INTEGER PRIMARY KEY,
      romId INTEGER NOT NULL,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      image TEXT,
      console TEXT,
      downloadCount TEXT,
      size TEXT,
      romType TEXT,
      FOREIGN KEY (romId) REFERENCES roms(id)
    )`);

    // Step 2: Read all ROMs from source and sort by download count
    console.log('Reading ROMs from source DB...');
    const allRoms = await sourceAll('SELECT * FROM roms');
    console.log(`Found ${allRoms.length} total ROMs in source DB`);

    // Parse download counts and sort
    const romsWithParsedCount = allRoms.map(rom => ({
      ...rom,
      parsedDownloadCount: parseDownloadCount(rom.downloadCount)
    }));

    romsWithParsedCount.sort((a, b) => b.parsedDownloadCount - a.parsedDownloadCount);

    // Take top N
    const topRoms = romsWithParsedCount.slice(0, topN);
    console.log(`Selected top ${topRoms.length} ROMs`);

    // Show sample
    console.log('Top 5 sample:');
    topRoms.slice(0, 5).forEach((rom, idx) => {
      console.log(`  ${idx + 1}. ${rom.title} - ${rom.downloadCount} (parsed: ${rom.parsedDownloadCount})`);
    });

    // Step 3: Insert top ROMs into output DB
    console.log(`\nInserting ${topRoms.length} ROMs into output DB...`);
    const insertRomStmt = outputDb.prepare(`INSERT INTO roms (
      id, title, url, console, description, mainImage, screenshots, genre, releaseDate, 
      publisher, region, size, downloadCount, numberOfReviews, averageRating, 
      downloadLink, directDownloadLink, createdAt, updatedAt, romType
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

    for (const rom of topRoms) {
      await new Promise<void>((resolve, reject) => {
        insertRomStmt.run([
          rom.id, rom.title, rom.url, rom.console, rom.description, rom.mainImage,
          rom.screenshots, rom.genre, rom.releaseDate, rom.publisher, rom.region,
          rom.size, rom.downloadCount, rom.numberOfReviews, rom.averageRating,
          rom.downloadLink, rom.directDownloadLink, rom.createdAt, rom.updatedAt, rom.romType
        ], function(err) { if (err) reject(err); else resolve(); });
      });
    }
    insertRomStmt.finalize();

    // Step 4: Get all related ROMs for the top ROMs
    const topRomIds = topRoms.map(r => r.id);
    const placeholders = topRomIds.map(() => '?').join(',');
    console.log(`\nFetching related ROMs for top ${topRoms.length} ROMs...`);
    const relatedRoms = await sourceAll(
      `SELECT * FROM related_roms WHERE romId IN (${placeholders})`,
      topRomIds
    );
    console.log(`Found ${relatedRoms.length} related ROMs`);

    // Step 5: Insert related ROMs into output DB
    if (relatedRoms.length > 0) {
      console.log(`Inserting ${relatedRoms.length} related ROMs into output DB...`);
      const insertRelatedStmt = outputDb.prepare(`INSERT INTO related_roms (
        id, romId, title, url, image, console, downloadCount, size, romType
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);

      for (const rel of relatedRoms) {
        await new Promise<void>((resolve, reject) => {
          insertRelatedStmt.run([
            rel.id, rel.romId, rel.title, rel.url, rel.image, 
            rel.console, rel.downloadCount, rel.size, rel.romType
          ], function(err) { if (err) reject(err); else resolve(); });
        });
      }
      insertRelatedStmt.finalize();
    }

    // Step 6: Create indexes
    console.log('Creating indexes...');
    await outputRun('CREATE INDEX IF NOT EXISTS idx_roms_console ON roms(console)');
    await outputRun('CREATE INDEX IF NOT EXISTS idx_roms_title ON roms(title)');
    await outputRun('CREATE INDEX IF NOT EXISTS idx_related_roms_romId ON related_roms(romId)');

    console.log(`\n✅ Successfully extracted top ${topRoms.length} ROMs and ${relatedRoms.length} related ROMs`);
    console.log(`Output saved to: ${outputDbPath}`);

  } catch (err) {
    console.error('Error during extraction:', err);
    process.exit(1);
  } finally {
    sourceDb.close();
    outputDb.close();
  }
}

if (require.main === module) {
  main();
}
