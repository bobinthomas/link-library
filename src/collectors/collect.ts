import { db, initializeSettings } from '../storage/db';
import type { HistoryCoverage, SessionCoverage, Settings, Source } from '../domain/models';
import { allowedUrl } from './policy';
import { isSuppressed, suppressionKey } from '../storage/suppression';

let active: Promise<void> | undefined;
export function collectArchive(): Promise<void> {
  if (active) return active;
  active = run().finally(() => { active = undefined; });
  return active;
}
async function check(_settings: Settings, source: Source) {
  const current = await db.settings.get('local');
  if (!current?.onboardingCompleted || current.paused || !current.enabledSources.includes(source)) throw new Error('Collection paused or source disabled.');
  if (!await chrome.permissions.contains({ permissions: [source] })) throw new Error('Permission missing. Open collection settings to grant access.');
  return current;
}
async function saveLink(url: string, title: string) {
  const existing = await db.links.where('url').equals(url).first();
  const now = Date.now();
  if (existing) {
    await db.links.update(existing.id, { title: title || existing.title, lastCollectedAt: now });
    return existing.id;
  }
  const id = crypto.randomUUID();
  await db.links.add({ id, url, title, domain: new URL(url).hostname, firstCollectedAt: now, lastCollectedAt: now, tags: [], notes: '' });
  return id;
}
async function persistenceAllowed(source: Source, url: string, key: string, storedKey = key) {
  const settings = await db.settings.get('local');
  if (!settings?.onboardingCompleted || settings.paused || !settings.enabledSources.includes(source)) throw new Error('Collection paused or source disabled.');
  return allowedUrl(url, settings.excludedDomains) && !await isSuppressed(source, key, storedKey);
}
async function run() {
  const settings = await initializeSettings();
  if (!settings.onboardingCompleted || settings.paused) return;
  // A worker restart makes any unfinished run observable; source IDs make retries idempotent.
  await db.runs.where('outcome').equals('running').modify({ outcome: 'error', endedAt: Date.now(), error: 'Collection interrupted. Refresh to retry safely.' });
  // Fetch remote snapshots first: a long history import must not delay phone tabs.
  const sources = [...settings.enabledSources].sort((a, b) => Number(b === 'sessions') - Number(a === 'sessions'));
  for (const source of sources) {
    const id = crypto.randomUUID();
    let count = 0;
    await db.runs.add({ id, source, startedAt: Date.now(), outcome: 'running', count });
    const progress = async () => { count++; await db.runs.update(id, { count }); };
    try {
      await check(settings, source);
      if (source === 'bookmarks') await bookmarks(settings, progress);
      if (source === 'history') await history(settings, progress, async coverage => { await db.runs.update(id, { historyCoverage: coverage }); });
      if (source === 'sessions') await sessions(settings, progress, async coverage => { await db.runs.update(id, { sessionCoverage: coverage }); });
      await db.runs.update(id, { outcome: 'success', endedAt: Date.now(), count });
    } catch (error) {
      await db.runs.update(id, { outcome: 'error', endedAt: Date.now(), count, error: error instanceof Error ? error.message : 'Collection failed.' });
    }
  }
}
async function bookmarks(settings: Settings, progress: () => Promise<void>) {
  const tree = await chrome.bookmarks.getTree();
  const seen = new Set<string>();
  async function walk(nodes: chrome.bookmarks.BookmarkTreeNode[], path: string[]) {
    for (const node of nodes) {
      if (node.url) {
        seen.add(node.id);
        const current = await check(settings, 'bookmarks');
        if (!allowedUrl(node.url, current.excludedDomains)) continue;
        const saved = await db.transaction('rw', [db.links, db.bookmarks, db.suppressions, db.settings], async () => {
          if (!await persistenceAllowed('bookmarks', node.url!, `${settings.collectorId}:${node.id}`)) return false;
          const linkId = await saveLink(node.url!, node.title);
          const previous = await db.bookmarks.get(`${settings.collectorId}:${node.id}`);
          await db.bookmarks.put({ id: `${settings.collectorId}:${node.id}`, linkId, collectorId: settings.collectorId, sourceBookmarkId: node.id, folderPath: path, savedAt: node.dateAdded, current: true, collectedAt: previous ? previous.collectedAt : Date.now() });
          return true;
        });
        if (saved) await progress();
      } else if (node.children) await walk(node.children, node.title ? [...path, node.title] : path);
    }
  }
  await walk(tree, []);
  await db.bookmarks.filter(record => record.collectorId === settings.collectorId && !seen.has(record.sourceBookmarkId)).modify({ current: false });
}
async function history(settings: Settings, progress: () => Promise<void>, report: (coverage: HistoryCoverage) => Promise<void>) {
  const endTime = Date.now();
  const startTime = settings.historyDays === 0 ? 0 : endTime - (settings.historyDays ?? 30) * 86_400_000;
  // Explicit bounded feasibility import. Never represent an API limit as complete coverage.
  const items = await chrome.history.search({ text: '', startTime, endTime, maxResults: 10_000 });
  const coverage: HistoryCoverage = { urlsReturned: items.length, localVisits: 0, syncedVisits: 0, unknownVisits: 0, excludedUrls: 0, suppressedVisits: 0, startTime, endTime, limitReached: items.length === 10_000 };
  await report(coverage);
  try {
  for (const item of items) {
    const current = await check(settings, 'history');
    if (!item.url || !allowedUrl(item.url, current.excludedDomains)) { coverage.excludedUrls++; continue; }
    const visits = await chrome.history.getVisits({ url: item.url });
    for (const visit of visits) {
      const latest = await check(settings, 'history');
      if (!allowedUrl(item.url, latest.excludedDomains)) break;
      if (visit.visitTime === undefined || visit.visitTime < startTime || visit.visitTime > endTime) continue;
      const key = `${settings.collectorId}:${visit.visitId}`;
      if (visit.isLocal === true) coverage.localVisits++;
      else if (visit.isLocal === false) coverage.syncedVisits++;
      else coverage.unknownVisits++;
      const saved = await db.transaction('rw', [db.links, db.visits, db.suppressions, db.settings], async () => {
        if (!await persistenceAllowed('history', item.url!, key)) return false;
        const linkId = await saveLink(item.url!, item.title ?? '');
        const previous = await db.visits.get(key);
        await db.visits.put({ id: key, linkId, collectorId: settings.collectorId, sourceVisitId: visit.visitId, visitedAt: visit.visitTime!, origin: visit.isLocal === true ? 'local' : visit.isLocal === false ? 'synced' : 'unknown', knownDeviceId: visit.isLocal === true ? `local:${settings.collectorId}` : undefined, collectedAt: previous ? previous.collectedAt : Date.now() });
        return true;
      });
      if (saved) await progress(); else coverage.suppressedVisits++;
      if ((coverage.localVisits + coverage.syncedVisits + coverage.unknownVisits) % 50 === 0) await report(coverage);
    }
  }
  } finally { await report(coverage); }
  if (items.length === 10_000) throw new Error('Imported a bounded batch of 10,000 URLs. Coverage may be incomplete; select a shorter history range.');
}
async function sessions(settings: Settings, progress: () => Promise<void>, report: (coverage: SessionCoverage) => Promise<void>) {
  const devices = await chrome.sessions.getDevices({ maxResults: 25 });
  const coverage: SessionCoverage = { tabsPermission: await chrome.permissions.contains({ permissions: ['tabs'] }), devices: devices.length, sessions: 0, tabsReturned: 0, missingUrl: 0, excluded: 0, incognito: 0, withheld: 0, archived: 0, deviceCounts: [] };
  await report(coverage);
  const now = Date.now();
  const nameCounts = new Map<string, number>();
  try {
  for (const device of devices) {
    const deviceCounts = { name: device.deviceName, sessions: device.sessions.length, tabs: 0, archived: 0, missingUrl: 0 };
    coverage.deviceCounts.push(deviceCounts); coverage.sessions += device.sessions.length;
    await check(settings, 'sessions');
    // Chrome exposes names but no stable device identifier. Keep same-name entries separate.
    const slot = nameCounts.get(device.deviceName) ?? 0;
    nameCounts.set(device.deviceName, slot + 1);
    const deviceId = JSON.stringify([settings.collectorId, device.deviceName, slot]);
    const previous = await db.devices.get(deviceId);
    await db.transaction('rw', db.devices, db.settings, async () => {
      const latest = await db.settings.get('local');
      if (latest?.paused || !latest?.enabledSources.includes('sessions')) throw new Error('Collection paused or source disabled.');
      await db.devices.put({ id: deviceId, collectorId: settings.collectorId, sourceName: device.deviceName, firstObservedAt: previous?.firstObservedAt ?? now, lastObservedAt: now });
    });
    for (const session of device.sessions) {
      const tabs = session.window?.tabs ?? (session.tab ? [session.tab] : []);
      for (const [index, tab] of tabs.entries()) {
        coverage.tabsReturned++; deviceCounts.tabs++;
        const current = await check(settings, 'sessions');
        if (tab.incognito) { coverage.incognito++; continue; }
        if (!tab.url) { coverage.missingUrl++; deviceCounts.missingUrl++; continue; }
        if (!allowedUrl(tab.url, current.excludedDomains)) { coverage.excluded++; continue; }
        const key = JSON.stringify([deviceId, session.window?.sessionId ?? session.tab?.sessionId, session.lastModified, tab.sessionId ?? index, tab.url]);
        const storedKey = await suppressionKey('sessions', key);
        const saved = await db.transaction('rw', [db.links, db.observations, db.suppressions, db.settings], async () => {
          if (!await persistenceAllowed('sessions', tab.url!, key, storedKey)) return false;
          const linkId = await saveLink(tab.url!, tab.title ?? '');
          const prior = await db.observations.get(key);
          // Refreshes of the same exposed snapshot do not add observations or visits.
          if (!prior) await db.observations.add({ id: key, linkId, deviceId, snapshotId: JSON.stringify([deviceId, session.lastModified]), sessionRef: session.window?.sessionId ?? session.tab?.sessionId, tabRef: tab.sessionId, sessionModifiedAt: session.lastModified * 1000, observedAt: now });
          return true;
        });
        if (saved) { coverage.archived++; deviceCounts.archived++; await progress(); } else coverage.withheld++;
      }
    }
  }
  } finally { await report(coverage); }
  if (coverage.missingUrl > 0 && !coverage.tabsPermission) throw new Error('Chrome returned synced tabs without readable URLs. Grant session and tab URL access in Collection coverage, then retry.');
}
