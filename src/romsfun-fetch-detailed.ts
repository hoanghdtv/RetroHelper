import { chromium, Browser, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

interface Console {
  name: string;
  slug: string;
  url: string;
}

interface Rom {
  title: string;
  url: string;
  console: string;
  image?: string;
  description?: string;
  size?: string;
  downloadLink?: string;
  region?: string;
  language?: string;
  genre?: string;
  releaseDate?: string;
}

class RomsFunDetailedClient {
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
   * Get ROM details from its page
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

        // Get description
        const descEl = document.querySelector('.description, .content, .game-description, .rom-description, p.description');
        if (descEl) {
          result.description = descEl.textContent?.trim().substring(0, 500);
        }

        // Get image
        const imgEl = document.querySelector('.game-image img, .rom-image img, img[alt*="ROM"], img[alt*="Game"], .main-image img');
        if (imgEl) {
          const src = imgEl.getAttribute('src') || imgEl.getAttribute('data-src');
          if (src) {
            result.image = src.startsWith('http') ? src : `https://romsfun.com${src}`;
          }
        }

        // Get download link
        const downloadBtn = document.querySelector('a[href*="download"], .download-button, .btn-download');
        if (downloadBtn) {
          const href = downloadBtn.getAttribute('href');
          if (href) {
            result.downloadLink = href.startsWith('http') ? href : `https://romsfun.com${href}`;
          }
        }

        // Get metadata from info sections
        const infoElements = document.querySelectorAll('.info-item, .meta-item, .detail-item, .game-info li, .rom-info li');
        infoElements.forEach(el => {
          const text = el.textContent?.trim() || '';
          
          if (text.toLowerCase().includes('size') || text.toLowerCase().includes('file size')) {
            const match = text.match(/[\d.]+\s*(KB|MB|GB)/i);
            if (match) result.size = match[0];
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
          
          if (text.toLowerCase().includes('release') || text.toLowerCase().includes('date')) {
            result.releaseDate = text.split(':')[1]?.trim() || text;
          }
        });

        // Try to get size from download button or file info
        if (!result.size) {
          const sizeEl = document.querySelector('.file-size, .size, [class*="size"]');
          if (sizeEl) {
            const sizeText = sizeEl.textContent?.trim();
            const match = sizeText?.match(/[\d.]+\s*(KB|MB|GB)/i);
            if (match) result.size = match[0];
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
   * Get ROMs for a specific console with detailed information
   */
  async getRomsByConsoleDetailed(consoleSlug: string, maxPages = 2): Promise<Rom[]> {
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

        // Fetch details for each ROM
        for (let i = 0; i < roms.length; i++) {
          const rom = roms[i];
          console.log(`    [${i + 1}/${roms.length}] Fetching: ${rom.title.substring(0, 50)}...`);
          
          const details = await this.getRomDetails(rom.url, rom.title, consoleSlug);
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
  async getAllRomsDetailed(maxPagesPerConsole = 2, consoleLimit = 2): Promise<Map<string, Rom[]>> {
    const allRomsMap = new Map<string, Rom[]>();

    // Get all consoles
    let consoles = await this.getAllConsoles();
    
    if (consoleLimit) {
      consoles = consoles.slice(0, consoleLimit);
      console.log(`\n⚠️ Limited to first ${consoleLimit} consoles for testing`);
    }

    console.log(`\n=== Fetching Detailed ROMs from ${consoles.length} consoles ===\n`);

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
  const client = new RomsFunDetailedClient();
  
  try {
    console.log('=== RomsFun - Fetch Detailed ROMs ===\n');
    console.log('Configuration:');
    console.log('  - Consoles: 2');
    console.log('  - Pages per console: 2');
    console.log('  - Fetching detailed info for each ROM\n');

    const allRoms = await client.getAllRomsDetailed(2, 2);

    // Calculate statistics
    let totalRoms = 0;
    let romsWithDownloadLinks = 0;
    let romsWithDescription = 0;
    let romsWithSize = 0;
    const consolesWithRoms: any[] = [];

    for (const [consoleName, roms] of allRoms.entries()) {
      totalRoms += roms.length;
      
      const withDownload = roms.filter(r => r.downloadLink).length;
      const withDesc = roms.filter(r => r.description).length;
      const withSize = roms.filter(r => r.size).length;
      
      romsWithDownloadLinks += withDownload;
      romsWithDescription += withDesc;
      romsWithSize += withSize;

      consolesWithRoms.push({
        console: consoleName,
        count: roms.length,
        withDownload,
        withDescription: withDesc,
        withSize,
      });
    }

    console.log('\n\n=== SUMMARY ===');
    console.log(`Total Consoles: ${allRoms.size}`);
    console.log(`Total ROMs: ${totalRoms}`);
    console.log(`ROMs with Download Links: ${romsWithDownloadLinks}`);
    console.log(`ROMs with Description: ${romsWithDescription}`);
    console.log(`ROMs with Size Info: ${romsWithSize}`);
    
    console.log('\nDetailed per Console:');
    consolesWithRoms.forEach(c => {
      console.log(`  ${c.console}: ${c.count} ROMs`);
      console.log(`    - Downloads: ${c.withDownload}`);
      console.log(`    - Descriptions: ${c.withDescription}`);
      console.log(`    - Sizes: ${c.withSize}`);
    });

    // Save to JSON
    const outputDir = path.join(__dirname, '..', 'output');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const data = {
      fetchedAt: new Date().toISOString(),
      configuration: {
        consoles: 2,
        pagesPerConsole: 2,
        detailedFetch: true,
      },
      statistics: {
        totalConsoles: allRoms.size,
        totalRoms,
        romsWithDownloadLinks,
        romsWithDescription,
        romsWithSize,
      },
      consoles: consolesWithRoms,
      roms: Object.fromEntries(allRoms),
    };

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outputPath = path.join(outputDir, `romsfun-detailed-${timestamp}.json`);
    const latestPath = path.join(outputDir, 'romsfun-detailed-latest.json');

    fs.writeFileSync(outputPath, JSON.stringify(data, null, 2));
    fs.writeFileSync(latestPath, JSON.stringify(data, null, 2));

    console.log('\n✓ Data saved to:');
    console.log(`  - ${outputPath}`);
    console.log(`  - ${latestPath}`);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  main().catch(console.error);
}

export { RomsFunDetailedClient, main };
