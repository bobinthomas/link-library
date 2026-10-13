import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { db, initializeSettings } from '../src/storage/db';
import { collectArchive } from '../src/collectors/collect';
import { allowedUrl, parseExclusions } from '../src/collectors/policy';
import { loadRecentLinks } from '../src/storage/recent-links';
import Dexie from 'dexie';
import { dateBounds, defaultSearch, loadLinkDetails, searchArchive } from '../src/storage/search';
import { createCollection, saveOrganization } from '../src/storage/organization';
import { csvCell, exportArchive, exportCsv, importArchive, validateArchive } from '../src/storage/transfer';
import { allowDeletedRecordsAgain, applyDeletion, previewDeletion } from '../src/storage/deletion';
import { analyzeBookmarks, type BookmarkNode } from '../src/bookmarks/analysis';
import { applyBookmarkCleanup, bookmarkBackupHtml, validateCleanupPlan } from '../src/bookmarks/cleanup';
import { checkBookmarkUrl } from '../src/bookmarks/health';
import { archiveOverview, bookmarkOverview } from '../src/storage/overview';
import { sourcePermissions } from '../src/shared/permissions';

test('collectors preserve provenance, deduplicate retries, respect controls, and retain archives', async () => {
  let now = Date.now();
  let bookmarkPresent = true;
  let historyPresent = true;
  let historyDenied = false;
  let searched = false;
  const url = 'https://example.com/article?part=1#section';
  Object.assign(globalThis, { chrome: {
    permissions: { contains: async ({ permissions }: { permissions: string[] }) => !(historyDenied && permissions.includes('history')) },
    bookmarks: { getTree: async () => [{ id: 'root', title: '', children: bookmarkPresent ? [{ id: 'folder', title: 'Learning', children: [{ id: 'b1', title: 'Article', url, dateAdded: now }, { id: 'b2', title: 'Another folder association', url, dateAdded: now }] }] : [] }] },
    history: {
      search: async (query: { startTime: number; endTime: number; maxResults: number }) => { searched = true; assert.ok(query.startTime < query.endTime); assert.equal(query.maxResults, 10_000); return historyPresent ? [{ id: 'h1', url, title: 'Article' }, { id: 'h2', url: 'https://blocked.example/private' }] : []; },
      getVisits: async () => [{ visitId: 'local', visitTime: now, isLocal: true }, { visitId: 'remote', visitTime: now, isLocal: false }, { visitId: 'old', visitTime: 1, isLocal: true }],
    },
    sessions: { getDevices: async () => [{ deviceName: 'Phone', sessions: [{ lastModified: Math.floor(now / 1000), window: { sessionId: 's1', tabs: [{ url, title: 'Article', sessionId: 't1', incognito: false }] } }] }, { deviceName: 'Phone', sessions: [{ lastModified: Math.floor(now / 1000), tab: { url: 'https://example.com/article?part=2', sessionId: 't2' } }] }] },
  } });
  await db.delete(); await db.open();
  assert.deepEqual((await loadRecentLinks()).rows, []);
  const settings = await initializeSettings();
  await collectArchive(); assert.equal(searched, false, 'no collection before consent');
  await db.settings.update('local', { onboardingCompleted: true, paused: false, enabledSources: ['bookmarks', 'history', 'sessions'], excludedDomains: ['blocked.example'], historyDays: 30 });
  await collectArchive();
  assert.equal(await db.links.count(), 2, 'query variants stay distinct and exclusions apply');
  const initialRows = (await loadRecentLinks()).rows;
  assert.equal(initialRows.length, 2);
  assert.ok(initialRows.every(row => Array.isArray(row.bookmarks) && Array.isArray(row.visits) && Array.isArray(row.observations)), 'every rendered row includes source arrays');
  const article = initialRows.find(row => row.url === url)!;
  assert.equal(article.bookmarks.length, 2);
  assert.equal(article.visits.length, 2);
  assert.equal(article.observations.length, 1);
  // Concurrent collection/read snapshots always return complete renderable rows.
  await Promise.all([collectArchive(), ...Array.from({ length: 10 }, async () => {
    const snapshot = await loadRecentLinks();
    for (const row of snapshot.rows) {
      assert.ok(Array.isArray(row.bookmarks));
      assert.ok(Array.isArray(row.visits));
      assert.ok(Array.isArray(row.observations));
    }
  })]);
  assert.equal(await db.bookmarks.count(), 2, 'duplicate bookmarks retain associations');
  assert.deepEqual((await db.bookmarks.toArray())[0].folderPath, ['Learning']);
  assert.equal(await db.visits.count(), 2, 'only visits in selected period');
  const remote = await db.visits.get(`${settings.collectorId}:remote`);
  assert.equal(remote?.origin, 'synced'); assert.equal(remote?.knownDeviceId, undefined);
  assert.equal((await db.visits.get(`${settings.collectorId}:local`))?.knownDeviceId, `local:${settings.collectorId}`);
  assert.equal(await db.devices.count(), 2, 'same-name device entries are separate');
  assert.equal(await db.observations.count(), 2);
  const firstHistoryRun = (await db.runs.where('source').equals('history').toArray())[0];
  assert.equal(firstHistoryRun.historyCoverage?.syncedVisits, 1);
  assert.equal(firstHistoryRun.historyCoverage?.localVisits, 1);
  assert.equal(firstHistoryRun.historyCoverage?.excludedUrls, 1);
  await collectArchive();
  assert.equal(await db.links.count(), 2); assert.equal(await db.visits.count(), 2); assert.equal(await db.observations.count(), 2);
  bookmarkPresent = false; historyPresent = false;
  await collectArchive();
  assert.equal(await db.visits.count(), 2, 'Chrome deletion does not erase archive');
  assert.equal(await db.bookmarks.count(), 2);
  assert.ok((await db.bookmarks.toArray()).every(value => !value.current));
  historyDenied = true;
  await collectArchive();
  assert.ok((await db.runs.toArray()).some(value => value.source === 'history' && value.outcome === 'error'));
  assert.equal(await db.visits.count(), 2, 'partial failure preserves archive');
  await db.settings.update('local', { paused: true });
  const runsBefore = await db.runs.count(); await collectArchive(); assert.equal(await db.runs.count(), runsBefore);
  await db.settings.update('local', { paused: false, enabledSources: ['history'] });
  historyPresent = true; historyDenied = false; now += 1000;
  await db.visits.delete(`${settings.collectorId}:local`);
  await db.suppressions.add({ id: 'suppression', source: 'history', sourceKey: `${settings.collectorId}:local` });
  await collectArchive(); assert.equal(await db.visits.count(), 1, 'suppressed visit is not restored');
  db.close(); await db.open(); assert.equal(await db.links.count(), 2, 'archive survives reopening database');
  await db.delete();
});

