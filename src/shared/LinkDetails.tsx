import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { loadLinkDetails } from '../storage/search';
import { safeNavigationUrl } from './urls';
import { LinkEditor } from './LinkEditor';
import { previewDeletion, type DeletionPreview } from '../storage/deletion';
import { DeleteConfirmation } from './DeleteConfirmation';

export function LinkDetails({ id, installationName, onClose }: { id: string; installationName: string; onClose: () => void }) {
  const [visitPage, setVisitPage] = useState(0);
  const [observationPage, setObservationPage] = useState(0);
  const [message, setMessage] = useState('');
  const [deletion, setDeletion] = useState<DeletionPreview>();
  const dialog = useRef<HTMLDialogElement>(null);
  const details = useLiveQuery(() => loadLinkDetails(id, visitPage, observationPage), [id, visitPage, observationPage]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => { previous?.focus(); };
  }, []);
  const format = (time?: number) => time === undefined ? 'Unavailable' : new Date(time).toLocaleString();
  const url = details && safeNavigationUrl(details.link.url);
  async function copy() {
    try { if (details) { await navigator.clipboard.writeText(details.link.url); setMessage('URL copied.'); } }
    catch { setMessage('Unable to copy. Select and copy the full URL below.'); }
  }
  return <dialog ref={dialog} className="details" aria-labelledby="details-title" onCancel={onClose} onClose={onClose}>
    <div className="details-header"><h2 id="details-title">Link details</h2><button onClick={onClose} aria-label="Close link details">Close</button></div>
    {!details ? <p role="status">Loading link details…</p> : <>
      <h3>{details.link.title || 'Untitled link'}</h3><p className="full-url">{details.link.url}</p>
      <div className="actions">{url && <a className="button-link" href={url} target="_blank" rel="noreferrer">Open page ↗</a>}<button onClick={() => void copy()}>Copy URL</button></div>
      {message && <p role="status">{message}</p>}
      <p className="muted">First collected: {format(details.link.firstCollectedAt)}<br />Last collected: {format(details.link.lastCollectedAt)}</p>
      <LinkEditor link={details.link} />
      <button className="danger" onClick={() => void previewDeletion({ kind: 'links', ids: [id] }).then(setDeletion).catch(error => setMessage(error instanceof Error ? error.message : 'Unable to preview deletion.'))}>Delete link from archive…</button>
      {deletion && <DeleteConfirmation preview={deletion} onCancel={() => setDeletion(undefined)} onDeleted={onClose} />}
      <h3>Bookmarks · {details.bookmarks.length}</h3>{details.bookmarks.length ? details.bookmarks.map(bookmark => <div className="detail-record" key={bookmark.id}><strong>{bookmark.folderPath.join(' / ') || 'No folder'}</strong><p>Saved: {format(bookmark.savedAt)}<br />Last used: {format(bookmark.lastUsedAt)}<br />Original device: Unavailable<br />Chrome source: {bookmark.current ? 'Present at last collection' : 'Removed at last collection'}</p></div>) : <p>No archived bookmarks.</p>}
      <h3>Visit timeline · {details.visitCount}</h3><p className="muted">Actual archived visits across all dates. Browser lifetime totals are unavailable in this view.</p>
      {details.visits.map(visit => <div className="detail-record" key={visit.id}><strong>{format(visit.visitedAt)}</strong><p>{visit.origin === 'local' ? visit.collectorId === details.settings?.collectorId ? installationName : 'Other collecting desktop · name unavailable' : visit.origin === 'synced' ? 'Other synced devices · originating device unavailable' : 'Device unavailable'}<br />Origin: {visit.origin}</p></div>)}
      <Pager page={visitPage} total={details.visitCount} onPage={setVisitPage} label="Visits" />
      <h3>Tab observations · {details.observationCount}</h3><p className="muted">Archived snapshots do not establish an actual visit or that a tab is open now.</p>
      {details.observations.map(observation => <div className="detail-record" key={observation.id}><strong>{details.devices.find(device => device.id === observation.deviceId)?.sourceName ?? 'Device unavailable'}</strong><p>Observed: {format(observation.observedAt)}<br />Session modified: {format(observation.sessionModifiedAt)}</p></div>)}
      <Pager page={observationPage} total={details.observationCount} onPage={setObservationPage} label="Observations" />
    </>}
  </dialog>;
}
function Pager({ page, total, onPage, label }: { page: number; total: number; onPage: (page: number) => void; label: string }) {
  return total > 25 ? <div className="actions" aria-label={`${label} pages`}><button disabled={!page} onClick={() => onPage(page - 1)}>Previous</button><span>Page {page + 1} of {Math.ceil(total / 25)}</span><button disabled={(page + 1) * 25 >= total} onClick={() => onPage(page + 1)}>Next</button></div> : null;
}
