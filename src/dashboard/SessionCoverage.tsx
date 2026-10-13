import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../storage/db';
import { isExtension, refreshArchive } from '../shared/extension';
import type { Settings } from '../domain/models';

export function SessionCoverage({ settings, onTabs }: { settings: Settings; onTabs: () => void }) {
  const run = useLiveQuery(async () => (await db.runs.where('source').equals('sessions').sortBy('startedAt')).at(-1), []);
  const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  const scan = run?.sessionCoverage;
  async function repair() {
    setBusy(true); setMessage('');
    try {
      if (!await chrome.permissions.request({ permissions: ['sessions', 'tabs'] })) throw new Error('Session/tab URL access was not granted.');
      if (!settings.onboardingCompleted) throw new Error('Complete archive-retention onboarding before collecting.');
      await db.settings.update('local', { paused: false, enabledSources: [...new Set([...settings.enabledSources, 'sessions' as const])] });
      await refreshArchive(); setMessage('Collection finished. Use Show device tabs to view all snapshots without filters.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to refresh phone tabs.'); }
    finally { setBusy(false); }
  }
  return <section className="notice sync-coverage"><h2>Phone / synced-tab diagnostics</h2><p>Collection: {settings.enabledSources.includes('sessions') ? 'enabled' : 'disabled'} · {settings.paused ? 'paused' : 'active'}</p>
    {!scan ? <p>No detailed session scan yet. Grant access and retry below.</p> : <><p>Chrome returned {scan.devices} devices, {scan.sessions} sessions, and {scan.tabsReturned} tabs. {scan.archived} accepted for the archive.</p><p>{scan.missingUrl} tabs missing URLs · {scan.excluded} excluded/unsupported URLs · {scan.incognito} incognito tabs skipped · {scan.withheld} withheld by current exclusions or deletion suppression.</p><p>Tab URL permission: {scan.tabsPermission ? 'granted' : 'missing'} · Latest run: {run?.outcome}{run?.endedAt ? ` · ${new Date(run.endedAt).toLocaleString()}` : ''}</p>{scan.deviceCounts.map((device, index) => <p key={index}>{device.name}: {device.tabs} returned tabs, {device.archived} accepted, {device.missingUrl} missing URLs</p>)}{!scan.devices && <p>Chrome exposed no synced sessions to this profile. Compare with Chrome’s own History → Tabs from other devices.</p>}{scan.missingUrl > 0 && <p>Returned tab metadata has no readable URL. Tab URL access is required to collect those links.</p>}</>}
    {run?.error && <p role="alert">{run.error}</p>}<div className="actions"><button disabled={busy || !isExtension()} onClick={() => void repair()}>{busy ? 'Collecting…' : 'Grant session + tab URL access and retry'}</button><button onClick={onTabs}>Show device tabs without filters</button></div>{message && <p role="status">{message}</p>}
    <p className="muted">Device tabs are observed synced snapshots. A phone’s full navigation history is a separate source and cannot be reconstructed from these tabs.</p>
  </section>;
}
