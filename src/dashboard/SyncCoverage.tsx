import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../storage/db';
import type { Settings } from '../domain/models';

export function SyncCoverage({ settings, onSettings, onHistory, onTabs }: { settings: Settings; onSettings: () => void; onHistory: () => void; onTabs: () => void }) {
  const coverage = useLiveQuery(async () => {
    const counts = { local: 0, synced: 0, unknown: 0 };
    await db.visits.toCollection().each(visit => { counts[visit.origin]++; });
    const run = await db.runs.where('source').equals('history').sortBy('startedAt');
    return { counts, latest: run.at(-1), observations: await db.observations.count() };
  }, []);
  const latest = coverage?.latest;
  const scan = latest?.historyCoverage;
  return <section className="notice sync-coverage"><h2>Other-device history coverage</h2>
    <p>{coverage ? `${coverage.counts.synced} archived synced visits · ${coverage.counts.local} collector-local visits · ${coverage.counts.unknown} visits with unknown origin · ${coverage.observations} tab snapshots` : 'Loading coverage…'}</p>
    {!settings.enabledSources.includes('history') ? <p>History collection is disabled. Enable it in Collection settings.</p> : !scan ? <p>Refresh to record what Chrome exposes. Older runs have no coverage breakdown.</p> : <>
      <p>Latest history scan: {scan.urlsReturned} URLs returned; {scan.localVisits} local, {scan.syncedVisits} synced, and {scan.unknownVisits} unknown-origin visits in the import period. {scan.excludedUrls} URLs excluded; {scan.suppressedVisits} visits withheld from persistence.</p>
      <p className="muted">Import period: {scan.startTime === 0 ? 'All available history' : new Date(scan.startTime).toLocaleString()} through {new Date(scan.endTime).toLocaleString()}. Scan status: {latest?.outcome}. {scan.limitReached && 'The URL limit was reached; coverage is incomplete.'}</p>
      {latest?.outcome === 'running' && <p>Import is running; these coverage counters are partial.</p>}
      {scan.syncedVisits === 0 && latest?.outcome !== 'running' && <p>Chrome returned no identified synced visits in the URLs scanned for this period. Synced tabs use a separate source and do not provide the phone’s full browsing history.</p>}
      {scan.unknownVisits > 0 && <p>Unknown-origin visits remain in History; they cannot be safely labeled as visits from another device.</p>}
    </>}
    <p className="muted">Use the same Chrome account on both devices and enable History and tabs syncing. On desktop: Settings → You and Google → your account → History and tabs. Then choose All available history in Collection settings and collect again. Compare with Chrome’s own History and Tabs from other devices. Chrome’s extension API does not identify a remote visit’s device name. A custom sync passphrase may restrict synced history to addresses typed into the address bar.</p>
    <div className="actions"><button onClick={onSettings}>Collection settings</button><button onClick={onHistory}>Show synced visits</button><button onClick={onTabs}>Show device tabs</button><a href="https://support.google.com/chrome/answer/165139" target="_blank" rel="noreferrer">Chrome sync help ↗</a></div>
  </section>;
}
