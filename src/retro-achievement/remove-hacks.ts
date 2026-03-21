// Remove rows where title contains "~Hack~" from all *-games.csv and *-md5.csv files in the output folder
// Usage: npx ts-node src/retro-achievement/remove-hacks.ts

import * as fs from 'fs';
import * as path from 'path';

const OUTPUT_DIR = path.resolve(__dirname, '../../output');

function removeHackRows(filePath: string): void {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split(/\r?\n/);

  const header = lines[0];
  const dataLines = lines.slice(1);

  const kept: string[] = [];
  const removed: string[] = [];

  for (const line of dataLines) {
    if (line.trim() === '') continue;
    if (line.includes('~Hack~')) {
      removed.push(line);
    } else {
      kept.push(line);
    }
  }

  const output = [header, ...kept].join('\n');
  fs.writeFileSync(filePath, output, 'utf-8');

  const fileName = path.basename(filePath);
  console.log(`${fileName}: removed ${removed.length} ~Hack~ rows, kept ${kept.length} rows`);

  if (removed.length > 0) {
    for (const r of removed) {
      // Extract title from CSV (2nd or 3rd column depending on file type)
      const match = r.match(/~Hack~[^,"]*/);
      console.log(`  - ${match ? match[0] : r.substring(0, 60)}`);
    }
  }
}

const files = fs.readdirSync(OUTPUT_DIR).filter(
  f => f.endsWith('-games.csv') || f.endsWith('-md5.csv')
);

console.log(`Found ${files.length} CSV files to process\n`);

let totalRemoved = 0;
for (const file of files.sort()) {
  const filePath = path.join(OUTPUT_DIR, file);
  const before = fs.readFileSync(filePath, 'utf-8').split(/\r?\n/).filter(l => l.trim()).length - 1;
  removeHackRows(filePath);
  const after = fs.readFileSync(filePath, 'utf-8').split(/\r?\n/).filter(l => l.trim()).length - 1;
  totalRemoved += before - after;
}

console.log(`\nDone. Total rows removed: ${totalRemoved}`);
