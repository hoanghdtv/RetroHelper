// Tool to read ROM information from CSV file
// Usage: npx ts-node src/retro-achievement/ra-csv-update.ts <csvPath> [options]
// Example:
//   npx ts-node src/retro-achievement/ra-csv-update.ts output/topnes-split/roms.csv
//   npx ts-node src/retro-achievement/ra-csv-update.ts output/topnes-split/roms.csv --limit 10
//   npx ts-node src/retro-achievement/ra-csv-update.ts output/topnes-split/roms.csv --console nes

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as dotenv from 'dotenv';
import axios from 'axios';
import AdmZip from 'adm-zip';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';

dotenv.config();

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RomRecord {
  id?: number;
  title: string;
  url: string;
  console: string;
  description?: string;
  mainImage?: string;
  screenshots?: string[];
  genre?: string[];
  releaseDate?: string;
  publisher?: string;
  region?: string[];
  size?: string;
  downloadCount?: string;
  numberOfReviews?: string;
  averageRating?: string;
  downloadLink?: string;
  directDownloadLink?: string;
  romType?: string;
  relatedRoms?: string; // comma-separated IDs e.g. "10002,10003,10005,10007"
}
