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
}

class RomsFunFullClient {
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

        // Look for console links in various places
        const selectors = [
          'a[href*="/roms/"]',
          '.console-link',
          '.platform-link',
          'nav a',
        ];

        selectors.forEach(selector => {
          const links = document.querySelectorAll(selector);
          links.forEach(link => {
            const href = link.getAttribute('href');
            const text = link.textContent?.trim();

            // Match pattern: /roms/{console}/ (not individual game pages)
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
   * Get all ROMs for a specific console
   */
  async getRomsByConsole(consoleSlug: string, maxPages = 10): Promise<Rom[]> {
    const allRoms: Rom[] = [];
    let currentPage = 1;
    let hasMore = true;

    console.log(`\nFetching ROMs for: ${consoleSlug}`);

    while (hasMore && currentPage <= maxPages) {
      const page = await this.createPage();
      
      try {
        const url = `${this.baseUrl}/roms/${consoleSlug}/?page=${currentPage}`;
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(1500);

        const roms = await page.evaluate((slug) => {
          const results: any[] = [];
          
          // Find ROM links (pattern: /roms/{console}/{game}.html)
          const links = document.querySelectorAll(`a[href*="/roms/${slug}/"][href$=".html"]`);
          
          links.forEach(link => {
            const href = link.getAttribute('href');
            const title = link.textContent?.trim() || link.getAttribute('title');
            
            if (href && title && title.length > 2) {
              const img = link.querySelector('img') || link.parentElement?.querySelector('img');
              const image = img?.getAttribute('src') || img?.getAttribute('data-src');
              
              results.push({
                title,
                url: href.startsWith('http') ? href : `https://romsfun.com${href}`,
                console: slug,
                image: image ? (image.startsWith('http') ? image : `https://romsfun.com${image}`) : undefined,
              });
            }
          });
          
          return results;
        }, consoleSlug);

        if (roms.length === 0) {
          hasMore = false;
        } else {
          allRoms.push(...roms);
          console.log(`  Page ${currentPage}: +${roms.length} ROMs (total: ${allRoms.length})`);
          currentPage++;
        }
      } catch (error) {
        console.error(`  ✗ Error on page ${currentPage}: ${error}`);
        hasMore = false;
      } finally {
        await page.close();
      }

      // Rate limiting
      await this.sleep(1000);
    }

    console.log(`  ✓ Total: ${allRoms.length} ROMs`);
    return allRoms;
  }

  /**
   * Get ALL ROMs from ALL consoles
   */
  async getAllRoms(maxPagesPerConsole = 5, consoleLimit?: number): Promise<Map<string, Rom[]>> {
    const allRomsMap = new Map<string, Rom[]>();

    // Get all consoles
    let consoles = await this.getAllConsoles();
    
    if (consoleLimit) {
      consoles = consoles.slice(0, consoleLimit);
      console.log(`\n⚠️ Limited to first ${consoleLimit} consoles for testing`);
    }

    console.log(`\n=== Fetching ROMs from ${consoles.length} consoles ===\n`);

    // Fetch ROMs for each console
    for (let i = 0; i < consoles.length; i++) {
      const consoleItem = consoles[i];
      console.log(`[${i + 1}/${consoles.length}] ${consoleItem.name}`);
      
      try {
        const roms = await this.getRomsByConsole(consoleItem.slug, maxPagesPerConsole);
        
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
  const client = new RomsFunFullClient();
  
  try {
    console.log('=== RomsFun - Fetch All ROMs from All Consoles ===\n');

    // Get ALL ROMs
    // Set consoleLimit for testing (remove or set to undefined for all consoles)
    const allRoms = await client.getAllRoms(
      5,      // maxPagesPerConsole - increase for more ROMs per console
      10      // consoleLimit - set to undefined to fetch ALL consoles
    );

    // Calculate statistics
    let totalRoms = 0;
    const consolesWithRoms: any[] = [];

    for (const [consoleName, roms] of allRoms.entries()) {
      totalRoms += roms.length;
      consolesWithRoms.push({
        console: consoleName,
        count: roms.length,
      });
    }

    // Sort by count
    consolesWithRoms.sort((a, b) => b.count - a.count);

    console.log('\n\n=== SUMMARY ===');
    console.log(`Total Consoles: ${allRoms.size}`);
    console.log(`Total ROMs: ${totalRoms}`);
    console.log('\nROMs per Console:');
    consolesWithRoms.forEach(c => {
      console.log(`  ${c.console}: ${c.count} ROMs`);
    });

    // Save to JSON
    const outputDir = path.join(__dirname, '..', 'output');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const data = {
      fetchedAt: new Date().toISOString(),
      totalConsoles: allRoms.size,
      totalRoms: totalRoms,
      consoles: consolesWithRoms,
      roms: Object.fromEntries(allRoms),
    };

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outputPath = path.join(outputDir, `romsfun-all-roms-${timestamp}.json`);
    const latestPath = path.join(outputDir, 'romsfun-all-roms-latest.json');

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

export { RomsFunFullClient, main };
