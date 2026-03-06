const axios = require('axios');
require('dotenv').config();

async function check() {
  const resp = await axios.get('https://retroachievements.org/API/API_GetGameList.php', {
    params: { z: process.env.RA_USERNAME, y: process.env.RA_API_KEY, i: 7, h: 1, f: 0 }
  });

  // Find Castlevania (first one, no sequel)
  const games = resp.data.filter(g =>
    g.Title && g.Title.toLowerCase().includes('castlevania') &&
    !g.Title.toLowerCase().includes(' ii') &&
    !g.Title.toLowerCase().includes(' iii')
  );
  games.forEach(g => console.log('ID:', g.ID, 'Title:', g.Title, 'Hashes:', g.Hashes));

  // Also check Contra
  const contra = resp.data.find(g => g.Title === 'Contra');
  if (contra) console.log('\nContra ID:', contra.ID, 'Hashes:', contra.Hashes);

  // Check Mega Man
  const mm = resp.data.find(g => g.Title === 'Mega Man');
  if (mm) console.log('\nMega Man ID:', mm.ID, 'Hashes:', mm.Hashes);
}
check().catch(console.error);
