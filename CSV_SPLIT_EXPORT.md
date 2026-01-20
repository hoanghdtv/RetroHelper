# Export CSV với 2 sheets (roms và related_roms)

## Tổng quan

Vì CSV không hỗ trợ multiple sheets, project đã được cập nhật để xuất **2 file CSV riêng biệt**:
- `roms.csv` - Chứa thông tin ROM chính
- `related_roms.csv` - Chứa thông tin ROM liên quan (linked by romId)

## Commands

### 📤 Export sang 2 file CSV

```bash
# Export toàn bộ database
npm run convert -- export-split <db-path> <output-dir>

# Export một console cụ thể
npm run convert -- export-split <db-path> <output-dir> <console>
```

### 📥 Import từ 2 file CSV

```bash
# Import từ directory chứa roms.csv và related_roms.csv
npm run convert -- import-split <input-dir> <db-path>

# Import mà không ghi đè
npm run convert -- import-split <input-dir> <db-path> --no-overwrite
```

## Ví dụ sử dụng

### Export SNES ROMs
```bash
npm run convert -- export-split ./output/roms_snes.db ./output/snes-split
```

**Output:**
```
✓ Exported 2286 ROMs to output/snes-split/roms.csv
✓ Exported 13710 Related ROMs to output/snes-split/related_roms.csv

Statistics:
  Total ROMs: 2286
  Total Related ROMs: 13710
  Consoles: 1 (super-nintendo)
  With related ROMs: 2285 (100.0%)
```

### Export NES ROMs only
```bash
npm run convert -- export-split ./output/roms_nes.db ./output/nes-split nes
```

**Output:**
```
✓ Exported 1854 ROMs to output/nes-split/roms.csv
✓ Exported 11112 Related ROMs to output/nes-split/related_roms.csv
```

### Import back to database
```bash
npm run convert -- import-split ./output/snes-split ./output/roms_new.db
```

## Cấu trúc file CSV

### 📄 roms.csv
Chứa tất cả thông tin ROM chính:
```csv
id,title,url,console,description,mainImage,screenshots,genre,releaseDate,publisher,region,size,downloadCount,numberOfReviews,averageRating,downloadLink,directDownloadLink,romType
2384,'96 Zenkoku Koukou Soccer Senshuken,https://romsfun.com/roms/super-nintendo/...,super-nintendo,"...",https://...,https://...|https://...,Sports,1996,Magical Company,Japan,256K,1234,5,4.5,https://...,https://...,Game
```

**Columns:**
- `id` - ROM ID (primary key)
- `title` - Tên game
- `url` - URL trên RomsFun
- `console` - Platform (nes, snes, game-boy, etc.)
- `description` - Mô tả game
- `mainImage` - URL ảnh chính
- `screenshots` - URLs ảnh, phân cách bởi `|`
- `genre` - Thể loại, phân cách bởi `|`
- `releaseDate` - Năm phát hành
- `publisher` - Nhà phát hành
- `region` - Khu vực, phân cách bởi `|`
- `size` - Kích thước file
- `downloadCount` - Số lượt download
- `numberOfReviews` - Số đánh giá
- `averageRating` - Điểm trung bình
- `downloadLink` - Link download page
- `directDownloadLink` - Link download trực tiếp
- `romType` - Loại ROM (Game, Hack, Homebrew, etc.)

### 📄 related_roms.csv
Chứa thông tin ROMs liên quan:
```csv
id,romId,title,url,image,console,downloadCount,size,romType
14281,2384,The Ninjawarriors Again,https://romsfun.com/roms/super-nintendo/...,https://...,super-nintendo,5678,512K,Game
14282,2384,Mario to Wario,https://romsfun.com/roms/super-nintendo/...,https://...,super-nintendo,9012,384K,Game
```

**Columns:**
- `id` - Related ROM ID (primary key)
- `romId` - ID của ROM cha (foreign key to roms.id)
- `title` - Tên game liên quan
- `url` - URL trên RomsFun
- `image` - URL ảnh thumbnail
- `console` - Platform
- `downloadCount` - Số lượt download
- `size` - Kích thước file
- `romType` - Loại ROM

