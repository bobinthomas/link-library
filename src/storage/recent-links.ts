import { db } from './db';

export async function loadRecentLinks() {
  return db.transaction('r', db.links, db.bookmarks, db.visits, db.observations, db.devices, async () => {
    const links = await db.links.orderBy('lastCollectedAt').reverse().limit(100).toArray();
    const rows = await Promise.all(links.map(async link => ({
      ...link,
      bookmarks: await db.bookmarks.where('linkId').equals(link.id).toArray(),
      visits: await db.visits.where('linkId').equals(link.id).toArray(),
      observations: await db.observations.where('linkId').equals(link.id).toArray(),
    })));
    return { rows, devices: await db.devices.toArray() };
  });
}
