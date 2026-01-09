import { RomsFunEnhancedClient } from './romsfun-enhanced';

export type TrendingRom = {
  title: string;
  url: string;
  image?: string;
  snippet?: string;
};

/**
 * Scrape the romsfun homepage and return a list of trending / popular ROM links.
 * This uses the existing RomsFunEnhancedClient for browser/context handling.
 *
 * Strategy:
 * - Open the homepage and look for links that point to `/roms/`.
 * - Prefer links that appear early on the page (assumed more prominent).
 * - Deduplicate by URL and return up to `limit` items.
 */
export async function getTrendingRoms(limit = 20): Promise<TrendingRom[]> {
  const client = new RomsFunEnhancedClient();
  const page = await client.createPage();
  try {
  const baseUrl = (client as any).baseUrl || 'https://romsfun.com/browse-all-roms/?sort=downloads';
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    // let dynamic content load briefly
    await page.waitForTimeout(1500);

    const results = await page.evaluate(() => {
      const seen = new Set<string>();
      const items: any[] = [];

      // Helper to normalize and push anchors found in a container
      function collectFrom(container: Element | Document) {
        const anchors = Array.from(container.querySelectorAll('a[href*="/roms/"]')) as HTMLAnchorElement[];
        for (const a of anchors) {
          const href = a.href;
          if (!href) continue;
          if (href.includes('#') || href.match(/\/roms\/?$/)) continue;

          const title = (a.textContent || '').trim() || a.getAttribute('title') || '';
          let image: string | undefined;
          const img = a.querySelector('img') as HTMLImageElement | null;
          if (img && img.src) image = img.src;
          else {
            const sibImg = a.parentElement?.querySelector('img') as HTMLImageElement | null;
            if (sibImg && sibImg.src) image = sibImg.src;
          }

          let snippet: string | undefined;
          const para = a.closest('article')?.querySelector('p');
          if (para) snippet = para.textContent?.trim();

          const urlObj = new URL(href, window.location.origin);
          urlObj.hash = '';
          urlObj.search = '';
          const clean = urlObj.toString();

          if (!seen.has(clean)) {
            seen.add(clean);
            items.push({ title: title || (a.getAttribute('aria-label') || '').trim() || clean.split('/').pop(), url: clean, image, snippet });
          }
        }
      }

      // 1) Prefer the "Popular ROM" widget if present (heading contains "popular" + "rom")
      const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6')) as HTMLElement[];
      for (const h of headings) {
        const txt = (h.textContent || '').toLowerCase();
        if (txt.includes('popular') && txt.includes('rom')) {
          // find nearest section or container
          const sect = h.closest('section') || h.parentElement || document;
          collectFrom(sect as Element);
          if (items.length) return items;
        }
      }

      // 2) If not found, look for elements with common widget classes
      const widget = document.querySelector(".widget-popular, .popular, .trending, #widget-popular");
      if (widget) {
        collectFrom(widget as Element);
        if (items.length) return items;
      }

      // 3) Fallback: collect from whole document
      collectFrom(document);
      return items;
    });

    // Return first `limit` results
    return (results || []).slice(0, limit).map((r: any) => ({
      title: r.title || '',
      url: r.url,
      image: r.image,
      snippet: r.snippet,
    }));
  } finally {
    await page.close();
  }
}
