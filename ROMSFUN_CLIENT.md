# RomsFun Client

⚠️ **NOTE**: Website RomsFun.com có bot protection, nên web scraping thông thường sẽ bị chặn (403/404 errors). 

## Status

- ✅ Client code đã được implement
- ⚠️ Website có bot protection (Cloudflare/similar)
- 💡 Cần sử dụng browser automation hoặc proxy để bypass

## Alternatives

### Recommended: RetroAchievements API (Already Working!)

Project này đã có RetroAchievements API client hoạt động tốt:

```bash
# Fetch games with full achievement data including MemAddr
npm start
```

Features:
- ✅ Official API - no blocking
- ✅ Full game metadata
- ✅ Complete achievement details with MemAddr
- ✅ ROM hashes for verification
- ✅ Free to use with account

## RomsFun Client (For Reference)

- ✅ Lấy danh sách consoles/platforms
- ✅ Tìm kiếm games theo tên
- ✅ Lấy games theo console
- ✅ Lấy thông tin chi tiết game
- ✅ Lấy popular/featured games
- ✅ Batch fetch từ nhiều consoles
- ✅ Rate limiting tự động

## Installation

Đã được cài đặt sẵn trong project:

```bash
npm install
```

## Usage

### Basic Example

```typescript
import { RomsFunClient } from './romsfun-client';

const client = new RomsFunClient();

// Search for games
const results = await client.searchGames('Super Mario');
console.log(results.games);

// Get games by console
const nesGames = await client.getGamesByConsole('nes');
console.log(nesGames.games);

// Get game details
const gameDetails = await client.getGameDetails('/rom/super-mario-bros');
console.log(gameDetails);
```

### Get Available Consoles

```typescript
const consoles = await client.getConsoles();
consoles.forEach(console => {
  console.log(`${console.name}: ${console.url}`);
});
```

### Search Games

```typescript
const searchResults = await client.searchGames('Zelda', 1); // page 1
console.log(`Found ${searchResults.totalResults} games`);

searchResults.games.forEach(game => {
  console.log(`${game.title} - ${game.console}`);
  console.log(`  URL: ${game.url}`);
  console.log(`  Size: ${game.size}`);
});
```

### Get Games by Console

```typescript
// Get first page of NES games
const nesGames = await client.getGamesByConsole('nes', 1);

nesGames.games.forEach(game => {
  console.log(game.title);
});
```

### Get Game Details

```typescript
const game = await client.getGameDetails('/rom/super-mario-bros-nes');

console.log(`Title: ${game.title}`);
console.log(`Console: ${game.console}`);
console.log(`Description: ${game.description}`);
console.log(`Size: ${game.size}`);
console.log(`Rating: ${game.rating}`);
console.log(`Download: ${game.downloadLink}`);
```

### Get Popular Games

```typescript
const popularGames = await client.getPopularGames(20); // top 20

popularGames.forEach(game => {
  console.log(`${game.title} [${game.console}]`);
});
```

### Batch Fetch from Multiple Consoles

```typescript
const consoleSlugs = ['nes', 'snes', 'gba', 'nds'];
const allGames = await client.getAllGamesByConsoles(
  consoleSlugs,
  10,    // max games per console
  1000   // delay between requests (ms)
);

for (const [console, games] of allGames.entries()) {
  console.log(`${console}: ${games.length} games`);
}
```

## API Methods

### `getConsoles(): Promise<RomsFunConsole[]>`
Lấy danh sách tất cả consoles/platforms có sẵn.

### `searchGames(query: string, page?: number): Promise<RomsFunSearchResult>`
Tìm kiếm games theo query string.

### `getGamesByConsole(consoleSlug: string, page?: number): Promise<RomsFunSearchResult>`
Lấy danh sách games của một console cụ thể.

### `getGameDetails(gameUrl: string): Promise<RomsFunGame>`
Lấy thông tin chi tiết của một game.

### `getPopularGames(limit?: number): Promise<RomsFunGame[]>`
Lấy danh sách popular/featured games.

### `getAllGamesByConsoles(consoleSlugs: string[], maxGamesPerConsole?: number, delayMs?: number): Promise<Map<string, RomsFunGame[]>>`
Batch fetch games từ nhiều consoles với rate limiting.

## Data Types

### RomsFunGame

```typescript
interface RomsFunGame {
  title: string;
  url: string;
  console: string;
  image?: string;
  size?: string;
  description?: string;
  downloadLink?: string;
  rating?: string;
  releaseDate?: string;
  publisher?: string;
  genre?: string;
}
```

### RomsFunConsole

```typescript
interface RomsFunConsole {
  name: string;
  slug: string;
  url: string;
  gameCount?: number;
}
```

## Testing

Chạy test script:

```bash
npm run test:romsfun
```

Test script sẽ:
1. Lấy danh sách consoles
2. Search games
3. Lấy games theo console
4. Lấy game details
5. Lấy popular games
6. Batch fetch từ nhiều consoles
7. Lưu kết quả vào `output/romsfun-games.json`

## Common Console Slugs

- `nes` - Nintendo Entertainment System
- `snes` - Super Nintendo
- `gba` - Game Boy Advance
- `gbc` - Game Boy Color
- `gb` - Game Boy
- `nds` - Nintendo DS
- `n64` - Nintendo 64
- `genesis` - Sega Genesis
- `ps1` - PlayStation 1
- `ps2` - PlayStation 2
- `psp` - PlayStation Portable

## Configuration

```typescript
const client = new RomsFunClient({
  baseUrl: 'https://romsfun.com',  // Custom base URL
  timeout: 30000,                   // Request timeout in ms
  userAgent: 'Custom User Agent'    // Custom user agent
});
```

## Rate Limiting

Client tự động thêm delay giữa các requests khi sử dụng batch fetch methods. Mặc định là 1 giây giữa mỗi request.

## Notes

- Web scraping nên được sử dụng có trách nhiệm
- Tôn trọng robots.txt và terms of service của website
- Sử dụng rate limiting để tránh overload server
- Data structure có thể thay đổi nếu website cập nhật HTML

## Error Handling

```typescript
try {
  const games = await client.searchGames('Mario');
  console.log(games);
} catch (error) {
  console.error('Failed to fetch games:', error);
}
```

## Output Example

```json
{
  "nes": [
    {
      "title": "Super Mario Bros.",
      "url": "https://romsfun.com/rom/super-mario-bros-nes",
      "console": "nes",
      "image": "https://romsfun.com/images/super-mario-bros.jpg",
      "size": "40 KB",
      "rating": "4.8"
    }
  ],
  "snes": [
    {
      "title": "Super Mario World",
      "url": "https://romsfun.com/rom/super-mario-world-snes",
      "console": "snes",
      "image": "https://romsfun.com/images/super-mario-world.jpg",
      "size": "512 KB"
    }
  ]
}
```
