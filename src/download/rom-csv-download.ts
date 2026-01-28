import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { Rom } from '../database';
import * as cheerio from 'cheerio';
import { chromium } from 'playwright';

// Program to read CSV file and download ROM files
// Usage: npx ts-node src/download/rom-csv-download.ts <csvPath> [--output <dir>] [--limit <n>] [--manual-select <index>]
// Example: 
//   npx ts-node src/download/rom-csv-download.ts output/topnes-split/roms.csv --output downloads/nes --limit 10
//   npx ts-node src/download/rom-csv-download.ts output/topnes-split/roms.csv --output downloads/nes --limit 1 --manual-select 0

interface DownloadOptions {
  csvPath: string;
  outputDir: string;
  limit?: number;
  manualSelectIndex?: number;
}

function parseCSVToRoms(csvPath: string): Rom[] {
  console.log(`Reading CSV from ${csvPath}...`);
  
  if (!fs.existsSync(csvPath)) {
    throw new Error(`CSV file not found: ${csvPath}`);
  }

  const csvContent = fs.readFileSync(csvPath, 'utf-8');
  const records = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  const roms: Rom[] = records.map((record: any) => {
    // Parse arrays from CSV (stored as pipe-separated or comma-separated)
    const parseArray = (value: string | undefined): string[] | undefined => {
      if (!value || value.trim() === '') return undefined;
      // Try pipe separator first, then comma
      if (value.includes('|')) {
        return value.split('|').map(s => s.trim()).filter(s => s);
      }
      return value.split(',').map(s => s.trim()).filter(s => s);
    };

    return {
      id: record.id ? parseInt(record.id, 10) : undefined,
      title: record.title,
      url: record.url,
      console: record.console,
      description: record.description || undefined,
      mainImage: record.mainImage || undefined,
      screenshots: parseArray(record.screenshots),
      genre: parseArray(record.genre),
      releaseDate: record.releaseDate || undefined,
      publisher: record.publisher || undefined,
      region: parseArray(record.region),
      size: record.size || undefined,
      downloadCount: record.downloadCount || undefined,
      numberOfReviews: record.numberOfReviews || undefined,
      averageRating: record.averageRating || undefined,
      downloadLink: record.downloadLink || undefined,
      directDownloadLink: record.directDownloadLink || undefined,
      romType: record.romType || undefined,
    };
  });

  console.log(`Parsed ${roms.length} ROMs from CSV`);
  return roms;
}

function downloadFile(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    
    const file = fs.createWriteStream(destPath);
    
    const request = protocol.get(url, { 
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      }
    }, (response) => {
      // Handle redirects
      if (response.statusCode === 301 || response.statusCode === 302) {
        const redirectUrl = response.headers.location;
        if (redirectUrl) {
          file.close();
          fs.unlinkSync(destPath);
          downloadFile(redirectUrl, destPath).then(resolve).catch(reject);
          return;
        }
      }

      if (response.statusCode !== 200) {
        file.close();
        fs.unlinkSync(destPath);
        reject(new Error(`Failed to download: HTTP ${response.statusCode}`));
        return;
      }

      response.pipe(file);

      file.on('finish', () => {
        file.close();
        resolve();
      });

      file.on('error', (err) => {
        file.close();
        fs.unlinkSync(destPath);
        reject(err);
      });
    });

    request.on('error', (err) => {
      file.close();
      if (fs.existsSync(destPath)) {
        fs.unlinkSync(destPath);
      }
      reject(err);
    });
  });
}

function sanitizeFilename(filename: string): string {
  // Remove or replace invalid characters for filenames
  return filename
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, '_')
    .substring(0, 200); // Limit length
}

interface RomDownloadOption {
  title: string;
  url: string;
  region?: string;
  version?: string;
}

function fetchHTML(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    
    protocol.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      }
    }, (response) => {
      // Handle redirects
      if (response.statusCode === 301 || response.statusCode === 302) {
        const redirectUrl = response.headers.location;
        if (redirectUrl) {
          fetchHTML(redirectUrl).then(resolve).catch(reject);
          return;
        }
      }

      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }

      let data = '';
      response.on('data', chunk => data += chunk);
      response.on('end', () => resolve(data));
      response.on('error', reject);
    }).on('error', reject);
  });
}

