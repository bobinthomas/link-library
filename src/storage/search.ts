import { db } from './db';
import type { Source } from '../domain/models';

export interface SearchOptions {
  query: string;
  source: 'all' | Source;
  device: string;
  domain: string;
  from?: number;
  to?: number;
  bookmark: 'all' | 'saved' | 'not-saved';
  sort: 'recent' | 'title' | 'visits';
  page: number;
  pageSize: number;
  collection?: string;
  addedSince?: number;
  repeatedOnly?: boolean;
  deadOnly?: boolean;
}
interface Summary {
  bookmarks: number;
  visits: number;
  observations: number;
  savedAt?: number;
  visitedAt?: number;
  observedAt?: number;
}
export const defaultSearch: SearchOptions = { query: '', source: 'all', device: 'all', domain: '', bookmark: 'all', sort: 'recent', page: 0, pageSize: 30 };
export function dateBounds(from: string, to: string) {
  return { from: from ? new Date(`${from}T00:00:00`).getTime() : undefined, to: to ? new Date(`${to}T23:59:59.999`).getTime() : undefined };
}

export async function searchArchive(options: SearchOptions) {
  if (options.from !== undefined && options.to !== undefined && options.from > options.to) return { total: 0, page: 0, rows: [] };
  return db.transaction('r', [db.links, db.bookmarks, db.visits, db.observations, db.collections, db.linkHealth], async () => {
    const deadUrls = options.deadOnly ? new Set((await db.linkHealth.where('state').equals('dead').toArray()).map(result => result.url)) : undefined;
    const collectionIds = options.collection ? new Set((await db.collections.get(options.collection))?.linkIds ?? []) : undefined;
    const matched = new Set<string>();
    const bookmarked = new Set<string>();
    const summary = new Map<string, Summary>();
    const info = (id: string) => {
      let value = summary.get(id);
      if (!value) { value = { bookmarks: 0, visits: 0, observations: 0 }; summary.set(id, value); }
      return value;
    };
    const within = (time?: number) => options.from === undefined && options.to === undefined || time !== undefined && time >= (options.from ?? 0) && time <= (options.to ?? Infinity);
    const sourceMatches = (source: Source) => options.source === 'all' || options.source === source;
    await db.bookmarks.toCollection().each(record => {
      if (record.current) bookmarked.add(record.linkId);
      if (options.device !== 'all' || !within(record.savedAt)) return;
      if (options.addedSince !== undefined && (record.collectedAt === undefined || record.collectedAt < options.addedSince)) return;
      const value = info(record.linkId); value.bookmarks++;
      if (record.savedAt !== undefined) value.savedAt = Math.max(value.savedAt ?? 0, record.savedAt);
      if (sourceMatches('bookmarks')) matched.add(record.linkId);
    });
    const visits = options.from !== undefined || options.to !== undefined ? db.visits.where('visitedAt').between(options.from ?? 0, options.to ?? Infinity, true, true) : db.visits.toCollection();
    await visits.each(record => {
      if (options.device !== 'all' && !(options.device === 'synced' ? record.origin === 'synced' : options.device === 'unknown' ? record.origin === 'unknown' : options.device === 'local-origin' ? record.origin === 'local' : record.knownDeviceId === options.device)) return;
      if (options.addedSince !== undefined && (record.collectedAt === undefined || record.collectedAt < options.addedSince)) return;
      const value = info(record.linkId); value.visits++; value.visitedAt = Math.max(value.visitedAt ?? 0, record.visitedAt);
      if (sourceMatches('history')) matched.add(record.linkId);
    });
    const observations = options.from !== undefined || options.to !== undefined ? db.observations.where('observedAt').between(options.from ?? 0, options.to ?? Infinity, true, true) : db.observations.toCollection();
    await observations.each(record => {
      if (options.device !== 'all' && record.deviceId !== options.device) return;
      const value = info(record.linkId); value.observations++; value.observedAt = Math.max(value.observedAt ?? 0, record.observedAt);
      if (sourceMatches('sessions')) matched.add(record.linkId);
    });
    const requireSource = options.source !== 'all' || options.device !== 'all' || options.from !== undefined || options.to !== undefined || options.addedSince !== undefined;
    const needle = options.query.trim().toLowerCase();
    const base = options.domain ? db.links.where('domain').equals(options.domain.toLowerCase()) : options.sort === 'title' ? db.links.orderBy('title') : db.links.orderBy('lastCollectedAt').reverse();
    const filtered = base.filter(link =>
      (!collectionIds || collectionIds.has(link.id)) &&
      (!deadUrls || deadUrls.has(link.url)) &&
      (!options.repeatedOnly || (summary.get(link.id)?.visits ?? 0) > 1) &&
      (!requireSource || matched.has(link.id)) &&
      (options.bookmark === 'all' || bookmarked.has(link.id) === (options.bookmark === 'saved')) &&
      (!needle || [link.title, link.url, link.domain, ...link.tags].some(value => value.toLowerCase().includes(needle)))
    );
    const total = await filtered.count();
    const page = Math.min(Math.max(0, options.page), Math.max(0, Math.ceil(total / options.pageSize) - 1));
    let links;
    if (options.sort === 'visits' || options.domain) {
      // Keep only sort metadata in memory, not full URLs/titles/notes/source records.
      const order: { id: string; rank: number; recent: number; title?: string }[] = [];
      await filtered.each(link => { order.push({ id: link.id, rank: summary.get(link.id)?.visits ?? 0, recent: link.lastCollectedAt, title: options.sort === 'title' ? link.title : undefined }); });
      order.sort((a, b) => options.sort === 'title' ? (a.title ?? '').localeCompare(b.title ?? '') || a.id.localeCompare(b.id) : (options.sort === 'visits' ? b.rank - a.rank : 0) || b.recent - a.recent || a.id.localeCompare(b.id));
      links = (await db.links.bulkGet(order.slice(page * options.pageSize, (page + 1) * options.pageSize).map(value => value.id))).filter(value => value !== undefined);
    } else links = await filtered.offset(page * options.pageSize).limit(options.pageSize).toArray();
    return { total, page, rows: links.map(link => ({ ...link, summary: summary.get(link.id) ?? { bookmarks: 0, visits: 0, observations: 0 } })) };
  });
}

export async function loadLinkDetails(id: string, visitPage: number, observationPage: number) {
  return db.transaction('r', [db.links, db.bookmarks, db.visits, db.observations, db.devices, db.settings], async () => {
    const link = await db.links.get(id);
    if (!link) return undefined;
    const visits = db.visits.where('linkId').equals(id);
    const observations = db.observations.where('linkId').equals(id);
    const visitIds: { id: string; time: number }[] = [];
    const observationIds: { id: string; time: number }[] = [];
    await visits.each(record => { visitIds.push({ id: record.id, time: record.visitedAt }); });
    await observations.each(record => { observationIds.push({ id: record.id, time: record.observedAt }); });
    visitIds.sort((a, b) => b.time - a.time); observationIds.sort((a, b) => b.time - a.time);
    return {
      link, settings: await db.settings.get('local'), bookmarks: await db.bookmarks.where('linkId').equals(id).toArray(), devices: await db.devices.toArray(),
      visitCount: visitIds.length, observationCount: observationIds.length,
      visits: (await db.visits.bulkGet(visitIds.slice(visitPage * 25, (visitPage + 1) * 25).map(value => value.id))).filter(value => value !== undefined),
      observations: (await db.observations.bulkGet(observationIds.slice(observationPage * 25, (observationPage + 1) * 25).map(value => value.id))).filter(value => value !== undefined),
    };
  });
}