test('domain policy includes subdomains and rejects unsafe navigation', () => {
  assert.equal(allowedUrl('https://sub.example.com/path', ['example.com']), false);
  assert.equal(allowedUrl('https://notexample.com', ['example.com']), true);
  assert.equal(allowedUrl('javascript:alert(1)', []), false);
  assert.deepEqual(parseExclusions('Example.com\nhttps://example.com/path, private.example'), ['example.com', 'private.example']);
});

test('full archive discovery, date semantics, pagination, provenance details, and schema upgrade', async () => {
  // Recreate a version-one archive to verify the title index migration preserves records.
  const legacy = new Dexie('link-library');
  legacy.version(1).stores({ links: 'id, &url, domain, lastCollectedAt, *tags', visits: 'id, linkId, visitedAt, knownDeviceId, &[collectorId+sourceVisitId]', bookmarks: 'id, linkId, savedAt, &[collectorId+sourceBookmarkId]', devices: 'id, collectorId, lastObservedAt', observations: 'id, linkId, deviceId, observedAt, snapshotId', collections: 'id, name, *linkIds', runs: 'id, source, startedAt, outcome', suppressions: 'id, &[source+sourceKey]', settings: 'id' });
  await legacy.open();
  await legacy.table('links').add({ id: 'target', url: 'https://older.example/needle?x=1#part', title: 'Old reference', domain: 'older.example', firstCollectedAt: 1, lastCollectedAt: 1, tags: ['research'], notes: 'Preserved note' });
  legacy.close(); await db.open();
  assert.equal(db.verno, 4);
  assert.equal((await db.links.get('target'))?.notes, 'Preserved note');
  await db.links.bulkAdd(Array.from({ length: 150 }, (_, index) => ({ id: `filler-${index}`, url: `https://new.example/${index}`, title: `New ${String(index).padStart(3, '0')}`, domain: 'new.example', firstCollectedAt: 2, lastCollectedAt: index + 2, tags: [], notes: '' })));
  const saved = new Date('2026-01-01T12:00:00').getTime();
  const visited = new Date('2026-02-01T12:00:00').getTime();
  const observed = new Date('2026-03-01T12:00:00').getTime();
  await db.bookmarks.add({ id: 'b1', linkId: 'target', collectorId: 'c', sourceBookmarkId: 'b1', folderPath: ['Learning'], savedAt: saved, current: true });
  await db.visits.bulkAdd(Array.from({ length: 60 }, (_, index) => ({ id: `v-${index}`, linkId: 'target', collectorId: 'c', sourceVisitId: `v-${index}`, visitedAt: visited + index, origin: index === 0 ? 'synced' as const : 'local' as const, knownDeviceId: index === 0 ? undefined : 'local:c' })));
  await db.observations.add({ id: 'o1', linkId: 'target', deviceId: 'phone', snapshotId: 's1', sessionModifiedAt: observed - 1000, observedAt: observed });
  assert.ok(!(await loadRecentLinks()).rows.some(row => row.id === 'target'), 'old link is outside the former recent limit');
  const found = await searchArchive({ ...defaultSearch, query: 'needle' });
  assert.equal(found.total, 1); assert.equal(found.rows[0].id, 'target');
  assert.equal((await searchArchive({ ...defaultSearch, query: 'RESEARCH' })).total, 1, 'tags search is case insensitive');
  assert.equal((await searchArchive({ ...defaultSearch, domain: 'older.example' })).total, 1);
  assert.equal((await searchArchive({ ...defaultSearch, domain: 'example' })).total, 0, 'domain matches exact host');
  const january = dateBounds('2026-01-01', '2026-01-01');
  assert.equal((await searchArchive({ ...defaultSearch, from: visited, to: saved })).total, 0, 'inverted dates return an empty result safely');
  assert.equal((await searchArchive({ ...defaultSearch, source: 'bookmarks', ...january })).total, 1);
  assert.equal((await searchArchive({ ...defaultSearch, source: 'history', ...january })).total, 0);
  assert.equal((await searchArchive({ ...defaultSearch, ...january })).total, 1, 'mixed view uses matching source date');
  const february = dateBounds('2026-02-01', '2026-02-01');
  const history = await searchArchive({ ...defaultSearch, source: 'history', ...february });
  assert.equal(history.rows[0].summary.visits, 60);
  assert.equal((await searchArchive({ ...defaultSearch, source: 'history', device: 'synced', ...february })).rows[0].summary.visits, 1);
  assert.equal((await searchArchive({ ...defaultSearch, source: 'history', device: 'phone' })).total, 0, 'a tab device is not inferred for visits');
  assert.equal((await searchArchive({ ...defaultSearch, source: 'sessions', device: 'phone', ...dateBounds('2026-03-01', '2026-03-01') })).rows[0].summary.observations, 1);
  assert.equal((await searchArchive({ ...defaultSearch, sort: 'visits' })).rows[0].id, 'target', 'snapshots never inflate visit frequency');
  assert.equal((await searchArchive({ ...defaultSearch, bookmark: 'saved' })).total, 1);
  assert.equal((await searchArchive({ ...defaultSearch, bookmark: 'not-saved' })).total, 150);
  const first = await searchArchive(defaultSearch);
  const second = await searchArchive({ ...defaultSearch, page: 1 });
  assert.equal(first.total, 151); assert.equal(first.rows.length, 30); assert.equal(second.rows.length, 30);
  assert.ok(!second.rows.some(row => first.rows.some(prior => prior.id === row.id)));
  assert.equal((await searchArchive({ ...defaultSearch, page: 999 })).page, 5, 'page clamps after result changes');
  const details = await loadLinkDetails('target', 0, 0);
  assert.equal(details?.visitCount, 60); assert.equal(details?.visits.length, 25);
  assert.equal(details?.visits[0].visitedAt, visited + 59);
  assert.equal((await loadLinkDetails('target', 2, 0))?.visits.length, 10);
  assert.deepEqual(details?.bookmarks[0].folderPath, ['Learning']);
  assert.equal(details?.observations[0].sessionModifiedAt, observed - 1000);
  assert.equal(await loadLinkDetails('missing', 0, 0), undefined);
  await db.delete();
});