async function fetchDownloadOptions(downloadPageUrl: string): Promise<RomDownloadOption[]> {
  console.log(`    🔍 Fetching download options from: ${downloadPageUrl}`);
  
  try {
    const html = await fetchHTML(downloadPageUrl);
    const $ = cheerio.load(html);
    const options: RomDownloadOption[] = [];
    
    // Strategy 1: Look for download buttons/links in a list or table
    $('a[href*="cdn"], a[href*=".zip"], a[href*=".rar"], a[href*=".7z"], a[href*="download"]').each((_, link) => {
      const href = $(link).attr('href');
      const text = $(link).text().trim();
      
      // Filter out navigation/non-download links, FAQ links, and make absolute URLs
      if (href && 
          !href.includes('javascript:') && 
          !href.includes('#') &&
          !href.includes('download-limit-faq') &&
          !href.includes('/faq')) {
        let absoluteUrl = href;
        if (!href.startsWith('http')) {
          const baseUrl = new URL(downloadPageUrl);
          absoluteUrl = new URL(href, baseUrl.origin).toString();
        }
        
        // Try to extract region/version info from text
        const regionMatch = text.match(/\((USA|Europe|Japan|World|EU|US|JP)\)/i);
        const region = regionMatch ? regionMatch[1] : undefined;
        
        options.push({
          title: text || 'Download',
          url: absoluteUrl,
          region: region,
        });
      }
    });
    
    // Strategy 2: Look for table rows with download info
    $('table tr').each((_, row) => {
      const cells = $(row).find('td');
      if (cells.length >= 2) {
        const link = $(row).find('a[href*=".zip"], a[href*="cdn"], a[href*="download"]').first();
        const href = link.attr('href');
        
        if (href) {
          let absoluteUrl = href;
          if (!href.startsWith('http')) {
            const baseUrl = new URL(downloadPageUrl);
            absoluteUrl = new URL(href, baseUrl.origin).toString();
          }
          
          const title = cells.map((_, c) => $(c).text().trim()).get().filter(t => t).join(' - ');
          
          options.push({
            title: title || 'Download',
            url: absoluteUrl,
          });
        }
      }
    });
    
    // Remove duplicates by URL
    const uniqueOptions = Array.from(
      new Map(options.map(opt => [opt.url, opt])).values()
    );
    
    console.log(`    📋 Found ${uniqueOptions.length} download options`);
    return uniqueOptions;
    
  } catch (error) {
    console.log(`    ❌ Error fetching download options: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return [];
  }
}

function printDownloadOptions(options: RomDownloadOption[]): void {
  console.log(`\n    📋 Available download options:`);
  options.forEach((opt, index) => {
    const regionInfo = opt.region ? ` [${opt.region}]` : '';
    console.log(`    ${index + 1}. ${opt.title}${regionInfo}`);
    console.log(`       URL: ${opt.url}`);
  });
  console.log('');
}

function selectDownloadOptionByIndex(options: RomDownloadOption[], index: number): RomDownloadOption | null {
  if (index < 0 || index >= options.length) {
    console.log(`    ❌ Invalid selection: index ${index} out of range (0-${options.length - 1})`);
    return null;
  }
  
  const selected = options[index];
  console.log(`    ✓ Selected [${index + 1}]: ${selected.title}`);
  return selected;
}

function selectBestDownloadOption(options: RomDownloadOption[], preferredRegion: string = 'USA'): RomDownloadOption | null {
  if (options.length === 0) return null;
  
  // Rule 1: If only one option, select it
  if (options.length === 1) {
    console.log(`    ✓ Auto-selected (only option): ${options[0].title}`);
    return options[0];
  }
  
  // Rule 2: Filter out Demo versions
  const nonDemoOptions = options.filter(opt => 
    !opt.title.toLowerCase().includes('demo')
  );
  
  if (nonDemoOptions.length === 0) {
    console.log(`    ⚠️  All options are Demo versions, selecting first one`);
    return options[0];
  }
  
  if (nonDemoOptions.length === 1) {
    console.log(`    ✓ Auto-selected (only non-demo): ${nonDemoOptions[0].title}`);
    return nonDemoOptions[0];
  }
  
  // Rule 3: Select by region priority
  const regionPriority = [preferredRegion, 'USA', 'US', 'World', 'Europe', 'EU'];
  
  for (const region of regionPriority) {
    const match = nonDemoOptions.find(opt => 
      opt.region?.toLowerCase() === region.toLowerCase() ||
      opt.title.toLowerCase().includes(`(${region.toLowerCase()})`) ||
      opt.title.toLowerCase().includes(region.toLowerCase())
    );
    if (match) {
      console.log(`    ✓ Auto-selected (region: ${region}): ${match.title}`);
      return match;
    }
  }
  
  // Default to first non-demo option
  console.log(`    ✓ Auto-selected (default): ${nonDemoOptions[0].title}`);
  return nonDemoOptions[0];
}

async function getRedirectLink(url: string, repository: string = 'romsfun'): Promise<string | null> {
  console.log(`    🔄 Getting redirect link from: ${url}`);
  
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  
  try {
    let finalUrl: string | null = null;
    
    // CDN domains based on repository
    const cdnDomains: Record<string, string[]> = {
      'romsfun': ['sto.romsfast.com', 'statics.romsfun.com', 'cdn.romsfun.com'],
      'romsmania': ['dl.romsmania.cc', 'cdn.romsmania.cc'],
      'edgeemu': ['files.edgeemu.net', 'cdn.edgeemu.net'],
      // Add more repositories as needed
    };
    
    const domains = cdnDomains[repository] || cdnDomains['romsfun'];
    
    // Listen for CDN responses
    page.on('response', async (response) => {
      const respUrl = response.url();
      
      // Check if this is a CDN download URL
      const isCdnUrl = domains.some(domain => respUrl.includes(domain)) ||
        respUrl.includes('github') ||
        respUrl.includes('raw') ||
        respUrl.match(/\.(zip|rar|7z|iso)(\?|$)/i);
      
      if (isCdnUrl) {
        console.log(`    🔗 Detected CDN URL from response: ${respUrl}`);
        finalUrl = respUrl;
      }
    });
    
    // Navigate to the URL
    await page.goto(url, { 
      waitUntil: 'domcontentloaded',
      timeout: 20000 
    });
    
    console.log(`    ⏳ Waiting for download button to appear (countdown)...`);
    
    // Wait for countdown/button (usually 3-5 seconds)
    await page.waitForTimeout(8000);
    
    // Wait for download button to become visible (it starts hidden)
    try {
      await page.waitForSelector('#download-link', { 
        state: 'visible',
        timeout: 8000 
      });
      console.log(`    ✓ Download button appeared`);
    } catch (e) {
      console.log(`    ⚠️  Download button didn't appear with standard IDs`);
    }
    
    console.log(`    🖱️  Extracting download link from button...`);
    
    // Try to find and get the actual download link from button
    const downloadLink = await page.evaluate(() => {
      // Try common download link IDs/classes
      const selectors = [
        '#download-link',
        '#download-button',
        '.download-link',
        '.download-button',
        'a[href*="cdn"]',
        'a[href*=".zip"]',
        'a[href*="storage"]',
        'a[href*="github"]',
        'a[href*="romsfast"]'
      ];
      
      for (const selector of selectors) {
        const element = document.querySelector(selector) as HTMLAnchorElement;
        if (element && element.href && element.href.includes('http')) {
          // Check if it's a real download link (not the page itself)
          if (element.href.includes('cdn') || 
              element.href.includes('storage') || 
              element.href.includes('github') ||
              element.href.includes('romsfast') ||
              element.href.includes('.zip') ||
              element.href.includes('.rar')) {
            return element.href;
          }
        }
      }
      
      return null;
    });
    
    if (downloadLink) {
      console.log(`    ✅ Found download link from button: ${downloadLink}`);
      finalUrl = downloadLink;
    }
    
    // If we found a CDN URL from response listener, use it
    if (finalUrl) {
      await browser.close();
      console.log(`    ✅ Final redirect URL: ${finalUrl}`);
      return finalUrl;
    }
    
    // If still no link, try clicking the button as last resort
    console.log(`    🖱️  Trying to click button to trigger redirect...`);
    try {
      const button = await page.$('#download-link, #download-button, a[href*="cdn"]');
      if (button) {
        await button.click();
        console.log(`    ✓ Clicked button, waiting for redirect...`);
        await page.waitForTimeout(3000);
        
        // Check if we captured a CDN URL from response
        if (finalUrl) {
          await browser.close();
          console.log(`    ✅ Got redirect URL after click: ${finalUrl}`);
          return finalUrl;
        }
      }
    } catch (e) {
      console.log(`    ⚠️  Could not click button: ${e instanceof Error ? e.message : 'Unknown'}`);
    }
    
    await browser.close();
    
    if (!finalUrl) {
      console.log(`    ❌ Could not get redirect link from button`);
    }
    
    return finalUrl;
    
  } catch (error) {
    await browser.close();
    console.log(`    ❌ Error getting redirect: ${error instanceof Error ? error.message : 'Unknown'}`);
    return null;
  }
}

