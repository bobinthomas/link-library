import { useState } from 'react';
import { applyDeletion, type DeletionPreview } from '../storage/deletion';

export function DeleteConfirmation({ preview, onCancel, onDeleted }: { preview: DeletionPreview; onCancel: () => void; onDeleted: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function confirm() {
    setBusy(true); setError('');
    try {
      const result = await applyDeletion(preview);
      onDeleted(`Deleted ${result.removedLinks} links and ${result.removedRecords} source records from the archive.${preview.request.kind === 'all' ? ' Collection is now paused.' : ''}`);
    } catch (error) { setError(error instanceof Error ? error.message : 'Deletion failed.'); }
    finally { setBusy(false); }
  }
  const count = preview.visits.length + preview.bookmarks.length + preview.observations.length;
  return <section className="delete-confirm" aria-label="Review archive deletion"><h3>Review archive-only deletion</h3><p>{preview.links.length} affected links · {preview.visits.length} visits · {preview.bookmarks.length} bookmarks · {preview.observations.length} snapshots</p>
    <ul>{preview.links.slice(0, 5).map(link => <li key={link.id}>{link.title || link.domain} · {link.domain}</li>)}</ul>{preview.links.length > 5 && <p>And {preview.links.length - 5} additional affected links.</p>}
    <p>Chrome history, bookmarks, and tabs remain unchanged. Deleted source records are suppressed from collection until you explicitly allow them again. Export a JSON backup first if you may need these records.</p>
    {preview.request.kind === 'range' && <p>Only source records in the selected period are removed. Links with other source records remain.</p>}
    {preview.request.kind === 'all' && <p>This also removes tags, notes, collections, device metadata, and collection logs, and pauses collection. Minimal suppression identifiers and local settings remain.</p>}
    {error && <p role="alert">{error}</p>}<div className="actions"><button className="danger" disabled={busy || preview.request.kind !== 'all' && !count && !preview.links.length} onClick={() => void confirm()}>{busy ? 'Deleting…' : 'Confirm archive deletion'}</button><button disabled={busy} onClick={onCancel}>Cancel</button></div>
  </section>;
}
