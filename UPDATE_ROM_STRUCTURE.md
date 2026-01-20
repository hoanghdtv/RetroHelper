# Cập nhật cấu trúc Rom và RelatedRom

## Thay đổi

### 1. Interface Rom
Đã thêm trường `id` (optional):
```typescript
export interface Rom {
  id?: number;  // 🆕 ID tự động từ database
  title: string;
  url: string;
  console: string;
  // ... các trường khác
}
```

### 2. Interface RelatedRom
Đã thêm trường `id` và `romId` (optional):
```typescript
export interface RelatedRom {
  id?: number;      // 🆕 ID của related ROM
  romId?: number;   // 🆕 ID của ROM cha
  title: string;
  url: string;
  // ... các trường khác
}
```

## Các file đã cập nhật

### 1. `database.ts`
- ✅ Thêm `id?` vào interface `Rom`
- ✅ Thêm `id?` và `romId?` vào interface `RelatedRom`
- ✅ Cập nhật method `rowToRom()` để trả về `id` cho Rom và `id`, `romId` cho RelatedRom
- ✅ Method `saveRom()` vẫn trả về `romId` như cũ

### 2. `db-csv-converter.ts`
- ✅ Thêm cột `id` vào CSV khi export
- ✅ Cột `id` sẽ được export nhưng **không được import** (vì DB tự động tạo)
- ✅ Cập nhật `exportToCsv()` để include cột `id`
- ✅ Cập nhật `exportAllConsoles()` để include cột `id`
- ✅ Cập nhật `importFromCsv()` để bỏ qua cột `id` (database tự tạo)

## Lưu ý quan trọng

### ⚠️ ID là optional
- Trường `id` là **optional** (`?`) vì khi tạo ROM mới, chúng ta không cần cung cấp id
- Database sẽ tự động tạo id (AUTO_INCREMENT)
- Chỉ khi đọc ROM từ database, trường `id` mới có giá trị

### 📤 Export CSV
Khi export sang CSV, cột `id` sẽ được bao gồm:
```csv
id,title,url,console,...
2384,'96 Zenkoku Koukou Soccer,...
2385,ActRaiser,...
```

### 📥 Import CSV  
Khi import từ CSV:
- Cột `id` trong CSV sẽ bị **bỏ qua**
- Database sẽ tự động tạo id mới
- Điều này đảm bảo không có conflict về ID

## Sử dụng

### Fetch ROMs (có id)
```typescript
const db = new RomDatabase('./output/roms.db');
await db.init();

const roms = await db.getRomsByConsole('nes');
roms.forEach(rom => {
  console.log(`ID: ${rom.id}, Title: ${rom.title}`);
  // ID: 1, Title: Super Mario Bros.
  // ID: 2, Title: The Legend of Zelda
});
```

### Create new ROM (không cần id)
```typescript
const newRom: Rom = {
  // Không cần trường id
  title: 'New Game',
  url: 'https://...',
  console: 'nes',
  // ...
};

const romId = await db.saveRom(newRom); // Returns generated ID
console.log(`Created ROM with ID: ${romId}`);
```

### Export với ID
```bash
npm run convert -- export ./output/roms.db ./output/roms.csv
# CSV sẽ có cột id
```

### Import (ID tự động tạo mới)
```bash
npm run convert -- import ./output/roms.csv ./output/new.db
# ID trong CSV bị bỏ qua, DB tạo ID mới
```

## Testing

Đã test thành công:
- ✅ Compile TypeScript không lỗi
- ✅ Export CSV có cột `id`
- ✅ Import CSV không conflict về ID
- ✅ Fetch ROMs trả về đầy đủ thông tin với `id`

## Migration

Không cần migration! Database schema không thay đổi, chỉ thêm trường vào TypeScript interface.

Các database hiện có vẫn hoạt động bình thường vì:
1. Database đã có cột `id` từ trước (AUTO_INCREMENT)
2. Chỉ cập nhật code để sử dụng trường `id` đó
3. Không thay đổi cấu trúc bảng
