import Dexie, { type Table } from 'dexie';
import type { Bookmark, Collection, CollectionRun, Device, Link, Settings, Suppression, TabObservation, Visit } from '../domain/models';
import type { CleanupBackup } from '../bookmarks/cleanup';
import type { LinkHealth } from '../bookmarks/health';

class ArchiveDatabase extends Dexie {
  links!: Table<Link, string>;
  visits!: Table<Visit, string>;
  bookmarks!: Table<Bookmark, string>;
  devices!: Table<Device, string>;
  observations!: Table<TabObservation, string>;
  collections!: Table<Collection, string>;
  runs!: Table<CollectionRun, string>;
  suppressions!: Table<Suppression, string>;
  settings!: Table<Settings, string>;
  bookmarkCleanups!: Table<CleanupBackup, string>;
  linkHealth!: Table<LinkHealth, string>;

  constructor() {
    super('link-library');
    this.version(1).stores({
      links: 'id, &url, domain, lastCollectedAt, *tags',
      visits: 'id, linkId, visitedAt, knownDeviceId, &[collectorId+sourceVisitId]',
      bookmarks: 'id, linkId, savedAt, &[collectorId+sourceBookmarkId]',
      devices: 'id, collectorId, lastObservedAt',
      observations: 'id, linkId, deviceId, observedAt, snapshotId',
      collections: 'id, name, *linkIds',
      runs: 'id, source, startedAt, outcome',
      suppressions: 'id, &[source+sourceKey]',
      settings: 'id',
    });
    this.version(2).stores({ links: 'id, &url, domain, title, lastCollectedAt, *tags' });
    this.version(3).stores({ bookmarkCleanups: 'id, createdAt, state' });
    this.version(4).stores({ linkHealth: 'url, state, checkedAt' });
  }
}
export const db = new ArchiveDatabase();

export async function initializeSettings(): Promise<Settings> {
  return db.transaction('rw', db.settings, async () => {
    const existing = await db.settings.get('local');
    if (existing) return existing;
    const settings: Settings = {
      id: 'local', collectorId: crypto.randomUUID(), installationName: 'This desktop',
      onboardingCompleted: false, paused: true, enabledSources: [], excludedDomains: [], theme: 'dark',
    };
    await db.settings.add(settings);
    return settings;
  });
}
