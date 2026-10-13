import { useRef, useState } from 'react';
import { exportArchive, exportCsv, importArchive } from '../storage/transfer';

function download(content: string, type: string, filename: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename;
  anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function ArchiveTransfer() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function exportFile(format: 'json' | 'csv') {
    setBusy(true); setMessage('');
    try {
      const content = format === 'json' ? JSON.stringify(await exportArchive(), null, 2) : await exportCsv();
      download(content, format === 'json' ? 'application/json' : 'text/csv;charset=utf-8', `link-library-${new Date().toISOString().slice(0, 10)}.${format}`);
      setMessage(format === 'json' ? 'JSON archive downloaded.' : 'CSV links downloaded. Use JSON for restoring source records.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Export failed.'); }
    finally { setBusy(false); }
  }
  async function importFile(file?: File) {
    if (!file) return;
    setBusy(true); setMessage('');
    try {
      if (file.size > 50 * 1024 * 1024) throw new Error('Import supports JSON archives up to 50 MB.');
      const result = await importArchive(JSON.parse(await file.text()));
      setMessage(`Imported ${result.importedLinks} links; ${result.addedLinks} newly added. Existing notes and source records were preserved.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Import failed. No changes were saved.'); }
    finally { setBusy(false); if (fileInput.current) fileInput.current.value = ''; }
  }
  return <details className="transfer"><summary>Backup and restore</summary><p className="muted">JSON includes URLs, titles, notes, tags, collections, and source records. CSV exports link fields only. Import merges records and preserves existing notes; it does not enable collection or change permissions. Files stay on your device. JSON import limit: 50 MB.</p><div className="actions"><button disabled={busy} onClick={() => void exportFile('json')}>Export JSON archive</button><button disabled={busy} onClick={() => void exportFile('csv')}>Export CSV links</button><button disabled={busy} onClick={() => fileInput.current?.click()}>Import JSON archive</button><input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={event => void importFile(event.target.files?.[0])} /></div>{busy && <p role="status">Processing archive…</p>}{message && <p role="status">{message}</p>}</details>;
}
