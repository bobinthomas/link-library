import { db } from './db';

export async function createCollection(name: string) {
  const label = name.trim();
  if (!label || label.length > 100) throw new Error('Use a collection name between 1 and 100 characters.');
  return db.transaction('rw', db.collections, async () => {
    if (await db.collections.filter(value => value.name.toLowerCase() === label.toLowerCase()).first()) throw new Error('A collection with this name already exists.');
    const id = crypto.randomUUID();
    await db.collections.add({ id, name: label, linkIds: [] });
    return id;
  });
}
export async function saveOrganization(id: string, tagsText: string, notes: string, collectionIds: string[]) {
  const tags = [...new Set(tagsText.split(',').map(value => value.trim()).filter(Boolean))];
  if (tags.length > 50 || tags.some(tag => tag.length > 100) || notes.length > 20_000) throw new Error('Use up to 50 tags of 100 characters and notes of up to 20,000 characters.');
  await db.transaction('rw', db.links, db.collections, async () => {
    if (!await db.links.get(id)) throw new Error('This link no longer exists.');
    await db.links.update(id, { tags, notes });
    await db.collections.toCollection().modify(collection => {
      collection.linkIds = collectionIds.includes(collection.id) ? [...new Set([...collection.linkIds, id])] : collection.linkIds.filter(linkId => linkId !== id);
    });
  });
}
