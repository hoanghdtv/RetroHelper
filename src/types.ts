export interface GameInfo {
  ID: number;
  Title: string;
  ConsoleID: number;
  ConsoleName: string;
  ImageIcon: string;
  NumAchievements: number;
  NumLeaderboards: number;
  Points: number;
  DateModified: string;
  ForumTopicID?: number;
  Hashes?: string[];
}

export interface ConsoleInfo {
  ID: number;
  Name: string;
}

export interface GameExtended extends GameInfo {
  Achievements?: Record<string, Achievement>;
}

export interface Achievement {
  ID: number;
  Title: string;
  Description: string;
  Points: number;
  BadgeName: string;
  DisplayOrder: number;
  MemAddr: string;
  DateCreated?: string;
  DateModified?: string;
  Author?: string;
  TrueRatio?: number;
}

export interface GameWithAchievements {
  ID: number;
  Title: string;
  ConsoleID: number;
  ConsoleName?: string;
  ForumTopicID?: number;
  Flags?: number;
  ImageIcon?: string;
  ImageTitle?: string;
  ImageIngame?: string;
  ImageBoxArt?: string;
  Publisher?: string;
  Developer?: string;
  Genre?: string;
  Released?: string;
  IsFinal?: boolean;
  RichPresencePatch?: string;
  Achievements?: Record<string, Achievement>;
  NumAchievements?: number;
  NumDistinctPlayersCasual?: number;
  NumDistinctPlayersHardcore?: number;
  Points?: number;
}

export interface RetroAchievementsConfig {
  username: string;
  apiKey: string;
}
