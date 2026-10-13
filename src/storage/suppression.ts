import { db } from './db';
import type { Source } from '../domain/models';

export async function suppressionKey(source: Source, key: string) {
  if (source !== 'sessions') return key;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  return `sha256:${Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('')}`;
}
export async function isSuppressed(source: Source, key: string, storedKey = key) {
  return Boolean(await db.suppressions.where('[source+sourceKey]').equals([source, storedKey]).first() || storedKey !== key && await db.suppressions.where('[source+sourceKey]').equals([source, key]).first());
}
