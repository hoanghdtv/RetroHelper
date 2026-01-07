import { chromium, Browser, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

interface RomsFunGame {
  title: string;
  url: string;
  console: string;
  image?: string;
  downloads?: number;
}

export class SimpleRomsFunClient {
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
   * Get popular/most downloaded games
   */
  async getPopularGames(limit = 20): Promise<RomsFunGame[]> {
    const page = await this.createPage();
    
    try {
      console.log('Fetching popular games from homepage...');
      await page.goto(this.baseUrl, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(2000);

      const games = await page.evaluate((maxLimit) => {
        const results: any[] = [];
        
        // Find game links (format: /roms/{console}/{game}.html)
        const links = document.querySelectorAll('a[href*="/roms/"][href$=".html"]');
        
        links.forEach((link) => {
          if (results.length >= maxLimit) return;
          
          const href = link.getAttribute('href');
          const title = link.textContent?.trim() || link.getAttribute('title');
          
          if (href && title) {
            // Extract console from URL: /roms/3ds/pokemon-x-and-y.html -> 3ds
            const parts = href.split('/');
            const console = parts[2] || 'unknown';
            
            // Find image if available
            const img = link.querySelector('img');
            const image = img?.getAttribute('src') || img?.getAttribute('data-src');
            
            results.push({
              title,
              url: href.startsWith('http') ? href : `https://romsfun.com${href}`,
              console,
              image: image ? (image.startsWith('http') ? image : `https://romsfun.com${image}`) : undefined,
            });
          }
        });
        
        return results;
      }, limit);

      console.log(`  Found ${games.length} games`);
      return games.slice(0, limit);
    } finally {
      await page.close();
    }
  }

  /**
   * Browse all ROMs with sorting
   */
  async browseAllRoms(sortBy: 'downloads' | 'recent' | 'rating' = 'downloads', limit = 50): Promise<RomsFunGame[]> {
    const page = await this.createPage();
    
    try {
      const url = `${this.baseUrl}/browse-all-roms/?sort=${sortBy}`;
      console.log(`Browsing all ROMs (sorted by ${sortBy})...`);
      
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(2000);

      const games = await page.evaluate((maxLimit) => {
        const results: any[] = [];
        
        const links = document.querySelectorAll('a[href*="/roms/"][href$=".html"]');
        
        links.forEach((link) => {
          if (results.length >= maxLimit) return;
          
          const href = link.getAttribute('href');
          const title = link.textContent?.trim() || link.getAttribute('title');
          
          if (href && title && title.length > 3) {
            const parts = href.split('/');
            const console = parts[2] || 'unknown';
            
            const img = link.querySelector('img');
            const image = img?.getAttribute('src') || img?.getAttribute('data-src');
            
            results.push({
              title,
              url: href.startsWith('http') ? href : `https://romsfun.com${href}`,
              console,
              image: image ? (image.startsWith('http') ? image : `https://romsfun.com${image}`) : undefined,
            });
          }
        });
        
        return results;
      }, limit);

      console.log(`  Found ${games.length} games`);
      return games;
    } finally {
      await page.close();
    }
  }

  /**
   * Get game details
   */
  async getGameDetails(gameUrl: string): Promise<any> {
    const page = await this.createPage();
    
    try {
      const url = gameUrl.startsWith('http') ? gameUrl : `${this.baseUrl}${gameUrl}`;
      console.log(`Fetching details: ${url}`);
      
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(2000);

      const details = await page.evaluate(() => {
        const title = document.querySelector('h1')?.textContent?.trim();
        const description = document.querySelector('.description, .content, .game-description')?.textContent?.trim();
        
        // Find download button
        const downloadBtn = document.querySelector('a[href*="download"], .download-button, button[contains="download"]');
        const downloadLink = downloadBtn?.getAttribute('href');
        
        // Get metadata
        const metadata: any = {};
        document.querySelectorAll('.meta, .info, .details').forEach(el => {
          const label = el.querySelector('.label, strong')?.textContent?.trim();
          const value = el.querySelector('.value, span:last-child')?.textContent?.trim();
          if (label && value) {
            metadata[label] = value;
          }
        });
        
        return {
          title,
          description: description?.substring(0, 500),
          downloadLink,
          metadata,
        };
      });

      return details;
    } finally {
      await page.close();
    }
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}

// Example usage
async function main() {
  const client = new SimpleRomsFunClient();
  
  try {
    console.log('=== RomsFun Simple Client ===\n');

    // Get popular games
    console.log('1. Fetching popular games...');
    const popularGames = await client.getPopularGames(10);
    console.log(`\nTop 10 popular games:`);
    popularGames.forEach((game, i) => {
      console.log(`${i + 1}. ${game.title} [${game.console}]`);
      console.log(`   URL: ${game.url}`);
    });

    // Browse all ROMs
    console.log('\n2. Browsing most downloaded ROMs...');
    const allGames = await client.browseAllRoms('downloads', 20);
    console.log(`\nTop 20 downloaded ROMs:`);
    allGames.slice(0, 10).forEach((game, i) => {
      console.log(`${i + 1}. ${game.title} [${game.console}]`);
    });

    // Get details of first game
    if (popularGames.length > 0) {
      console.log('\n3. Getting game details...');
      const firstGame = popularGames[0];
      const details = await client.getGameDetails(firstGame.url);
      console.log(`\nDetails for: ${details.title}`);
      console.log(`Description: ${details.description}`);
      if (details.downloadLink) {
        console.log(`Download: ${details.downloadLink}`);
      }
    }

    // Save results
    const outputDir = path.join(__dirname, '..', 'output');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const data = {
      popularGames,
      mostDownloaded: allGames,
      fetchedAt: new Date().toISOString(),
    };

    fs.writeFileSync(
      path.join(outputDir, 'romsfun-simple-results.json'),
      JSON.stringify(data, null, 2)
    );
    console.log('\n✓ Data saved to: output/romsfun-simple-results.json');

  } finally {
    await client.close();
  }
}

if (require.main === module) {
  main().catch(console.error);
}

export { main as testSimpleClient };
