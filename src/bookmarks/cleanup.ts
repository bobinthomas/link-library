import { db } from '../storage/db';
import { analyzeBookmarks, flattenBookmarks, treeFingerprint, type BookmarkNode } from './analysis';
import { checkBookmarkUrl, originPermission } from './health';

export interface CleanupPlan { duplicateIds: string[]; deadIds: string[]; emptyFolderIds: string[]; merges: { sourceId: string; targetId: string }[] }
export interface CleanupBackup { id: string; createdAt: number; tree: BookmarkNode[]; plan: CleanupPlan; state: 'pending' | 'complete' | 'partial'; completed: number; error?: string }
export function validateCleanupPlan(tree: BookmarkNode[], plan: CleanupPlan) {
  const analysis = analyzeBookmarks(tree);
  const map = new Map(analysis.flat.map(item => [item.node.id, item]));
  const removals = [...new Set([...plan.duplicateIds, ...plan.deadIds])];
  for (const id of removals) if (!map.get(id)?.mutable || !map.get(id)?.node.url) throw new Error('Cannot remove a protected folder or bookmark.');
  for (const id of plan.duplicateIds) {
    const url = map.get(id)!.node.url;
    if (!analysis.flat.some(item => item.node.url === url && !removals.includes(item.node.id)) && !plan.deadIds.some(deadId => map.get(deadId)?.node.url === url)) throw new Error('Each duplicate group must keep at least one bookmark.');
  }
  const emptyIds = new Set(analysis.emptyFolders.map(item => item.node.id));
  for (const id of plan.emptyFolderIds) {
    if (!emptyIds.has(id)) throw new Error('Only empty, editable folders can be removed.');
    if (analysis.flat.some(child => child.ancestors.includes(id) && !plan.emptyFolderIds.includes(child.node.id))) throw new Error('Select empty child folders too before removing their parent.');
  }
  const used = new Set<string>();
  const sources = new Set<string>(); const targets = new Set<string>();
  for (const merge of plan.merges) {
    const source = map.get(merge.sourceId); const target = map.get(merge.targetId);
    if (!source || !target || !source.mutable || !target.mutable || source.node.url || target.node.url || source.ancestors.includes(target.node.id) || target.ancestors.includes(source.node.id) || source.node.id === target.node.id || sources.has(source.node.id) || targets.has(source.node.id) || sources.has(target.node.id) || plan.emptyFolderIds.includes(source.node.id) || plan.emptyFolderIds.includes(target.node.id)) throw new Error('Choose each source once, use editable folders that are not ancestors of each other, and do not also remove them as empty folders.');
    if (analysis.flat.some(child => (child.ancestors.includes(source.node.id) || child.ancestors.includes(target.node.id)) && !child.mutable)) throw new Error('This folder contains protected nodes.');
    if ([...used].some(id => source.ancestors.includes(id) || target.ancestors.includes(id) || map.get(id)!.ancestors.includes(source.node.id) || map.get(id)!.ancestors.includes(target.node.id))) throw new Error('Apply parent and nested folder merges in separate cleanup runs.');
    used.add(source.node.id); used.add(target.node.id);
    sources.add(source.node.id); targets.add(target.node.id);
  }
  return { analysis, removals };
}
export async function applyBookmarkCleanup(tree: BookmarkNode[], plan: CleanupPlan) {
  if (!await chrome.permissions.contains({ permissions: ['bookmarks'] })) throw new Error('Bookmark permission unavailable.');
  const { analysis, removals } = validateCleanupPlan(tree, plan);
  if (treeFingerprint(await chrome.bookmarks.getTree()) !== treeFingerprint(tree)) throw new Error('Bookmarks changed after scanning. Scan again before applying cleanup.');
  // Recheck dead-link candidates before any write. A temporary outage never qualifies.
  const deadUrls = [...new Set(plan.deadIds.map(id => analysis.flat.find(item => item.node.id === id)!.node.url!))];
  for (const url of deadUrls) {
    if (!await chrome.permissions.contains({ origins: [originPermission(url)] })) throw new Error('A selected dead link could not be confirmed. Check links again before applying cleanup.');
    const health = await checkBookmarkUrl(url); await db.linkHealth.put(health);
    if (health.state !== 'dead') throw new Error('A selected dead link could not be confirmed. Check links again before applying cleanup.');
  }
  if (treeFingerprint(await chrome.bookmarks.getTree()) !== treeFingerprint(tree)) throw new Error('Bookmarks changed during link checking. Scan again.');
  const backup: CleanupBackup = { id: crypto.randomUUID(), createdAt: Date.now(), tree, plan, state: 'pending', completed: 0 };
  await db.bookmarkCleanups.add(backup);
  const done = async () => { backup.completed++; await db.bookmarkCleanups.put(backup); };
  async function currentNode(id: string) {
    const node = (await chrome.bookmarks.get(id))[0];
    const original = analysis.flat.find(item => item.node.id === id)!.node;
    if (!node || node.unmodifiable || node.folderType || node.url !== original.url || node.title !== original.title || node.parentId !== original.parentId) throw new Error('A bookmark changed during cleanup. Remaining operations were stopped.');
    return node;
  }
  try {
    for (const id of removals) {
      if (plan.duplicateIds.includes(id)) {
        const url = analysis.flat.find(item => item.node.id === id)!.node.url;
        if (!plan.deadIds.some(deadId => analysis.flat.find(item => item.node.id === deadId)?.node.url === url)) {
          let retained = false;
          for (const keeper of analysis.flat.filter(item => item.node.url === url && !removals.includes(item.node.id))) {
            try { if ((await chrome.bookmarks.get(keeper.node.id))[0]?.url === url) retained = true; } catch { /* A missing keeper invalidates this duplicate deletion. */ }
          }
          if (!retained) throw new Error('The retained duplicate bookmark disappeared. Remaining operations were stopped.');
        }
      }
      await currentNode(id); await chrome.bookmarks.remove(id); await done();
    }
    const empty = plan.emptyFolderIds.map(id => analysis.flat.find(item => item.node.id === id)!).sort((a, b) => b.depth - a.depth);
    for (const item of empty) {
      await currentNode(item.node.id);
      if ((await chrome.bookmarks.getChildren(item.node.id)).length) throw new Error('An empty folder gained children; it was kept. Scan again.');
      await chrome.bookmarks.remove(item.node.id); await done();
    }
    for (const merge of plan.merges) {
      await currentNode(merge.sourceId); await currentNode(merge.targetId);
      const children = await chrome.bookmarks.getChildren(merge.sourceId);
      const expected = new Set((analysis.flat.find(item => item.node.id === merge.sourceId)!.node.children ?? []).filter(node => !removals.includes(node.id) && !plan.emptyFolderIds.includes(node.id)).map(node => node.id));
      if (children.length !== expected.size || children.some(child => !expected.has(child.id) || child.unmodifiable || child.folderType)) throw new Error('Folder contents changed during cleanup. Remaining operations were stopped.');
      for (const child of children) { await chrome.bookmarks.move(child.id, { parentId: merge.targetId }); await done(); }
      if ((await chrome.bookmarks.getChildren(merge.sourceId)).length) throw new Error('The source folder is no longer empty; it was kept.');
      await chrome.bookmarks.remove(merge.sourceId); await done();
    }
    backup.state = 'complete'; await db.bookmarkCleanups.put(backup);
  } catch (error) {
    backup.state = 'partial'; backup.error = error instanceof Error ? error.message : 'Chrome cleanup failed.';
    await db.bookmarkCleanups.put(backup);
  }
  // Reconcile existing archive source state without collecting new records or bypassing pause/exclusions.
  try { await reconcileBookmarkArchive(await chrome.bookmarks.getTree()); }
  catch { backup.error = `${backup.error ?? ''} Archive source reconciliation failed; Refresh to retry.`; await db.bookmarkCleanups.put(backup); }
  return backup;
}
export async function reconcileBookmarkArchive(tree: BookmarkNode[]) {
  const map = new Map<string, { url: string; folderPath: string[] }>();
  function walk(nodes: BookmarkNode[], path: string[]) { for (const node of nodes) { if (node.url) map.set(node.id, { url: node.url, folderPath: path }); else if (node.children) walk(node.children, node.title ? [...path, node.title] : path); } }
  walk(tree, []);
  await db.transaction('rw', db.bookmarks, db.links, db.settings, async () => {
    const settings = await db.settings.get('local'); if (!settings) return;
    const bookmarks = await db.bookmarks.filter(record => record.collectorId === settings.collectorId).toArray();
    for (const bookmark of bookmarks) {
      const node = map.get(bookmark.sourceBookmarkId); const link = await db.links.get(bookmark.linkId);
      const current = Boolean(node && node.url === link?.url);
      await db.bookmarks.update(bookmark.id, { current, ...(current ? { folderPath: node!.folderPath } : {}) });
    }
  });
}
const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
export function bookmarkBackupHtml(tree: BookmarkNode[]) {
  function render(nodes: BookmarkNode[]): string { return nodes.map(node => node.url ? `<DT><A HREF="${escape(node.url)}" ADD_DATE="${Math.floor((node.dateAdded ?? 0) / 1000)}">${escape(node.title)}</A>` : `<DT><H3>${escape(node.title)}</H3><DL><p>${render(node.children ?? [])}</DL><p>`).join('\n'); }
  return `<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n<TITLE>Link Library bookmark backup</TITLE>\n<H1>Bookmarks</H1>\n<DL><p>${render(tree.flatMap(node => !node.parentId ? node.children ?? [] : [node]))}</DL><p>`;
}
