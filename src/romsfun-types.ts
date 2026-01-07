export interface RomsFunGame {
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

export interface RomsFunSearchResult {
  games: RomsFunGame[];
  totalResults: number;
  currentPage: number;
}

export interface RomsFunConsole {
  name: string;
  slug: string;
  url: string;
  gameCount?: number;
}

export interface RomsFunConfig {
  baseUrl?: string;
  timeout?: number;
  userAgent?: string;
}