/**
 * Update a specific ROM's redirect link in the CSV file
 * Reads all ROMs, updates the matching one, and writes back
 */
function updateRomInCSV(csvPath: string, romToUpdate: Rom): void {
  // Read all ROMs from CSV
  const allRoms = parseCSVToRoms(csvPath);
  
  // Find and update the matching ROM (by title and url)
  let updated = false;
  for (let i = 0; i < allRoms.length; i++) {
    if (allRoms[i].title === romToUpdate.title && allRoms[i].url === romToUpdate.url) {
      allRoms[i].directDownloadLink = romToUpdate.directDownloadLink;
      updated = true;
      break;
    }
  }
  
  if (!updated) {
    console.log(`    ⚠️  Warning: Could not find ROM in CSV to update`);
    return;
  }
  
  // Convert all ROMs back to CSV format
  const csvRecords = allRoms.map(rom => ({
    id: rom.id || '',
    title: rom.title,
    url: rom.url,
    console: rom.console,
    description: rom.description || '',
    mainImage: rom.mainImage || '',
    screenshots: Array.isArray(rom.screenshots) ? rom.screenshots.join('|') : '',
    genre: Array.isArray(rom.genre) ? rom.genre.join('|') : '',
    releaseDate: rom.releaseDate || '',
    publisher: rom.publisher || '',
    region: Array.isArray(rom.region) ? rom.region.join('|') : '',
    size: rom.size || '',
    downloadCount: rom.downloadCount || '',
    numberOfReviews: rom.numberOfReviews || '',
    averageRating: rom.averageRating || '',
    downloadLink: rom.downloadLink || '',
    directDownloadLink: rom.directDownloadLink || '',
    romType: rom.romType || ''
  }));
  
  // Write back to CSV
  const csvContent = stringify(csvRecords, {
    header: true,
    columns: [
      'id', 'title', 'url', 'console', 'description', 'mainImage', 
      'screenshots', 'genre', 'releaseDate', 'publisher', 'region', 
      'size', 'downloadCount', 'numberOfReviews', 'averageRating', 
      'downloadLink', 'directDownloadLink', 'romType'
    ]
  });
  
  fs.writeFileSync(csvPath, csvContent, 'utf-8');
  console.log(`    💾 Updated CSV with redirect link`);
}

