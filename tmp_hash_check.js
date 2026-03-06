const AdmZip = require('adm-zip');
const crypto = require('crypto');

function md5(buf) { return crypto.createHash('md5').update(buf).digest('hex'); }

const INES_MAGIC = Buffer.from([0x4E, 0x45, 0x53, 0x1A]);

function hashesForZip(zipPath) {
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries().filter(e => !e.isDirectory);
  const results = [];
  for (const entry of entries) {
    const data = entry.getData();
    const full = md5(data);
    let noHeader = null;
    if (data.slice(0,4).equals(INES_MAGIC)) {
      noHeader = md5(data.slice(16));
    }
    results.push({ name: entry.entryName, size: data.length, full, noHeader });
  }
  return results;
}

// Castlevania RA hashes: 728e05f245ab8b7fe61083f6919dc485 etc.
const RA_CASTLEVANIA = new Set([
  '728e05f245ab8b7fe61083f6919dc485',
  '890958883f86ad71e73e7d14cb7c1cc0',
  '72fcfde76971ce7b1592ed4a13a7cdaf',
  '756170ba1e06fa26c60d10114dc6a5ae',
  'ce20d494ab91bb8e723f9f415988b686',
  '3cbc994df40436a0c6f337cf5f47c8dc',
  'd400b821332a63cea14215d91e6d66b1',
]);

const RA_CONTRA = new Set(['5a5c2f4f1cafb1f55a8dc0d5ad4550e5']);
const RA_MEGAMAN = new Set(['4de82cfceadbf1a5e693b669b1221107','8d5a61f42d92ee61d05083263a11fca1','e1542de8784b93492fd7686f56f30376']);

for (const [file, raHashes] of [
  ['downloads/nes/Castlevania.zip', RA_CASTLEVANIA],
  ['downloads/nes/Contra.zip', RA_CONTRA],
  ['downloads/nes/Mega_Man.zip', RA_MEGAMAN],
]) {
  console.log(`\n=== ${file} ===`);
  const hashes = hashesForZip(file);
  for (const h of hashes) {
    const fullMatch = raHashes.has(h.full) ? '✅ MATCH (full)' : '';
    const noHdrMatch = h.noHeader && raHashes.has(h.noHeader) ? '✅ MATCH (no-header)' : '';
    console.log(`  ${h.name} (${h.size} bytes)`);
    console.log(`    full     : ${h.full} ${fullMatch}`);
    if (h.noHeader) console.log(`    no-hdr   : ${h.noHeader} ${noHdrMatch}`);
  }
}