test('organization, validated archive round trips, merge semantics, and import rollback', async () => {
  await db.open();
  const settings = await initializeSettings();
  await db.links.add({ id: 'original', url: 'https://example.com/reference?part=1#section', title: '=1+1', domain: 'example.com', firstCollectedAt: 1, lastCollectedAt: 10, tags: [], notes: '' });
  const collectionId = await createCollection(' Learning ');
  await assert.rejects(createCollection('learning'), /already exists/);
  await saveOrganization('original', ' research, work, research ', 'Private note\nSecond line', [collectionId]);
  assert.deepEqual((await db.links.get('original'))?.tags, ['research', 'work']);
  assert.equal((await searchArchive({ ...defaultSearch, collection: collectionId })).total, 1);
  await saveOrganization('original', 'research', 'Private note\nSecond line', []);
  assert.equal((await searchArchive({ ...defaultSearch, collection: collectionId })).total, 0);
  await saveOrganization('original', 'research', 'Private note\nSecond line', [collectionId]);
  await db.visits.add({ id: 'v1', linkId: 'original', collectorId: 'foreign', sourceVisitId: 'v1', visitedAt: 5, origin: 'local', knownDeviceId: 'local:foreign' });
  await db.bookmarks.add({ id: 'b1', linkId: 'original', collectorId: 'foreign', sourceBookmarkId: 'b1', savedAt: 3, current: true, folderPath: ['Work'] });
  await db.devices.add({ id: 'phone', collectorId: 'foreign', sourceName: 'Phone', firstObservedAt: 1, lastObservedAt: 8 });
  await db.observations.add({ id: 'o1', linkId: 'original', deviceId: 'phone', snapshotId: 'snapshot', observedAt: 8, sessionModifiedAt: 7 });
  await db.suppressions.add({ id: 's1', source: 'history', sourceKey: 'foreign:deleted' });
  const archive = JSON.parse(JSON.stringify(await exportArchive()));
  assert.equal(archive.version, 1); assert.equal(archive.settings, undefined);
  await db.transaction('rw', db.links, db.visits, db.bookmarks, db.devices, db.observations, db.collections, db.suppressions, async () => {
    await db.links.clear(); await db.visits.clear(); await db.bookmarks.clear(); await db.devices.clear(); await db.observations.clear(); await db.collections.clear(); await db.suppressions.clear();
  });
  // A local row with the same URL has a different ID: source and membership references must remap.
  await db.links.add({ ...archive.links[0], id: 'local-row', notes: 'Keep my newer note', tags: ['local-tag'] });
  assert.equal((await importArchive(archive)).addedLinks, 0);
  await importArchive(archive);
  assert.equal(await db.links.count(), 1); assert.equal(await db.visits.count(), 1); assert.equal(await db.bookmarks.count(), 1); assert.equal(await db.observations.count(), 1); assert.equal(await db.collections.count(), 1); assert.equal(await db.suppressions.count(), 1);
  assert.equal((await db.links.get('local-row'))?.notes, 'Keep my newer note');
  assert.deepEqual((await db.links.get('local-row'))?.tags, ['local-tag', 'research']);
  assert.equal((await db.visits.get('v1'))?.linkId, 'local-row');
  assert.deepEqual((await db.collections.get(collectionId))?.linkIds, ['local-row']);
  assert.deepEqual(await db.settings.get('local'), settings, 'import never enables collection or changes collector identity');
  const details = await loadLinkDetails('local-row', 0, 0);
  assert.equal(details?.visits[0].collectorId, 'foreign');
  assert.notEqual(details?.visits[0].collectorId, details?.settings?.collectorId);
  assert.throws(() => validateArchive({ ...archive, version: 99 }), /Invalid archive/);
  assert.throws(() => validateArchive({ ...archive, links: [{ ...archive.links[0], url: 'javascript:alert(1)' }] }), /Invalid archive/);
  assert.throws(() => validateArchive({ ...archive, visits: [{ ...archive.visits[0], linkId: 'missing' }] }), /Invalid archive/);
  assert.throws(() => validateArchive({ ...archive, visits: [{ ...archive.visits[0], origin: 'synced', knownDeviceId: 'phone' }] }), /Invalid archive/);
  const before = await exportArchive();
  const conflict = { ...archive, links: [...archive.links, { ...archive.links[0], id: 'new', url: 'https://example.com/new' }], visits: [{ ...archive.visits[0], visitedAt: 6 }] };
  await assert.rejects(importArchive(conflict), /conflicts/);
  const after = await exportArchive();
  assert.deepEqual({ ...after, exportedAt: 0 }, { ...before, exportedAt: 0 }, 'late conflict rolls back all merged/inserted data');
  assert.equal(csvCell('=1+1'), '"\'=1+1"');
  assert.equal(csvCell(' a,"b"'), '" a,""b"""');
  assert.ok((await exportCsv()).includes('"\'=1+1"'));
  await db.delete();
});

