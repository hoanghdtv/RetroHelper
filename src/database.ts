import sqlite3 from 'sqlite3';
import * as fs from 'fs';
import * as path from 'path';

export interface Rom {
  title: string;
  url: string;
  console: string;
  description?: string;
  mainImage?: string;
  screenshots?: string[];
  genre?: string[];
  releaseDate?: string;
  publisher?: string;
  region?: string[];
  size?: string;
  downloadCount?: string;
  numberOfReviews?: string;
  averageRating?: string;
  downloadLink?: string;
  directDownloadLink?: string;
  relatedRoms?: RelatedRom[];
  romType?: string;
}

export interface RelatedRom {
  title: string;
  url: string;
  image?: string;
  console: string;
  downloadCount?: string;
  size?: string;
  romType?: string;
}

export class RomDatabase {
  private db: sqlite3.Database;

  constructor(dbPath: string = './output/roms.db') {
    // Ensure parent directory exists so SQLite can create the file
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new sqlite3.Database(dbPath);
  }

  // Helper methods for promisified database operations
  private run(sql: string, params: any[] = []): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function(err) {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  private get(sql: string, params: any[] = []): Promise<any> {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

  private all(sql: string, params: any[] = []): Promise<any[]> {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  /**
   * Initialize database schema
   */
  async init(): Promise<void> {
    // Create roms table
    await this.run(`
      CREATE TABLE IF NOT EXISTS roms (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
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
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        romType TEXT
      )
    `);

    // Create related_roms table
    await this.run(`
      CREATE TABLE IF NOT EXISTS related_roms (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        romId INTEGER NOT NULL,
        title TEXT NOT NULL,
        url TEXT NOT NULL,
        image TEXT,
        console TEXT,
        downloadCount TEXT,
        size TEXT,
        romType TEXT,
        FOREIGN KEY (romId) REFERENCES roms(id) ON DELETE CASCADE
      )
    `);

    // Create indexes
    await this.run(`CREATE INDEX IF NOT EXISTS idx_roms_console ON roms(console)`);
    await this.run(`CREATE INDEX IF NOT EXISTS idx_roms_title ON roms(title)`);
    await this.run(`CREATE INDEX IF NOT EXISTS idx_related_roms_romId ON related_roms(romId)`);

    console.log('✓ Database initialized');
  }

  /**
   * Insert or update a ROM
   */
  async saveRom(rom: Rom): Promise<number> {
    // Convert arrays to JSON strings
    const screenshots = rom.screenshots ? JSON.stringify(rom.screenshots) : null;
    const genre = rom.genre ? JSON.stringify(rom.genre) : null;
    const region = rom.region ? JSON.stringify(rom.region) : null;

    // Insert or replace ROM
    await this.run(`
      INSERT OR REPLACE INTO roms (
        title, url, console, description, mainImage, screenshots, 
        genre, releaseDate, publisher, region, size, downloadCount, 
        numberOfReviews, averageRating, downloadLink, directDownloadLink, updatedAt, romType
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
    `, [
      rom.title,
      rom.url,
      rom.console,
      rom.description || null,
      rom.mainImage || null,
      screenshots,
      genre,
      rom.releaseDate || null,
      rom.publisher || null,
      region,
      rom.size || null,
      rom.downloadCount || null,
      rom.numberOfReviews || null,
      rom.averageRating || null,
      rom.downloadLink || null,
      rom.directDownloadLink || null,
      rom.romType || null,
    ]);

    // Get the ROM ID
    const row = await this.get('SELECT id FROM roms WHERE url = ?', [rom.url]) as any;
    const romId = row.id;

    // Delete old related ROMs
    await this.run('DELETE FROM related_roms WHERE romId = ?', [romId]);

    // Insert related ROMs
    if (rom.relatedRoms && rom.relatedRoms.length > 0) {
      for (const relatedRom of rom.relatedRoms) {
        await this.run(`
          INSERT INTO related_roms (romId, title, url, image, console, downloadCount, size, romType)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          romId,
          relatedRom.title,
          relatedRom.url,
          relatedRom.image || null,
          relatedRom.console,
          relatedRom.downloadCount || null,
          relatedRom.size || null,
          relatedRom.romType || null,
        ]);
      }
    }

    return romId;
  }

  /**
   * Get ROM by URL
   */
  async getRomByUrl(url: string): Promise<Rom | null> {
    const row = await this.get('SELECT * FROM roms WHERE url = ?', [url]) as any;
    if (!row) return null;

    // Get related ROMs
    const relatedRows = await this.all('SELECT * FROM related_roms WHERE romId = ?', [row.id]) as any[];

    return this.rowToRom(row, relatedRows);
  }

  /**
   * Get all ROMs for a console
   */
  async getRomsByConsole(console: string): Promise<Rom[]> {
    const rows = await this.all('SELECT * FROM roms WHERE console = ? ORDER BY title', [console]) as any[];
    
    const roms: Rom[] = [];
    for (const row of rows) {
      const relatedRows = await this.all('SELECT * FROM related_roms WHERE romId = ?', [row.id]) as any[];
      roms.push(this.rowToRom(row, relatedRows));
    }

    return roms;
  }

  /**
   * Get all ROMs from database
   */
  async getAllRoms(): Promise<Rom[]> {
    const rows = await this.all('SELECT * FROM roms ORDER BY console, title') as any[];
    
    const roms: Rom[] = [];
    for (const row of rows) {
      const relatedRows = await this.all('SELECT * FROM related_roms WHERE romId = ?', [row.id]) as any[];
      roms.push(this.rowToRom(row, relatedRows));
    }

    return roms;
  }

  /**
   * Get statistics
   */
  async getStats(): Promise<any> {
    const totalRoms = await this.get('SELECT COUNT(*) as count FROM roms') as any;
    const totalConsoles = await this.get('SELECT COUNT(DISTINCT console) as count FROM roms') as any;
    const romsWithDirectLinks = await this.get('SELECT COUNT(*) as count FROM roms WHERE directDownloadLink IS NOT NULL') as any;
    const romsWithDescriptions = await this.get('SELECT COUNT(*) as count FROM roms WHERE description IS NOT NULL') as any;
    
    const consoleStats = await this.all(`
      SELECT console, COUNT(*) as count 
      FROM roms 
      GROUP BY console 
      ORDER BY count DESC
    `) as any[];

    return {
      totalRoms: totalRoms.count,
      totalConsoles: totalConsoles.count,
      romsWithDirectLinks: romsWithDirectLinks.count,
      romsWithDescriptions: romsWithDescriptions.count,
      consoles: consoleStats,
    };
  }

  /**
   * Search ROMs
   */
  async searchRoms(query: string): Promise<Rom[]> {
    const rows = await this.all(`
      SELECT * FROM roms 
      WHERE title LIKE ? OR description LIKE ?
      ORDER BY title
      LIMIT 100
    `, [`%${query}%`, `%${query}%`]) as any[];
    
    const roms: Rom[] = [];
    for (const row of rows) {
      const relatedRows = await this.all('SELECT * FROM related_roms WHERE romId = ?', [row.id]) as any[];
      roms.push(this.rowToRom(row, relatedRows));
    }

    return roms;
  }

  /**
   * Convert database row to Rom object
   */
  private rowToRom(row: any, relatedRows: any[]): Rom {
    return {
      title: row.title,
      url: row.url,
      console: row.console,
      description: row.description,
      mainImage: row.mainImage,
      screenshots: row.screenshots ? JSON.parse(row.screenshots) : undefined,
      genre: row.genre ? JSON.parse(row.genre) : undefined,
      releaseDate: row.releaseDate,
      publisher: row.publisher,
      region: row.region ? JSON.parse(row.region) : undefined,
      size: row.size,
      downloadCount: row.downloadCount,
      numberOfReviews: row.numberOfReviews,
      averageRating: row.averageRating,
      downloadLink: row.downloadLink,
      directDownloadLink: row.directDownloadLink,
      relatedRoms: relatedRows.map(r => ({
        title: r.title,
        url: r.url,
        image: r.image,
        console: r.console,
        downloadCount: r.downloadCount,
        size: r.size,
        romType: r.romType,
      })),
      romType: row.romType,
    };
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
}
