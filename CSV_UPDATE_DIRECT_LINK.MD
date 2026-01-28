
npx ts-node src/download/rom-csv-download.ts output/topnes-split/roms.csv --output downloads/nes --repository nes-roms




📋 Tóm tắt 3 chế độ hoạt động:
1. Download ROMs (default)
Nếu ROM đã có directDownloadLink → Dùng ngay, không fetch
Nếu ROM chưa có → Fetch redirect link → Lưu vào CSV → Download file
Output: ROMs được download + CSV được update
npx ts-node src/download/rom-csv-download.ts output/topnes-split/roms.csv --output downloads/nes --limit 10
2. Fetch redirect links only (không download)
ROM đã có directDownloadLink → Skip ✅
ROM chưa có → Fetch redirect link → Lưu vào CSV → Dừng lại (không download)
Output: Chỉ update CSV, không tải file
npx ts-node src/download/rom-csv-download.ts output/topnes-split/roms.csv --fetch-redirects-only --limit 10
3. Save redirects to new CSV
Fetch redirect links cho tất cả ROMs (kể cả đã có)
Lưu vào file CSV mới
Output: File CSV mới với redirect links
Test results:
npx ts-node src/download/rom-csv-download.ts output/topnes-split/roms.csv --save-redirects --output-csv output/roms-updated.csv

✅ --fetch-redirects-only: 2 ROMs skipped (đã có), 3 ROMs fetched và saved
✅ Download mode: Tất cả 5 ROMs dùng saved links, không fetch lại
✅ CSV được update đúng sau mỗi lần fetch thành công
Claude Sonnet 4.5 • 1x