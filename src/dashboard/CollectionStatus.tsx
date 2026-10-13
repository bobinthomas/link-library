import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { db } from '../storage/db';
import type { Settings } from '../domain/models';
import { isExtension } from '../shared/extension';

export function CollectionStatus({ settings }: { settings: Settings }) {
  const runs = useLiveQuery(() => db.runs.orderBy('startedAt').reverse().limit(30).toArray(), []);
  const [permissions, setPermissions] = useState<string[]>([]);
  useEffect(() => {
    if (!isExtension()) return;
    const update = () => { void chrome.permissions.getAll().then(result => setPermissions(result.permissions ?? [])); };
    update(); chrome.permissions.onAdded.addListener(update); chrome.permissions.onRemoved.addListener(update);
    return () => { chrome.permissions.onAdded.removeListener(update); chrome.permissions.onRemoved.removeListener(update); };
  }, []);
  return <section className="status" aria-label="Collection status">{settings.enabledSources.map(source => {
    const latest = runs?.find(run => run.source === source);
    const success = runs?.find(run => run.source === source && run.outcome === 'success');
    return <div key={source}><strong>{source === 'sessions' ? 'Synced tab snapshots' : source}</strong><p>{permissions.includes(source) ? 'Permission granted' : 'Permission unavailable'}</p><p role="status">{latest ? `${latest.outcome} · ${latest.count} source records processed` : 'Not collected yet'}</p>{latest?.error && <p role="alert">{latest.error}</p>}<p>Last success: {success?.endedAt ? new Date(success.endedAt).toLocaleString() : 'Unavailable'}</p></div>;
  })}</section>;
}
