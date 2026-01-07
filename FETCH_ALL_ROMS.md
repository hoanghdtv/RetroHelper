# RomsFun - Fetch All ROMs Guide

## 🎯 Quick Start

Fetch all ROMs from all consoles:

```bash
npm run fetch:all
```

## ⚙️ Configuration

Edit `src/romsfun-fetch-all.ts` to customize:

```typescript
const allRoms = await client.getAllRoms(
  5,      // maxPagesPerConsole - ROMs per console (20 per page)
  10      // consoleLimit - Number of consoles (undefined = ALL)
);
```

### Examples:

**Test Mode (Fast - 10 consoles, 5 pages each):**
```typescript
await client.getAllRoms(5, 10)
```

**Medium (20 consoles, 10 pages each):**
```typescript
await client.getAllRoms(10, 20)
```

**Full Database (ALL consoles, 20 pages each) - SLOW:**
```typescript
await client.getAllRoms(20, undefined)
```

**Complete Everything (ALL consoles, ALL pages) - VERY SLOW:**
```typescript
await client.getAllRoms(999, undefined)
```

## 📊 Output

The script creates two files:

1. **`romsfun-all-roms-{timestamp}.json`** - Timestamped version
2. **`romsfun-all-roms-latest.json`** - Latest version (overwritten)

### Output Structure:

```json
{
  "fetchedAt": "2026-01-07T03:26:09.498Z",
  "totalConsoles": 61,
  "totalRoms": 12500,
  "consoles": [
    {
      "console": "game-boy",
      "count": 100
    }
  ],
  "roms": {
    "game-boy": [
      {
        "title": "Pokemon Red",
        "url": "https://romsfun.com/roms/game-boy/pokemon-red.html",
        "console": "game-boy",
        "image": "https://..."
      }
    ]
  }
}
```

## 📈 Statistics

From the website, estimated ROM counts:

| Console | Estimated ROMs |
|---------|---------------|
| Nintendo DS | ~4,795 |
| NES | ~3,140 |
| GBA | ~2,688 |
| Game Boy Color | ~1,362 |
| Nintendo 3DS | ~1,692 |
| Game Boy | ~1,150 |
| GameCube | ~871 |
| Nintendo 64 | ~862 |
| SNES | ~2,500+ |
| PlayStation | ~3,000+ |
| PlayStation 2 | ~5,000+ |

**Total: 60+ consoles, 50,000+ ROMs**

## ⏱️ Performance

- **Pages per Console**: 20 ROMs per page
- **Delay between pages**: 1 second
- **Delay between consoles**: 2 seconds

**Estimated Time:**

- 5 pages, 10 consoles: ~5 minutes
- 10 pages, 20 consoles: ~20 minutes  
- 20 pages, ALL consoles (61): ~2 hours
- ALL pages, ALL consoles: **6-8 hours**

## 🎮 Available Consoles (61 total)

Nintendo:
- Game Boy, Game Boy Color, GBA
- NES, SNES
- Nintendo 64
- GameCube, Wii, Wii U
- Nintendo DS, Nintendo 3DS
- Switch

Sony:
- PlayStation 1, 2, 3, 4
- PSP, PS Vita

Sega:
- Genesis/Mega Drive
- Saturn, Dreamcast
- Game Gear, Master System

And many more...

## 💡 Tips

1. **Start Small**: Test with limited consoles first
   ```typescript
   await client.getAllRoms(2, 3)  // 3 consoles, 2 pages each
   ```

2. **Monitor Progress**: Watch console output for real-time progress

3. **Check Output**: Review JSON file structure before full run

4. **Rate Limiting**: Script includes delays to avoid overloading server

5. **Resume**: If interrupted, manually edit the code to skip already-fetched consoles

## 🔧 Advanced Usage

### Fetch Specific Consoles Only:

Edit the code to filter consoles:

```typescript
// In getAllRoms method, after getting consoles:
consoles = consoles.filter(c => 
  ['nes', 'snes', 'game-boy'].includes(c.slug)
);
```

### Increase ROMs per Console:

```typescript
await client.getAllRoms(50, undefined)  // 50 pages = 1000 ROMs per console
```

### Get EVERYTHING:

```typescript
await client.getAllRoms(999, undefined)  // All pages, all consoles
```

⚠️ **Warning**: This will take many hours!

## 📝 Example Output

```
=== Fetching ROMs from 61 consoles ===

[1/61] Game Boy
  Page 1: +20 ROMs (total: 20)
  Page 2: +20 ROMs (total: 40)
  ...
  ✓ Total: 100 ROMs

[2/61] Game Boy Color
  Page 1: +20 ROMs (total: 20)
  ...

=== SUMMARY ===
Total Consoles: 61
Total ROMs: 12,500

ROMs per Console:
  game-boy: 100 ROMs
  nes: 100 ROMs
  ...
```

## 🚀 Next Steps

After fetching data:

1. **Analyze**: Use the JSON for your application
2. **Filter**: Extract specific games or consoles
3. **Compare**: Cross-reference with RetroAchievements data
4. **Build**: Create ROM library manager

## ⚠️ Important Notes

- **Respect the website**: Don't abuse the scraper
- **Rate limiting**: Built-in delays between requests
- **Terms of Service**: Use responsibly
- **Legal**: Only download ROMs you legally own
- **File Size**: Full database JSON can be 50-100MB+

## 🔗 Related Commands

```bash
# Fetch all ROMs (default: 10 consoles, 5 pages)
npm run fetch:all

# Simple test (popular games only)
npm run test:romsfun:simple

# Inspect website structure
npm run inspect:romsfun
```

## 📚 See Also

- `PROJECT_SUMMARY.md` - Project overview
- `ROMSFUN_CLIENT.md` - Client documentation
- `README.md` - Main documentation
