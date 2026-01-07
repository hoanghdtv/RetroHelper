import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

async function testSingleRom() {
  const browser = await chromium.launch({ 
    headless: false, // Show browser để xem
    slowMo: 1000 
  });
  
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  });
  
  const page = await context.newPage();
  
  try {
    // Test với 1 game cụ thể - thử game có nhiều ảnh hơn
    const testUrl = 'https://romsfun.com/roms/nes/manalls-ff1.html';
    console.log(`Testing URL: ${testUrl}\n`);
    
    await page.goto(testUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);
    
    // Take screenshot để xem cấu trúc
    await page.screenshot({ path: 'output/rom-detail-page.png', fullPage: true });
    console.log('✓ Screenshot saved to output/rom-detail-page.png\n');
    
    // Get HTML structure
    const html = await page.content();
    const outputDir = path.join(__dirname, '..', 'output');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    fs.writeFileSync(path.join(outputDir, 'rom-page-html.html'), html);
    console.log('✓ HTML saved to output/rom-page-html.html\n');
    
    // Extract all possible information
    const details = await page.evaluate(() => {
      const result: any = {
        title: '',
        description: '',
        images: [],
        screenshots: [],
        size: '',
        downloadCount: '',
        views: '',
        rating: '',
        uploadDate: '',
        console: '',
        region: '',
        language: '',
        genre: '',
        publisher: '',
        developer: '',
        releaseDate: '',
        downloadLink: '',
        alternateLinks: [],
      };
      
      // Title
      const titleSelectors = [
        'h1.entry-title',
        'h1.game-title',
        'h1.rom-title',
        '.title h1',
        'h1',
      ];
      for (const selector of titleSelectors) {
        const el = document.querySelector(selector);
        if (el && el.textContent?.trim()) {
          result.title = el.textContent.trim();
          break;
        }
      }
      
      // Description
      const descSelectors = [
        '.entry-content p',
        '.description',
        '.game-description',
        '.rom-description',
        'article p',
        '.content p',
      ];
      for (const selector of descSelectors) {
        const el = document.querySelector(selector);
        if (el && el.textContent?.trim() && el.textContent.trim().length > 50) {
          result.description = el.textContent.trim();
          break;
        }
      }
      
      // Main image
      const imgSelectors = [
        '.entry-content img',
        '.game-image img',
        '.rom-image img',
        'article img',
        'img[alt*="ROM"]',
        'img[alt*="Game"]',
      ];
      for (const selector of imgSelectors) {
        const imgs = document.querySelectorAll(selector);
        imgs.forEach(img => {
          const src = img.getAttribute('src') || img.getAttribute('data-src');
          if (src && !src.includes('logo') && !src.includes('icon')) {
            const fullSrc = src.startsWith('http') ? src : `https://romsfun.com${src}`;
            if (!result.images.includes(fullSrc)) {
              result.images.push(fullSrc);
            }
          }
        });
        if (result.images.length > 0) break;
      }
      
      // Screenshots
      const screenshotSelectors = [
        '.gallery img',
        '.screenshots img',
        '.slider img',
        '[class*="screenshot"] img',
        '[class*="gallery"] img',
      ];
      screenshotSelectors.forEach(selector => {
        const imgs = document.querySelectorAll(selector);
        imgs.forEach(img => {
          const src = img.getAttribute('src') || img.getAttribute('data-src');
          if (src) {
            const fullSrc = src.startsWith('http') ? src : `https://romsfun.com${src}`;
            if (!result.screenshots.includes(fullSrc)) {
              result.screenshots.push(fullSrc);
            }
          }
        });
      });
      
      // Download link
      const downloadSelectors = [
        'a[href*="download"]',
        '.download-button',
        '.btn-download',
        'a.button[href*="download"]',
        '.wp-block-button a',
      ];
      for (const selector of downloadSelectors) {
        const el = document.querySelector(selector);
        if (el) {
          const href = el.getAttribute('href');
          if (href) {
            result.downloadLink = href.startsWith('http') ? href : `https://romsfun.com${href}`;
            break;
          }
        }
      }
      
      // File size, download count, views, etc from meta info
      const allText = document.body.innerText;
      
      // Size
      const sizeMatch = allText.match(/Size[:\s]*([0-9.]+\s*(KB|MB|GB))/i) ||
                       allText.match(/File Size[:\s]*([0-9.]+\s*(KB|MB|GB))/i) ||
                       allText.match(/([0-9.]+\s*(KB|MB|GB))/i);
      if (sizeMatch) {
        result.size = sizeMatch[1] || sizeMatch[0];
      }
      
      // Download count
      const downloadMatch = allText.match(/Download[s]?[:\s]*([0-9,]+)/i) ||
                           allText.match(/([0-9,]+)\s*download/i);
      if (downloadMatch) {
        result.downloadCount = downloadMatch[1];
      }
      
      // Views
      const viewsMatch = allText.match(/View[s]?[:\s]*([0-9,]+)/i) ||
                        allText.match(/([0-9,]+)\s*view/i);
      if (viewsMatch) {
        result.views = viewsMatch[1];
      }
      
      // Rating
      const ratingEl = document.querySelector('[class*="rating"]');
      if (ratingEl) {
        result.rating = ratingEl.textContent?.trim() || '';
      }
      
      // Meta information
      const metaSelectors = [
        '.game-info li',
        '.rom-info li',
        '.meta-info li',
        '.info-list li',
        'dl dt, dl dd',
      ];
      
      metaSelectors.forEach(selector => {
        const elements = document.querySelectorAll(selector);
        elements.forEach(el => {
          const text = el.textContent?.trim() || '';
          
          if (text.toLowerCase().includes('console') || text.toLowerCase().includes('platform')) {
            result.console = text.split(':')[1]?.trim() || text;
          }
          if (text.toLowerCase().includes('region')) {
            result.region = text.split(':')[1]?.trim() || text;
          }
          if (text.toLowerCase().includes('language')) {
            result.language = text.split(':')[1]?.trim() || text;
          }
          if (text.toLowerCase().includes('genre') || text.toLowerCase().includes('category')) {
            result.genre = text.split(':')[1]?.trim() || text;
          }
          if (text.toLowerCase().includes('publisher')) {
            result.publisher = text.split(':')[1]?.trim() || text;
          }
          if (text.toLowerCase().includes('developer')) {
            result.developer = text.split(':')[1]?.trim() || text;
          }
          if (text.toLowerCase().includes('release')) {
            result.releaseDate = text.split(':')[1]?.trim() || text;
          }
          if (text.toLowerCase().includes('upload')) {
            result.uploadDate = text.split(':')[1]?.trim() || text;
          }
        });
      });
      
      return result;
    });
    
    console.log('=== EXTRACTED DATA ===\n');
    console.log(JSON.stringify(details, null, 2));
    
    // Save to file
    const savePath = path.join(__dirname, '..', 'output', 'single-rom-test.json');
    fs.writeFileSync(savePath, JSON.stringify(details, null, 2));
    
    console.log('\n✓ Data saved to output/single-rom-test.json');
    
    // Test download if download link exists
    if (details.downloadLink) {
      console.log('\n=== TESTING DOWNLOAD ===\n');
      console.log(`Download page: ${details.downloadLink}`);
      
      // Import RomsFunEnhancedClient to use getDirectDownloadLink
      const { RomsFunEnhancedClient } = require('./romsfun-enhanced');
      const client = new RomsFunEnhancedClient();
      
      try {
        // Get direct download link
        console.log('Getting direct download link...');
        const directLinkData = await client.getDirectDownloadLink(details.downloadLink);
        
        if (directLinkData && directLinkData.url) {
          console.log(`✓ Direct link found: ${directLinkData.url}\n`);
          
          // Download the file
          console.log('Downloading ROM file...');
          const https = require('https');
          const http = require('http');
          const url = require('url');
          
          const downloadUrl = url.parse(directLinkData.url);
          const protocol = downloadUrl.protocol === 'https:' ? https : http;
          const downloadDir = path.join(__dirname, '..', 'downloads', 'test');
          
          if (!fs.existsSync(downloadDir)) {
            fs.mkdirSync(downloadDir, { recursive: true });
          }
          
          const filename = 'test-rom.zip';
          const filePath = path.join(downloadDir, filename);
          
          await new Promise<void>((resolve, reject) => {
            const request = protocol.get(directLinkData.url, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': '*/*',
                'Accept-Language': 'en-US,en;q=0.9',
                'Referer': 'https://romsfun.com/',
                'Origin': 'https://romsfun.com',
                'Connection': 'keep-alive',
                'Cookie': directLinkData.cookies || '',
              },
              timeout: 120000, // 2 minutes
            }, (response: any) => {
              if (response.statusCode === 301 || response.statusCode === 302) {
                const redirectUrl = response.headers.location;
                if (redirectUrl) {
                  console.log('→ Following redirect...');
                  const redirectProtocol = redirectUrl.startsWith('https') ? https : http;
                  const redirectRequest = redirectProtocol.get(redirectUrl, {
                    headers: {
                      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                      'Accept': '*/*',
                      'Accept-Language': 'en-US,en;q=0.9',
                      'Referer': 'https://romsfun.com/',
                      'Origin': 'https://romsfun.com',
                      'Connection': 'keep-alive',
                      'Cookie': directLinkData.cookies || '',
                    },
                    timeout: 120000,
                  }, (redirectResponse: any) => {
                    if (redirectResponse.statusCode !== 200) {
                      reject(new Error(`HTTP ${redirectResponse.statusCode}`));
                      return;
                    }
                    downloadStream(redirectResponse, filePath, resolve, reject);
                  });
                  
                  redirectRequest.on('error', reject);
                  redirectRequest.on('timeout', () => {
                    redirectRequest.destroy();
                    reject(new Error('Download timeout'));
                  });
                } else {
                  reject(new Error('Redirect without location'));
                }
                return;
              }
              
              if (response.statusCode !== 200) {
                reject(new Error(`HTTP ${response.statusCode}`));
                return;
              }
              
              downloadStream(response, filePath, resolve, reject);
            });
            
            request.on('error', reject);
            request.on('timeout', () => {
              request.destroy();
              reject(new Error('Download timeout'));
            });
          });
          
          const stats = fs.statSync(filePath);
          console.log(`✓ Downloaded successfully!`);
          console.log(`  File: ${filename}`);
          console.log(`  Size: ${formatBytes(stats.size)}`);
          console.log(`  Path: ${filePath}`);
        } else {
          console.log('✗ Could not extract direct download link');
        }
        
        await client.close();
      } catch (downloadError) {
        console.error(`✗ Download failed: ${downloadError}`);
      }
    } else {
      console.log('\n⚠ No download link found in extracted data');
    }
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await page.waitForTimeout(3000); // Wait để xem
    await browser.close();
  }
}

// Helper function for download stream
function downloadStream(response: any, filePath: string, resolve: () => void, reject: (error: Error) => void): void {
  const totalSize = parseInt(response.headers['content-length'] || '0');
  let downloadedSize = 0;
  
  const writer = fs.createWriteStream(filePath);
  
  response.on('data', (chunk: Buffer) => {
    downloadedSize += chunk.length;
    if (totalSize > 0) {
      const percent = Math.floor((downloadedSize / totalSize) * 100);
      if (percent % 10 === 0) {
        console.log(`  Progress: ${percent}%`);
      }
    }
  });
  
  response.pipe(writer);
  
  writer.on('finish', () => {
    writer.close();
    resolve();
  });
  
  writer.on('error', (err: Error) => {
    fs.unlink(filePath, () => {}); // Delete partial file
    reject(err);
  });
  
  response.on('error', (err: Error) => {
    writer.close();
    fs.unlink(filePath, () => {}); // Delete partial file
    reject(err);
  });
}

// Helper function to format bytes
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

testSingleRom().catch(console.error);
