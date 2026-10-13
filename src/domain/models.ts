export type Source = 'bookmarks' | 'history' | 'sessions';
export interface Link {
  id: string;
  url: string;
  title: string;
  domain: string;
  firstCollectedAt: number;
  lastCollectedAt: number;
  tags: string[];
  notes: string;
}
export interface Visit {
  id: string;
  linkId: string;
  collectorId: string;
  sourceVisitId: string;
  visitedAt: number;
  origin: 'local' | 'synced' | 'unknown';
  knownDeviceId?: string;
  collectedAt?: number;
}
export interface Bookmark {
  id: string;
  linkId: string;
  collectorId: string;
  sourceBookmarkId: string;
  folderPath: string[];
  savedAt?: number;
  lastUsedAt?: number;
  current: boolean;
  collectedAt?: number;
}
export interface Device {
  id: string;
  collectorId: string;
  sourceName: string;
  alias?: string;
  firstObservedAt: number;
  lastObservedAt: number;
}
export interface TabObservation {
  id: string;
  linkId: string;
  deviceId: string;
  snapshotId: string;
  sessionRef?: string;
  windowRef?: string;
  tabRef?: string;
  sessionModifiedAt?: number;
  observedAt: number;
}
export interface Collection { id: string; name: string; linkIds: string[] }
export interface CollectionRun {
  id: string;
  source: Source;
  startedAt: number;
  endedAt?: number;
  outcome: 'running' | 'success' | 'error';
  count: number;
  error?: string;
  cursor?: string;
  historyCoverage?: HistoryCoverage;
  sessionCoverage?: SessionCoverage;
}
export interface SessionCoverage {
  tabsPermission: boolean;
  devices: number;
  sessions: number;
  tabsReturned: number;
  missingUrl: number;
  excluded: number;
  incognito: number;
  withheld: number;
  archived: number;
  deviceCounts: { name: string; sessions: number; tabs: number; archived: number; missingUrl: number }[];
}
export interface HistoryCoverage {
  urlsReturned: number;
  localVisits: number;
  syncedVisits: number;
  unknownVisits: number;
  excludedUrls: number;
  suppressedVisits: number;
  startTime: number;
  endTime: number;
  limitReached: boolean;
}
export interface Suppression { id: string; source: Source; sourceKey: string }
export interface Settings {
  id: 'local';
  collectorId: string;
  installationName: string;
  onboardingCompleted: boolean;
  paused: boolean;
  enabledSources: Source[];
  excludedDomains: string[];
  theme: 'dark' | 'light';
  historyDays?: number;
}
