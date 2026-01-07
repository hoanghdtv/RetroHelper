import { chromium } from 'playwright';

async function testDownloadLink() {
  const browser = await chromium.launch({ 
    headless: false,
    slowMo: 1000 
  });
  
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  });
  
  const page = await context.newPage();
  
  try {
    // Test download link - go directly to download page
    const downloadPageUrl = 'https://romsfun.com/download/pokemon-red-version-49375';
    console.log(`Opening download page: ${downloadPageUrl}\n`);
    
    await page.goto(downloadPageUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);
    
    // Take screenshot
    await page.screenshot({ path: 'output/download-page.png', fullPage: true });
    console.log('✓ Screenshot saved\n');
    
    // Save HTML
    const html = await page.content();
    const fs = require('fs');
    fs.writeFileSync('output/download-page.html', html);
    console.log('✓ HTML saved\n');
    
    // Look for download links
    console.log('Looking for download links...\n');
    
    const links = await page.evaluate(() => {
      const results: any[] = [];
      
      // Get all links
      const allLinks = document.querySelectorAll('a[href]');
      allLinks.forEach(link => {
        const href = link.getAttribute('href');
        const text = link.textContent?.trim();
        const classes = link.className;
        
        if (href) {
          results.push({
            href,
            text: text?.substring(0, 100),
            classes,
          });
        }
      });
      
      return results;
    });
    
    console.log('All links found:');
    links.forEach((link, i) => {
      console.log(`${i + 1}. ${link.href}`);
      console.log(`   Text: ${link.text}`);
      console.log(`   Classes: ${link.classes}\n`);
    });
    
    await page.waitForTimeout(5000);
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await browser.close();
  }
}

testDownloadLink().catch(console.error);
