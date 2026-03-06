# ra-csv-update

Tool để đọc, làm giàu và cập nhật file CSV chứa thông tin ROM, tích hợp với hệ thống **RetroAchievements (RA)**.

---

## Yêu cầu

Tạo file `.env` ở thư mục gốc (xem `.env.example`):

```env
RA_USERNAME=your_username
RA_API_KEY=your_api_key
```

---

## Cách dùng

```bash
npx ts-node src/retro-achievement/ra-csv-update.ts <csvPath> [options]
```

### Options

| Option | Mô tả |
|--------|-------|
| `--stats` | In thống kê tóm tắt (số ROM, % có link, genre...) |
| `--add-related` | Tính và thêm cột `relatedRoms` (4 ROM liên quan) |
| `--add-ra-ids` | Tra cứu `raGameId` từ RA qua MD5 của ROM file |
| `--update-screenshots` | Lấy screenshots từ RA bằng `raGameId`, lưu vào cột `screenshots` |
| `--downloads <dir>` | Thư mục chứa file ROM (mặc định: `downloads/<console>`) |
| `--force` | Ghi đè dữ liệu đã có (dùng với các option trên) |
| `--top <n>` | Số ROM liên quan mỗi entry (mặc định: `4`) |
| `--limit <n>` | Chỉ hiển thị N ROM đầu tiên |
| `--console <name>` | Lọc theo console (nes, snes, gba...) |
| `--help` | Hiển thị hướng dẫn |

---

## Các lệnh thường dùng

### Xem thống kê CSV

```bash
npx ts-node src/retro-achievement/ra-csv-update.ts output/topnes-split/roms.csv --stats
```

```
📊 ─── Statistics ────────────────────────────────────
   Total ROMs          : 200
   With direct link    : 200 (100%)
   With download link  : 200
   Consoles            : nes
   Genres              : Other, Platformer, Action, Puzzle ...
   ROM types           : Fan Translation, Hack
─────────────────────────────────────────────────────
```

---

### Thêm cột `relatedRoms`

Tính 4 ROM liên quan cho mỗi ROM dựa trên: tên series, genre, publisher, region.

```bash
# Lần đầu
npx ts-node src/retro-achievement/ra-csv-update.ts output/topnes-split/roms.csv --add-related

# Re-compute kể cả đã có rồi
npx ts-node src/retro-achievement/ra-csv-update.ts output/topnes-split/roms.csv --add-related --force

# Tùy chỉnh số lượng related ROMs
npx ts-node src/retro-achievement/ra-csv-update.ts output/topnes-split/roms.csv --add-related --top 6
```

**Kết quả trong CSV:**
```
relatedRoms: "10060,10092,10085,10187"
```

**Thuật toán tính điểm tương đồng:**

| Tiêu chí | Điểm |
|----------|------|
| Cùng tên series (Adventure Island 1, 2, 3) | +40 |
| Shared title tokens | +5/token |
| Shared genre | +8/genre |
| Same publisher | +10 |
| Shared region | +3/region |

---

### Thêm cột `raGameId`

Tìm ID game trên RetroAchievements bằng cách:
1. Tìm file ROM trong thư mục downloads
2. Tính MD5 của ROM (NES: bỏ 16-byte iNES header trước khi hash)
3. So sánh với hash list từ RA API

```bash
# Tự động detect thư mục downloads/<console>
npx ts-node src/retro-achievement/ra-csv-update.ts output/topnes-split/roms.csv --add-ra-ids

# Chỉ định thư mục cụ thể
npx ts-node src/retro-achievement/ra-csv-update.ts output/topnes-split/roms.csv \
  --add-ra-ids --downloads downloads/nes

# Re-compute tất cả
npx ts-node src/retro-achievement/ra-csv-update.ts output/topnes-split/roms.csv \
  --add-ra-ids --downloads downloads/nes --force
```

**Kết quả trong CSV:**
```
raGameId: 1447
```

> **Lưu ý:** ROM là Fan Translation hoặc Hack sẽ không match vì RA chỉ support ROM gốc.

---

### Cập nhật `screenshots` từ RA

Lấy ảnh title screen + in-game screenshot từ RA cho các ROM đã có `raGameId`.
Nếu `mainImage` đang trống, tự động điền bằng box art từ RA.

```bash
# Chỉ update ROM chưa có screenshots
npx ts-node src/retro-achievement/ra-csv-update.ts output/topnes-split/roms.csv --update-screenshots

# Re-fetch tất cả
npx ts-node src/retro-achievement/ra-csv-update.ts output/topnes-split/roms.csv \
  --update-screenshots --force
```

**Kết quả trong CSV:**
```
screenshots: "https://media.retroachievements.org/Images/035322.png|https://media.retroachievements.org/Images/035323.png"
```

| Nguồn ảnh RA | Dùng cho |
|--------------|---------|
| `ImageTitle` | Title screen → `screenshots[0]` |
| `ImageIngame` | In-game shot → `screenshots[1]` |
| `ImageBoxArt` | Điền `mainImage` nếu trống |

---

## Cấu trúc CSV

Sau khi chạy đầy đủ, CSV sẽ có các cột:

| Cột | Mô tả |
|-----|-------|
| `id` | ID nội bộ |
| `title` | Tên game |
| `url` | URL trang game trên romsfun |
| `console` | Tên console (nes, snes, gba...) |
| `description` | Mô tả game |
| `mainImage` | Ảnh chính (box art) |
| `screenshots` | Pipe-separated URLs ảnh từ RA |
| `genre` | Pipe-separated genres |
| `releaseDate` | Ngày phát hành |
| `publisher` | Nhà xuất bản |
| `region` | Pipe-separated regions |
| `size` | Kích thước file |
| `downloadCount` | Số lượt tải |
| `numberOfReviews` | Số đánh giá |
| `averageRating` | Điểm đánh giá trung bình |
| `downloadLink` | Link trang download |
| `directDownloadLink` | Link CDN trực tiếp |
| `romType` | Loại ROM (Hack, Fan Translation...) |
| `relatedRoms` | Comma-separated IDs của 4 ROM liên quan |
| `raGameId` | Game ID trên RetroAchievements |

---

## Workflow đề xuất

```bash
CSV_PATH="output/topnes-split/roms.csv"
DL_DIR="downloads/nes"

# 1. Xem tổng quan
npx ts-node src/retro-achievement/ra-csv-update.ts $CSV_PATH --stats

# 2. Tính related ROMs
npx ts-node src/retro-achievement/ra-csv-update.ts $CSV_PATH --add-related

# 3. Match với RA (cần file ROM đã download)
npx ts-node src/retro-achievement/ra-csv-update.ts $CSV_PATH --add-ra-ids --downloads $DL_DIR

# 4. Lấy screenshots từ RA
npx ts-node src/retro-achievement/ra-csv-update.ts $CSV_PATH --update-screenshots
```

---

## Console IDs hỗ trợ

| CSV console | RA Console ID |
|-------------|--------------|
| `nes` | 7 |
| `snes` | 3 |
| `gb` | 4 |
| `gbc` | 6 |
| `gba` | 5 |
| `n64` | 2 |
| `nds` | 18 |
| `psx` | 12 |
| `psp` | 41 |
| `genesis` / `md` | 1 |
| `sms` | 11 |
| `gg` | 15 |
| `pce` | 8 |
| `saturn` | 39 |
| `dc` | 40 |
