import { chromium, Browser, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { RomDatabase, Rom, RelatedRom } from './database';

interface Console {
  name: string;
  slug: string;
  url: string;
}

class RomsFunEnhancedClient {
  private browser: Browser | null = null;
  private baseUrl = 'https://romsfun.com';

  async initBrowser(headless = true) {
    if (!this.browser) {
      this.browser = await chromium.launch({
        headless,
        args: ['--no-sandbox'],
      });
    }
    return this.browser;
  }

  async createPage(): Promise<Page> {
    const browser = await this.initBrowser();
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    });
    return await context.newPage();
  }

  /**
   * Get all available consoles
   */
  async getAllConsoles(): Promise<Console[]> {
    const page = await this.createPage();
    
    try {
      console.log('Fetching all consoles...');
      await page.goto(`${this.baseUrl}/roms/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2000);

      const consoles = await page.evaluate(() => {
        const results: Console[] = [];
        const seen = new Set<string>();

        const links = document.querySelectorAll('a[href*="/roms/"]');

        links.forEach(link => {
          const href = link.getAttribute('href');
          const text = link.textContent?.trim();

          if (href && text && href.match(/\/roms\/([a-z0-9-]+)\/?$/)) {
            const parts = href.split('/');
            const slug = parts[parts.length - 1] || parts[parts.length - 2];
            
            if (slug && slug !== 'roms' && !seen.has(slug)) {
              seen.add(slug);
              results.push({
                name: text,
                slug: slug,
                url: href.startsWith('http') ? href : `https://romsfun.com${href}`,
              });
            }
          }
        });

        return results;
      });

      console.log(`  ✓ Found ${consoles.length} consoles`);
      return consoles;
    } finally {
      await page.close();
    }
  }

  /**
   * Get direct download link from download page
   * Requires 2 clicks: 1st opens popup ad, 2nd opens page with actual file link
   */
  async getDirectDownloadLink(downloadPageUrl: string): Promise<{ url?: string; cookies?: string } | undefined> {
    const page = await this.createPage();
    
    try {
      const url = downloadPageUrl.startsWith('http') ? downloadPageUrl : `${this.baseUrl}${downloadPageUrl}`;
      const context = page.context();
      let downloadPage: any = null;
      let isFirstClick = true;
      
      // Setup listener for new pages
      context.on('page', async (newPage) => {
        const newUrl = newPage.url();
        
        // First click opens ad popup - close it
        if (isFirstClick && !newUrl.includes('romsfun.com')) {
          await newPage.close().catch(() => {});
        } 
        // Second click opens download page - keep it!
        else if (newUrl.includes('romsfun.com/download') && newUrl.endsWith('/1')) {
          downloadPage = newPage;
        }
      });

      // Navigate to download page
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2000);

      // Construct the link URL (add /1 to the download page URL)
      const downloadLinkUrl = `${url}/1`;

      // FIRST CLICK - Opens popup ad
      await page.click(`a[href="${downloadLinkUrl}"]`).catch(() => {});
      isFirstClick = false;
      await page.waitForTimeout(1500);

      // SECOND CLICK - Opens download page with actual file link
      await page.click(`a[href="${downloadLinkUrl}"]`).catch(() => {});
      await page.waitForTimeout(3000);

      // Extract file download link from download page
      if (downloadPage) {
        await downloadPage.waitForLoadState('domcontentloaded').catch(() => {});
        await downloadPage.waitForTimeout(3000); // Wait for countdown and button to appear
        
        console.log(`      Waiting for download button to appear...`);
        
        // Wait for download button to become visible (it's hidden initially)
        await downloadPage.waitForSelector('#download-button:not(.hidden)', { timeout: 10000 }).catch(() => {
          console.log(`      ⚠️ Download button didn't appear, trying to find link anyway...`);
        });
        
        // Click the download button to trigger the actual download
        // This will navigate to the real CDN link
        console.log(`      Clicking download button...`);
        
        const finalDownloadUrl = await Promise.race([
          // Option 1: Listen for navigation to CDN URL
          new Promise<string>((resolve) => {
            downloadPage.on('response', (response: any) => {
              const url = response.url();
              if (url.includes('sto.romsfast.com') || 
                  url.includes('statics.romsfun.com') || 
                  url.includes('cdn.romsfun.com') ||
                  url.match(/\.(zip|rar|7z|iso)(\?|$)/i)) {
                console.log(`      ✓ Detected CDN URL from response: ${url}`);
                resolve(url);
              }
            });
          }),
          
          // Option 2: Click and wait for navigation
          (async () => {
            try {
              const downloadButton = await downloadPage.$('#download-link');
              if (downloadButton) {
                // Get href before clicking
                const href = await downloadButton.getAttribute('href');
                if (href) {
                  console.log(`      ✓ Found href on button: ${href}`);
                  return href;
                }
                
                // Try clicking
                await downloadButton.click({ timeout: 5000 });
                await downloadPage.waitForTimeout(2000);
              }
            } catch (e) {
              console.log(`      ⚠️ Click failed, trying to extract from HTML...`);
            }
            
            // Fallback: extract from HTML
            const fileLink = await downloadPage.evaluate(() => {
              const links = Array.from(document.querySelectorAll('a'));
              const downloadLink = links.find(link => {
                const href = link.href.toLowerCase();
                return href.includes('.zip') || href.includes('.rar') || 
                       href.includes('.7z') || href.includes('.iso') ||
                       href.includes('statics.romsfun.com') || 
                       href.includes('sto.romsfast.com') ||
                       href.includes('cdn.romsfun.com');
              });
              return downloadLink?.href;
            });
            
            if (fileLink) {
              console.log(`      ✓ Extracted from HTML: ${fileLink}`);
              return fileLink;
            }
            
            return undefined;
          })(),
        ]).then(url => url).catch(() => undefined);
        
        // Get cookies from browser context
        const cookies = await downloadPage.context().cookies();
        const cookieString = cookies.map((cookie: any) => `${cookie.name}=${cookie.value}`).join('; ');
        
        console.log(`      📋 Cookies (${cookies.length} total)`);
        
        await downloadPage.close().catch(() => {});
        
        if (finalDownloadUrl) {
          console.log(`      ✓ Final download URL: ${finalDownloadUrl}`);
          return { url: finalDownloadUrl, cookies: cookieString };
        }
      }

      return undefined;
    } catch (error) {
      console.error(`      ✗ Error fetching direct download link: ${error}`);
      return undefined;
    } finally {
      await page.close();
    }
  }

  /**
   * Get ROM details with all available information
   */
  async getRomDetails(romUrl: string, romTitle: string, consoleName: string): Promise<Rom> {
    const page = await this.createPage();
    
    try {
      const url = romUrl.startsWith('http') ? romUrl : `${this.baseUrl}${romUrl}`;
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(1500);

      const details = await page.evaluate(({ pageUrl, title, consoleSlug }: { pageUrl: string; title: string; consoleSlug: string }) => {
        const result: any = {
          title: title,
          url: pageUrl,
          console: consoleSlug,
        };

        // === TITLE ===
        const titleEl = document.querySelector('h1.entry-title');
        if (titleEl) {
          result.title = titleEl.textContent?.trim() || title;
        }

        // === DESCRIPTION ===
        const descEl = document.querySelector('.revert.page-content p');
        if (descEl) {
          result.description = descEl.textContent?.trim();
        }

        // === MAIN IMAGE ===
        const mainImg = document.querySelector('.entry-content img[alt]:not([alt*="LOGO"]):not([src*="logo"])');
        if (mainImg) {
          const src = mainImg.getAttribute('src') || mainImg.getAttribute('data-src');
          if (src) {
            result.mainImage = src.startsWith('http') ? src : `https://romsfun.com${src}`;
          }
        }

        // === SCREENSHOTS === (look for gallery/slider images)
        result.screenshots = [];
        
        // Method 1: Images with "Screenshot" in alt text
        const screenshotByAlt = document.querySelectorAll('img[alt*="Screenshot"], img[alt*="screenshot"]');
        screenshotByAlt.forEach(img => {
          const src = img.getAttribute('src') || img.getAttribute('data-src');
          if (src && !src.includes('LOGO') && !src.includes('logo')) {
            const fullSrc = src.startsWith('http') ? src : `https://romsfun.com${src}`;
            if (!result.screenshots.includes(fullSrc)) {
              result.screenshots.push(fullSrc);
            }
          }
        });
        
        // Method 2: Images in lightgallery container
        const lgImages = document.querySelectorAll('.lg-thumb-item img, [data-lg-item-id] img');
        lgImages.forEach(img => {
          const src = img.getAttribute('src') || img.getAttribute('data-src');
          if (src && !src.includes('LOGO') && !src.includes('logo')) {
            const fullSrc = src.startsWith('http') ? src : `https://romsfun.com${src}`;
            if (!result.screenshots.includes(fullSrc)) {
              result.screenshots.push(fullSrc);
            }
          }
        });
        
        // Method 3: Images with specific classes (h-36 is common for thumbnails)
        const thumbImages = document.querySelectorAll('img.h-36');
        thumbImages.forEach(img => {
          const src = img.getAttribute('src') || img.getAttribute('data-src');
          if (src && !src.includes('LOGO') && !src.includes('logo')) {
            const fullSrc = src.startsWith('http') ? src : `https://romsfun.com${src}`;
            if (!result.screenshots.includes(fullSrc)) {
              result.screenshots.push(fullSrc);
            }
          }
        });

        // === GENRE ===
        result.genre = [];
        const genreLinks = document.querySelectorAll('a[href*="genres"]');
        genreLinks.forEach(link => {
          const text = link.textContent?.trim();
          if (text && !result.genre.includes(text)) {
            result.genre.push(text);
          }
        });

        // === REGION ===
        result.region = [];
        const regionLinks = document.querySelectorAll('a[href*="/region/"]');
        regionLinks.forEach(link => {
          const text = link.textContent?.trim();
          if (text && !result.region.includes(text)) {
            result.region.push(text);
          }
        });

        // === FILE SIZE ===
        const allText = document.body.innerText;
        const sizeMatch = allText.match(/Size[:\s]*([0-9.]+\s*(?:KB|MB|GB))/i) ||
                         allText.match(/File Size[:\s]*([0-9.]+\s*(?:KB|MB|GB))/i) ||
                         allText.match(/([0-9.]+\s*(?:KB|MB|GB))/i);
        if (sizeMatch) {
          result.size = sizeMatch[1] || sizeMatch[0];
        }

        // === DOWNLOAD COUNT ===
        const downloadMatch = allText.match(/([0-9,]+)\s*(?:D|d)ownload/i);
        if (downloadMatch) {
          result.downloadCount = downloadMatch[1];
        }

        // === VIEWS ===
        const viewsMatch = allText.match(/([0-9,]+)\s*(?:V|v)iew/i);
        if (viewsMatch) {
          result.views = viewsMatch[1];
        }

        // === RELEASE DATE === (look for table rows)
        const dateRow = Array.from(document.querySelectorAll('tr')).find(tr => 
          tr.textContent?.includes('Release Date')
        );
        if (dateRow) {
          const dateCell = dateRow.querySelector('td:last-child');
          if (dateCell) {
            result.releaseDate = dateCell.textContent?.trim();
          }
        }

        // === PUBLISHER === (look for table rows)
        const publisherRow = Array.from(document.querySelectorAll('tr')).find(tr => 
          tr.textContent?.includes('Publisher')
        );
        if (publisherRow) {
          const publisherCell = publisherRow.querySelector('td:last-child');
          if (publisherCell) {
            result.publisher = publisherCell.textContent?.trim();
          }
        }

        // === DOWNLOAD LINK ===
        const downloadBtn = document.querySelector('a[href*="download"]');
        if (downloadBtn) {
          const href = downloadBtn.getAttribute('href');
          if (href) {
            result.downloadLink = href.startsWith('http') ? href : `https://romsfun.com${href}`;
          }
        }

        // === RELATED ROMS ===
        result.relatedRoms = [];
        const relatedSection = Array.from(document.querySelectorAll('h2, h3')).find(h => 
          h.textContent?.includes('Related ROMs') || h.textContent?.includes('Related Games')
        );
        
        if (relatedSection) {
          // Find the container after the heading
          let container = relatedSection.nextElementSibling;
          while (container && !container.classList.contains('space-y-4')) {
            container = container.nextElementSibling;
          }
          
          if (container) {
            const relatedItems = container.querySelectorAll('.bg-white.rounded-xl');
            relatedItems.forEach(item => {
              const relatedRom: any = {};
              
              // Title and URL
              const titleLink = item.querySelector('h3 a');
              if (titleLink) {
                relatedRom.title = titleLink.textContent?.trim();
                const href = titleLink.getAttribute('href');
                if (href) {
                  relatedRom.url = href.startsWith('http') ? href : `https://romsfun.com${href}`;
                }
              }
              
              // Image
              const img = item.querySelector('img');
              if (img) {
                const src = img.getAttribute('src');
                if (src && !src.includes('logo')) {
                  relatedRom.image = src.startsWith('http') ? src : `https://romsfun.com${src}`;
                }
              }
              
              // Console (from image alt or link)
              const consoleImg = item.querySelector('a[href*="/roms/"] img[alt]');
              if (consoleImg) {
                relatedRom.console = consoleImg.getAttribute('alt') || titleLink?.textContent?.trim() || 'Unknown';
              } else {
                relatedRom.console = titleLink?.textContent?.trim() || 'Unknown';
              }
              
              // Download count and size from badges
              const badges = item.querySelectorAll('.badge');
              badges.forEach((badge, index) => {
                const text = badge.textContent?.trim();
                if (text) {
                  // First badge is usually download count, second is size
                  if (index === 0 && text.match(/[0-9,]+/)) {
                    relatedRom.downloadCount = text.replace(/[^0-9,]/g, '');
                  } else if (index === 1 && (text.includes('G') || text.includes('M') || text.includes('K'))) {
                    relatedRom.size = text.trim();
                  }
                }
              });
              
              if (relatedRom.title && relatedRom.url) {
                result.relatedRoms.push(relatedRom);
              }
            });
          }
        }

        return result;
      }, { pageUrl: url, title: romTitle, consoleSlug: consoleName });

      return details as Rom;
    } catch (error) {
      console.error(`    ✗ Error fetching details: ${error}`);
      return {
        title: romTitle,
        url: romUrl,
        console: consoleName,
      };
    } finally {
      await page.close();
    }
  }

  /**
   * Get ROM details and immediately download the file
   * This avoids the short-lived download link expiring
   * @param romUrl ROM page URL
   * @param romTitle ROM title
   * @param consoleName Console slug
   * @param downloadDir Directory to save downloaded file
   * @returns ROM details with download status
   */
  async getRomDetailedAndDownload(
    romUrl: string, 
    romTitle: string, 
    consoleName: string,
    downloadDir: string = './downloads'
  ): Promise<Rom & { downloaded?: boolean; downloadPath?: string; downloadError?: string }> {
    const page = await this.createPage();
    
    try {
      const url = romUrl.startsWith('http') ? romUrl : `${this.baseUrl}${romUrl}`;
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(1500);

      // Get all ROM details first
      const details = await page.evaluate(({ pageUrl, title, consoleSlug }: { pageUrl: string; title: string; consoleSlug: string }) => {
        const result: any = {
          title: title,
          url: pageUrl,
          console: consoleSlug,
        };

        // === TITLE ===
        const titleEl = document.querySelector('h1.entry-title');
        if (titleEl) {
          result.title = titleEl.textContent?.trim() || title;
        }

        // === DESCRIPTION ===
        const descEl = document.querySelector('.revert.page-content p');
        if (descEl) {
          result.description = descEl.textContent?.trim();
        }

        // === MAIN IMAGE ===
        const mainImg = document.querySelector('.entry-content img[alt]:not([alt*="LOGO"]):not([src*="logo"])');
        if (mainImg) {
          const src = mainImg.getAttribute('src') || mainImg.getAttribute('data-src');
          if (src) {
            result.mainImage = src.startsWith('http') ? src : `https://romsfun.com${src}`;
          }
        }

        // === SCREENSHOTS ===
        result.screenshots = [];
        const screenshotByAlt = document.querySelectorAll('img[alt*="Screenshot"], img[alt*="screenshot"]');
        screenshotByAlt.forEach(img => {
          const src = img.getAttribute('src') || img.getAttribute('data-src');
          if (src && !src.includes('LOGO') && !src.includes('logo')) {
            const fullSrc = src.startsWith('http') ? src : `https://romsfun.com${src}`;
            if (!result.screenshots.includes(fullSrc)) {
              result.screenshots.push(fullSrc);
            }
          }
        });

        // === GENRE ===
        result.genre = [];
        const genreLinks = document.querySelectorAll('a[href*="genres"]');
        genreLinks.forEach(link => {
          const text = link.textContent?.trim();
          if (text && !result.genre.includes(text)) {
            result.genre.push(text);
          }
        });

        // === REGION ===
        result.region = [];
        const regionLinks = document.querySelectorAll('a[href*="/region/"]');
        regionLinks.forEach(link => {
          const text = link.textContent?.trim();
          if (text && !result.region.includes(text)) {
            result.region.push(text);
          }
        });

        // === FILE SIZE ===
        const allText = document.body.innerText;
        const sizeMatch = allText.match(/Size[:\s]*([0-9.]+\s*(?:KB|MB|GB))/i) ||
                         allText.match(/File Size[:\s]*([0-9.]+\s*(?:KB|MB|GB))/i) ||
                         allText.match(/([0-9.]+\s*(?:KB|MB|GB))/i);
        if (sizeMatch) {
          result.size = sizeMatch[1] || sizeMatch[0];
        }

        // === DOWNLOAD COUNT ===
        const downloadMatch = allText.match(/([0-9,]+)\s*(?:D|d)ownload/i);
        if (downloadMatch) {
          result.downloadCount = downloadMatch[1];
        }

        // === VIEWS ===
        const viewsMatch = allText.match(/([0-9,]+)\s*(?:V|v)iew/i);
        if (viewsMatch) {
          result.views = viewsMatch[1];
        }

        // === RELEASE DATE ===
        const dateRow = Array.from(document.querySelectorAll('tr')).find(tr => 
          tr.textContent?.includes('Release Date')
        );
        if (dateRow) {
          const dateCell = dateRow.querySelector('td:last-child');
          if (dateCell) {
            result.releaseDate = dateCell.textContent?.trim();
          }
        }

        // === PUBLISHER ===
        const publisherRow = Array.from(document.querySelectorAll('tr')).find(tr => 
          tr.textContent?.includes('Publisher')
        );
        if (publisherRow) {
          const publisherCell = publisherRow.querySelector('td:last-child');
          if (publisherCell) {
            result.publisher = publisherCell.textContent?.trim();
          }
        }

        // === DOWNLOAD LINK ===
        const downloadBtn = document.querySelector('a[href*="download"]');
        if (downloadBtn) {
          const href = downloadBtn.getAttribute('href');
          if (href) {
            result.downloadLink = href.startsWith('http') ? href : `https://romsfun.com${href}`;
          }
        }

        // === RELATED ROMS ===
        result.relatedRoms = [];
        const relatedSection = Array.from(document.querySelectorAll('h2, h3')).find(h => 
          h.textContent?.includes('Related ROMs') || h.textContent?.includes('Related Games')
        );
        
        if (relatedSection) {
          let container = relatedSection.nextElementSibling;
          while (container && !container.classList.contains('space-y-4')) {
            container = container.nextElementSibling;
          }
          
          if (container) {
            const relatedItems = container.querySelectorAll('.bg-white.rounded-xl');
            relatedItems.forEach(item => {
              const relatedRom: any = {};
              
              const titleLink = item.querySelector('h3 a');
              if (titleLink) {
                relatedRom.title = titleLink.textContent?.trim();
                const href = titleLink.getAttribute('href');
                if (href) {
                  relatedRom.url = href.startsWith('http') ? href : `https://romsfun.com${href}`;
                }
              }
              
              const img = item.querySelector('img');
              if (img) {
                const src = img.getAttribute('src');
                if (src && !src.includes('logo')) {
                  relatedRom.image = src.startsWith('http') ? src : `https://romsfun.com${src}`;
                }
              }
              
              const consoleImg = item.querySelector('a[href*="/roms/"] img[alt]');
              if (consoleImg) {
                relatedRom.console = consoleImg.getAttribute('alt') || titleLink?.textContent?.trim() || 'Unknown';
              } else {
                relatedRom.console = titleLink?.textContent?.trim() || 'Unknown';
              }
              
              const badges = item.querySelectorAll('.badge');
              badges.forEach((badge, index) => {
                const text = badge.textContent?.trim();
                if (text) {
                  if (index === 0 && text.match(/[0-9,]+/)) {
                    relatedRom.downloadCount = text.replace(/[^0-9,]/g, '');
                  } else if (index === 1 && (text.includes('G') || text.includes('M') || text.includes('K'))) {
                    relatedRom.size = text.trim();
                  }
                }
              });
              
              if (relatedRom.title && relatedRom.url) {
                result.relatedRoms.push(relatedRom);
              }
            });
          }
        }

        return result;
      }, { pageUrl: url, title: romTitle, consoleSlug: consoleName });

      const rom = details as Rom;

      // Get direct download link if available
      if (rom.downloadLink) {
        console.log(`      Getting direct download link... ${rom.downloadLink}`);
        const directLinkData = await this.getDirectDownloadLink(rom.downloadLink);
        
        if (directLinkData && directLinkData.url) {
          rom.directDownloadLink = decodeURI(directLinkData.url);
          console.log(`      ✓ Direct link found, downloading immediately...  ${rom.directDownloadLink}`);
          
          // Download immediately while link is fresh
          try {
            const https = require('https');
            const http = require('http');
            const fs = require('fs');
            const path = require('path');
            const url = require('url');
            
            // Create download directory
            if (!fs.existsSync(downloadDir)) {
              fs.mkdirSync(downloadDir, { recursive: true });
            }
            
            // Sanitize filename
            const sanitizedTitle = rom.title
              .replace(/[^a-zA-Z0-9\s\-_\.]/g, '')
              .replace(/\s+/g, '-')
              .substring(0, 200);
            
            const filename = `${sanitizedTitle}.zip`;
            const filePath = path.join(downloadDir, filename);
            
            // Download with native https/http module
            const downloadUrl = url.parse(directLinkData.url);
            const protocol = downloadUrl.protocol === 'https:' ? https : http;
            
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
                timeout: 300000, // 5 minutes
              }, (response: any) => {
                // Handle redirects
                if (response.statusCode === 301 || response.statusCode === 302) {
                  const redirectUrl = response.headers.location;
                  if (redirectUrl) {
                    console.log(`      → Following redirect...`);
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
                      timeout: 300000,
                    }, (redirectResponse: any) => {
                      if (redirectResponse.statusCode !== 200) {
                        reject(new Error(`HTTP ${redirectResponse.statusCode}`));
                        return;
                      }
                      this.downloadWithStream(redirectResponse, filePath, resolve, reject);
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
                
                this.downloadWithStream(response, filePath, resolve, reject);
              });
              
              request.on('error', reject);
              request.on('timeout', () => {
                request.destroy();
                reject(new Error('Download timeout'));
              });
            });
            
            const stats = fs.statSync(filePath);
            console.log(`      ✓ Downloaded: ${filename} (${this.formatBytes(stats.size)})`);
            
            return {
              ...rom,
              downloaded: true,
              downloadPath: filePath,
            };
          } catch (downloadError: any) {
            console.error(`      ✗ Download failed: ${downloadError.message}`);
            return {
              ...rom,
              downloaded: false,
              downloadError: downloadError.message,
            };
          }
        } else {
          console.log(`      ✗ Could not extract direct download link`);
        }
      }

      return rom;
    } catch (error) {
      console.error(`    ✗ Error fetching details: ${error}`);
      return {
        title: romTitle,
        url: romUrl,
        console: consoleName,
        downloaded: false,
        downloadError: error instanceof Error ? error.message : String(error),
      };
    } finally {
      await page.close();
    }
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * Helper method to download file from stream
   */
  private downloadWithStream(
    response: any,
    filePath: string,
    resolve: () => void,
    reject: (error: Error) => void
  ): void {
    const fs = require('fs');
    
    const totalSize = parseInt(response.headers['content-length'] || '0');
    let downloadedSize = 0;
    
    const writer = fs.createWriteStream(filePath);
    
    response.on('data', (chunk: Buffer) => {
      downloadedSize += chunk.length;
      if (totalSize > 0) {
        const percent = Math.floor((downloadedSize / totalSize) * 100);
        if (percent % 20 === 0) {
          console.log(`      Progress: ${percent}%`);
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

  /**
   * Get ROMs for a console and immediately download them
   * This avoids the short-lived download links expiring
   * @param consoleSlug Console slug (e.g., 'nes', 'game-boy')
   * @param maxPages Maximum pages to fetch
   * @param downloadDir Directory to save downloaded files
   * @returns Array of ROM details with download status
   */
  async getRomsByConsoleAndDownload(
    consoleSlug: string, 
    maxPages = 1,
    downloadDir: string = './downloads'
  ): Promise<Array<Rom & { downloaded?: boolean; downloadPath?: string; downloadError?: string }>> {
    const allRoms: Array<Rom & { downloaded?: boolean; downloadPath?: string; downloadError?: string }> = [];
    
    console.log(`\n=== Fetching and Downloading ROMs for: ${consoleSlug} ===`);
    console.log(`Download directory: ${downloadDir}\n`);

    // Create download directory
    const fs = require('fs');
    const path = require('path');
    if (!fs.existsSync(downloadDir)) {
      fs.mkdirSync(downloadDir, { recursive: true });
    }

    let successCount = 0;
    let failCount = 0;
    let noLinkCount = 0;

    // Fetch pages
    for (let currentPage = 1; currentPage <= maxPages; currentPage++) {
      const page = await this.createPage();
      
      try {
        const url = `${this.baseUrl}/roms/${consoleSlug}/?page=${currentPage}`;
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(1500);

        const roms = await page.evaluate((slug) => {
          const results: any[] = [];
          const links = document.querySelectorAll(`a[href*="/roms/${slug}/"][href$=".html"]`);
          
          links.forEach(link => {
            const href = link.getAttribute('href');
            const title = link.textContent?.trim() || link.getAttribute('title');
            
            if (href && title && title.length > 2) {
              results.push({
                title,
                url: href.startsWith('http') ? href : `https://romsfun.com${href}`,
              });
            }
          });
          
          return results;
        }, consoleSlug);

        console.log(`Page ${currentPage}: Found ${roms.length} ROMs`);

        // If no ROMs found, stop pagination
        if (roms.length === 0) {
          console.log(`✓ No more ROMs found, stopping pagination\n`);
          await page.close();
          break;
        }

        await page.close();

        // Fetch details and download each ROM
        for (let i = 0; i < roms.length; i++) {
          const rom = roms[i];
          console.log(`\n[${i + 1}/${roms.length}] ${rom.title.substring(0, 60)}...`);
          
          try {
            // Use getRomDetailedAndDownload to fetch and download immediately
            const romWithDownload = await this.getRomDetailedAndDownload(
              rom.url,
              rom.title,
              consoleSlug,
              downloadDir
            );
            await this.sleep(2000);
            
            allRoms.push(romWithDownload);
            
            // Track statistics
            if (romWithDownload.downloaded) {
              successCount++;
            } else if (romWithDownload.downloadError) {
              failCount++;
            } else if (!romWithDownload.directDownloadLink) {
              noLinkCount++;
            }
            
          } catch (error) {
            console.error(`  ✗ Error processing ROM: ${error}`);
            allRoms.push({
              title: rom.title,
              url: rom.url,
              console: consoleSlug,
              downloaded: false,
              downloadError: error instanceof Error ? error.message : String(error),
            });
            failCount++;
          }
          
          // Rate limiting between ROMs
          await this.sleep(2000);
        }
        
      } catch (error) {
        console.error(`✗ Error on page ${currentPage}: ${error}`);
        await page.close();
        break;
      }

      // Rate limiting between pages
      await this.sleep(2000);
    }

    // Summary statistics
    console.log('\n\n=== DOWNLOAD SUMMARY ===');
    console.log(`Total ROMs processed: ${allRoms.length}`);
    console.log(`✓ Successfully downloaded: ${successCount}`);
    console.log(`✗ Failed downloads: ${failCount}`);
    console.log(`⊘ No download link available: ${noLinkCount}`);
    console.log(`Success rate: ${allRoms.length > 0 ? ((successCount / allRoms.length) * 100).toFixed(1) : 0}%`);

    return allRoms;
  }

  /**
   * Get ROMs for a specific console with detailed information
   */
  async getRomsByConsoleDetailed(consoleSlug: string, maxPages = 1): Promise<Rom[]> {
    const allRoms: Rom[] = [];
    
    console.log(`\nFetching ROMs for: ${consoleSlug}`);

    // First, get ROM list
    for (let currentPage = 1; currentPage <= maxPages; currentPage++) {
      const page = await this.createPage();
      
      try {
        const url = `${this.baseUrl}/roms/${consoleSlug}/?page=${currentPage}`;
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(1500);

        const roms = await page.evaluate((slug) => {
          const results: any[] = [];
          
          const links = document.querySelectorAll(`a[href*="/roms/${slug}/"][href$=".html"]`);
          
          links.forEach(link => {
            const href = link.getAttribute('href');
            const title = link.textContent?.trim() || link.getAttribute('title');
            
            if (href && title && title.length > 2) {
              results.push({
                title,
                url: href.startsWith('http') ? href : `https://romsfun.com${href}`,
              });
            }
          });
          
          return results;
        }, consoleSlug);

        console.log(`  Page ${currentPage}: Found ${roms.length} ROMs`);

        // If no ROMs found on this page, stop pagination
        if (roms.length === 0) {
          console.log(`  ✓ No more ROMs found, stopping pagination`);
          await page.close();
          break;
        }

        // Fetch details for each ROM
        for (let i = 0; i < roms.length; i++) {
          const rom = roms[i];
          console.log(`    [${i + 1}/${roms.length}] Fetching: ${rom.title.substring(0, 50)}...`);
          
          const details = await this.getRomDetails(rom.url, rom.title, consoleSlug);
          
          // Get direct download link if download link exists
          if (details.downloadLink) {
            console.log(`      Getting direct download link...`);
            const directLinkData = await this.getDirectDownloadLink(details.downloadLink);
            if (directLinkData && directLinkData.url) {
              details.directDownloadLink = directLinkData.url;
              console.log(`      ✓ Direct link found`);
            }
          }
          
          allRoms.push(details);
          
          // Rate limiting between ROM details
          await this.sleep(800);
        }
        
        await page.close();
        
      } catch (error) {
        console.error(`  ✗ Error on page ${currentPage}: ${error}`);
        await page.close();
        break;
      }

      // Rate limiting between pages
      await this.sleep(1000);
    }

    console.log(`  ✓ Total: ${allRoms.length} ROMs with details`);
    return allRoms;
  }

  /**
   * Get ROMs from specific consoles with detailed information
   */
  async getAllRomsDetailed(maxPagesPerConsole = 1, consoleLimit = 1): Promise<Map<string, Rom[]>> {
    const allRomsMap = new Map<string, Rom[]>();

    // Get all consoles
    let consoles = await this.getAllConsoles();
    
    if (consoleLimit) {
      consoles = consoles.slice(0, consoleLimit);
      console.log(`\n⚠️ Limited to first ${consoleLimit} console(s) for testing`);
    }

    console.log(`\n=== Fetching Detailed ROMs from ${consoles.length} console(s) ===\n`);

    // Fetch ROMs for each console
    for (let i = 0; i < consoles.length; i++) {
      const consoleItem = consoles[i];
      console.log(`[${i + 1}/${consoles.length}] ${consoleItem.name}`);
      
      try {
        const roms = await this.getRomsByConsoleDetailed(consoleItem.slug, maxPagesPerConsole);
        
        if (roms.length > 0) {
          allRomsMap.set(consoleItem.slug, roms);
        }
        
        // Rate limiting between consoles
        await this.sleep(2000);
      } catch (error) {
        console.error(`  ✗ Failed to fetch ${consoleItem.slug}: ${error}`);
      }
    }

    return allRomsMap;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}

// Main execution
async function main() {
  const client = new RomsFunEnhancedClient();
  const db = new RomDatabase();
  
  // Parse command line arguments
  const args = process.argv.slice(2);
  let consoleLimit: number | undefined = 1;
  let pagesPerConsole = 1;
  let specificConsoles: string[] = [];
  
  // Parse arguments: 
  // Format 1: consoleLimit pagesPerConsole
  // Format 2: --console console1 console2 ... --pages pagesPerConsole
  // 
  // Examples:
  //   npm run fetch:enhanced -- 5 10  (fetch 5 consoles, 10 pages each)
  //   npm run fetch:enhanced -- all 20  (fetch all consoles, 20 pages each)
  //   npm run fetch:enhanced -- --console game-boy nintendo-ds --pages 20
  //   npm run fetch:enhanced -- --console game-boy
  
  if (args.includes('--console')) {
    // Format 2: specific consoles
    const consoleIndex = args.indexOf('--console');
    const pagesIndex = args.indexOf('--pages');
    
    // Get console names (all args between --console and --pages or end)
    const endIndex = pagesIndex !== -1 ? pagesIndex : args.length;
    specificConsoles = args.slice(consoleIndex + 1, endIndex);
    
    // Get pages if specified
    if (pagesIndex !== -1 && args[pagesIndex + 1]) {
      pagesPerConsole = parseInt(args[pagesIndex + 1]) || 1;
    }
    
    consoleLimit = undefined; // Will be handled by specificConsoles
  } else if (args.length > 0) {
    // Format 1: consoleLimit pagesPerConsole
    const consoleLimitArg = args[0];
    consoleLimit = consoleLimitArg === 'all' || consoleLimitArg === 'ALL' ? undefined : parseInt(consoleLimitArg);
    
    if (args.length > 1) {
      pagesPerConsole = parseInt(args[1]) || 1;
    }
  }
  
  try {
    // Initialize database
    await db.init();
    
    console.log('=== RomsFun - Enhanced Detailed Fetch ===\n');
    console.log('Configuration:');
    if (specificConsoles.length > 0) {
      console.log(`  - Consoles: ${specificConsoles.join(', ')}`);
    } else {
      console.log(`  - Consoles: ${consoleLimit || 'ALL'}`);
    }
    console.log(`  - Pages per console: ${pagesPerConsole}`);
    console.log('  - Fetching ALL available info for each ROM');
    console.log('  - Saving to SQLite database\n');

    let allRoms: Map<string, Rom[]>;
    
    if (specificConsoles.length > 0) {
      // Fetch only specific consoles
      allRoms = new Map<string, Rom[]>();
      
      console.log(`\n=== Fetching Specific Consoles ===\n`);
      
      for (let i = 0; i < specificConsoles.length; i++) {
        const consoleSlug = specificConsoles[i];
        console.log(`[${i + 1}/${specificConsoles.length}] ${consoleSlug}`);
        
        try {
          const roms = await client.getRomsByConsoleDetailed(consoleSlug, pagesPerConsole);
          
          if (roms.length > 0) {
            allRoms.set(consoleSlug, roms);
          }
          
          // Rate limiting between consoles
          await client['sleep'](2000);
        } catch (error) {
          console.error(`  ✗ Failed to fetch ${consoleSlug}: ${error}`);
        }
      }
    } else {
      // Fetch all or limited consoles
      allRoms = await client.getAllRomsDetailed(pagesPerConsole, consoleLimit);
    }

    // Save ROMs to database
    console.log('\nSaving to database...');
    let savedCount = 0;
    for (const [consoleName, roms] of allRoms.entries()) {
      for (const rom of roms) {
        await db.saveRom(rom);
        savedCount++;
      }
    }
    console.log(`✓ Saved ${savedCount} ROMs to database`);

    // Calculate statistics
    let totalRoms = 0;
    let romsWithDownloadLinks = 0;
    let romsWithDirectLinks = 0;
    let romsWithDescription = 0;
    let romsWithSize = 0;
    let romsWithRegion = 0;
    let romsWithGenre = 0;
    let romsWithPublisher = 0;
    let romsWithScreenshots = 0;
    let romsWithRelated = 0;
    const consolesWithRoms: any[] = [];

    for (const [consoleName, roms] of allRoms.entries()) {
      totalRoms += roms.length;
      
      const withDownload = roms.filter(r => r.downloadLink).length;
      const withDirectLink = roms.filter(r => r.directDownloadLink).length;
      const withDesc = roms.filter(r => r.description && r.description.length > 0).length;
      const withSize = roms.filter(r => r.size).length;
      const withRegion = roms.filter(r => r.region && r.region.length > 0).length;
      const withGenre = roms.filter(r => r.genre && r.genre.length > 0).length;
      const withPublisher = roms.filter(r => r.publisher).length;
      const withScreenshots = roms.filter(r => r.screenshots && r.screenshots.length > 0).length;
      const withRelated = roms.filter(r => r.relatedRoms && r.relatedRoms.length > 0).length;
      
      romsWithDownloadLinks += withDownload;
      romsWithDirectLinks += withDirectLink;
      romsWithDescription += withDesc;
      romsWithSize += withSize;
      romsWithRegion += withRegion;
      romsWithGenre += withGenre;
      romsWithPublisher += withPublisher;
      romsWithScreenshots += withScreenshots;
      romsWithRelated += withRelated;

      consolesWithRoms.push({
        console: consoleName,
        count: roms.length,
        withDownload,
        withDirectLink,
        withDescription: withDesc,
        withSize,
        withRegion,
        withGenre,
        withPublisher,
        withScreenshots,
        withRelated,
      });
    }

    console.log('\n\n=== DETAILED SUMMARY ===');
    console.log(`Total Consoles: ${allRoms.size}`);
    console.log(`Total ROMs: ${totalRoms}`);
    console.log(`ROMs with Download Links: ${romsWithDownloadLinks} (${Math.round(romsWithDownloadLinks/totalRoms*100)}%)`);
    console.log(`ROMs with Direct Download Links: ${romsWithDirectLinks} (${Math.round(romsWithDirectLinks/totalRoms*100)}%)`);
    console.log(`ROMs with Description: ${romsWithDescription} (${Math.round(romsWithDescription/totalRoms*100)}%)`);
    console.log(`ROMs with Size Info: ${romsWithSize} (${Math.round(romsWithSize/totalRoms*100)}%)`);
    console.log(`ROMs with Region: ${romsWithRegion} (${Math.round(romsWithRegion/totalRoms*100)}%)`);
    console.log(`ROMs with Genre: ${romsWithGenre} (${Math.round(romsWithGenre/totalRoms*100)}%)`);
    console.log(`ROMs with Publisher: ${romsWithPublisher} (${Math.round(romsWithPublisher/totalRoms*100)}%)`);
    console.log(`ROMs with Screenshots: ${romsWithScreenshots} (${Math.round(romsWithScreenshots/totalRoms*100)}%)`);
    console.log(`ROMs with Related ROMs: ${romsWithRelated} (${Math.round(romsWithRelated/totalRoms*100)}%)`);
    
    console.log('\n\nDetailed per Console:');
    consolesWithRoms.forEach(c => {
      console.log(`  ${c.console}: ${c.count} ROMs`);
      console.log(`    - Downloads: ${c.withDownload}`);
      console.log(`    - Direct Links: ${c.withDirectLink}`);
      console.log(`    - Descriptions: ${c.withDescription}`);
      console.log(`    - Sizes: ${c.withSize}`);
      console.log(`    - Regions: ${c.withRegion}`);
      console.log(`    - Genres: ${c.withGenre}`);
      console.log(`    - Publishers: ${c.withPublisher}`);
      console.log(`    - Screenshots: ${c.withScreenshots}`);
      console.log(`    - Related ROMs: ${c.withRelated}`);
    });

    // Show sample ROM
    if (totalRoms > 0) {
      const firstConsole = Array.from(allRoms.values())[0];
      const sampleRom = firstConsole[0];
      console.log('\n\n=== SAMPLE ROM DATA ===');
      console.log(JSON.stringify(sampleRom, null, 2));
    }

    // Save to JSON (still keep JSON output for backup)
    const outputDir = path.join(__dirname, '..', 'output');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const data = {
      fetchedAt: new Date().toISOString(),
      configuration: {
        consoles: consoleLimit,
        pagesPerConsole: pagesPerConsole,
        detailedFetch: true,
        database: 'SQLite'
      },
      statistics: {
        totalConsoles: allRoms.size,
        totalRoms,
        romsWithDownloadLinks,
        romsWithDirectLinks,
        romsWithDescription,
        romsWithSize,
        romsWithRegion,
        romsWithGenre,
        romsWithPublisher,
        romsWithScreenshots,
        romsWithRelated,
      },
      consoles: consolesWithRoms,
      roms: Object.fromEntries(allRoms),
    };

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outputPath = path.join(outputDir, `romsfun-enhanced-${timestamp}.json`);
    const latestPath = path.join(outputDir, 'romsfun-enhanced-latest.json');

    fs.writeFileSync(outputPath, JSON.stringify(data, null, 2));
    fs.writeFileSync(latestPath, JSON.stringify(data, null, 2));

    console.log('\n✓ Data saved to:');
    console.log(`  - Database: output/roms.db`);
    console.log(`  - JSON: ${outputPath}`);
    console.log(`  - JSON: ${latestPath}`);

    // Show database stats
    const dbStats = await db.getStats();
    console.log('\n=== DATABASE STATS ===');
    console.log(`Total ROMs in DB: ${dbStats.totalRoms}`);
    console.log(`Total Consoles: ${dbStats.totalConsoles}`);
    console.log(`ROMs with Direct Links: ${dbStats.romsWithDirectLinks}`);
    console.log(`ROMs with Descriptions: ${dbStats.romsWithDescriptions}`);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.close();
    await db.close();
  }
}

if (require.main === module) {
  main().catch(console.error);
}

export { RomsFunEnhancedClient, main };
