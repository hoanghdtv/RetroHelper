import { getTrendingRoms } from './trending-service';

(async () => {
  try {
    console.log('Running getTrendingRoms(20)...');
    const rows = await getTrendingRoms(20);
    console.log('Results:', JSON.stringify(rows, null, 2));
    process.exit(0);
  } catch (e) {
    console.error('Error running getTrendingRoms:', e);
    process.exit(1);
  }
})();
