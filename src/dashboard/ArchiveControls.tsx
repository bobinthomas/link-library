import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../storage/db';
import { allowDeletedRecordsAgain, previewDeletion, type DeletionPreview } from '../storage/deletion';
import { dateBounds } from '../storage/search';
import { DeleteConfirmation } from '../shared/DeleteConfirmation';
import type { Source } from '../domain/models';

export function ArchiveControls() {
  const [source, setSource] = useState<'all' | Source>('history');
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [preview, setPreview] = useState<DeletionPreview>();
  const [message, setMessage] = useState('');
  const [restore, setRestore] = useState(false);
  const count = useLiveQuery(() => db.suppressions.count(), []);
  async function review(all: boolean) {
    try {
      const bounds = dateBounds(from, to);
      if (!all && (bounds.from === undefined || bounds.to === undefined)) throw new Error('Choose both dates before previewing deletion.');
      setPreview(await previewDeletion(all ? { kind: 'all' } : { kind: 'range', source, from: bounds.from!, to: bounds.to! })); setMessage('');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to preview deletion.'); }
  }
  return <details className="transfer"><summary>Archive deletion controls</summary><p className="muted">These controls affect Link Library only. Source dates mean visit time, bookmark saved time, or snapshot observation time. Unknown saved dates are unaffected by date deletion.</p>
    <div className="filters"><label>Source<select value={source} onChange={event => { setSource(event.target.value as 'all' | Source); setPreview(undefined); }}><option value="history">History visits</option><option value="bookmarks">Bookmarks</option><option value="sessions">Tab snapshots</option><option value="all">All source types</option></select></label><label>From<input type="date" value={from} onChange={event => { setFrom(event.target.value); setPreview(undefined); }} /></label><label>Through<input type="date" value={to} onChange={event => { setTo(event.target.value); setPreview(undefined); }} /></label><button onClick={() => void review(false)}>Preview date deletion</button><button className="danger" onClick={() => void review(true)}>Preview entire archive deletion</button></div>
    {preview && <DeleteConfirmation preview={preview} onCancel={() => setPreview(undefined)} onDeleted={result => { setMessage(result); setPreview(undefined); }} />}
    <p>{count ?? 0} deleted source identifiers suppressed.</p><button disabled={!count} onClick={() => setRestore(true)}>Allow deleted records again…</button>
    {restore && <div className="delete-confirm"><p>Clear all suppression markers? A subsequent refresh may collect previously deleted records again.</p><button onClick={() => void allowDeletedRecordsAgain().then(() => { setRestore(false); setMessage('Suppression cleared. Resume collection if paused, then Refresh to collect available records again.'); }).catch(() => setMessage('Unable to clear suppression.'))}>Confirm allow recollection</button><button onClick={() => setRestore(false)}>Cancel</button></div>}
    {message && <p role="status">{message}</p>}
  </details>;
}
