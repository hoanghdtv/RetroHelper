// Match ROM zip files to RA game CSV by MD5 hash
// Usage:
//   npx ts-node src/retro-achievement/match-rom-files.ts <csv-path> <downloads-dir> [options]
//   npx ts-node src/retro-achievement/match-rom-files.ts output/nes-md5.csv downloads/NES
//   npx ts-node src/retro-achievement/match-rom-files.ts output/nes-md5.csv downloads/NES --resume
//   npx ts-node src/retro-achievement/match-rom-files.ts output/nes-md5.csv downloads/NES --force
//
// Options:
//   --resume   Skip rows that already have a romFile value (continue interrupted run)
//   --force    Clear all existing romFile values and re-scan everything from scratch
//
// The script:
//   1. Reads <csv-path>  (columns: gameId, gameTitle, md5, romName, ...)
//   2. Scans every *.zip in <downloads-dir>
//   3. For each zip: extracts the ROM buffer, strips iNES header if present, computes MD5
//   4. If the MD5 matches a row in the CSV → writes the zip filename into "romFile"
//      and the zip file size (bytes) into "romSize"
//   5. Saves the updated CSV to <csv-path> (in-place)

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import AdmZip from 'adm-zip';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const INES_MAGIC = Buffer.from([0x4e, 0x45, 0x53, 0x1a]); // "NES\x1a"

/** Compute MD5 of a buffer */
function md5(buf: Buffer): string {
  return crypto.createHash('md5').update(buf).digest('hex');
}

/**
 * Return the hashes we should compare against the RA MD5 list.
 * For NES ROMs we try both the raw buffer AND the buffer with the
 * 16-byte iNES header stripped — RA hashes NES without the header.
 */
function hashesForBuffer(data: Buffer): string[] {
  const hashes: string[] = [md5(data)];
  if (data.length > 16 && data.slice(0, 4).equals(INES_MAGIC)) {
    hashes.push(md5(data.slice(16)));
  }
  return hashes;
}

/**
 * Scan one zip file and return all MD5 hashes (full + no-header where applicable).
 * Also returns the zip file size in bytes.
 */
