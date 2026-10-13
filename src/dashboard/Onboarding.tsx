import { useState } from 'react';
import type { Settings, Source } from '../domain/models';
import { db } from '../storage/db';
import { isExtension, refreshArchive } from '../shared/extension';
import { parseExclusions } from '../collectors/policy';
import { sourcePermissions } from '../shared/permissions';

export function Onboarding({ settings, onClose }: { settings: Settings; onClose: () => void }) {
  const [name, setName] = useState(settings.installationName);
  const [sources, setSources] = useState<Source[]>(settings.onboardingCompleted ? settings.enabledSources : ['bookmarks', 'history', 'sessions']);
  const [days, setDays] = useState(settings.historyDays ?? 30);
  const [exclusions, setExclusions] = useState(settings.excludedDomains.join('\n'));
  const [consent, setConsent] = useState(settings.onboardingCompleted);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function start() {
    setError('');
    try {
      const excludedDomains = parseExclusions(exclusions);
      if (!name.trim() || !sources.length || !consent) throw new Error('Name this installation, select a source, and acknowledge archive retention.');
      setBusy(true);
      // Must be called directly from the user gesture, before any awaited work.
      const granted = await chrome.permissions.request({ permissions: sourcePermissions(sources) });
      if (!granted) throw new Error('Access was not granted. Try selecting fewer sources, or approve permissions to continue.');
      await db.settings.update('local', { installationName: name.trim(), enabledSources: sources, excludedDomains, historyDays: days, onboardingCompleted: true, paused: false });
      onClose();
      await refreshArchive();
    } catch (error) { setError(error instanceof Error ? error.message : 'Unable to configure collection.'); }
    finally { setBusy(false); }
  }
  return <section className="notice onboarding"><h2>{settings.onboardingCompleted ? 'Collection settings' : 'Set up your local archive'}</h2>
    {!isExtension() && <p className="preview-note">You are viewing the web preview. To import real Chrome data, run npm run build, then load dist in chrome://extensions.</p>}
    <label>Desktop name<input value={name} onChange={event => setName(event.target.value)} maxLength={100} /></label>
    <fieldset><legend>Sources to collect</legend>{(['bookmarks', 'history', 'sessions'] as Source[]).map(source => <label className="check" key={source}><input type="checkbox" checked={sources.includes(source)} onChange={event => setSources(event.target.checked ? [...sources, source] : sources.filter(value => value !== source))} />{source === 'sessions' ? 'Available synced device tabs' : source === 'history' ? 'Browsing history' : 'Bookmarks and folders'}</label>)}</fieldset>
    <label>History range<select value={days} onChange={event => setDays(Number(event.target.value))}><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option><option value={0}>All available history</option></select></label>
    <p className="muted">Initial import is limited to 10,000 URLs per refresh. History visits from synced devices have no device name. Synced tabs require both session and tab URL permissions; they are observed snapshots, not visits.</p>
    <label>Excluded domains (one per line)<textarea value={exclusions} onChange={event => setExclusions(event.target.value)} placeholder="example.com" /></label>
    <p className="muted">Excludes each domain and its subdomains from future collection. Existing records remain in your archive.</p>
    <label className="check"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} />I understand Link Library keeps collected data even after I delete Chrome history.</label>
    {error && <p role="alert">{error}</p>}
    <button disabled={busy || !isExtension()} onClick={() => void start()}>{busy ? 'Requesting access…' : 'Grant access and collect'}</button>
    {settings.onboardingCompleted && <button onClick={onClose}>Cancel</button>}
  </section>;
}