async function downloadRoms(
  roms: Rom[], 
  outputDir: string, 
  manualSelectIndex?: number, 
  csvPath?: string, 
  fetchRedirectsOnly: boolean = false,
  repository: string = 'romsfun'
): Promise<void> {
  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const mode = fetchRedirectsOnly ? 'Fetching redirect links' : 'Starting download';
  console.log(`\n${mode} for ${roms.length} ROMs${fetchRedirectsOnly ? '' : ` to ${outputDir}`}...\n`);
  if (manualSelectIndex !== undefined) {
    console.log(`Manual selection mode: Will select option index ${manualSelectIndex}\n`);
  }

  let successCount = 0;
  let failCount = 0;
  let skippedCount = 0;

  for (let i = 0; i < roms.length; i++) {
    const rom = roms[i];
    
    let downloadUrl: string | undefined;
    
    // If directDownloadLink exists, use it directly
    if (rom.directDownloadLink) {
      downloadUrl = rom.directDownloadLink;
      console.log(`[${i + 1}/${roms.length}] 📦 ${rom.title}`);
      
      // If in fetch-redirects-only mode and already has link, skip
      if (fetchRedirectsOnly) {
        console.log(`    ✅ Already has redirect link - skipping`);
        skippedCount++;
        successCount++;
        console.log('');
        continue;
      }
      
      console.log(`    ℹ️  Using direct download link`);
    } 
    // Otherwise, fetch options from downloadLink page and select best one
    else if (rom.downloadLink) {
      console.log(`[${i + 1}/${roms.length}] 📦 ${rom.title}`);
      try {
        const options = await fetchDownloadOptions(rom.downloadLink);
        
        if (options.length === 0) {
          console.log(`    ⚠️  No download options found`);
          failCount++;
          console.log('');
          continue;
        }
        
        // Print all available options
        printDownloadOptions(options);
        
        // Select option based on mode
        let selected: RomDownloadOption | null = null;
        
        if (manualSelectIndex !== undefined) {
          // Manual selection by index
          selected = selectDownloadOptionByIndex(options, manualSelectIndex);
        } else {
          // Auto-select best option
          selected = selectBestDownloadOption(options);
        }
        
        if (selected) {
          downloadUrl = selected.url;
        }
      } catch (error) {
        console.log(`    ⚠️  Could not fetch download options: ${error instanceof Error ? error.message : 'Unknown error'}`);
        failCount++;
        console.log('');
        continue;
      }
    } else {
      console.log(`[${i + 1}/${roms.length}] ⚠️  Skipping "${rom.title}" - no download link`);
      failCount++;
      console.log('');
      continue;
    }

    if (!downloadUrl) {
      console.log(`    ⚠️  No download URL selected`);
      failCount++;
      console.log('');
      continue;
    }

    // Get the actual redirect/download link only if we don't already have directDownloadLink
    if (!rom.directDownloadLink) {
      const redirectUrl = await getRedirectLink(downloadUrl, repository);
      
      if (!redirectUrl) {
        console.log(`    ❌ Failed to get redirect download link`);
        failCount++;
        console.log('');
        continue;
      }
      
      // Customize and save redirect link to ROM object
      const customizedLink = customizeRedirectLink(redirectUrl, rom, repository);
      rom.directDownloadLink = customizedLink;
      
      // Save to CSV if csvPath provided
      if (csvPath) {
        updateRomInCSV(csvPath, rom);
      }
      
      downloadUrl = redirectUrl;
    }

    // If in fetch-redirects-only mode, skip actual download
    if (fetchRedirectsOnly) {
      console.log(`    ✅ Redirect link fetched and saved`);
      successCount++;
      console.log('');
      continue;
    }

    // Determine file extension from URL or default to .zip
    let ext = '.zip';
    const urlPath = downloadUrl.split('?')[0]; // Remove query params
    const urlExt = path.extname(urlPath);
    if (urlExt) {
      ext = urlExt;
    }

    const filename = sanitizeFilename(`${rom.title}${ext}`);
    const destPath = path.join(outputDir, filename);

    // Skip if already exists
    if (fs.existsSync(destPath)) {
      console.log(`    ⏭️  Already exists: ${filename}`);
      successCount++;
      console.log('');
      continue;
    }

    try {
      console.log(`    ⬇️  Downloading from: ${downloadUrl}`);
      
      await downloadFile(downloadUrl, destPath);
      
      const stats = fs.statSync(destPath);
      const sizeKB = (stats.size / 1024).toFixed(2);
      console.log(`    ✅ Success: ${filename} (${sizeKB} KB)`);
      successCount++;
      
      // Small delay to avoid overwhelming servers
      await new Promise(resolve => setTimeout(resolve, 1000));
      
    } catch (error) {
      console.log(`    ❌ Failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      failCount++;
    }

    console.log('');
  }

  console.log(`\n=== ${fetchRedirectsOnly ? 'Redirect Links' : 'Download'} Summary ===`);
  console.log(`✅ Success: ${successCount}${skippedCount > 0 ? ` (${skippedCount} already had links)` : ''}`);
  console.log(`❌ Failed: ${failCount}`);
  console.log(`📊 Total: ${roms.length}`);
}

/**
 * Customize redirect link before saving
 * You can modify the URL here as needed
 */
function customizeRedirectLink(redirectLink: string, rom: Rom, repository: string): string {
  // Example customizations:
  // Uncomment and modify as needed
  
  // Option 1: Save to GitHub repository
  const ext = path.extname(redirectLink.split('?')[0]) || '.zip';
  const filename = sanitizeFilename(`${rom.title}${ext}`);
  return `https://github.com/hoanghdtv/${repository}/raw/refs/heads/main/` + encodeURIComponent(filename);
  
  // Option 2: Remove token parameters
  // return redirectLink.split('?')[0];
  
  // Option 3: Change domain
  // return redirectLink.replace('sto.romsfast.com', 'cdn.myserver.com');
  
  // Default: Return as-is
  return redirectLink;
}

/**
 * Save redirect links to CSV file
 * This will update the CSV with the redirect links fetched from download pages
 * Only processes ROMs that don't have directDownloadLink yet
 */
async function saveRedirectLinksToCSV(
  roms: Rom[], 
  csvPath: string, 
  outputCsvPath?: string,
  repository: string = 'romsfun'
): Promise<void> {
  console.log(`\n🔄 Fetching and saving redirect links...`);
  
  const outputPath = outputCsvPath || csvPath.replace('.csv', '-with-redirects.csv');
  
  let processedCount = 0;
  let successCount = 0;
  let failCount = 0;
  let skippedCount = 0;
  
  // Process each ROM
  for (let i = 0; i < roms.length; i++) {
    const rom = roms[i];
    processedCount++;
    
    console.log(`\n[${i + 1}/${roms.length}] 📦 ${rom.title}`);
    
    // Skip if already has directDownloadLink
    if (rom.directDownloadLink) {
      console.log(`    ✅ Already has redirect link - skipping`);
      skippedCount++;
      successCount++;
      continue;
    }
    
    // Skip if no downloadLink
    if (!rom.downloadLink) {
      console.log(`    ⚠️  No download link available`);
      failCount++;
      continue;
    }
    
    try {
      // Fetch download options
      const options = await fetchDownloadOptions(rom.downloadLink);
      
      if (options.length === 0) {
        console.log(`    ⚠️  No download options found`);
        failCount++;
        continue;
      }
      
      // Auto-select best option
      const selectedOption = selectBestDownloadOption(options);
      
      if (!selectedOption) {
        console.log(`    ⚠️  Could not select download option`);
        failCount++;
        continue;
      }
      
      console.log(`    ✓ Selected: ${selectedOption.title}`);
      
      // Get redirect link
      const redirectLink = await getRedirectLink(selectedOption.url, repository);
      
      if (!redirectLink) {
        console.log(`    ❌ Failed to get redirect link`);
        failCount++;
        continue;
      }
      
      // Customize the redirect link
      const customizedLink = customizeRedirectLink(redirectLink, rom, repository);
      
      // Update ROM object
      rom.directDownloadLink = customizedLink;
      
      console.log(`    ✅ Saved redirect link`);
      successCount++;
      
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
      
    } catch (error) {
      console.log(`    ❌ Error: ${error instanceof Error ? error.message : 'Unknown'}`);
      failCount++;
    }
  }
  
  // Write updated ROMs to CSV
  console.log(`\n📝 Writing to ${outputPath}...`);
  
  // Convert ROMs to CSV format
  const csvRecords = roms.map(rom => ({
    id: rom.id || '',
    title: rom.title,
    url: rom.url,
    console: rom.console,
    description: rom.description || '',
    mainImage: rom.mainImage || '',
    screenshots: Array.isArray(rom.screenshots) ? rom.screenshots.join('|') : '',
    genre: Array.isArray(rom.genre) ? rom.genre.join('|') : '',
    releaseDate: rom.releaseDate || '',
    publisher: rom.publisher || '',
    region: Array.isArray(rom.region) ? rom.region.join('|') : '',
    size: rom.size || '',
    downloadCount: rom.downloadCount || '',
    numberOfReviews: rom.numberOfReviews || '',
    averageRating: rom.averageRating || '',
    downloadLink: rom.downloadLink || '',
    directDownloadLink: rom.directDownloadLink || '',
    romType: rom.romType || ''
  }));
  
  // Write to CSV with headers
  const csvContent = stringify(csvRecords, {
    header: true,
    columns: [
      'id', 'title', 'url', 'console', 'description', 'mainImage', 
      'screenshots', 'genre', 'releaseDate', 'publisher', 'region', 
      'size', 'downloadCount', 'numberOfReviews', 'averageRating', 
      'downloadLink', 'directDownloadLink', 'romType'
    ]
  });
  
  fs.writeFileSync(outputPath, csvContent, 'utf-8');
  
  console.log(`\n=== Redirect Links Summary ===`);
  console.log(`✅ Success: ${successCount} (${skippedCount} already had links)`);
  console.log(`❌ Failed: ${failCount}`);
  console.log(`📊 Total: ${processedCount}`);
  console.log(`📄 Output: ${outputPath}`);
}

async function main() {
  const argv = process.argv.slice(2);

  if (argv.length === 0) {
    console.log('Usage: npx ts-node src/download/rom-csv-download.ts <csvPath> [options]');
    console.log('');
    console.log('Download ROMs:');
    console.log('  npx ts-node src/download/rom-csv-download.ts output/topnes-split/roms.csv --output downloads/nes');
    console.log('  npx ts-node src/download/rom-csv-download.ts output/topnes-split/roms.csv --output downloads/nes --limit 10');
    console.log('  npx ts-node src/download/rom-csv-download.ts output/topnes-split/roms.csv --limit 1 --manual-select 2');
    console.log('');
    console.log('Fetch redirect links only (no download):');
    console.log('  npx ts-node src/download/rom-csv-download.ts output/topnes-split/roms.csv --fetch-redirects-only');
    console.log('  npx ts-node src/download/rom-csv-download.ts output/topnes-split/roms.csv --fetch-redirects-only --limit 10');
    console.log('');
    console.log('Save redirect links to new CSV:');
    console.log('  npx ts-node src/download/rom-csv-download.ts output/topnes-split/roms.csv --save-redirects');
    console.log('  npx ts-node src/download/rom-csv-download.ts output/topnes-split/roms.csv --save-redirects --limit 5');
    console.log('  npx ts-node src/download/rom-csv-download.ts output/topnes-split/roms.csv --save-redirects --output-csv output/roms-updated.csv');
    console.log('');
    console.log('Options:');
    console.log('  --output <dir>           Output directory for downloaded ROMs');
    console.log('  --limit <n>              Limit to first N ROMs');
    console.log('  --manual-select <index>  Manually select download option by index (0-based)');
    console.log('  --fetch-redirects-only   Fetch and save redirect links to CSV only (no download)');
    console.log('  --save-redirects         Save redirect links to CSV instead of downloading');
    console.log('  --output-csv <path>      Output CSV path (for --save-redirects mode)');
    console.log('  --repository <name>      Repository name (default: romsfun)');
    process.exit(1);
  }

  const csvPath = argv[0];
  
  // Parse optional arguments
  const saveRedirects = argv.includes('--save-redirects');
  const fetchRedirectsOnly = argv.includes('--fetch-redirects-only');
  
  const outputIndex = argv.indexOf('--output');
  const outputDir = outputIndex !== -1 ? argv[outputIndex + 1] : path.join('downloads', path.basename(path.dirname(csvPath)));
  
  const repositoryIndex = argv.indexOf('--repository');
  const repository = repositoryIndex !== -1 ? argv[repositoryIndex + 1] : 'romsfun';
  
  const outputCsvIndex = argv.indexOf('--output-csv');
  const outputCsvPath = outputCsvIndex !== -1 ? argv[outputCsvIndex + 1] : undefined;
  
  const limitIndex = argv.indexOf('--limit');
  const limit = limitIndex !== -1 ? parseInt(argv[limitIndex + 1], 10) : undefined;

  const manualSelectIndex = argv.indexOf('--manual-select');
  const manualSelect = manualSelectIndex !== -1 ? parseInt(argv[manualSelectIndex + 1], 10) : undefined;

  try {
    // Read and parse CSV
    let roms = parseCSVToRoms(csvPath);

    // Apply limit if specified
    if (limit && limit > 0) {
      console.log(`Limiting to first ${limit} ROMs`);
      roms = roms.slice(0, limit);
    }

    // Choose mode: save redirects to new CSV, fetch redirects only, or download
    if (saveRedirects) {
      await saveRedirectLinksToCSV(roms, csvPath, outputCsvPath, repository);
    } else {
      await downloadRoms(roms, outputDir, manualSelect, csvPath, fetchRedirectsOnly, repository);
    }

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
