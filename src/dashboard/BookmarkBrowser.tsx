import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { analyzeBookmarks, type BookmarkNode } from '../bookmarks/analysis';
import { db } from '../storage/db';
import { safeNavigationUrl } from '../shared/urls';
export function BookmarkBrowser({ tree, mode, since, onLoad, onCleanup }: { tree?: BookmarkNode[]; mode?: string; since: number; onLoad: () => void; onCleanup: () => void }) {
  const [query, setQuery] = useState(''); const [folder, setFolder] = useState(''); const [page, setPage] = useState(0);
  const analysis = useMemo(() => tree ? analyzeBookmarks(tree) : undefined, [tree]);
  const health = useLiveQuery(() => db.linkHealth.toArray(), []);
  if (!analysis) return <section className="empty"><h2>Read your Chrome bookmarks</h2><p>Current bookmark and folder details require access to the installed extension’s bookmark tree.</p><button onClick={onLoad}>Load bookmark overview</button></section>;
  const rows = analysis.flat.filter(item => {
    if (mode === 'folders' && !folder) { if (item.node.url || item.depth <= 1 || item.node.folderType) return false; }
    else if (!item.node.url || folder && !item.ancestors.includes(folder)) return false;
    if (mode === 'dead' && !health?.some(result => result.url === item.node.url && result.state === 'dead')) return false;
    if (mode === 'new' && (item.node.dateAdded === undefined || item.node.dateAdded < since)) return false;
    return [item.node.title, item.node.url ?? '', item.path].some(value => value.toLowerCase().includes(query.toLowerCase()));
  });
  const currentPage = Math.min(page, Math.max(0, Math.ceil(rows.length / 30) - 1));
  return <><div className="section-heading"><h2>{mode === 'folders' ? folder ? 'Bookmarks in folder' : 'Bookmark folders' : mode === 'dead' ? 'Bookmarks last checked as not found / gone' : mode === 'new' ? 'Bookmarks added in the last 7 days' : 'Current Chrome bookmarks'}</h2><button onClick={onCleanup}>Open cleanup workspace</button></div><label className="search">Search title, URL, or folder<input value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} /></label>{folder && <button onClick={() => { setFolder(''); setPage(0); }}>Back to folders</button>}<p className="muted">{rows.length} matching records. Archive exclusions do not change this view of your Chrome tree.</p><ul className="results">{rows.slice(currentPage * 30, (currentPage + 1) * 30).map(item => <li key={item.node.id}>{item.node.url ? <>{safeNavigationUrl(item.node.url) ? <a href={safeNavigationUrl(item.node.url)} target="_blank" rel="noreferrer">{item.node.title || item.node.url}</a> : <strong>{item.node.title}</strong>}<small className="full-url">{item.node.url}</small><small>Saved: {item.node.dateAdded ? new Date(item.node.dateAdded).toLocaleString() : 'Unavailable'}</small></> : <button onClick={() => { setFolder(item.node.id); setPage(0); }}>{item.node.title || '(untitled folder)'}</button>}<small>{item.path}{item.mutable ? '' : ' · Protected'}</small>{mode === 'dead' && <small>HTTP {health?.find(result => result.url === item.node.url)?.status} · Last checked {new Date(health!.find(result => result.url === item.node.url)!.checkedAt).toLocaleString()} · Review in cleanup before deleting</small>}</li>)}</ul>{!rows.length && <p>No matching records. Dead-link counts remain zero until URLs have been checked.</p>}<div className="pagination"><button disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>Previous</button><button disabled={(currentPage + 1) * 30 >= rows.length} onClick={() => setPage(currentPage + 1)}>Next</button></div></>;
}
