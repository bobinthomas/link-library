import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { archiveOverview, bookmarkOverview } from '../storage/overview';
import type { BookmarkNode } from '../bookmarks/analysis';
import type { SearchOptions } from '../storage/search';
import { LinkDetails } from '../shared/LinkDetails';
export type OverviewTarget = { view: 'links' | 'chrome-bookmarks' | 'cleanup' | 'websites'; source?: string; device?: string; mode?: string; filters?: Partial<SearchOptions> };
export function Overview({ tree, since, capturedAt, installationName, onNavigate, onLoad }: { tree?: BookmarkNode[]; since: number; capturedAt?: number; installationName: string; onNavigate: (target: OverviewTarget) => void; onLoad: () => void }) {
  const archive = useLiveQuery(() => archiveOverview(since), [since]);
  const [selected, setSelected] = useState<string>();
  const current = tree ? bookmarkOverview(tree, since, archive?.health) : undefined;
  const count = (value?: number) => value === undefined ? '—' : value.toLocaleString();
  const card = (title: string, value: number | undefined, description: string, target: OverviewTarget) => <button className="stat-card" onClick={() => onNavigate(target)}><span>{title}</span><strong>{count(value)}</strong><small>{description} ↗</small></button>;
  return <section className="overview"><div className="section-heading"><div><h2>Your library at a glance</h2><p className="muted">Select a number to explore the records behind it.</p></div><button onClick={onLoad}>Update bookmark overview</button></div>
    <h3>Bookmarks</h3><p className="muted">Current Chrome tree{capturedAt ? ` · read ${new Date(capturedAt).toLocaleString()}` : ' · bookmark access needed for live counts'}. <button className="activity-link" onClick={() => onNavigate({ view: 'links', source: 'bookmarks' })}>{count(archive?.archivedBookmarks)} archived bookmark records</button></p>
    <div className="stat-grid">
      {card('Bookmarks', current?.bookmarks, 'Current Chrome bookmarks', { view: 'chrome-bookmarks' })}
      {card('Folders', current?.folders, 'Excludes browser root folders', { view: 'chrome-bookmarks', mode: 'folders' })}
      {card('Duplicate copies', current?.extraCopies, `${count(current?.duplicateGroups)} exact-URL groups`, { view: 'cleanup', mode: 'duplicates' })}
      {card('Empty folders', current?.emptyFolders, 'Editable empty branches', { view: 'cleanup', mode: 'empty' })}
      {card('Not found / gone', archive ? current?.deadBookmarks : undefined, `${count(current?.deadUrls)} affected URLs · ${count(current?.checkedUrls)} checked · ${count(current?.uncheckedUrls)} unchecked`, { view: 'chrome-bookmarks', mode: 'dead' })}
      {card('Added in 7 days', current?.added, 'Chrome bookmark creation time', { view: 'chrome-bookmarks', mode: 'new' })}
    </div>
    <h3>History</h3><p className="muted">Archived actual visits. Repeated visits are activity, not duplicate archive records. Dead-link counts use the latest saved check and do not imply all pages have been checked.</p>
    <div className="stat-grid">
      {card('Recorded visits', archive?.visits, `${count(archive?.pages)} unique pages`, { view: 'links', source: 'history' })}
      {card('Websites', archive?.websites, 'Group pages by hostname', { view: 'websites' })}
      {card('Repeat visits', archive?.repeatVisits, `${count(archive?.repeatedPages)} pages visited more than once`, { view: 'links', source: 'history', filters: { repeatedOnly: true, sort: 'visits' } })}
      {card('Not found / gone', archive?.historyDead, `${count(archive?.historyChecked)} unique history URLs checked`, { view: 'links', source: 'history', filters: { deadOnly: true } })}
      {card('Visited in 7 days', archive?.recentVisits, 'Actual visit timestamps', { view: 'links', source: 'history', filters: { from: since } })}
      {card('Newly archived visits', archive?.newVisits, 'First archived in the last 7 days', { view: 'links', source: 'history', filters: { addedSince: since } })}
      {card('Collector-local visits', archive?.local, 'Local to their collecting desktop', { view: 'links', source: 'history', device: 'local-origin' })}
      {card('Synced visits', archive?.synced, 'Remote device name unavailable', { view: 'links', source: 'history', device: 'synced' })}
      {card('Unknown-origin visits', archive?.unknown, 'Provenance unavailable', { view: 'links', source: 'history', device: 'unknown' })}
    </div>
    <p className="muted">New-visit tracking begins with this update; older source records with no first-archive timestamp are not counted as newly added. {count(archive?.links)} unique links across the library.</p>
    <h3>New to your archive · last 7 days</h3>{archive?.recent.length ? <ul className="results">{archive.recent.map(link => <li key={link.id}><button className="activity-link" onClick={() => setSelected(link.id)}>{link.title || link.domain}</button><small>{link.domain} · First collected {new Date(link.collectedAt).toLocaleString()}</small></li>)}</ul> : <p className="muted">No newly archived links in this period.</p>}
    {selected && <LinkDetails key={selected} id={selected} installationName={installationName} onClose={() => setSelected(undefined)} />}
  </section>;
}
