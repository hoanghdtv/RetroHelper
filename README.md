# RetroHelper - ROM Database Fetcher & Downloader

A comprehensive TypeScript/Node.js project to fetch ROM databases from multiple sources, store them in SQLite, and download ROM files directly.

## 🎯 Main Features

### 1. RetroAchievements API Client (✅ Working)

- Fetches all consoles and their games from RetroAchievements API
- **Fetch detailed achievement information with MemAddr using API_GetGameExtended**
- Two modes: Basic (game list only) or Detailed (with achievements)
- Filter by specific console IDs
- Limit games per console for testing
- Saves data to timestamped JSON files
- Includes rate limiting to respect API guidelines

### 2. RomsFun Enhanced Client (✅ Fully Working)

- **Comprehensive ROM metadata scraper** with browser automation
- **Direct download link extraction** (2-click method with popup handling)
- **SQLite database storage** for efficient querying
- Fetches complete ROM information:
  - ✅ Title, description, console
  - ✅ Genre, publisher, release date, region
  - ✅ Screenshots (when available)
  - ✅ Size, download count, views
  - ✅ Related ROMs (6 per game)
  - ✅ Direct CDN download links
- Bypasses Cloudflare bot protection with Playwright
- 61 consoles, ~50,000+ ROMs available
- Rate limiting: 800ms between ROMs, 1-2s between pages

### 3. ROM Downloader (✅ New!)

- **Download ROM files directly** from CDN servers
- Search and download by game title
- Download by console (with limit or ALL)
- Progress tracking with real-time statistics
- Automatic retry and error handling
- Query ROMs from SQLite database

## 📦 Installation

### 1. Install Dependencies

```bash
npm install
```

### 2. Setup RetroAchievements API (Optional)

