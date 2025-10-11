/**
 * HDHomeRun API Response Types
 * Based on actual API responses documented in ORIGINAL_SCRIPT_ANALYSIS.md
 */

export interface DeviceDiscovery {
  DeviceAuth: string;
  DeviceID: string;
  FriendlyName?: string;
  ModelNumber?: string;
  [key: string]: unknown;
}

export interface ChannelLineupItem {
  GuideNumber: string;
  GuideName: string;
  URL?: string;
  [key: string]: unknown;
}

export interface ProgrammeGuide {
  StartTime: number; // Unix timestamp
  EndTime: number; // Unix timestamp
  Title: string;
  Synopsis?: string;
  EpisodeNumber?: string; // Format: "S01E05"
  EpisodeTitle?: string;
  OriginalAirdate?: number; // Unix timestamp
  ImageURL?: string;
  Filter?: string[]; // Categories like ["Drama", "Crime"]
  [key: string]: unknown;
}

export interface ChannelGuide {
  GuideNumber: string;
  GuideName: string;
  Affiliate?: string;
  ImageURL?: string;
  Guide: ProgrammeGuide[];
  [key: string]: unknown;
}

export type EPGResponse = ChannelGuide[];
