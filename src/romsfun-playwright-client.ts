import { chromium, Browser, Page } from 'playwright';
import {
  RomsFunGame,
  RomsFunSearchResult,
  RomsFunConsole,
  RomsFunConfig,
} from './romsfun-types';

export class RomsFunPlaywrightClient {
  private browser: Browser | null = null;
  private baseUrl: string;
  private headless: boolean;

  constructor(config?: RomsFunConfig & { headless?: boolean }) {
    this.baseUrl = config?.baseUrl || 'https://romsfun.com';
    this.headless = config?.headless !== false; // default true
  }

  /**
   * Initialize browser
   */
  private async initBrowser(): Promise<Browser> {
    if (!this.browser) {
      this.browser = await chromium.launch({
        headless: this.headless,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });
    }
    return this.browser;
  }

  /**
   * Create new page with common settings
   */
  private async createPage(): Promise<Page> {
    const browser = await this.initBrowser();
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
    });
    return await context.newPage();
  }

  /**
   * Get list of available consoles/platforms
   */
  async getConsoles(): Promise<RomsFunConsole[]> {
    const page = await this.createPage();
    
    try {
      console.log('Loading homepage...');
      await page.goto(this.baseUrl, { waitUntil: 'networkidle', timeout: 30000 });
      
      // Wait for page to load
      await page.waitForTimeout(2000);

      // Extract console links
      const consoles = await page.evaluate(() => {
        const results: Array<{ name: string; slug: string; url: string }> = [];
        
        // Try various selectors for console links
        const selectors = [
          '.console-list a',
          '.platform-list a',
          'nav a[href*="/roms/"]',
          'a[href*="/roms/"]',
        ];

        const seenUrls = new Set<string>();

        for (const selector of selectors) {
          const elements = document.querySelectorAll(selector);
          elements.forEach((el) => {
            const anchor = el as HTMLAnchorElement;
            const href = anchor.getAttribute('href');
            const text = anchor.textContent?.trim();

            if (href && text && !seenUrls.has(href) && href.includes('/roms/')) {
              seenUrls.add(href);
              const slug = href.split('/').filter(Boolean).pop() || '';
              results.push({
                name: text,
                slug,
                url: href.startsWith('http') ? href : `https://romsfun.com${href}`,
              });
            }
          });
        }

        return results;
      });

      console.log(`Found ${consoles.length} consoles`);
      return consoles;
    } catch (error) {
      throw new Error(`Failed to fetch consoles: ${error}`);
    } finally {
      await page.close();
    }
  }

  /**
   * Search for games by query
   */
  async searchGames(query: string, page: number = 1): Promise<RomsFunSearchResult> {
    const browserPage = await this.createPage();
    
    try {
      const searchUrl = `${this.baseUrl}/search?q=${encodeURIComponent(query)}&page=${page}`;
      console.log(`Searching for: ${query}`);
      
      await browserPage.goto(searchUrl, { waitUntil: 'networkidle', timeout: 30000 });
      await browserPage.waitForTimeout(2000);

      const games = await browserPage.evaluate(() => {
        const results: Array<{
          title: string;
          url: string;
          console: string;
          image?: string;
          size?: string;
        }> = [];

        // Try various selectors
        const selectors = [
          '.game-item',
          '.rom-item',
          '.search-result-item',
          '.game-card',
          'article',
        ];

        for (const selector of selectors) {
          const elements = document.querySelectorAll(selector);
          
          elements.forEach((el) => {
            const titleEl = el.querySelector('.game-title, .rom-title, h3, h4, .title');
            const linkEl = el.querySelector('a');
            const imgEl = el.querySelector('img');
            const consoleEl = el.querySelector('.console, .platform, .system');
            const sizeEl = el.querySelector('.size, .file-size');

            const title = titleEl?.textContent?.trim() || linkEl?.textContent?.trim();
            const url = linkEl?.getAttribute('href');

            if (title && url) {
              results.push({
                title,
                url: url.startsWith('http') ? url : `https://romsfun.com${url}`,
                console: consoleEl?.textContent?.trim() || 'Unknown',
                image: imgEl?.getAttribute('src') || imgEl?.getAttribute('data-src') || undefined,
                size: sizeEl?.textContent?.trim() || undefined,
              });
            }
          });

          if (results.length > 0) break;
        }

        return results;
      });

      return {
        games,
        totalResults: games.length,
        currentPage: page,
      };
    } catch (error) {
      throw new Error(`Failed to search games: ${error}`);
    } finally {
      await browserPage.close();
    }
  }

  /**
   * Get games for a specific console
   */
  async getGamesByConsole(consoleSlug: string, page: number = 1): Promise<RomsFunSearchResult> {
    const browserPage = await this.createPage();
    
    try {
      const url = `${this.baseUrl}/roms/${consoleSlug}?page=${page}`;
      console.log(`Fetching games for ${consoleSlug}...`);
      
      await browserPage.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
      await browserPage.waitForTimeout(2000);

      const games = await browserPage.evaluate((slug) => {
        const results: Array<{
          title: string;
          url: string;
          console: string;
          image?: string;
          size?: string;
          rating?: string;
        }> = [];

        const selectors = [
          '.game-item',
          '.rom-item',
          '.list-item',
          '.game-card',
          'article',
        ];

        for (const selector of selectors) {
          const elements = document.querySelectorAll(selector);
          
          elements.forEach((el) => {
            const titleEl = el.querySelector('.game-title, .rom-title, h3, h4, .title, a');
            const linkEl = el.querySelector('a');
            const imgEl = el.querySelector('img');
            const sizeEl = el.querySelector('.size, .file-size');
            const ratingEl = el.querySelector('.rating, .score');

            const title = titleEl?.textContent?.trim();
            const url = linkEl?.getAttribute('href');

            if (title && url) {
              results.push({
                title,
                url: url.startsWith('http') ? url : `https://romsfun.com${url}`,
                console: slug,
                image: imgEl?.getAttribute('src') || imgEl?.getAttribute('data-src') || undefined,
                size: sizeEl?.textContent?.trim() || undefined,
                rating: ratingEl?.textContent?.trim() || undefined,
              });
            }
          });

          if (results.length > 0) break;
        }

        return results;
      }, consoleSlug);

      console.log(`  Found ${games.length} games`);
      return {
        games,
        totalResults: games.length,
        currentPage: page,
      };
    } catch (error) {
      throw new Error(`Failed to fetch games for console ${consoleSlug}: ${error}`);
    } finally {
      await browserPage.close();
    }
  }

  /**
   * Get detailed information about a specific game
   */
  async getGameDetails(gameUrl: string): Promise<RomsFunGame> {
    const browserPage = await this.createPage();
    
    try {
      const url = gameUrl.startsWith('http') ? gameUrl : `${this.baseUrl}${gameUrl}`;
      console.log(`Fetching game details from ${url}...`);
      
      await browserPage.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
      await browserPage.waitForTimeout(2000);

      const gameDetails = await browserPage.evaluate((pageUrl) => {
        const title = document.querySelector('.game-title, .rom-title, h1, .title')?.textContent?.trim() || 'Unknown';
        const image = document.querySelector('.game-image img, .rom-image img, .main-image img, img')?.getAttribute('src');
        const description = document.querySelector('.description, .game-description, .rom-description, .content')?.textContent?.trim();
        const size = document.querySelector('.file-size, .size')?.textContent?.trim();
        const console = document.querySelector('.console, .platform, .system')?.textContent?.trim();
        const rating = document.querySelector('.rating, .score')?.textContent?.trim();
        const releaseDate = document.querySelector('.release-date, .year, .released')?.textContent?.trim();
        const publisher = document.querySelector('.publisher, .developer')?.textContent?.trim();
        const genre = document.querySelector('.genre, .category, .type')?.textContent?.trim();
        
        const downloadBtn = document.querySelector('.download-button, .btn-download, a[href*="download"]') as HTMLAnchorElement;
        const downloadLink = downloadBtn?.getAttribute('href');

        return {
          title,
          url: pageUrl,
          console: console || 'Unknown',
          image: image || undefined,
          description: description || undefined,
          size: size || undefined,
          rating: rating || undefined,
          releaseDate: releaseDate || undefined,
          publisher: publisher || undefined,
          genre: genre || undefined,
          downloadLink: downloadLink || undefined,
        };
      }, url);

      return gameDetails;
    } catch (error) {
      throw new Error(`Failed to fetch game details: ${error}`);
    } finally {
      await browserPage.close();
    }
  }

  /**
   * Get popular/featured games
   */
  async getPopularGames(limit: number = 20): Promise<RomsFunGame[]> {
    const browserPage = await this.createPage();
    
    try {
      console.log('Fetching popular games...');
      await browserPage.goto(this.baseUrl, { waitUntil: 'networkidle', timeout: 30000 });
      await browserPage.waitForTimeout(2000);

      const games = await browserPage.evaluate((maxLimit) => {
        const results: Array<{
          title: string;
          url: string;
          console: string;
          image?: string;
        }> = [];

        const selectors = [
          '.popular-games .game-item',
          '.featured-games .game-item',
          '.top-games .game-item',
          '.game-item',
        ];

        for (const selector of selectors) {
          const elements = document.querySelectorAll(selector);
          let count = 0;
          
          elements.forEach((el) => {
            if (count >= maxLimit) return;

            const titleEl = el.querySelector('.game-title, .rom-title, h3, h4, .title, a');
            const linkEl = el.querySelector('a');
            const imgEl = el.querySelector('img');
            const consoleEl = el.querySelector('.console, .platform, .system');

            const title = titleEl?.textContent?.trim();
            const url = linkEl?.getAttribute('href');

            if (title && url) {
              results.push({
                title,
                url: url.startsWith('http') ? url : `https://romsfun.com${url}`,
                console: consoleEl?.textContent?.trim() || 'Unknown',
                image: imgEl?.getAttribute('src') || imgEl?.getAttribute('data-src') || undefined,
              });
              count++;
            }
          });

          if (results.length > 0) break;
        }

        return results.slice(0, maxLimit);
      }, limit);

      console.log(`  Found ${games.length} popular games`);
      return games;
    } catch (error) {
      throw new Error(`Failed to fetch popular games: ${error}`);
    } finally {
      await browserPage.close();
    }
  }

  /**
   * Helper: Sleep function
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Batch fetch games from multiple consoles
   */
  async getAllGamesByConsoles(
    consoleSlugs: string[],
    maxGamesPerConsole?: number,
    delayMs: number = 1000
  ): Promise<Map<string, RomsFunGame[]>> {
    const allGames = new Map<string, RomsFunGame[]>();

    console.log(`\nFetching games from ${consoleSlugs.length} consoles...\n`);

    for (const consoleSlug of consoleSlugs) {
      try {
        const result = await this.getGamesByConsole(consoleSlug);
        const games = maxGamesPerConsole 
          ? result.games.slice(0, maxGamesPerConsole)
          : result.games;
        
        allGames.set(consoleSlug, games);
        console.log(`  ✓ ${consoleSlug}: ${games.length} games`);

        // Rate limiting
        await this.sleep(delayMs);
      } catch (error) {
        console.error(`  ✗ Error fetching ${consoleSlug}: ${error}`);
      }
    }

    return allGames;
  }

  /**
   * Close browser
   */
  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      console.log('Browser closed');
    }
  }
}
