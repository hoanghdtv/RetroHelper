import sqlite3 from 'sqlite3';
import * as fs from 'fs';
import * as path from 'path';

// This script renumbers rom IDs and updates related_roms.romId accordingly.
// Usage:
//   npx ts-node src/rom-analytics/rom-analytics.ts <startId> [dbPath] [--dry-run] [--backup]
// Example:
//   npx ts-node src/rom-analytics/rom-analytics.ts 10000 ./output/roms.db --backup

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    console.log('Usage: npx ts-node src/rom-analytics/rom-analytics.ts <startId> [dbPath] [--dry-run] [--backup]');
    process.exit(1);
  }

  const startId = parseInt(argv[0], 10);
  if (isNaN(startId) || startId <= 0) {
    console.error('startId must be a positive integer');
    process.exit(1);
  }

  const dbPath = argv[1] || path.join('output', 'roms.db');
  const dryRun = argv.includes('--dry-run');
  const doBackup = argv.includes('--backup');
  const renumberRelated = argv.includes('--renumber-related');
  const relatedStartFlagIndex = argv.indexOf('--related-start');
  let relatedStart: number | null = null;
  if (relatedStartFlagIndex !== -1) {
    const val = argv[relatedStartFlagIndex + 1];
    relatedStart = parseInt(val, 10);
    if (isNaN(relatedStart) || relatedStart <= 0) {
      console.error('--related-start must be followed by a positive integer');
      process.exit(1);
    }
  }

  if (!fs.existsSync(dbPath)) {
    console.error(`DB not found at ${dbPath}`);
    process.exit(1);
  }

  if (doBackup) {
    const bak = `${dbPath}.${Date.now()}.bak`;
    fs.copyFileSync(dbPath, bak);
    console.log(`Backup created: ${bak}`);
  }

  const db = new sqlite3.Database(dbPath);

  // Promisify basic helpers
  const run = (sql: string, params: any[] = []) => new Promise<void>((res, rej) => db.run(sql, params, function(err) { if (err) rej(err); else res(); }));
  const all = (sql: string, params: any[] = []) => new Promise<any[]>((res, rej) => db.all(sql, params, (err, rows) => { if (err) rej(err); else res(rows); }));

  try {
    console.log(`Reading all roms from ${dbPath}...`);
    const roms = await all('SELECT id, title FROM roms ORDER BY id ASC');
    console.log(`Found ${roms.length} roms`);

    // Build mapping from oldId -> newId
    const mapping: Record<number, number> = {};
    let nextId = startId;
    for (const r of roms) {
      mapping[r.id] = nextId++;
    }

    // Show sample of mapping
    const sample = Object.entries(mapping).slice(0, 10).map(([oldId, newId]) => ({ oldId: Number(oldId), newId }));
    console.log('Sample id mapping:', sample);

    if (dryRun) {
      console.log('--dry-run set, no changes will be written.');
      if (renumberRelated) {
        // Show sample related mapping (do a quick read)
        const relatedRowsPreview = await all('SELECT id FROM related_roms ORDER BY id ASC LIMIT 10');
        const relatedSample = relatedRowsPreview.map((r: any, idx: number) => ({ oldId: r.id, newId: (relatedStart || (startId + roms.length)) + idx }));
        console.log('Sample related id mapping (preview):', relatedSample);
      }
      await db.close();
      process.exit(0);
    }

    // Start transaction
    await run('BEGIN TRANSACTION');

    // Update roms table: we must be careful to avoid UNIQUE conflicts on url — we update by creating temp column new_id then swapping
    // Strategy:
    // 1) Add temporary column new_id
    // 2) Update new_id for each row
    // 3) Create new table roms_new with same schema but empty
    // 4) Copy rows into roms_new with id = new_id
    // 5) Drop old table, rename roms_new to roms
    // 6) Recreate indexes

    console.log('Adding temporary column new_id');
    await run('ALTER TABLE roms ADD COLUMN new_id INTEGER');

    console.log('Populating new_id values');
    const stmtUpdate = db.prepare('UPDATE roms SET new_id = ? WHERE id = ?');
    for (const [oldIdStr, newId] of Object.entries(mapping)) {
      const oldId = Number(oldIdStr);
      await new Promise<void>((resolve, reject) => {
        stmtUpdate.run([newId, oldId], function(err) { if (err) reject(err); else resolve(); });
      });
    }
    stmtUpdate.finalize();

    // Read current schema of roms
    const romsInfo = await all("PRAGMA table_info('roms')");
    const romsCols = romsInfo.map((c: any) => c.name);

    // Create roms_new with identical schema but without AUTOINCREMENT on id (we'll set id explicitly)
    // For simplicity recreate with columns manually similar to database.ts
    console.log('Creating roms_new table');
    await run(`CREATE TABLE IF NOT EXISTS roms_new (
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

    // Copy rows into roms_new with new id from new_id
    console.log('Copying rows into roms_new with new ids');
    await run(`INSERT INTO roms_new (id, title, url, console, description, mainImage, screenshots, genre, releaseDate, publisher, region, size, downloadCount, numberOfReviews, averageRating, downloadLink, directDownloadLink, createdAt, updatedAt, romType)
      SELECT new_id, title, url, console, description, mainImage, screenshots, genre, releaseDate, publisher, region, size, downloadCount, numberOfReviews, averageRating, downloadLink, directDownloadLink, createdAt, updatedAt, romType FROM roms ORDER BY id ASC`);

    // Now we need to update related_roms. It references old romId values.
    console.log('Updating related_roms to point to new rom IDs');
    // Create related_roms_new with same schema. If renumbering related ids we will set id explicitly,
    // otherwise keep AUTOINCREMENT
    if (renumberRelated) {
      console.log('Renumbering related_roms.id as requested');
      await run(`CREATE TABLE IF NOT EXISTS related_roms_new (
        id INTEGER PRIMARY KEY,
        romId INTEGER NOT NULL,
        title TEXT NOT NULL,
        url TEXT NOT NULL,
        image TEXT,
        console TEXT,
        downloadCount TEXT,
        size TEXT,
        romType TEXT
      )`);
    } else {
      await run(`CREATE TABLE IF NOT EXISTS related_roms_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        romId INTEGER NOT NULL,
        title TEXT NOT NULL,
        url TEXT NOT NULL,
        image TEXT,
        console TEXT,
        downloadCount TEXT,
        size TEXT,
        romType TEXT
      )`);
    }

    // Copy related rows, mapping romId
    const relatedRows = await all('SELECT id, romId, title, url, image, console, downloadCount, size, romType FROM related_roms');

    // If requested, build mapping for related row ids to avoid conflicts
    let relatedMapping: Record<number, number> = {};
    if (renumberRelated) {
      // Decide start value for related ids
      let nextRelatedId = relatedStart || nextId; // nextId currently points after last rom new id
      console.log(`Building related id mapping starting at ${nextRelatedId}`);
      for (const rr of relatedRows) {
        relatedMapping[rr.id] = nextRelatedId++;
      }
      // Show small sample
      const relSample = Object.entries(relatedMapping).slice(0, 10).map(([oldId, newId]) => ({ oldId: Number(oldId), newId }));
      console.log('Sample related id mapping:', relSample);
    }

    const insertRelated = db.prepare('INSERT INTO related_roms_new (id, romId, title, url, image, console, downloadCount, size, romType) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const r of relatedRows) {
      const oldRomId = r.romId;
      const newRomId = mapping[oldRomId];
      if (!newRomId) {
        console.warn(`Warning: related_roms row id=${r.id} references missing romId=${oldRomId}; skipping`);
        continue;
      }
      const newId = renumberRelated ? relatedMapping[r.id] : r.id;
      await new Promise<void>((resolve, reject) => {
        insertRelated.run([newId, newRomId, r.title, r.url, r.image, r.console, r.downloadCount, r.size, r.romType], function(err) { if (err) reject(err); else resolve(); });
      });
    }
    insertRelated.finalize();

    // Swap tables: drop old and rename new
    console.log('Dropping old tables and renaming new ones');
    await run('DROP TABLE related_roms');
    await run('ALTER TABLE related_roms_new RENAME TO related_roms');

    await run('DROP TABLE roms');
    await run('ALTER TABLE roms_new RENAME TO roms');

    // Recreate indexes
    console.log('Recreating indexes');
    await run('CREATE INDEX IF NOT EXISTS idx_roms_console ON roms(console)');
    await run('CREATE INDEX IF NOT EXISTS idx_roms_title ON roms(title)');
    await run('CREATE INDEX IF NOT EXISTS idx_related_roms_romId ON related_roms(romId)');

    // Commit
    await run('COMMIT');

    console.log('Renumbering completed successfully');

  } catch (err) {
    console.error('Error during renumbering:', err);
    try { await run('ROLLBACK'); } catch (e) {}
  } finally {
    db.close();
  }
}

if (require.main === module) {
  main();
}
