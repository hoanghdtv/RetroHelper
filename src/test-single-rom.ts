import { RomsFunEnhancedClient } from './romsfun-enhanced';
import * as fs from 'fs';
import * as path from 'path';

async function testSingleRom() {
  const client = new RomsFunEnhancedClient();
  
  try {
    // Test với 1 game cụ thể
    const testUrl = 'https://romsfun.com/roms/nes/manalls-ff1.html';
    const testTitle = 'Manalls FF1 ROM'; // Can extract from URL or provide
    const testConsole = 'nes';
    
    console.log(`\n=== Testing getRomDetails ===`);
    console.log(`URL: ${testUrl}`);
    console.log(`Title: ${testTitle}`);
    console.log(`Console: ${testConsole}\n`);
    
    // Use getRomDetails from RomsFunEnhancedClient
    console.log('Fetching ROM details...\n');
    const details = await client.getRomDetails(testUrl, testTitle, testConsole);
    
    console.log('\n=== EXTRACTED ROM DETAILS ===\n');
    console.log(JSON.stringify(details, null, 2));
    
    // Save to file
    const outputDir = path.join(__dirname, '..', 'output');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    const savePath = path.join(outputDir, 'single-rom-test.json');
    fs.writeFileSync(savePath, JSON.stringify(details, null, 2));
    console.log(`\n✓ Data saved to output/single-rom-test.json`);
    
    // Test download if download link exists
    if (details.downloadLink) {
      console.log('\n=== TESTING DIRECT DOWNLOAD LINK ===\n');
      console.log(`Download page: ${details.downloadLink}`);
      
      try {
        // Get direct download link
        console.log('Getting direct download link...');
        const directLinkData = await client.getDirectDownloadLink(details.downloadLink);
        
        if (directLinkData && directLinkData.url) {
          console.log(`✓ Direct link found: ${directLinkData.url}`);
          
          // Save direct link info
          const directLinkPath = path.join(outputDir, 'direct-link-test.json');
          fs.writeFileSync(directLinkPath, JSON.stringify(directLinkData, null, 2));
          console.log(`✓ Direct link info saved to output/direct-link-test.json`);
          
          // Optional: Actually download the file
          const shouldDownload = process.argv.includes('--download');
          if (shouldDownload) {
            console.log('\nDownloading ROM file...');
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
                timeout: 120000,
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
            console.log('\n💡 Add --download flag to actually download the file');
          }
        } else {
          console.log('✗ Could not extract direct download link');
        }
      } catch (downloadError) {
        console.error(`✗ Download failed: ${downloadError}`);
      }
    } else {
      console.log('\n⚠ No download link found in ROM details');
    }
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.close();
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
