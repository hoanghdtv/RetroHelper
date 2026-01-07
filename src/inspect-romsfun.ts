import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

async function inspectRomsFun() {
  console.log('=== Inspecting RomsFun.com Structure ===\n');

  const browser = await chromium.launch({ 
    headless: false,  // Show browser to see what's happening
    slowMo: 1000      // Slow down to observe
  });
  
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  });
  
  const page = await context.newPage();

  try {
    // Visit homepage
    console.log('1. Loading homepage...');
    await page.goto('https://romsfun.com', { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    // Save screenshot
    const outputDir = path.join(__dirname, '..', 'output');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    await page.screenshot({ path: path.join(outputDir, 'romsfun-homepage.png'), fullPage: true });
    console.log('   Screenshot saved: output/romsfun-homepage.png');

    // Get page structure
    const structure = await page.evaluate(() => {
      const result: any = {
        title: document.title,
        url: window.location.href,
        links: [] as any[],
        mainElements: [] as any[],
      };

      // Get all links
      const links = document.querySelectorAll('a[href]');
      const seenHrefs = new Set();
      links.forEach(link => {
        const href = link.getAttribute('href');
        const text = link.textContent?.trim();
        if (href && text && !seenHrefs.has(href)) {
          seenHrefs.add(href);
          result.links.push({ href, text: text.substring(0, 50) });
        }
      });

      // Get main sections
      const sections = document.querySelectorAll('section, .section, .container, main, article');
      sections.forEach((section, i) => {
        const classes = section.className;
        const id = section.id;
        const children = section.children.length;
        result.mainElements.push({ tag: section.tagName, classes, id, children });
      });

      return result;
    });

    console.log('\n2. Page Analysis:');
    console.log(`   Title: ${structure.title}`);
    console.log(`   URL: ${structure.url}`);
    console.log(`   Total links: ${structure.links.length}`);
    console.log(`   Main elements: ${structure.mainElements.length}`);

    // Save structure to JSON
    fs.writeFileSync(
      path.join(outputDir, 'romsfun-structure.json'),
      JSON.stringify(structure, null, 2)
    );
    console.log('   Structure saved: output/romsfun-structure.json');

    // Try to find ROM/game links
    console.log('\n3. Looking for ROM/Game links...');
    const romLinks = structure.links.filter((link: any) => 
      link.href.includes('rom') || 
      link.href.includes('game') || 
      link.href.includes('download') ||
      link.text.toLowerCase().includes('nes') ||
      link.text.toLowerCase().includes('snes') ||
      link.text.toLowerCase().includes('n64')
    );
    
    console.log(`   Found ${romLinks.length} potential ROM links:`);
    romLinks.slice(0, 10).forEach((link: any) => {
      console.log(`   - ${link.text}: ${link.href}`);
    });

    // Wait for user to see
    console.log('\n4. Browser will stay open for 10 seconds for inspection...');
    await page.waitForTimeout(10000);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await browser.close();
    console.log('\nBrowser closed');
  }
}

inspectRomsFun().catch(console.error);