test('archive deletion previews, partial date deletion, stale protection, and all-source suppression', async () => {
  await db.open();
  const settings = await initializeSettings();
  await db.settings.update('local', { onboardingCompleted: true, paused: false, enabledSources: ['history', 'bookmarks', 'sessions'], historyDays: 30 });
  const now = Date.now();
  const url = 'https://private.example/sensitive?exact=1#fragment';
  let returnSyncedVisit = false;
  Object.assign(globalThis, { chrome: {
    permissions: { contains: async () => true },
    bookmarks: { getTree: async () => [{ id: 'b1', url, title: 'Sensitive', dateAdded: now - 2000 }] },
    history: { search: async () => [{ url, title: 'Sensitive' }], getVisits: async () => [{ visitId: 'local', visitTime: now - 1000, isLocal: true }, { visitId: 'unknown', visitTime: now }, ...(returnSyncedVisit ? [{ visitId: 'remote', visitTime: now, isLocal: false }] : [])] },
    sessions: { getDevices: async () => [{ deviceName: 'Phone', sessions: [{ lastModified: Math.floor(now / 1000), tab: { url, sessionId: 'tab1' } }] }] },
  } });
  await collectArchive();
  const coverage = (await db.runs.where('source').equals('history').sortBy('startedAt')).at(-1)?.historyCoverage;
  assert.equal(coverage?.syncedVisits, 0, 'tabs can exist without any synced history');
  assert.equal(coverage?.unknownVisits, 1, 'missing origin flag is never invented');
  assert.equal(await db.observations.count(), 1);
  assert.equal((await searchArchive({ ...defaultSearch, source: 'history', device: 'synced' })).total, 0);
  const link = (await db.links.toArray())[0];
  const collection = await createCollection('Private');
  await saveOrganization(link.id, 'test', 'Keep until all source records are removed', [collection]);
  const partial = await previewDeletion({ kind: 'range', source: 'history', from: now - 1100, to: now - 900 });
  assert.equal(partial.visits.length, 1); assert.equal(partial.bookmarks.length, 0);
  await applyDeletion(partial);
  assert.equal(await db.visits.count(), 1); assert.equal(await db.links.count(), 1, 'other source associations keep the link and notes');
  assert.equal((await db.collections.get(collection))?.linkIds.length, 1);
  await collectArchive(); assert.equal(await db.visits.count(), 1, 'deleted historical visit is not reimported');
  const stale = await previewDeletion({ kind: 'links', ids: [link.id] });
  await db.links.update(link.id, { notes: 'A newer edit' });
  await assert.rejects(applyDeletion(stale), /changed after preview/);
  assert.equal(await db.links.count(), 1, 'stale preview never deletes changed records');
  const single = await previewDeletion({ kind: 'links', ids: [link.id] });
  await applyDeletion(single);
  assert.equal(await db.links.count(), 0); assert.equal(await db.visits.count(), 0); assert.equal(await db.bookmarks.count(), 0); assert.equal(await db.observations.count(), 0);
  assert.deepEqual((await db.collections.get(collection))?.linkIds, []);
  const markers = await db.suppressions.toArray();
  assert.ok(markers.some(marker => marker.source === 'sessions' && marker.sourceKey.startsWith('sha256:')));
  assert.ok(markers.every(marker => !marker.sourceKey.includes('private.example')), 'snapshot suppression does not retain the deleted URL');
  await collectArchive();
  assert.equal(await db.links.count(), 0, 'all three collectors respect deletion suppression');
  // Real new visit IDs remain collectable without clearing previous markers.
  returnSyncedVisit = true;
  await collectArchive();
  assert.equal(await db.visits.count(), 1);
  assert.equal((await db.visits.toArray())[0].origin, 'synced');
  assert.equal((await searchArchive({ ...defaultSearch, source: 'history', device: 'synced' })).total, 1);
  const full = await previewDeletion({ kind: 'all' });
  await applyDeletion(full);
  assert.equal(await db.links.count(), 0); assert.equal(await db.devices.count(), 0); assert.equal(await db.collections.count(), 0); assert.equal(await db.runs.count(), 0);
  assert.equal((await db.settings.get('local'))?.paused, true);
  assert.equal((await db.settings.get('local'))?.collectorId, settings.collectorId);
  await collectArchive(); assert.equal(await db.links.count(), 0);
  await allowDeletedRecordsAgain(); assert.equal(await db.suppressions.count(), 0);
  await db.settings.update('local', { paused: false }); await collectArchive();
  assert.equal(await db.links.count(), 1); assert.equal(await db.visits.count(), 3); assert.equal(await db.bookmarks.count(), 1); assert.equal(await db.observations.count(), 1);
  const allSourceDates = await previewDeletion({ kind: 'range', source: 'all', from: now - 10_000, to: now + 10_000 });
  await applyDeletion(allSourceDates); assert.equal(await db.links.count(), 0, 'range deletion prunes links when their final source records are removed');
  await db.delete();
});

