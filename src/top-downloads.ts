#!/usr/bin/env ts-node
import { RomDatabase } from './database';

function parseDownloadCount(raw?: string | null): number {
  if (!raw) return 0;
  const s = String(raw).trim().toLowerCase();

  // If contains 'k' or 'm' suffix
  const kmMatch = s.match(/([\d.,]+)\s*([km])/);
  if (kmMatch) {
    const num = Number(kmMatch[1].replace(/,/g, ''));
    if (isNaN(num)) return 0;
    const suffix = kmMatch[2];
    if (suffix === 'k') return Math.round(num * 1000);
    if (suffix === 'm') return Math.round(num * 1000000);
  }

  // Otherwise extract digits
  const digitsMatch = s.match(/[\d,]+/);
  if (digitsMatch) {
    const n = Number(digitsMatch[0].replace(/,/g, ''));
    return isNaN(n) ? 0 : n;
  }

  return 0;
}

async function main() {
  const arg = process.argv[2];
  const dbPathArg = process.argv[3];
  const limit = arg ? parseInt(arg, 10) || 10 : 10;
  const dbPath = dbPathArg || './output/roms.db';

  const db = new RomDatabase(dbPath);
  try {
    // We don't need to init the DB here; just read
    // Get all roms
    const rows: any[] = await db['all']('SELECT id, title, url, console, downloadCount FROM roms');

    const mapped = rows.map(r => ({
      id: r.id,
      title: r.title,
      url: r.url,
      console: r.console,
      rawDownloadCount: r.downloadCount,
      downloads: parseDownloadCount(r.downloadCount),
    }));

    mapped.sort((a, b) => b.downloads - a.downloads);

    const top = mapped.slice(0, limit);

    console.log(JSON.stringify(top, null, 2));

  } catch (error) {
    console.error('Error reading DB:', error);
    process.exit(1);
  } finally {
    await db.close();
  }
}

if (require.main === module) {
  main();
}
