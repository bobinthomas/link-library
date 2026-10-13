import { db } from './db';
import type { Bookmark, Collection, Device, Link, Suppression, TabObservation, Visit } from '../domain/models';

export interface ArchiveFile {
  format: 'link-library'; version: 1; exportedAt: number;
  links: Link[]; visits: Visit[]; bookmarks: Bookmark[]; devices: Device[];
  observations: TabObservation[]; collections: Collection[]; suppressions: Suppression[];
}
const tables = () => [db.links, db.visits, db.bookmarks, db.devices, db.observations, db.collections, db.suppressions];
export async function exportArchive(): Promise<ArchiveFile> {
  return db.transaction('r', tables(), async () => ({
    format: 'link-library', version: 1, exportedAt: Date.now(),
    links: await db.links.toArray(), visits: await db.visits.toArray(), bookmarks: await db.bookmarks.toArray(),
    devices: await db.devices.toArray(), observations: await db.observations.toArray(),
    collections: await db.collections.toArray(), suppressions: await db.suppressions.toArray(),
  }));
}
type Validator = (value: unknown) => unknown;
const fail = (): never => { throw new Error('Invalid archive: malformed fields or references. No records were imported.'); };
const text = (max = 20_000): Validator => value => typeof value === 'string' && value.length <= max ? value : fail();
const identifier: Validator = value => typeof value === 'string' && value.length > 0 && value.length <= 20_000 ? value : fail();
const time: Validator = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 8.64e15 ? value : fail();
const bool: Validator = value => typeof value === 'boolean' ? value : fail();
const optional = (validate: Validator): Validator => value => value === undefined ? undefined : validate(value);
const oneOf = (...values: string[]): Validator => value => values.includes(value as string) ? value : fail();
const list = (validate: Validator, max = 500_000): Validator => value => Array.isArray(value) && value.length <= max ? value.map(validate) : fail();
const object = (schema: Record<string, Validator>): Validator => value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  const record = value as Record<string, unknown>;
  return Object.fromEntries(Object.entries(schema).map(([key, validate]) => [key, validate(record[key])]));
};
const source = oneOf('bookmarks', 'history', 'sessions');
const schema = object({
  format: oneOf('link-library'), version: value => value === 1 ? 1 : fail(), exportedAt: time,
  links: list(object({ id: identifier, url: identifier, title: text(), domain: text(), firstCollectedAt: time, lastCollectedAt: time, tags: list(text(100), 50), notes: text() })),
  visits: list(object({ id: identifier, linkId: identifier, collectorId: identifier, sourceVisitId: identifier, visitedAt: time, origin: oneOf('local', 'synced', 'unknown'), knownDeviceId: optional(identifier), collectedAt: optional(time) })),
  bookmarks: list(object({ id: identifier, linkId: identifier, collectorId: identifier, sourceBookmarkId: identifier, folderPath: list(text(), 100), savedAt: optional(time), lastUsedAt: optional(time), current: bool, collectedAt: optional(time) })),
  devices: list(object({ id: identifier, collectorId: identifier, sourceName: text(), alias: optional(text(100)), firstObservedAt: time, lastObservedAt: time })),
  observations: list(object({ id: identifier, linkId: identifier, deviceId: identifier, snapshotId: identifier, sessionRef: optional(identifier), windowRef: optional(identifier), tabRef: optional(identifier), sessionModifiedAt: optional(time), observedAt: time })),
  collections: list(object({ id: identifier, name: text(100), linkIds: list(identifier) })),
  suppressions: list(object({ id: identifier, source, sourceKey: identifier })),
});
export function validateArchive(value: unknown): ArchiveFile {
  const archive = schema(value) as ArchiveFile;
  for (const records of [archive.links, archive.visits, archive.bookmarks, archive.devices, archive.observations, archive.collections, archive.suppressions]) {
    if (new Set(records.map(record => record.id)).size !== records.length) fail();
  }
  const linkIds = new Set(archive.links.map(link => link.id));
  const deviceIds = new Set(archive.devices.map(device => device.id));
  if (new Set(archive.links.map(link => link.url)).size !== archive.links.length) fail();
  for (const link of archive.links) {
    let parsed: URL;
    try { parsed = new URL(link.url); } catch { return fail(); }
    if (!['https:', 'http:'].includes(parsed.protocol) || link.domain !== parsed.hostname || link.firstCollectedAt > link.lastCollectedAt) fail();
  }
  for (const record of [...archive.visits, ...archive.bookmarks, ...archive.observations]) if (!linkIds.has(record.linkId)) fail();
  for (const visit of archive.visits) if (visit.knownDeviceId !== undefined && (visit.origin !== 'local' || visit.knownDeviceId !== `local:${visit.collectorId}`)) fail();
  for (const record of archive.observations) if (!deviceIds.has(record.deviceId)) fail();
  for (const collection of archive.collections) if (!collection.name.trim() || collection.linkIds.some(id => !linkIds.has(id))) fail();
  for (const records of [archive.visits.map(record => JSON.stringify([record.collectorId, record.sourceVisitId])), archive.bookmarks.map(record => JSON.stringify([record.collectorId, record.sourceBookmarkId])), archive.suppressions.map(record => JSON.stringify([record.source, record.sourceKey]))]) if (new Set(records).size !== records.length) fail();
  return archive;
}
export async function importArchive(value: unknown) {
  const archive = validateArchive(value);
  return db.transaction('rw', tables(), async () => {
    const linkIds = new Map<string, string>();
    let addedLinks = 0;
    const conflict = () => { throw new Error('Archive identity conflicts with an existing source record. Import cancelled; no changes were saved.'); };
    for (const incoming of archive.links) {
      const existing = await db.links.where('url').equals(incoming.url).first();
      if (existing) {
        const tags = [...new Set([...existing.tags, ...incoming.tags])];
        if (tags.length > 50) throw new Error('Import would exceed the 50-tag limit for an existing link. No changes were saved.');
        linkIds.set(incoming.id, existing.id);
        await db.links.update(existing.id, { tags, notes: existing.notes || incoming.notes, firstCollectedAt: Math.min(existing.firstCollectedAt, incoming.firstCollectedAt), lastCollectedAt: Math.max(existing.lastCollectedAt, incoming.lastCollectedAt) });
      } else {
        const id = await db.links.get(incoming.id) ? crypto.randomUUID() : incoming.id;
        linkIds.set(incoming.id, id); await db.links.add({ ...incoming, id }); addedLinks++;
      }
    }
    for (const record of archive.devices) {
      const existing = await db.devices.get(record.id);
      if (existing && (existing.collectorId !== record.collectorId || existing.sourceName !== record.sourceName)) conflict();
      if (!existing) await db.devices.add(record);
    }
    for (const record of archive.visits) {
      const linkId = linkIds.get(record.linkId)!;
      const existing = await db.visits.where('[collectorId+sourceVisitId]').equals([record.collectorId, record.sourceVisitId]).first();
      if (existing && (existing.linkId !== linkId || existing.visitedAt !== record.visitedAt || existing.origin !== record.origin || existing.knownDeviceId !== record.knownDeviceId)) conflict();
      if (!existing) {
        if (await db.visits.get(record.id)) conflict();
        await db.visits.add({ ...record, linkId });
      }
    }
    for (const record of archive.bookmarks) {
      const existing = await db.bookmarks.where('[collectorId+sourceBookmarkId]').equals([record.collectorId, record.sourceBookmarkId]).first();
      if (!existing) {
        if (await db.bookmarks.get(record.id)) conflict();
        await db.bookmarks.add({ ...record, linkId: linkIds.get(record.linkId)! });
      }
    }
    for (const record of archive.observations) {
      const incoming = { ...record, linkId: linkIds.get(record.linkId)! };
      const existing = await db.observations.get(record.id);
      if (existing && (existing.linkId !== incoming.linkId || existing.deviceId !== incoming.deviceId || existing.snapshotId !== incoming.snapshotId || existing.observedAt !== incoming.observedAt || existing.sessionModifiedAt !== incoming.sessionModifiedAt || existing.sessionRef !== incoming.sessionRef || existing.tabRef !== incoming.tabRef || existing.windowRef !== incoming.windowRef)) conflict();
      if (!existing) await db.observations.add(incoming);
    }
    for (const record of archive.collections) {
      const existing = await db.collections.get(record.id);
      if (existing && existing.name !== record.name) conflict();
      await db.collections.put({ ...record, linkIds: [...new Set([...(existing?.linkIds ?? []), ...record.linkIds.map(id => linkIds.get(id)!)])] });
    }
    for (const record of archive.suppressions) {
      if (!await db.suppressions.where('[source+sourceKey]').equals([record.source, record.sourceKey]).first()) {
        if (await db.suppressions.get(record.id)) conflict();
        await db.suppressions.add(record);
      }
    }
    return { addedLinks, importedLinks: archive.links.length };
  });
}
export function csvCell(value: string) {
  // Spreadsheet applications must not interpret imported titles/notes as formulas.
  const safe = /^[\s]*[=+\-@]/.test(value) || /^[\t\r\n]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}
export async function exportCsv() {
  const links = await db.links.toArray();
  return [['Title', 'URL', 'Website', 'Tags', 'Notes'], ...links.map(link => [link.title, link.url, link.domain, link.tags.join(', '), link.notes])].map(row => row.map(csvCell).join(',')).join('\r\n');
}
