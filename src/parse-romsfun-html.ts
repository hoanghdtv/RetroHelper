import * as fs from 'fs';
import * as path from 'path';
// Use require to avoid strict cheerio TS types in this small utility
const cheerio = require('cheerio');

type TrendingRom = {
  title: string;
  url: string;
  image?: string;
  snippet?: string;
};

function extractFromSection($: any, section: any): TrendingRom[] {
  const results: TrendingRom[] = [];
  const seen = new Set<string>();

  section.find('a[href*="/roms/"]').each((_: any, el: any) => {
    const a = $(el);
    let href = a.attr('href') || '';
    if (!href) return;
    // normalize
    try {
      href = new URL(href, 'https://romsfun.com').toString();
    } catch (e) {
      // ignore
    }

    if (seen.has(href)) return;
    seen.add(href);

    const title = (a.text() || '').trim() || (a.attr('title') || '').trim();
    let image = a.find('img').first().attr('src');
    if (!image) {
      const parentImg = a.parent().find('img').first().attr('src');
      if (parentImg) image = parentImg;
    }
    const snippet = (a.closest('article').find('p').first().text() || '').trim() || undefined;

    results.push({ title: title || path.basename(href), url: href, image, snippet });
  });

  return results;
}

function parseHtmlFile(filePath: string, limit = 20): TrendingRom[] {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const $ = cheerio.load(raw);

  const candidates: TrendingRom[] = [];
  const seenUrls = new Set<string>();

  // 1) Look for widgets/sections that have "trending" or "popular" in heading or class
  const keywordSelectors = [
    "[class*='trending']",
    "[class*='popular']",
    "#trending",
    "#popular",
    "#widget-popular",
    "[id*='trending']",
    "[id*='popular']",
    "[class*='widget-popular']",
  ];

  for (const sel of keywordSelectors) {
    $(sel).each((_: any, sec: any) => {
      const extracted = extractFromSection($, $(sec));
      for (const it of extracted) {
        if (!seenUrls.has(it.url)) {
          candidates.push(it);
          seenUrls.add(it.url);
          if (candidates.length >= limit) return candidates;
        }
      }
    });
    if (candidates.length >= limit) break;
  }

  // 2) Try headings containing text "trending" or "popular" and extract anchors under that section
  if (candidates.length < limit) {
  $('h1,h2,h3,h4,h5,h6').each((_: any, h: any) => {
      const txt = ($(h).text() || '').toLowerCase();
      if (txt.includes('trending') || txt.includes('popular') || txt.includes('normal download')) {
        // find a parent section or next sibling
        const parent = $(h).parent();
        const sect = parent.is('section') ? parent : parent.closest('section');
        const target = sect.length ? sect : parent;
        const extracted = extractFromSection($, target);
        for (const it of extracted) {
          if (!seenUrls.has(it.url)) {
            candidates.push(it);
            seenUrls.add(it.url);
            if (candidates.length >= limit) return candidates;
          }
        }
      }
    });
  }

  // 3) Fallback: collect first /roms/ anchors from the whole document
  if (candidates.length < limit) {
    $('a[href*="/roms/"]').each((_: any, el: any) => {
      if (candidates.length >= limit) return;
      const a = $(el);
      let href = a.attr('href') || '';
      try { href = new URL(href, 'https://romsfun.com').toString(); } catch(e){}
      if (seenUrls.has(href)) return;
      seenUrls.add(href);
      const title = (a.text() || '').trim() || (a.attr('title') || '').trim() || undefined;
      const image = a.find('img').first().attr('src') || undefined;
      const snippet = a.closest('article').find('p').first().text().trim() || undefined;
      candidates.push({ title: title || path.basename(href), url: href, image, snippet });
    });
  }

  return candidates.slice(0, limit);
}

// CLI
if (require.main === module) {
  const argv = process.argv.slice(2);
  if (argv.length < 1) {
    console.error('Usage: ts-node src/parse-romsfun-html.ts <path-to-romsfun.html> [limit]');
    process.exit(2);
  }
  const filePath = argv[0];
  const limit = argv[1] ? parseInt(argv[1], 10) : 20;
  if (!fs.existsSync(filePath)) {
    console.error('File not found:', filePath);
    process.exit(2);
  }

  const results = parseHtmlFile(filePath, limit);
  console.log(JSON.stringify(results, null, 2));
}