1. Create account at [RetroAchievements.org](https://retroachievements.org/)
2. Go to [Control Panel](https://retroachievements.org/controlpanel.php)
3. Get your API key from Settings → API Key

### 3. Configure Environment

Copy the example environment file:

```bash
cp .env.example .env
```

Edit `.env`:

```bash
# Your API credentials (optional - only needed for RetroAchievements)
RA_USERNAME=your_username
RA_API_KEY=your_api_key
```

## 🚀 Quick Start

### Option 1: Unified Client (Recommended - ⭐ NEW!)

```bash
# Fetch 5 pages of NES ROMs
npm run client -- fetch nes 5

# Fetch and automatically download
npm run client -- fetch nes 5 --download

# Download from database
npm run client -- download nes 10

# Search and download
npm run client -- search "Pokemon"

# List ROMs (preview)
npm run client -- list game-boy 50

# Show statistics
npm run client -- stats
```

### Option 2: Advanced Workflow

```bash
# Fetch ROMs and save to SQLite database
npm run fetch:enhanced

# Query the database
npm run query:db

# List available ROMs
npm run download -- list "game-boy"

# Download ROM files
npm run download -- search "Pokemon"
```

### Option 3: Fetch from RetroAchievements (Optional)

```bash
# Configure .env with your credentials first
npm start
```

## 📖 Usage Guide

### NEW: Unified Client (Simple & Powerful)

The new unified client combines all features in one easy-to-use interface:

#### Fetch ROMs

```bash
# Fetch ROMs from specific console
npm run client -- fetch <console> <pages> [--download]

# Examples:
npm run client -- fetch nes 5              # Fetch 5 pages of NES
npm run client -- fetch game-boy 10        # Fetch 10 pages of Game Boy
npm run client -- fetch playstation 3      # Fetch 3 pages of PlayStation

# Fetch and auto-download
npm run client -- fetch nes 5 --download
```

**What happens:**
- Fetches ROM metadata with direct download links
- Saves to SQLite database automatically
- Shows statistics (success rate, coverage)
- Optionally downloads files immediately

#### Download from Database

```bash
# Download specific amount
npm run client -- download <console> <limit>

# Examples:
npm run client -- download nes 10          # First 10 NES ROMs
npm run client -- download game-boy 5      # First 5 Game Boy ROMs

# Download ALL ROMs
npm run client -- download nes all         # All NES ROMs
npm run client -- download game-boy all    # All Game Boy ROMs
```

#### Search and Download

```bash
npm run client -- search "<query>"

# Examples:
npm run client -- search "Pokemon"
npm run client -- search "Zelda"
npm run client -- search "Super Mario"
```

#### List ROMs (Preview)

```bash
npm run client -- list <console> [limit]

# Examples:
npm run client -- list game-boy 50         # List 50 Game Boy ROMs
npm run client -- list nes 100             # List 100 NES ROMs
```

**Shows:**
- ROM title and download availability
- File size and genre
- Statistics (total, with/without links)

#### Database Statistics

```bash
npm run client -- stats
```

**Shows:**
- Total ROMs and consoles
- ROMs with direct links
- ROMs per console breakdown

---

### Advanced: Individual Tools

#### 1. Fetch ROM Metadata

```bash
# Fetch all ROMs (61 consoles)
npm run fetch:enhanced
```

**Configuration** (edit `src/romsfun-enhanced.ts`):
```typescript
const consoleLimit = 1;          // Number of consoles (set undefined for all)
const pagesPerConsole = 1;       // Pages per console (20 ROMs per page)
```

**Output:**
- `output/roms.db` - SQLite database with all ROMs
- `output/romsfun-enhanced-latest.json` - JSON backup

**What's fetched:**
- Title, URL, console, description
- Genre, publisher, release date, region
- Size, download count, views
- Screenshots (when available)
- Related ROMs (6 per game)
- Direct CDN download links

### 2. Query Database

```bash
npm run query:db
```

**Features:**
- View database statistics
- Search for ROMs
- List ROMs by console
- View full ROM details with related games

**Example output:**
```
Database Statistics:
  Total ROMs: 20
  Total Consoles: 1
  ROMs with Direct Links: 18
  ROMs with Descriptions: 20

Searching for "Pokemon"...
Found 4 ROMs:
  - Pokemon PureBlue
  - Pokemon PureGreen
  - Pokemon PureRed
  - Pokemon Red Version
```

### 3. Download ROMs

#### List Available ROMs

```bash
npm run download -- list "game-boy"
```

Shows all ROMs with:
- Download availability status
- File size
- Genre
- Total statistics

#### Search and Download

```bash
# Search by title
npm run download -- search "Pokemon"
npm run download -- search "Zelda"
npm run download -- search "Mario"
```

#### Download by Console

```bash
# Download first 5 ROMs
npm run download -- console "game-boy" 5

# Download first 10 ROMs
npm run download -- console "game-boy" 10

# Download ALL ROMs of console
npm run download -- console "game-boy" all
```

**Features:**
- Real-time progress tracking (%)
- Download size statistics
- Success/Skip/Failed summary
- 2-second delay between downloads
- Error handling with continuation

#### Download by URL

```bash
npm run download -- url "https://romsfun.com/roms/game-boy/pokemon-red-version.html"
```

**Downloaded files location:** `./downloads/`

### 4. RetroAchievements API (Optional)

Configure `.env` with your credentials, then:

```bash
npm start
```

## 📊 Data Structure

### ROM Database Schema (SQLite)

**roms table:**
- id, title, url, console
- description, mainImage, screenshots (JSON)
- genre (JSON), releaseDate, publisher, region (JSON)
- size, downloadCount, views
- downloadLink, directDownloadLink
- createdAt, updatedAt

**related_roms table:**
- id, romId (foreign key)
- title, url, image
- console, downloadCount, size

### Example ROM Record

```json
{
  "title": "Pokemon Red Version",
  "url": "https://romsfun.com/roms/game-boy/pokemon-red-version.html",
  "console": "game-boy",
  "description": "Pokemon Red Version is a RPG video game...",
  "mainImage": "https://romsfun.com/wp-content/uploads/...",
  "screenshots": [
    "https://romsfun.com/wp-content/uploads/screenshot1.png",
    "https://romsfun.com/wp-content/uploads/screenshot2.png"
  ],
  "genre": ["Role-Playing"],
  "region": ["USA", "Europe"],
  "size": "370 KB",
  "downloadCount": "2,500",
  "downloadLink": "https://romsfun.com/download/pokemon-red-version-49375",
  "directDownloadLink": "https://statics.romsfun.com/GameBoy/Pokemon%20-%20Red%20Version.zip?token=...",
  "relatedRoms": [
    {
      "title": "Pokemon Blue Version",
      "url": "https://romsfun.com/roms/game-boy/pokemon-blue-version.html",
      "image": "https://romsfun.com/wp-content/uploads/pokemon-blue.jpg",
      "console": "game-boy",
      "downloadCount": "2,100",
      "size": "370 KB"
    }
  ]
}
```

## 🛠️ Development

### Available Scripts

```bash
# ⭐ NEW: Unified Client (Recommended)
npm run client -- <command> [args]         # All-in-one ROM management

# Other tools
npm start                                  # RetroAchievements API fetcher
npm run fetch:enhanced                     # RomsFun enhanced fetcher (SQLite)
npm run query:db                           # Query ROM database
npm run download -- <command>              # ROM downloader (advanced)

# Testing
npm run test:click                         # Test download link mechanism
npm run test:download                      # Test download page analysis
npm run test:single-rom                    # Test single ROM fetch

# Build
npm run build                              # Compile TypeScript
npm run prod                               # Build and run production
```

### Project Structure

```
RetroHelper/
├── src/
│   ├── romsfun-client.ts          # ⭐ NEW: Unified client (recommended)
│   ├── index.ts                   # RetroAchievements client
│   ├── types.ts                   # TypeScript interfaces
│   ├── database.ts                # SQLite database layer
│   ├── romsfun-enhanced.ts        # RomsFun scraper with Playwright
│   ├── rom-downloader.ts          # ROM file downloader
│   ├── query-database.ts          # Database query tool
│   └── test-*.ts                  # Testing utilities
├── output/
│   ├── roms.db                    # SQLite database
│   └── *.json                     # JSON backups
├── downloads/                     # Downloaded ROM files
├── .env                          # Environment configuration
└── package.json
```

## 🎯 Features Summary

### ROM Metadata Fetcher
- ✅ 61 consoles supported
- ✅ ~50,000+ ROMs available
- ✅ Comprehensive metadata (title, description, genre, etc.)
- ✅ Screenshots and related games
- ✅ Direct CDN download links
- ✅ SQLite database storage
- ✅ JSON backup files
- ✅ Cloudflare bot protection bypass

### ROM Downloader
- ✅ Search by title
- ✅ Download by console (with limit)
- ✅ Download ALL ROMs of console
- ✅ Real-time progress tracking
- ✅ Success/Skip/Failed statistics
- ✅ List mode (preview before download)
- ✅ Error handling with continuation
- ✅ Automatic rate limiting

### Database
- ✅ SQLite3 for efficient storage
- ✅ Full-text search support
- ✅ Related ROMs relationships
- ✅ Query by console, title, URL
- ✅ Statistics and aggregations

## 📈 Performance

- **Fetch speed**: ~800ms per ROM (with direct links)
- **Database size**: ~5MB for 1,000 ROMs
- **Download speed**: Depends on CDN (typically 1-5 MB/s)
- **Coverage**: 90% ROMs have direct download links

## ⚠️ Important Notes

1. **Rate Limiting**: Built-in delays to respect server resources
2. **Download Links**: Valid for ~24 hours (token-based)
3. **Re-fetch**: Run `fetch:enhanced` periodically to update links
4. **Legal**: Only download ROMs you legally own
5. **Storage**: Full database (~1,000 ROMs) ≈ 50GB download size

## 🐛 Troubleshooting

### "No direct download link available"
- Some ROMs don't have CDN links
- Re-run `fetch:enhanced` to update database
- Check if ROM exists on RomsFun website

### Download fails with timeout
- CDN might be temporarily unavailable
- Try again later
- Check your internet connection

### Database is empty
- Run `npm run fetch:enhanced` first
- Check `output/roms.db` exists
- Verify Playwright browser installed

### Playwright installation issues
```bash
npx playwright install chromium
```

## 📝 License

MIT License - Feel free to use for personal projects

## 🤝 Contributing

Issues and pull requests are welcome!

## ⚡ Quick Reference

### Console Names
Common console slugs for download commands:
- `game-boy` - Game Boy (GB)
- `game-boy-advance` - Game Boy Advance (GBA)
- `game-boy-color` - Game Boy Color (GBC)
- `nintendo-entertainment-system` - NES
- `super-nintendo` - SNES
- `nintendo-64` - N64
- `playstation` - PS1
- `sega-genesis` - Genesis/Mega Drive

### Example Workflow

#### Quick Start (NEW Unified Client)

```bash
# 1. Fetch NES ROMs (5 pages = ~100 ROMs)
npm run client -- fetch nes 5

# 2. Check what was fetched
npm run client -- list nes 50

# 3. Download first 10 ROMs
npm run client -- download nes 10

# 4. Or download ALL NES ROMs
npm run client -- download nes all

# 5. Search for specific games
npm run client -- search "Pokemon"

# 6. Check statistics
npm run client -- stats
```

#### Advanced Workflow

```bash
# 1. Fetch ROMs metadata
npm run fetch:enhanced

# 2. Query database
npm run query:db

# 3. List available ROMs
npm run download -- list "game-boy"

# 4. Download some ROMs
npm run download -- search "Pokemon"
npm run download -- console "game-boy" 5

# 5. Check downloaded files
ls -lh downloads/
```

## 🔗 Links

- [RomsFun.com](https://romsfun.com/) - ROM source
- [RetroAchievements.org](https://retroachievements.org/) - Achievement database
- [RetroAchievements API Docs](https://api-docs.retroachievements.org/)

---

**Made with ❤️ for retro gaming enthusiasts**