## Mối quan hệ giữa 2 file

**Relationship:** One-to-Many
- 1 ROM trong `roms.csv` có thể có nhiều related ROMs trong `related_roms.csv`
- Liên kết qua: `related_roms.romId` → `roms.id`

**Ví dụ:**
```csv
# roms.csv
id,title,...
2384,'96 Zenkoku Koukou Soccer Senshuken,...
2385,ActRaiser,...

# related_roms.csv
id,romId,title,...
14281,2384,The Ninjawarriors Again,...    # Liên quan đến ROM 2384
14282,2384,Mario to Wario,...              # Liên quan đến ROM 2384
14283,2385,Super Mario World,...           # Liên quan đến ROM 2385
14284,2385,The Legend of Zelda,...         # Liên quan đến ROM 2385
```

## Import Notes

✅ **Import đầy đủ cả ROMs và Related ROMs:**

1. **ID Mapping**: Khi import, IDs cũ sẽ được map sang IDs mới
   - File `roms.csv` được import trước
   - Hệ thống tạo map: `old_id → new_id`
   - File `related_roms.csv` sử dụng map này để cập nhật `romId`

2. **Related ROMs**: ✅ Đã được implement đầy đủ
   - Related ROMs được import vào bảng `related_roms`
   - Liên kết đúng với ROM cha thông qua `romId` mapping
   - Nếu ROM cha không tồn tại, related ROM sẽ bị skip

## So sánh với export thường

| Feature | export (single CSV) | export-split (2 CSVs) |
|---------|-------------------|---------------------|
| File output | 1 file | 2 files |
| Related ROMs | Embedded JSON-like | Separate table |
| Easy to read | ✅ | ✅✅ |
| Easy to edit | ⚠️ | ✅ |
| Database normalization | ❌ | ✅ |
| Import accuracy | ✅ | ✅✅ |
| Excel friendly | ✅ | ✅✅ |
| SQL friendly | ❌ | ✅✅ |

## Tích hợp với Excel/LibreOffice

Bạn có thể mở cả 2 file trong Excel/LibreOffice:
1. Open `roms.csv` và `related_roms.csv` trong 2 sheets khác nhau
2. Sử dụng VLOOKUP/INDEX-MATCH để query giữa 2 sheets
3. Filter, sort, analyze dễ dàng

**Ví dụ Excel Formula:**
```excel
# Trong sheet related_roms, lấy ROM title từ romId
=VLOOKUP(B2, roms!A:B, 2, FALSE)
```

## Statistics

Ví dụ thống kê từ SNES database:
- **2,286 ROMs** chính
- **13,710 Related ROMs** (trung bình ~6 related ROMs/game)
- **100% ROMs** có ít nhất 1 related ROM
- Tỷ lệ có description: 97.1%

## Troubleshooting

### ❌ "ROMs CSV file not found"
- Đảm bảo file `roms.csv` tồn tại trong input directory
- Check đúng đường dẫn

### ❌ "Parent ROM not found" (khi import related ROMs)
- Related ROM tham chiếu đến romId không tồn tại
- Có thể do ROMs không được import hoặc bị skip
- Hiện tại sẽ skip related ROM đó

### ⚠️ CSV encoding issues
- Mặc định sử dụng UTF-8
- Nếu có vấn đề với Excel, save as "UTF-8 with BOM"

## Next Steps

Tính năng đã hoàn thiện:
- [x] Export sang 2 CSV files (roms + related_roms)
- [x] Import từ 2 CSV files với ID mapping
- [x] Import đầy đủ related ROMs vào database
- [x] Validation foreign key constraints

Có thể thêm trong tương lai:
- [ ] Export sang Excel (.xlsx) với multiple sheets thật sự
- [ ] Compress CSVs (.csv.gz) cho file lớn
- [ ] Batch import để tăng tốc độ với database lớn