test('bookmark cleanup detection, guarded Chrome mutations, backups, and archive reconciliation', async () => {
  await db.open(); const settings = await initializeSettings();
  const tree: BookmarkNode[] = [{ id: '0', title: '', children: [{ id: '1', parentId: '0', title: 'Bookmarks bar', children: [
    { id: 'work', parentId: '1', title: 'Work', children: [{ id: 'keep', parentId: 'work', title: 'Reference', url: 'https://example.com/ref?part=1#section', dateAdded: 1 }] },
    { id: 'work-links', parentId: '1', title: 'Work Links', children: [{ id: 'duplicate', parentId: 'work-links', title: 'Copy', url: 'https://example.com/ref?part=1#section', dateAdded: 2 }, { id: 'distinct', parentId: 'work-links', title: 'Different query', url: 'https://example.com/ref?part=2#section' }, { id: 'gone', parentId: 'work-links', title: '<script>alert(1)</script>', url: 'https://example.com/gone' }] },
    { id: 'empty-parent', parentId: '1', title: 'Empty branch', children: [{ id: 'empty-child', parentId: 'empty-parent', title: 'Empty', children: [] }] },
    { id: 'managed', parentId: '1', title: 'Managed', unmodifiable: 'managed', children: [{ id: 'managed-link', parentId: 'managed', title: 'Corporate', url: 'https://corporate.example' }] },
  ] }] }];
  const analysis = analyzeBookmarks(tree);
  assert.equal(analysis.duplicates.length, 1); assert.equal(analysis.duplicates[0].nodes[0].node.id, 'keep');
  assert.ok(!analysis.duplicates[0].nodes.some(item => item.node.id === 'distinct'), 'query variants remain distinct');
  assert.deepEqual(analysis.emptyFolders.map(item => item.node.id), ['empty-parent', 'empty-child']);
  assert.equal(analysis.merges.length, 1);
  assert.ok(analysis.flat.filter(item => ['0', '1', 'managed', 'managed-link'].includes(item.node.id)).every(item => !item.mutable));
  const blankPlan = { duplicateIds: [], deadIds: [], emptyFolderIds: [], merges: [] };
  assert.throws(() => validateCleanupPlan(tree, { ...blankPlan, duplicateIds: ['keep', 'duplicate'] }), /keep at least one/);
  assert.throws(() => validateCleanupPlan(tree, { ...blankPlan, duplicateIds: ['managed-link'] }), /protected/);
  assert.throws(() => validateCleanupPlan(tree, { ...blankPlan, emptyFolderIds: ['empty-parent'] }), /child folders/);
  assert.throws(() => validateCleanupPlan(tree, { ...blankPlan, merges: [{ sourceId: 'empty-parent', targetId: 'empty-child' }] }), /ancestors/);
  assert.doesNotThrow(() => validateCleanupPlan(tree, { ...blankPlan, merges: [{ sourceId: 'work', targetId: 'empty-child' }] }), 'unrelated folders in different branches can be explicitly merged');
  const backupHtml = bookmarkBackupHtml(tree);
  assert.ok(backupHtml.includes('&lt;script&gt;')); assert.ok(!backupHtml.includes('<script>'));
  assert.ok(backupHtml.includes('https://example.com/ref?part=1#section'));
  let current = structuredClone(tree); const operations: string[] = [];
  const flatten = () => analyzeBookmarks(current).flat;
  const node = (id: string) => flatten().find(item => item.node.id === id)?.node;
  const remove = async (id: string) => {
    const value = node(id); if (!value) throw Error('missing');
    if (value.children?.length) throw Error('nonempty');
    node(value.parentId!)!.children = node(value.parentId!)!.children!.filter(child => child.id !== id);
    operations.push(`remove:${id}`);
  };
  const api = { getTree: async () => structuredClone(current), get: async (id: string) => node(id) ? [structuredClone(node(id)!)] : [], getChildren: async (id: string) => structuredClone(node(id)?.children ?? []), remove, move: async (id: string, destination: { parentId: string }) => {
    const value = node(id)!; const oldParent = node(value.parentId!)!;
    oldParent.children = oldParent.children!.filter(child => child.id !== id);
    value.parentId = destination.parentId; node(destination.parentId)!.children!.push(value); operations.push(`move:${id}`); return structuredClone(value);
  } };
  Object.assign(globalThis, { chrome: { permissions: { contains: async () => true }, bookmarks: api } });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(null, { status: 404 })) as typeof fetch;
  await db.links.add({ id: 'archive-link', url: 'https://example.com/ref?part=1#section', title: 'Reference', domain: 'example.com', firstCollectedAt: 1, lastCollectedAt: 2, tags: ['keep'], notes: 'Keep archive data' });
  await db.bookmarks.add({ id: 'archive-bookmark', collectorId: settings.collectorId, sourceBookmarkId: 'duplicate', linkId: 'archive-link', folderPath: ['Work Links'], current: true });
  const plan = { duplicateIds: ['duplicate'], deadIds: ['gone'], emptyFolderIds: ['empty-parent', 'empty-child'], merges: [{ sourceId: 'work-links', targetId: 'work' }] };
  // Changes made after scanning are rejected before creating a backup or mutating Chrome.
  node('keep')!.title = 'Changed';
  await assert.rejects(applyBookmarkCleanup(tree, plan), /changed after scanning/);
  assert.equal(operations.length, 0); assert.equal(await db.bookmarkCleanups.count(), 0);
  current = structuredClone(tree);
  const result = await applyBookmarkCleanup(tree, plan);
  assert.equal(result.state, 'complete'); assert.equal(result.completed, 6);
  assert.ok(node('keep')); assert.equal(node('distinct')?.parentId, 'work');
  assert.equal(node('duplicate'), undefined); assert.equal(node('gone'), undefined); assert.equal(node('empty-parent'), undefined); assert.equal(node('work-links'), undefined);
  assert.ok(operations.indexOf('remove:empty-child') < operations.indexOf('remove:empty-parent'));
  assert.ok(node('managed-link'));
  const storedBackup = await db.bookmarkCleanups.get(result.id);
  assert.deepEqual(storedBackup?.tree, tree);
  assert.equal((await db.bookmarks.get('archive-bookmark'))?.current, false);
  assert.equal((await db.links.get('archive-link'))?.notes, 'Keep archive data');
  // Similar folders may live in different branches; the destination remains intact.
  current = structuredClone(tree); operations.length = 0;
  const crossBranch = await applyBookmarkCleanup(tree, { ...blankPlan, merges: [{ sourceId: 'work', targetId: 'empty-child' }] });
  assert.equal(crossBranch.state, 'complete'); assert.equal(node('keep')?.parentId, 'empty-child'); assert.equal(node('work'), undefined);
  // Several source folders can share one destination in a single reviewed run.
  const multipleSources = structuredClone(tree);
  multipleSources[0].children![0].children!.push({ id: 'extra', parentId: '1', title: 'Work Resources', children: [{ id: 'extra-link', parentId: 'extra', title: 'Extra', url: 'https://example.com/extra' }] });
  current = structuredClone(multipleSources); operations.length = 0;
  const combined = await applyBookmarkCleanup(multipleSources, { ...blankPlan, merges: [{ sourceId: 'work-links', targetId: 'work' }, { sourceId: 'extra', targetId: 'work' }] });
  assert.equal(combined.state, 'complete'); assert.equal(node('extra-link')?.parentId, 'work'); assert.equal(node('distinct')?.parentId, 'work'); assert.equal(node('extra'), undefined);
  // A partial Chrome failure remains explicit and keeps the original backup.
  current = structuredClone(tree); operations.length = 0;
  api.move = async () => { throw Error('move failed'); };
  const partial = await applyBookmarkCleanup(tree, { ...blankPlan, duplicateIds: ['duplicate'], merges: [{ sourceId: 'work-links', targetId: 'work' }] });
  assert.equal(partial.state, 'partial'); assert.equal(partial.completed, 1); assert.match(partial.error!, /move failed/);
  assert.ok(node('work-links')); assert.ok(node('distinct'));
  assert.deepEqual((await db.bookmarkCleanups.get(partial.id))?.tree, tree);
  // A newly authenticated/not-found candidate is not removed if its status changes.
  current = structuredClone(tree); operations.length = 0;
  globalThis.fetch = (async () => new Response(null, { status: 403 })) as typeof fetch;
  await assert.rejects(applyBookmarkCleanup(tree, { ...blankPlan, deadIds: ['gone'] }), /could not be confirmed/);
  assert.equal(operations.length, 0);
  globalThis.fetch = originalFetch;
  const fullDeletion = await previewDeletion({ kind: 'all' }); await applyDeletion(fullDeletion);
  assert.equal(await db.bookmarkCleanups.count(), 0, 'full archive deletion clears sensitive cleanup backups');
  await db.delete();
});