function hashZip(zipPath: string): { hashes: Map<string, string>; size: number } {
  const zipName = path.basename(zipPath);
  const hashes = new Map<string, string>();
  let size = 0;
  try {
    size = fs.statSync(zipPath).size;
    const zip = new AdmZip(zipPath);
    const entries = zip.getEntries().filter(e => !e.isDirectory);
    for (const entry of entries) {
      const data = entry.getData();
      for (const h of hashesForBuffer(data)) {
        hashes.set(h, zipName);
      }
    }
  } catch (err) {
    console.warn(`  ⚠️  Could not read ${zipName}: ${err}`);
  }
  return { hashes, size };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2 || args[0].startsWith('--')) {
    console.log(`
Usage:
  npx ts-node src/retro-achievement/match-rom-files.ts <csv-path> <downloads-dir> [options]

Options:
  --resume   Skip rows that already have a romFile value (continue interrupted run)
  --force    Clear all existing romFile values and re-scan everything from scratch

Examples:
  npx ts-node src/retro-achievement/match-rom-files.ts output/nes-md5.csv downloads/NES
  npx ts-node src/retro-achievement/match-rom-files.ts output/nes-md5.csv downloads/NES --resume
  npx ts-node src/retro-achievement/match-rom-files.ts output/nes-md5.csv downloads/NES --force
`);
    process.exit(1);
  }

  const csvPath = args[0];
  const downloadsDir = args[1];
  const resume = args.includes('--resume');
  const force  = args.includes('--force');

  if (resume && force) {
    console.error('❌ --resume and --force are mutually exclusive');
    process.exit(1);
  }

  if (!fs.existsSync(csvPath)) {
    console.error(`❌ CSV not found: ${csvPath}`);
    process.exit(1);
  }
  if (!fs.existsSync(downloadsDir)) {
    console.error(`❌ Downloads directory not found: ${downloadsDir}`);
    process.exit(1);
  }

  // ── 1. Read CSV ────────────────────────────────────────────────────────────
  console.log(`\n=== Match ROM Files to CSV ===`);
  console.log(`CSV     : ${csvPath}`);
  console.log(`ZIP dir : ${downloadsDir}`);
  if (resume) console.log(`Mode    : resume (skipping already-matched rows)`);
  if (force)  console.log(`Mode    : force  (clearing existing romFile values)`);
  console.log();

  const csvContent = fs.readFileSync(csvPath, 'utf-8');
  const records: any[] = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  console.log(`Loaded ${records.length} rows from CSV`);

  // --force: wipe all existing romFile / romSize values
  if (force) {
    let cleared = 0;
    for (const r of records) {
      if (r.romFile) { r.romFile = ''; r.romSize = ''; cleared++; }
    }
    if (cleared > 0) console.log(`  ↺  Cleared ${cleared} existing romFile/romSize values`);
  }

  // Build a lookup: md5 (lowercase) → row index
  // --resume: skip rows that already have a romFile
  const md5ToIndex = new Map<string, number>();
  let alreadyMatched = 0;
  for (let i = 0; i < records.length; i++) {
    if (resume && records[i].romFile) {
      alreadyMatched++;
      continue; // already matched in a previous run — keep as-is
    }
    const m = (records[i].md5 || '').trim().toLowerCase();
    if (m) md5ToIndex.set(m, i);
  }

  if (resume && alreadyMatched > 0) {
    console.log(`  ⏭  Skipping ${alreadyMatched} rows already matched (--resume)`);
  }

  // ── 2. Scan ZIP files ──────────────────────────────────────────────────────
  const zipFiles = fs
    .readdirSync(downloadsDir)
    .filter(f => f.toLowerCase().endsWith('.zip'))
    .sort();

  console.log(`Found ${zipFiles.length} zip files in ${downloadsDir}\n`);

  let matchCount = 0;
  let processedCount = 0;
  let skippedCount = 0;

  for (const zipName of zipFiles) {
    const zipPath = path.join(downloadsDir, zipName);
    processedCount++;

    // --resume: if every MD5 from this zip already has a match, skip hashing it
    if (resume) {
      // Quick check: we only need to hash zips whose MD5 is still in our lookup
      // (rows without a romFile). If the lookup is empty we're done.
      if (md5ToIndex.size === 0) {
        skippedCount++;
        continue;
      }
    }

    const { hashes, size: zipSize } = hashZip(zipPath);

    let matched = false;
    for (const [hash] of hashes) {
      const idx = md5ToIndex.get(hash);
      if (idx !== undefined) {
        records[idx].romFile = zipName;
        records[idx].romSize = zipSize;
        matchCount++;
        matched = true;
        md5ToIndex.delete(hash); // remove so we stop looking for it
        console.log(`  ✅ [${processedCount}/${zipFiles.length}] ${zipName}`);
        console.log(`       → ${records[idx].gameTitle} (md5: ${hash}, size: ${(zipSize / 1024).toFixed(1)} KB)`);
        break; // one zip → one matching ROM
      }
    }

    if (!matched) {
      skippedCount++;
      if (processedCount % 50 === 0) {
        console.log(`  … [${processedCount}/${zipFiles.length}] processed`);
      }
    }
  }

  // ── 3. Determine output columns ────────────────────────────────────────────
  // Preserve original columns, append romFile / romSize if not already present
  const firstRecord = records[0] || {};
  const existingCols: string[] = Object.keys(firstRecord);

  let columns = [...existingCols];
  if (!columns.includes('romFile')) columns.push('romFile');
  if (!columns.includes('romSize')) {
    // insert romSize right after romFile
    const idx = columns.indexOf('romFile');
    columns.splice(idx + 1, 0, 'romSize');
  }

  // ── 4. Write updated CSV ───────────────────────────────────────────────────
  const csv = stringify(records, {
    header: true,
    columns,
  });

  fs.writeFileSync(csvPath, csv, 'utf-8');

  // ── 5. Summary ─────────────────────────────────────────────────────────────
  const totalMatched = records.filter(r => r.romFile).length;
  console.log(`\n=== Summary ===`);
  console.log(`  ZIP files scanned    : ${zipFiles.length}`);
  console.log(`  CSV rows             : ${records.length}`);
  if (resume) console.log(`  Already matched      : ${alreadyMatched}`);
  console.log(`  Matched this run     : ${matchCount}`);
  console.log(`  Total matched in CSV : ${totalMatched}`);
  console.log(`  Unmatched CSV rows   : ${records.length - totalMatched}`);
  console.log(`\n✓ Saved updated CSV to ${csvPath}`);

  // Print unmatched CSV rows
  const unmatched = records.filter(r => !r.romFile);
  if (unmatched.length > 0) {
    console.log(`\nCSV rows without a matching ZIP (${unmatched.length}):`);
    for (const r of unmatched) {
      console.log(`  - ${r.gameTitle} (md5: ${r.md5})`);
    }
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
