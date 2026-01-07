# Achievement Data Structure Example

## Complete Achievement Object with MemAddr

Khi sử dụng `FETCH_ACHIEVEMENTS=true`, API sẽ trả về thông tin chi tiết của mỗi achievement bao gồm `MemAddr`:

```json
{
  "NES/Famicom": [
    {
      "ID": 5799,
      "Title": "~Hack~ Angry Birds",
      "ConsoleID": 7,
      "ConsoleName": "NES/Famicom",
      "ImageIcon": "/Images/069591.png",
      "Publisher": "Hack - Moai Kun, Hack - Uncategorized Hacks",
      "Developer": "Googie",
      "Genre": "",
      "NumAchievements": 15,
      "Achievements": {
        "404736": {
          "ID": 404736,
          "NumAwarded": 124,
          "NumAwardedHardcore": 88,
          "Title": "Stage 2 - Complete!",
          "Description": "Complete Stage 2 for the first time.",
          "Points": 2,
          "TrueRatio": 2,
          "Author": "jerbq",
          "AuthorULID": "01EQXKEJQX47GGJJHKRVMG6CEK",
          "DateModified": "2024-05-01 18:10:49",
          "DateCreated": "2024-03-04 17:43:31",
          "BadgeName": "457936",
          "DisplayOrder": 1,
          "MemAddr": "c0d8aceb618b0abff4a9f538823e16e7",
          "type": "progression"
        },
        "404737": {
          "ID": 404737,
          "Title": "Stage 10 - Complete!",
          "Description": "Complete Stage 10 for the first time.",
          "Points": 2,
          "TrueRatio": 4,
          "Author": "jerbq",
          "DateModified": "2024-05-01 18:10:49",
          "DateCreated": "2024-03-04 17:44:18",
          "BadgeName": "458068",
          "DisplayOrder": 9,
          "MemAddr": "019818e68bb5100ead2fd207e928c698",
          "type": "progression"
        }
      }
    }
  ]
}
```

## Key Fields Explained

### Achievement Fields:

- **ID**: Unique achievement identifier
- **Title**: Achievement name
- **Description**: What the player needs to do
- **Points**: Base points awarded
- **TrueRatio**: Adjusted difficulty-based points
- **MemAddr**: **Memory address hash/condition** - This defines the trigger condition for the achievement
- **BadgeName**: Image badge identifier
- **DisplayOrder**: Order to display achievements
- **Author**: Who created the achievement
- **DateCreated**: When the achievement was first created
- **DateModified**: Last modification date
- **type**: Achievement category (progression, win_condition, etc.)
- **NumAwarded**: Total times awarded (casual + hardcore)
- **NumAwardedHardcore**: Times awarded in hardcore mode

### What is MemAddr?

`MemAddr` là một chuỗi hash đại diện cho **điều kiện bộ nhớ (memory condition)** để unlock achievement. Đây là logic định nghĩa khi nào achievement sẽ được kích hoạt trong game, ví dụ:

- Giá trị của một ô nhớ cụ thể (như HP, score, level completed)
- Tổ hợp nhiều điều kiện bộ nhớ
- Delta values (sự thay đổi giá trị qua thời gian)

## Using the Data

### Example: Extract all achievements with MemAddr

```javascript
const fs = require('fs');

// Read the JSON file
const data = JSON.parse(fs.readFileSync('output/retroachievements-with-achievements-latest.json'));

// Extract achievements from all games
for (const [consoleName, games] of Object.entries(data)) {
  console.log(`Console: ${consoleName}`);
  
  games.forEach(game => {
    if (game.Achievements && Object.keys(game.Achievements).length > 0) {
      console.log(`  Game: ${game.Title}`);
      
      for (const [achievementId, achievement] of Object.entries(game.Achievements)) {
        console.log(`    Achievement: ${achievement.Title}`);
        console.log(`      Points: ${achievement.Points}`);
        console.log(`      MemAddr: ${achievement.MemAddr}`);
        console.log(`      Description: ${achievement.Description}`);
      }
    }
  });
}
```

### Example: Filter achievements by type

```javascript
// Get all progression achievements
const progressionAchievements = [];

for (const [consoleName, games] of Object.entries(data)) {
  games.forEach(game => {
    if (game.Achievements) {
      for (const achievement of Object.values(game.Achievements)) {
        if (achievement.type === 'progression') {
          progressionAchievements.push({
            game: game.Title,
            console: consoleName,
            achievement: achievement.Title,
            memAddr: achievement.MemAddr,
            points: achievement.Points
          });
        }
      }
    }
  });
}

console.log(`Found ${progressionAchievements.length} progression achievements`);
```

## Configuration Tips

### Get achievements for specific popular games

```bash
# In .env
FETCH_ACHIEVEMENTS=true
CONSOLE_IDS=7,3,1  # NES, SNES, Genesis
MAX_GAMES=20       # First 20 games from each console
```

### Full database (WARNING: Very slow!)

```bash
# In .env
FETCH_ACHIEVEMENTS=true
CONSOLE_IDS=       # Empty = all consoles
MAX_GAMES=         # Empty = all games
```

**Note**: Fetching all achievements from all games can take many hours and generate files over 100MB!

## API Endpoint Used

The project uses `API_GetGameExtended.php` which returns:
- Complete game metadata
- Full achievement list with all fields including **MemAddr**
- Rich Presence patch information
- Player statistics

Reference: https://api-docs.retroachievements.org/v1/get-game-extended.html