test('dead-link checks distinguish gone pages from authentication, redirects, and network errors', async () => {
  const statuses = (head: number, get = head) => (async (_url: string, options: RequestInit) => {
    assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'manual'); assert.equal(options.referrerPolicy, 'no-referrer');
    return new Response(null, { status: options.method === 'HEAD' ? head : get });
  }) as typeof fetch;
  assert.equal((await checkBookmarkUrl('https://example.com', statuses(404))).state, 'dead');
  assert.equal((await checkBookmarkUrl('https://example.com', statuses(410))).state, 'dead');
  assert.equal((await checkBookmarkUrl('https://example.com', statuses(404, 200))).state, 'alive', 'HEAD-only failures do not cause deletion');
  assert.equal((await checkBookmarkUrl('https://example.com', statuses(405, 200))).state, 'alive');
  for (const status of [401, 403, 429, 500, 503]) assert.equal((await checkBookmarkUrl('https://example.com', statuses(status))).state, 'uncertain');
  assert.equal((await checkBookmarkUrl('https://example.com', statuses(302))).state, 'redirected');
  assert.equal((await checkBookmarkUrl('https://example.com', (async () => { throw Error('offline'); }) as typeof fetch)).state, 'uncertain');
  assert.equal((await checkBookmarkUrl('javascript:alert(1)', statuses(200))).state, 'uncertain');
  assert.equal((await checkBookmarkUrl('https://user:password@example.com', statuses(200))).state, 'uncertain');
});

