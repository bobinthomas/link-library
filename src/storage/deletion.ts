import { db } from './db';
import { suppressionKey } from './suppression';
import type { Bookmark, Link, Source, TabObservation, Visit } from '../domain/models';

export type DeletionRequest = { kind: 'links'; ids: string[] } | { kind: 'all' } | { kind: 'range'; source: 'all' | Source; from: number; to: number };
export interface DeletionPreview {
  request: DeletionRequest;
  links: Link[];
  visits: Visit[];
  bookmarks: Bookmark[];
  observations: TabObservation[];
}
const sourceTables = () => [db.links, db.visits, db.bookmarks, db.observations];
export async function previewDeletion(request: DeletionRequest): Promise<DeletionPreview> {
  if (request.kind === 'range' && (!Number.isFinite(request.from) || !Number.isFinite(request.to) || request.from < 0 || request.from > request.to)) throw new Error('Choose a valid start and end date.');
  return db.transaction('r', sourceTables(), async () => {
    if (request.kind === 'all') return { request, links: await db.links.toArray(), visits: await db.visits.toArray(), bookmarks: await db.bookmarks.toArray(), observations: await db.observations.toArray() };
    if (request.kind === 'links') {
      const ids = [...new Set(request.ids)];
      return { request, links: (await db.links.bulkGet(ids)).filter(value => value !== undefined), visits: await db.visits.where('linkId').anyOf(ids).toArray(), bookmarks: await db.bookmarks.where('linkId').anyOf(ids).toArray(), observations: await db.observations.where('linkId').anyOf(ids).toArray() };
    }
    const visits = request.source === 'all' || request.source === 'history' ? await db.visits.where('visitedAt').between(request.from, request.to, true, true).toArray() : [];
    const bookmarks = request.source === 'all' || request.source === 'bookmarks' ? await db.bookmarks.where('savedAt').between(request.from, request.to, true, true).toArray() : [];
    const observations = request.source === 'all' || request.source === 'sessions' ? await db.observations.where('observedAt').between(request.from, request.to, true, true).toArray() : [];
    const ids = [...new Set([...visits, ...bookmarks, ...observations].map(record => record.linkId))];
    return { request, links: (await db.links.bulkGet(ids)).filter(value => value !== undefined), visits, bookmarks, observations };
  });
}
export async function applyDeletion(preview: DeletionPreview) {
  // Hash snapshot identifiers before entering the IndexedDB transaction; they can contain URLs.
  const markers = [
    ...preview.visits.map(record => ({ source: 'history' as const, key: `${record.collectorId}:${record.sourceVisitId}` })),
    ...preview.bookmarks.map(record => ({ source: 'bookmarks' as const, key: `${record.collectorId}:${record.sourceBookmarkId}` })),
    ...preview.observations.map(record => ({ source: 'sessions' as const, key: record.id })),
  ];
  const suppressions = await Promise.all(markers.map(async marker => {
    const sourceKey = await suppressionKey(marker.source, marker.key);
    return { id: JSON.stringify([marker.source, sourceKey]), source: marker.source, sourceKey };
  }));
  return db.transaction('rw', [...sourceTables(), db.suppressions, db.collections, db.devices, db.runs, db.settings, db.bookmarkCleanups, db.linkHealth], async () => {
    const stale = () => { throw new Error('Archive records changed after preview. Review the deletion again. No data was deleted.'); };
    // Validate the concrete preview, including edits made while the confirmation is open.
    for (const [table, records] of [[db.links, preview.links], [db.visits, preview.visits], [db.bookmarks, preview.bookmarks], [db.observations, preview.observations]] as const) {
      for (const record of records) if (JSON.stringify(await table.get(record.id)) !== JSON.stringify(record)) stale();
      if (preview.request.kind === 'all' && await table.count() !== records.length) stale();
    }
    const ids = preview.links.map(link => link.id);
    if (preview.request.kind === 'links') {
      if (await db.visits.where('linkId').anyOf(ids).count() !== preview.visits.length || await db.bookmarks.where('linkId').anyOf(ids).count() !== preview.bookmarks.length || await db.observations.where('linkId').anyOf(ids).count() !== preview.observations.length) stale();
    }
    for (const marker of suppressions) {
      if (!await db.suppressions.where('[source+sourceKey]').equals([marker.source, marker.sourceKey]).first()) await db.suppressions.add(marker);
    }
    await db.visits.bulkDelete(preview.visits.map(record => record.id));
    await db.bookmarks.bulkDelete(preview.bookmarks.map(record => record.id));
    await db.observations.bulkDelete(preview.observations.map(record => record.id));
    const removed: string[] = [];
    for (const id of ids) {
      if (preview.request.kind !== 'range' || !await db.visits.where('linkId').equals(id).count() && !await db.bookmarks.where('linkId').equals(id).count() && !await db.observations.where('linkId').equals(id).count()) {
        await db.links.delete(id); removed.push(id);
        const original = preview.links.find(link => link.id === id); if (original) await db.linkHealth.delete(original.url);
      }
    }
    const removedIds = new Set(removed);
    if (preview.request.kind === 'all') {
      await db.collections.clear(); await db.devices.clear(); await db.runs.clear();
      await db.bookmarkCleanups.clear();
      await db.linkHealth.clear();
      await db.settings.update('local', { paused: true });
    } else await db.collections.toCollection().modify(collection => { collection.linkIds = collection.linkIds.filter(id => !removedIds.has(id)); });
    return { removedLinks: removed.length, removedRecords: markers.length };
  });
}
export async function allowDeletedRecordsAgain() {
  await db.suppressions.clear();
}
