import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { dateBounds, defaultSearch, searchArchive, type SearchOptions } from '../storage/search';
import { safeNavigationUrl } from './urls';
import { LinkDetails } from './LinkDetails';
import { previewDeletion, type DeletionPreview } from '../storage/deletion';
import { DeleteConfirmation } from './DeleteConfirmation';

export function LinkSearch({ source = 'all', device = 'all', collection, initialFilters, installationName = 'This desktop', compact = false, onClearNavigation }: { source?: string; device?: string; collection?: string; initialFilters?: Partial<SearchOptions>; installationName?: string; compact?: boolean; onClearNavigation?: () => void }) {
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [domain, setDomain] = useState(initialFilters?.domain ?? '');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [bookmark, setBookmark] = useState<SearchOptions['bookmark']>('all');
  const [sort, setSort] = useState<SearchOptions['sort']>(initialFilters?.sort ?? 'recent');
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<string>();
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
  const [deletion, setDeletion] = useState<DeletionPreview>();
  const [message, setMessage] = useState('');
  const [drillFilters, setDrillFilters] = useState(initialFilters ?? {});
  useEffect(() => { const timer = setTimeout(() => setSearch(query), 200); return () => clearTimeout(timer); }, [query]);
  useEffect(() => { setPage(0); setCheckedIds([]); setDeletion(undefined); }, [search, source, device, collection, domain, from, to, bookmark, sort]);
  const bounds = dateBounds(from, to);
  const invalidDates = bounds.from !== undefined && bounds.to !== undefined && bounds.from > bounds.to;
  const options = { ...defaultSearch, ...drillFilters, query: search, source: source as SearchOptions['source'], device, collection, domain: domain.trim(), from: bounds.from ?? drillFilters.from, to: bounds.to ?? drillFilters.to, bookmark, sort, page, pageSize: compact ? 10 : 30 };
  const archive = useLiveQuery(() => searchArchive(options), [search, source, device, collection, domain, from, to, bookmark, sort, page, compact, drillFilters]);
  const activeFilters = Boolean(query || source !== 'all' || device !== 'all' || collection || domain || from || to || bookmark !== 'all');
  function clear() { setDrillFilters({}); setQuery(''); setSearch(''); setDomain(''); setFrom(''); setTo(''); setBookmark('all'); setSort('recent'); setPage(0); onClearNavigation?.(); }
  function clearCurrentView() { setDrillFilters({}); setQuery(''); setSearch(''); setDomain(''); setFrom(''); setTo(''); setBookmark('all'); setSort('recent'); setPage(0); }
  const format = (time?: number) => time === undefined ? 'Unavailable' : new Date(time).toLocaleString();
  return <>
    <label className="search">Search your archive<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Title, URL, website, or tag" /></label>
    {!compact && <div className="filters">
      <label>Website<input value={domain} onChange={event => setDomain(event.target.value)} placeholder="example.com" /></label>
      <label>From<input type="date" value={from} onChange={event => { setFrom(event.target.value); setDrillFilters(({ from: _from, to: _to, ...filters }) => filters); }} /></label>
      <label>Through<input type="date" value={to} onChange={event => { setTo(event.target.value); setDrillFilters(({ from: _from, to: _to, ...filters }) => filters); }} /></label>
      <label>Chrome bookmark status<select value={bookmark} onChange={event => setBookmark(event.target.value as SearchOptions['bookmark'])}><option value="all">Any status</option><option value="saved">Present at last collection</option><option value="not-saved">Not present at last collection</option></select></label>
      <label>Sort<select value={sort} onChange={event => setSort(event.target.value as SearchOptions['sort'])}><option value="recent">Recently collected</option><option value="title">Title</option><option value="visits">Recorded visits in date range</option></select></label>
      <button onClick={clear}>Clear filters</button>
    </div>}
    {invalidDates && <p role="alert">The From date must be on or before the Through date.</p>}
    {message && <p role="status">{message}</p>}
    {Object.keys(drillFilters).length > 0 && <p className="muted">Dashboard filter: {drillFilters.repeatedOnly ? 'Pages with repeat visits' : drillFilters.deadOnly ? 'Last checked as not found/gone' : drillFilters.addedSince ? 'Visits newly archived in the last 7 days' : drillFilters.domain ? `Website: ${domain}` : drillFilters.from ? `Visits since ${new Date(drillFilters.from).toLocaleString()}` : 'History view'}. <button onClick={clearCurrentView}>Clear dashboard filter</button></p>}
    {!compact && checkedIds.length > 0 && <div className="actions"><span>{checkedIds.length} selected links</span><button className="danger" onClick={() => void previewDeletion({ kind: 'links', ids: checkedIds }).then(setDeletion).catch(error => setMessage(error instanceof Error ? error.message : 'Unable to preview deletion.'))}>Review selected deletion</button><button onClick={() => setCheckedIds([])}>Clear selection</button></div>}
    {deletion && <DeleteConfirmation preview={deletion} onCancel={() => setDeletion(undefined)} onDeleted={result => { setMessage(result); setCheckedIds([]); setDeletion(undefined); }} />}
    {!compact && <p className="muted">{source === 'history' ? 'Dates filter actual visit time.' : source === 'bookmarks' ? 'Dates filter bookmark saved time.' : source === 'sessions' ? 'Dates filter snapshot observation time.' : 'Dates match visit, bookmark saved, or tab observation time.'} Website matches the exact hostname. Source: {source === 'all' ? 'All links' : source}. {device !== 'all' && 'Device filter active.'}</p>}
    {!archive ? <p role="status">Loading archive…</p> : !invalidDates && archive.rows.length ? <>
      <p className="muted" role="status">{archive.total.toLocaleString()} matching links · page {archive.page + 1} of {Math.ceil(archive.total / options.pageSize)}</p>
      <ul className="results">{archive.rows.map(link => { const info = link.summary; return <li key={link.id}>
      {!compact && <label className="row-selection"><input type="checkbox" checked={checkedIds.includes(link.id)} onChange={event => setCheckedIds(event.target.checked ? [...checkedIds, link.id] : checkedIds.filter(id => id !== link.id))} />Select {link.title || link.domain}</label>}
      {safeNavigationUrl(link.url) ? <a href={safeNavigationUrl(link.url)} target="_blank" rel="noreferrer">{link.title || link.url}</a> : <span>{link.title || link.url}</span>}
      <small>{link.domain}</small>
      <small>{[info.bookmarks ? 'Bookmark · device unavailable' : '', info.visits ? `History · ${info.visits} recorded visits${from || to ? ' in date range' : ''}` : '', info.observations ? 'Device tab · archived snapshot' : ''].filter(Boolean).join(' / ')}</small>
      {!compact && <>{info.bookmarks > 0 && <small>Saved: {format(info.savedAt)}</small>}{info.visits > 0 && <small>Visited: {format(info.visitedAt)}</small>}{info.observations > 0 && <small>Observed: {format(info.observedAt)}</small>}</>}
      {!compact && <button className="details-trigger" onClick={() => setSelected(link.id)}>View details</button>}
    </li>; })}</ul>
    <div className="pagination"><button disabled={archive.page === 0} onClick={() => setPage(archive.page - 1)}>Previous</button><button disabled={(archive.page + 1) * options.pageSize >= archive.total} onClick={() => setPage(archive.page + 1)}>Next</button></div>
    </> : !invalidDates && <div className="empty"><h2>{activeFilters ? 'No matching links' : 'Your library starts here'}</h2><p>{device === 'synced' ? 'Only visits explicitly identified by Chrome as synced are shown here. Device-tab snapshots are in Device tabs. Check the history coverage panel above.' : activeFilters ? 'Try another search or clear the active filters.' : 'Complete setup in the installed Chrome extension to import your selected sources.'}</p>{activeFilters && <div className="actions"><button onClick={clearCurrentView}>Clear filters in this view</button><button onClick={clear}>Show all links</button></div>}</div>}
    {selected && <LinkDetails key={selected} id={selected} installationName={installationName} onClose={() => setSelected(undefined)} />}
  </>;
}