test('dashboard counts agree with source-aware drilldowns and distinguish unchecked URLs', async () => {
  await db.open();
  const tree: BookmarkNode[] = [{ id: 'root', title: '', children: [{ id: 'bar', title: 'Bar', parentId: 'root', children: [
    { id: 'folder', parentId: 'bar', title: 'Work', children: [{ id: 'a', parentId: 'folder', title: 'A', url: 'https://example.com/a', dateAdded: 10 }, { id: 'copy', parentId: 'folder', title: 'A copy', url: 'https://example.com/a', dateAdded: 20 }] },
    { id: 'empty', parentId: 'bar', title: 'Empty', children: [] },
    { id: 'other', parentId: 'bar', title: 'Other', children: [{ id: 'b', parentId: 'other', title: 'B', url: 'https://other.example/b', dateAdded: 30 }, { id: 'c', parentId: 'other', title: 'C', url: 'https://unchecked.example/c', dateAdded: 1 }] },
  ] }] }];
  const health = [{ url: 'https://example.com/a', state: 'dead' as const, status: 404, checkedAt: 40, reason: 'Not found' }, { url: 'https://other.example/b', state: 'alive' as const, status: 200, checkedAt: 40, reason: 'OK' }];
  const chromeCounts = bookmarkOverview(tree, 15, health);
  assert.equal(chromeCounts.bookmarks, 4); assert.equal(chromeCounts.folders, 3); assert.equal(chromeCounts.duplicateGroups, 1); assert.equal(chromeCounts.extraCopies, 1); assert.equal(chromeCounts.emptyFolders, 1); assert.equal(chromeCounts.added, 2);
  assert.equal(chromeCounts.deadBookmarks, 2, 'dead bookmark count includes each bookmarked copy');
  assert.equal(chromeCounts.deadUrls, 1); assert.equal(chromeCounts.checkedUrls, 2); assert.equal(chromeCounts.uncheckedUrls, 1);
  await db.links.bulkAdd([{ id: 'a', url: 'https://example.com/a', title: 'A', domain: 'example.com', firstCollectedAt: 20, lastCollectedAt: 30, tags: [], notes: '' }, { id: 'b', url: 'https://other.example/b', title: 'B', domain: 'other.example', firstCollectedAt: 1, lastCollectedAt: 30, tags: [], notes: '' }]);
  await db.visits.bulkAdd([
    { id: 'v1', linkId: 'a', collectorId: 'c', sourceVisitId: 'v1', visitedAt: 5, origin: 'local', knownDeviceId: 'local:c', collectedAt: 20 },
    { id: 'v2', linkId: 'a', collectorId: 'c', sourceVisitId: 'v2', visitedAt: 20, origin: 'local', knownDeviceId: 'local:c', collectedAt: 21 },
    { id: 'v3', linkId: 'a', collectorId: 'c', sourceVisitId: 'v3', visitedAt: 22, origin: 'unknown' },
    { id: 'v4', linkId: 'b', collectorId: 'c', sourceVisitId: 'v4', visitedAt: 29, origin: 'synced', collectedAt: 10 },
  ]);
  await db.linkHealth.bulkPut(health);
  const stats = await archiveOverview(15);
  assert.equal(stats.visits, 4); assert.equal(stats.pages, 2); assert.equal(stats.websites, 2); assert.equal(stats.repeatedPages, 1); assert.equal(stats.repeatVisits, 2); assert.equal(stats.local, 2); assert.equal(stats.synced, 1); assert.equal(stats.unknown, 1); assert.equal(stats.recentVisits, 3); assert.equal(stats.newVisits, 2); assert.equal(stats.historyDead, 1); assert.equal(stats.historyChecked, 2); assert.equal(stats.recent.length, 1);
  assert.equal((await searchArchive({ ...defaultSearch, source: 'history', repeatedOnly: true })).total, stats.repeatedPages);
  assert.equal((await searchArchive({ ...defaultSearch, source: 'history', deadOnly: true })).total, stats.historyDead);
  assert.equal((await searchArchive({ ...defaultSearch, source: 'history', addedSince: 15 })).rows[0].summary.visits, stats.newVisits);
  assert.equal((await searchArchive({ ...defaultSearch, source: 'history', from: 15 })).rows.reduce((total, row) => total + row.summary.visits, 0), stats.recentVisits);
  assert.equal((await searchArchive({ ...defaultSearch, source: 'history', device: 'unknown' })).rows[0].summary.visits, stats.unknown);
  assert.equal((await searchArchive({ ...defaultSearch, source: 'history', device: 'local-origin' })).rows[0].summary.visits, stats.local);
  assert.equal((await searchArchive({ ...defaultSearch, source: 'history', domain: 'other.example' })).total, 1);
  const deletion = await previewDeletion({ kind: 'all' }); await applyDeletion(deletion);
  assert.equal(await db.linkHealth.count(), 0);
  await db.delete();
});

