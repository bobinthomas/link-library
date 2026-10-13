import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, initializeSettings } from '../storage/db';
import { LinkSearch } from '../shared/LinkSearch';
import '../shared/styles.css';
import { Onboarding } from './Onboarding';
import { CollectionStatus } from './CollectionStatus';
import { isExtension, refreshArchive } from '../shared/extension';
import { Collections } from './Collections';
import { ArchiveTransfer } from './ArchiveTransfer';
import { ArchiveControls } from './ArchiveControls';
import { SyncCoverage } from './SyncCoverage';
import { BookmarkCleanup } from './BookmarkCleanup';
import { Overview, type OverviewTarget } from './Overview';
import { BookmarkBrowser } from './BookmarkBrowser';
import { HistoryWebsites } from './HistoryWebsites';
import type { BookmarkNode } from '../bookmarks/analysis';
import type { SearchOptions } from '../storage/search';
import { SessionCoverage } from './SessionCoverage';

function Dashboard() {
  const settings = useLiveQuery(() => db.settings.get('local'), []);
  const [error, setError] = useState('');
  const [configure, setConfigure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [source, setSource] = useState('all');
  const [device, setDevice] = useState('all');
  const [collection, setCollection] = useState('');
  const [navigationRevision, setNavigationRevision] = useState(0);
  const [view, setView] = useState<string>('overview');
  const [mode, setMode] = useState<string>();
  const [drillFilters, setDrillFilters] = useState<Partial<SearchOptions>>();
  const [bookmarkTree, setBookmarkTree] = useState<BookmarkNode[]>();
  const [capturedAt, setCapturedAt] = useState<number>();
  const [since, setSince] = useState(Date.now() - 7 * 86_400_000);
  const selectedCollection = useLiveQuery(() => collection ? db.collections.get(collection) : undefined, [collection]);
  const devices = useLiveQuery(() => db.devices.toArray(), []);
  useEffect(() => { void initializeSettings().catch(() => setError('Unable to open local storage. Check browser storage settings.')); }, []);
  async function loadBookmarkOverview(request = false) {
    if (!isExtension()) { if (request) setError('Open the installed Chrome extension to load current bookmark counts.'); return; }
    try {
      const allowed = request ? await chrome.permissions.request({ permissions: ['bookmarks'] }) : await chrome.permissions.contains({ permissions: ['bookmarks'] });
      if (!allowed) { setBookmarkTree(undefined); if (request) setError('Bookmark access was not granted.'); return; }
      setBookmarkTree(await chrome.bookmarks.getTree()); setCapturedAt(Date.now()); setSince(Date.now() - 7 * 86_400_000);
    } catch { setError('Unable to read the current Chrome bookmark tree.'); }
  }
  useEffect(() => { if (view === 'overview') void loadBookmarkOverview(); }, [view, settings?.enabledSources.join(',')]);
  function navigate(target: OverviewTarget) {
    setView(target.view); setSource(target.source ?? 'all'); setDevice(target.device ?? 'all'); setMode(target.mode); setCollection(''); setDrillFilters(target.filters); setConfigure(false); setNavigationRevision(value => value + 1);
  }
  async function toggleTheme() {
    if (settings) await db.settings.update('local', { theme: settings.theme === 'dark' ? 'light' : 'dark' });
  }
  async function refresh() {
    setBusy(true); setError('');
    try { await refreshArchive(); await loadBookmarkOverview(); } catch (error) { setError(error instanceof Error ? error.message : 'Collection failed.'); }
    finally { setBusy(false); }
  }
  return <div className="app" data-theme={settings?.theme ?? 'dark'}>
    <aside><a className="brand" href="index.html">▣ Link Library</a><p className="eyebrow">LIBRARY</p><nav aria-label="Library"><button aria-pressed={view === 'overview'} onClick={() => setView('overview')}>Dashboard</button>{[['all', 'All links'], ['bookmarks', 'Bookmarks'], ['history', 'History'], ['sessions', 'Device tabs']].map(([value, label]) => <button key={value} aria-pressed={(view === 'links' && source === value && !collection) || (value === 'bookmarks' && view === 'chrome-bookmarks')} onClick={() => navigate({ view: value === 'bookmarks' ? 'chrome-bookmarks' : 'links', source: value })}>{label}</button>)}<button aria-pressed={view === 'cleanup'} onClick={() => navigate({ view: 'cleanup' })}>Bookmark cleanup</button><button aria-pressed={view === 'coverage'} onClick={() => setView('coverage')}>Collection coverage</button><button aria-pressed={view === 'tools'} onClick={() => setView('tools')}>Archive controls</button></nav><p className="eyebrow">DEVICES</p><nav aria-label="Devices"><button onClick={() => navigate({ view: 'links', source: 'history', device: `local:${settings?.collectorId}` })}>{settings?.installationName ?? 'This desktop'}</button><button onClick={() => navigate({ view: 'links', source: 'history', device: 'synced' })}>Other synced devices</button>{devices?.map(item => <button key={item.id} onClick={() => navigate({ view: 'links', source: 'sessions', device: item.id })}>{item.alias ?? item.sourceName} · tabs</button>)}</nav><p className="eyebrow">COLLECTIONS</p><Collections selected={collection} onSelect={id => { navigate({ view: 'links' }); setCollection(id); }} /><footer>Local archive<br />No account required</footer></aside>
    <main><header><div><p className="eyebrow">YOUR PERSONAL ARCHIVE</p><h1>Link Library</h1></div><div className="actions"><button onClick={() => void toggleTheme().catch(() => setError('Unable to save theme.'))}>Switch theme</button>{settings?.onboardingCompleted && <><button onClick={() => setConfigure(true)}>Collection settings</button><button onClick={() => void db.settings.update('local', { paused: !settings.paused }).catch(() => setError('Unable to change collection state.'))}>{settings.paused ? 'Resume' : 'Pause'}</button><button disabled={busy || settings.paused || !isExtension()} onClick={() => void refresh()}>{busy ? 'Collecting…' : 'Refresh'}</button></>}</div></header>
      {error && <p role="alert">{error}</p>}
      {view !== 'overview' && <button className="back-overview" onClick={() => setView('overview')}>← Back to dashboard</button>}
      {settings && (!settings.onboardingCompleted || configure) && <Onboarding settings={settings} onClose={() => setConfigure(false)} />}
      <p className="muted">{settings?.onboardingCompleted ? settings.paused ? 'Collection paused.' : 'Manual collection enabled. Use Refresh to update your archive.' : 'Collection disabled until setup is complete.'}</p>
      {view === 'overview' && <Overview tree={bookmarkTree} since={since} capturedAt={capturedAt} installationName={settings?.installationName ?? 'This desktop'} onNavigate={navigate} onLoad={() => void loadBookmarkOverview(true)} />}
      {view === 'chrome-bookmarks' && <BookmarkBrowser key={navigationRevision} tree={bookmarkTree} mode={mode} since={since} onLoad={() => void loadBookmarkOverview(true)} onCleanup={() => navigate({ view: 'cleanup' })} />}
      {view === 'websites' && <HistoryWebsites since={since} onWebsite={domain => navigate({ view: 'links', source: 'history', filters: { domain } })} />}
      {view === 'coverage' && settings && <><SessionCoverage settings={settings} onTabs={() => navigate({ view: 'links', source: 'sessions' })} /><CollectionStatus settings={settings} /><SyncCoverage settings={settings} onSettings={() => setConfigure(true)} onHistory={() => navigate({ view: 'links', source: 'history', device: 'synced' })} onTabs={() => navigate({ view: 'links', source: 'sessions' })} /></>}
      {view === 'tools' && <><ArchiveTransfer /><ArchiveControls /></>}
      {view === 'cleanup' && <BookmarkCleanup initialTree={bookmarkTree} initialCategory={mode} onChanged={() => void loadBookmarkOverview()} />}
      {view === 'links' && <>{selectedCollection && <h2>Collection: {selectedCollection.name}</h2>}<LinkSearch key={navigationRevision} source={source} device={device} collection={collection || undefined} initialFilters={drillFilters} installationName={settings?.installationName} onClearNavigation={() => navigate({ view: 'links' })} /></>}
      <details className="transfer retention-note"><summary>Archive retention and source limits</summary><p>Link Library keeps collected data even after you delete Chrome history. Removing the extension or clearing storage can erase the archive.</p><p>History import is capped at 10,000 URLs per refresh. Synced tabs are snapshots, not complete remote history. Visit origins cannot identify remote device names.</p></details>
    </main>
  </div>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><Dashboard /></StrictMode>);
