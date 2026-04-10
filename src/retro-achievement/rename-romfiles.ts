// Rename romFile column values in a md5 CSV:
//   - Replace spaces with "."
//   - Remove "," "(" ")"
// Usage: npx ts-node src/retro-achievement/rename-romfiles.ts <csv-path>
// Example: npx ts-node src/retro-achievement/rename-romfiles.ts output/nds-md5.csv

import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';

function transformRomFileName(name: string): string {
  if (!name || name.trim() === '') return name;
  return name
    .replace(/ /g, '.')    // space → dot
    .replace(/,/g, '.')    // comma → dot
    .replace(/'/g, '.')    // comma → dot
    .replace(/\(/g, '')    // remove (
    .replace(/\)/g, '')    // remove )
    .replace(/\.{2,}/g, '.'); // collapse multiple dots → single dot
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.log('Usage: npx ts-node src/retro-achievement/rename-romfiles.ts <csv-path>');
    process.exit(1);
  }

  const csvPath = args[0];
  // --force: re-apply transform even on already-transformed values
  const force = args.includes('--force');
  if (!fs.existsSync(csvPath)) {
    console.error(`❌ File not found: ${csvPath}`);
    process.exit(1);
  }

  const content = fs.readFileSync(csvPath, 'utf-8');
  const records: any[] = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_quotes: true,
  });

  let changed = 0;
  for (const row of records) {
    if (row.romFile && row.romFile.trim() !== '') {
      const original = row.romFile;
      const transformed = transformRomFileName(original);
      if (original !== transformed) {
        console.log(`  "${original}"`);
        console.log(`  → "${transformed}"\n`);
        row.romFile = transformed;
        changed++;
      }
    }
  }

  const columns = Object.keys(records[0] || {});
  const output = stringify(records, { header: true, columns });
  fs.writeFileSync(csvPath, output, 'utf-8');

  console.log(`✓ Done. ${changed} romFile values renamed in ${path.basename(csvPath)}`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