test('redacted phone tabs are diagnosed and become collectable after tabs permission is granted', async () => {
  await db.open(); await initializeSettings();
  await db.settings.update('local', { onboardingCompleted: true, paused: false, enabledSources: ['history', 'sessions'] });
  let tabAccess = false; const calls: string[] = [];
  Object.assign(globalThis, { chrome: {
    permissions: { contains: async ({ permissions }: { permissions: string[] }) => !permissions.includes('tabs') || tabAccess },
    sessions: { getDevices: async () => { calls.push('sessions'); return [{ deviceName: 'iPhone', sessions: [{ lastModified: 100, window: { sessionId: 'window', tabs: [tabAccess ? { sessionId: 'tab', url: 'https://example.com/phone', title: 'Phone page' } : { sessionId: 'tab' }] } }] }]; } },
    history: { search: async () => { calls.push('history'); return []; } },
  } });
  assert.deepEqual(sourcePermissions(['sessions']), ['sessions', 'tabs']);
  assert.deepEqual(sourcePermissions(['history']), ['history']);
  await collectArchive();
  assert.deepEqual(calls, ['sessions', 'history'], 'phone snapshots run before lengthy history imports');
  assert.equal(await db.observations.count(), 0);
  const failed = (await db.runs.where('source').equals('sessions').toArray())[0];
  assert.equal(failed.outcome, 'error'); assert.match(failed.error!, /without readable URLs/);
  assert.equal(failed.sessionCoverage?.tabsReturned, 1); assert.equal(failed.sessionCoverage?.missingUrl, 1); assert.equal(failed.sessionCoverage?.tabsPermission, false);
  tabAccess = true; await collectArchive();
  assert.equal(await db.observations.count(), 1);
  assert.equal((await searchArchive({ ...defaultSearch, source: 'sessions' })).total, 1);
  assert.equal(await db.visits.count(), 0, 'phone tabs never become history visits');
  const fixed = (await db.runs.where('source').equals('sessions').sortBy('startedAt')).at(-1)!;
  assert.equal(fixed.outcome, 'success'); assert.equal(fixed.sessionCoverage?.archived, 1); assert.equal(fixed.sessionCoverage?.missingUrl, 0);
  await collectArchive(); assert.equal(await db.observations.count(), 1);
  await db.delete();
});
