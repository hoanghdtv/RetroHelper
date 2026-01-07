import { chromium } from 'playwright';
import * as fs from 'fs';

async function testDownloadClick() {
  const browser = await chromium.launch({ 
    headless: false,
    slowMo: 500 
  });
  
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  });
  
  const page = await context.newPage();
  
  try {
    // Visit download page directly
    const downloadPageUrl = 'https://romsfun.com/download/pokemon-red-version-49375';
    console.log('\nOpening download page:', downloadPageUrl);
    
    await page.goto(downloadPageUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    // Find the download link
    const downloadLinkUrl = 'https://romsfun.com/download/pokemon-red-version-49375/1';
    console.log('\nLooking for link:', downloadLinkUrl);

    // Setup listener for popup ad (will be closed immediately)
    let downloadPage: any = null;
    let isFirstClick = true;
    
    context.on('page', async (newPage) => {
      const url = newPage.url();
      console.log('\n✓ New page detected:', url);
      
      // First click opens ad popup - close it
      if (isFirstClick && !url.includes('romsfun.com')) {
        console.log('  → Closing ad popup...');
        await newPage.close();
        console.log('  ✓ Ad popup closed');
      } 
      // Second click opens download page on romsfun.com - keep it!
      else if (url.includes('romsfun.com/download') && url.endsWith('/1')) {
        console.log('  → This is the download page! Keeping it open...');
        downloadPage = newPage;
      }
    });
    
    // Listen for download event
    page.on('download', (download) => {
      console.log('\n✓ Download started!');
      console.log('Download URL:', download.url());
      console.log('Suggested filename:', download.suggestedFilename());
    });

    // FIRST CLICK - Opens popup ad
    console.log('\n[1st Click] Clicking download link (will open popup ad)...');
    await page.click(`a[href="${downloadLinkUrl}"]`);
    console.log('✓ First click done');
    isFirstClick = false;

    // Wait for popup to be closed
    await page.waitForTimeout(2000);

    // SECOND CLICK - Opens download page
    console.log('\n[2nd Click] Clicking download link again (should open download page)...');
    await page.click(`a[href="${downloadLinkUrl}"]`);
    console.log('✓ Second click done');

    // Wait for download page to open
    await page.waitForTimeout(3000);

    // Check if download page opened
    if (downloadPage) {
      console.log('\n✓ Download page opened successfully!');
      console.log('Download page URL:', downloadPage.url());
      
      // Wait for page to load
      await downloadPage.waitForLoadState('domcontentloaded');
      await downloadPage.waitForTimeout(3000);
      
      // Screenshot download page
      await downloadPage.screenshot({ path: 'output/final-download-page.png', fullPage: true });
      console.log('✓ Screenshot of download page saved');

      // Save HTML
      const downloadHtml = await downloadPage.content();
      fs.writeFileSync('output/final-download-page.html', downloadHtml);
      console.log('✓ HTML of download page saved');

      // Look for the actual file download link
      const fileLinks = await downloadPage.evaluate(() => {
        const allLinks = Array.from(document.querySelectorAll('a'));
        return allLinks
          .filter(link => {
            const href = link.href.toLowerCase();
            const text = link.textContent?.toLowerCase() || '';
            return href.includes('.zip') || href.includes('.rar') || 
                   href.includes('.7z') || href.includes('.gb') || 
                   href.includes('.gba') || href.includes('cdn') || 
                   href.includes('storage') || href.includes('file') ||
                   text.includes('click here') || text.includes('download now');
          })
          .map(link => ({
            href: link.href,
            text: link.textContent?.trim() || '',
            classes: link.className
          }));
      });

      if (fileLinks.length > 0) {
        console.log('\n=== FILE DOWNLOAD LINKS FOUND: ===');
        fileLinks.forEach((link: any, index: number) => {
          console.log(`\n${index + 1}. ${link.href}`);
          console.log(`   Text: ${link.text}`);
          console.log(`   Classes: ${link.classes}`);
        });
      } else {
        console.log('\n✗ No file download links found');
      }

      // Keep download page open
      console.log('\nKeeping download page open for manual inspection...');
    } else {
      console.log('\n✗ Download page did not open');
    }

    // Check current page URL
    const currentUrl = page.url();
    console.log('\nCurrent page URL:', currentUrl);
    
    // Take screenshot after click
    await page.screenshot({ path: 'output/download-after-click.png', fullPage: true });
    console.log('✓ Screenshot saved');

    // Save HTML after click
    const afterHtml = await page.content();
    fs.writeFileSync('output/download-after-click.html', afterHtml);
    console.log('✓ HTML saved');

    // Look for any download links that might appear
    const finalLinks = await page.evaluate(() => {
      const allLinks = Array.from(document.querySelectorAll('a'));
      return allLinks
        .filter(link => {
          const href = link.href.toLowerCase();
          const text = link.textContent?.toLowerCase() || '';
          return href.includes('.zip') || href.includes('.rar') || 
                 href.includes('.7z') || href.includes('.gb') || 
                 href.includes('.gba') || href.includes('cdn') || 
                 href.includes('file') || href.includes('storage') ||
                 text.includes('download') || text.includes('get file');
        })
        .map(link => ({
          href: link.href,
          text: link.textContent?.trim() || '',
          classes: link.className
        }));
    });

    if (finalLinks.length > 0) {
      console.log('\n=== Download links found: ===');
      finalLinks.forEach((link, index) => {
        console.log(`\n${index + 1}. ${link.href}`);
        console.log(`   Text: ${link.text}`);
        console.log(`   Classes: ${link.classes}`);
      });
    } else {
      console.log('\n✗ No download links found');
    }

    // Keep browser open for manual inspection
    console.log('\nKeeping browser open for 20 seconds for manual inspection...');
    await page.waitForTimeout(20000);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await browser.close();
  }
}

testDownloadClick();
