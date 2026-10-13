import { db } from './db';
import { analyzeBookmarks, type BookmarkNode } from '../bookmarks/analysis';
import type { LinkHealth } from '../bookmarks/health';
export function bookmarkOverview(tree: BookmarkNode[], since: number, health: LinkHealth[] = []) {
  const analysis = analyzeBookmarks(tree);
  const bookmarks = analysis.flat.filter(item => item.node.url);
  const urls = [...new Set(bookmarks.map(item => item.node.url!))];
  const checked = health.filter(result => urls.includes(result.url));
  const dead = new Set(checked.filter(result => result.state === 'dead').map(result => result.url));
  return { bookmarks: bookmarks.length, folders: analysis.flat.filter(item => !item.node.url && item.depth > 1 && !item.node.folderType).length, duplicateGroups: analysis.duplicates.length, extraCopies: analysis.duplicates.reduce((total, group) => total + group.nodes.length - 1, 0), emptyFolders: analysis.emptyFolders.length, added: bookmarks.filter(item => item.node.dateAdded !== undefined && item.node.dateAdded >= since).length, urls, deadBookmarks: bookmarks.filter(item => dead.has(item.node.url!)).length, deadUrls: dead.size, checkedUrls: checked.length, uncheckedUrls: urls.length - checked.length };
}
export async function archiveOverview(since: number) {
  return db.transaction('r', [db.links, db.visits, db.bookmarks, db.linkHealth], async () => {
    const history = new Map<string, number>();
    let visits = 0; let local = 0; let synced = 0; let unknown = 0; let newVisits = 0; let recentVisits = 0;
    await db.visits.toCollection().each(visit => { visits++; history.set(visit.linkId, (history.get(visit.linkId) ?? 0) + 1); if (visit.origin === 'local') local++; else if (visit.origin === 'synced') synced++; else unknown++; if (visit.collectedAt !== undefined && visit.collectedAt >= since) newVisits++; if (visit.visitedAt >= since) recentVisits++; });
    const health = await db.linkHealth.toArray();
    const historyUrls = new Set<string>(); const domains = new Map<string, { domain: string; pages: number; visits: number }>();
    const recent: { id: string; title: string; domain: string; collectedAt: number }[] = [];
    await db.links.toCollection().each(link => {
      if (history.has(link.id)) { historyUrls.add(link.url); const value = domains.get(link.domain) ?? { domain: link.domain, pages: 0, visits: 0 }; value.pages++; value.visits += history.get(link.id)!; domains.set(link.domain, value); }
      if (link.firstCollectedAt >= since) { recent.push({ id: link.id, title: link.title, domain: link.domain, collectedAt: link.firstCollectedAt }); recent.sort((a, b) => b.collectedAt - a.collectedAt); recent.length = Math.min(recent.length, 8); }
    });
    return { links: await db.links.count(), archivedBookmarks: await db.bookmarks.count(), visits, pages: history.size, websites: domains.size, websiteRows: [...domains.values()].sort((a, b) => b.visits - a.visits), recent, repeatedPages: [...history.values()].filter(count => count > 1).length, repeatVisits: visits - history.size, local, synced, unknown, newVisits, recentVisits, historyDead: health.filter(result => historyUrls.has(result.url) && result.state === 'dead').length, historyChecked: health.filter(result => historyUrls.has(result.url)).length, health };
  });
}
