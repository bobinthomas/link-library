import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../storage/db';
import { isExtension } from '../shared/extension';
import { analyzeBookmarks, type BookmarkNode } from '../bookmarks/analysis';
import { applyBookmarkCleanup, bookmarkBackupHtml, validateCleanupPlan, type CleanupPlan } from '../bookmarks/cleanup';
import { checkBookmarkBatch, originPermission, type LinkHealth } from '../bookmarks/health';

function downloadBackup(tree: BookmarkNode[]) {
  const url = URL.createObjectURL(new Blob([bookmarkBackupHtml(tree)], { type: 'text/html;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = `chrome-bookmarks-backup-${Date.now()}.html`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function BookmarkCleanup({ initialTree, initialCategory, onChanged }: { initialTree?: BookmarkNode[]; initialCategory?: string; onChanged?: () => void } = {}) {
  const [tree, setTree] = useState<BookmarkNode[]>();
  const [keepers, setKeepers] = useState<Record<string, string>>({});
  const [duplicates, setDuplicates] = useState<string[]>([]);
  const [empty, setEmpty] = useState<string[]>([]);
  const [merges, setMerges] = useState<CleanupPlan['merges']>([]);
  const [health, setHealth] = useState<Record<string, LinkHealth>>({});
  const [dead, setDead] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [review, setReview] = useState(false);
  const [message, setMessage] = useState('');
  const controller = useRef<AbortController | undefined>(undefined);
  const latestBackup = useLiveQuery(() => db.bookmarkCleanups.orderBy('createdAt').reverse().first(), []);
  useEffect(() => () => { controller.current?.abort(); }, []);
  useEffect(() => { if (initialTree) { setTree(initialTree); setKeepers({}); setDuplicates([]); setEmpty([]); setMerges([]); setDead([]); setReview(false); void db.linkHealth.toArray().then(results => setHealth(Object.fromEntries(results.map(result => [result.url, result])))); } }, [initialTree]);
  useEffect(() => { if (initialCategory && tree) { const timer = setTimeout(() => document.getElementById(`cleanup-${initialCategory}`)?.scrollIntoView({ block: 'start' }), 0); return () => clearTimeout(timer); } }, [initialCategory, tree]);
  const analysis = useMemo(() => tree ? analyzeBookmarks(tree) : undefined, [tree]);
  const plan: CleanupPlan = { duplicateIds: analysis?.duplicates.filter(group => duplicates.includes(group.url)).flatMap(group => group.nodes.filter(item => item.mutable && item.node.id !== (keepers[group.url] ?? group.nodes[0].node.id)).map(item => item.node.id)) ?? [], deadIds: dead, emptyFolderIds: empty, merges };
  const total = new Set([...plan.duplicateIds, ...plan.deadIds]).size + empty.length + merges.length;
  async function scan() {
    setBusy(true); setMessage(''); setReview(false);
    try {
      // Runtime permission request stays directly in this click handler.
      if (!await chrome.permissions.request({ permissions: ['bookmarks'] })) throw new Error('Bookmark access was not granted.');
      const tree = await chrome.bookmarks.getTree(); setTree(tree);
      setKeepers({}); setDuplicates([]); setEmpty([]); setMerges([]); setHealth({}); setDead([]);
      setMessage('Scan complete. Select cleanup candidates, then review changes.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to scan bookmarks.'); }
    finally { setBusy(false); }
  }
  async function checkNext() {
    const urls = analysis?.urls.filter(url => !health[url]).slice(0, 100) ?? [];
    if (!urls.length) return;
    setChecking(true); setMessage(''); setReview(false);
    const abort = new AbortController(); controller.current = abort;
    try {
      if (!await chrome.permissions.request({ origins: [...new Set(urls.map(originPermission))] })) throw new Error('Site access was not granted. Bookmarks can still be cleaned without link checks.');
      const writes: Promise<unknown>[] = [];
      await checkBookmarkBatch(urls, result => { setHealth(current => ({ ...current, [result.url]: result })); writes.push(db.linkHealth.put(result)); }, abort.signal);
      await Promise.all(writes);
      setMessage(abort.signal.aborted ? 'Link checks stopped.' : 'Link checks complete. Select confirmed not-found/gone pages for removal.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to check links.'); }
    finally { setChecking(false); }
  }
  function showReview() {
    try { if (tree) { validateCleanupPlan(tree, plan); setReview(true); setMessage(''); } }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Invalid cleanup selection.'); }
  }
  async function apply() {
    if (!tree) return;
    setBusy(true); setMessage('');
    try {
      const result = await applyBookmarkCleanup(tree, plan);
      setMessage(`${result.state === 'complete' ? 'Cleanup complete' : 'Cleanup stopped after partial changes'}: ${result.completed} Chrome operations completed. ${result.error ?? ''} A local pre-cleanup backup is available below. Scan again to review the current tree.`);
      setTree(undefined); setReview(false);
      onChanged?.();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Cleanup could not start.'); }
    finally { setBusy(false); }
  }
  function toggle(value: string, values: string[], setValues: (value: string[]) => void) { setValues(values.includes(value) ? values.filter(item => item !== value) : [...values, value]); setReview(false); }
  return <details open={Boolean(initialTree || initialCategory) || undefined} className="transfer cleanup"><summary>Clean up Chrome bookmarks</summary>
    <p>This workspace changes your actual Chrome bookmarks. Chrome may sync those changes to other devices. Your Link Library archive remains intact.</p>
    {!isExtension() && <p className="preview-note">Open the installed extension to scan and clean Chrome bookmarks.</p>}
    <div className="actions"><button disabled={!isExtension() || busy || checking} onClick={() => void scan()}>{busy ? 'Working…' : 'Scan bookmarks'}</button>{tree && <button onClick={() => downloadBackup(tree)}>Download current bookmark backup</button>}{latestBackup && <button onClick={() => downloadBackup(latestBackup.tree)}>Download pre-cleanup backup</button>}</div>
    {latestBackup && <p className="muted">Last cleanup: {latestBackup.state} · {latestBackup.completed} operations. Backup from {new Date(latestBackup.createdAt).toLocaleString()}. HTML backups can be imported through Chrome’s bookmark manager; importing adds bookmarks and does not reverse moves automatically.</p>}
    {message && <p role="status">{message}</p>}
    {analysis && <>
      <p>{analysis.duplicates.length} exact-URL duplicate groups · {analysis.emptyFolders.length} empty folders · {analysis.merges.length} similar-folder suggestions</p>
      <div id="cleanup-duplicates" className="cleanup-list"><h3>Duplicate bookmarks</h3><p className="muted">URLs must match exactly, including queries and fragments. Different folder associations may be intentional. Choose which bookmark to keep.</p><button disabled={busy || checking} onClick={() => { setDuplicates(analysis.duplicates.map(group => group.url)); setReview(false); }}>Select all duplicate groups</button>
        {analysis.duplicates.map(group => <div className="cleanup-item" key={group.url}><label className="check"><input type="checkbox" disabled={busy || checking} checked={duplicates.includes(group.url)} onChange={() => toggle(group.url, duplicates, setDuplicates)} />Remove extra copies of {group.url}</label><label>Keep<select disabled={busy || checking} value={keepers[group.url] ?? group.nodes[0].node.id} onChange={event => { setKeepers({ ...keepers, [group.url]: event.target.value }); setReview(false); }}>{group.nodes.map(item => <option key={item.node.id} value={item.node.id}>{item.path}{item.mutable ? '' : ' (protected)'}</option>)}</select></label></div>)}
      </div>
      <div id="cleanup-empty" className="cleanup-list"><h3>Empty folders</h3><button disabled={busy || checking} onClick={() => { setEmpty(analysis.emptyFolders.map(item => item.node.id)); setReview(false); }}>Select all empty folders</button>{analysis.emptyFolders.map(item => <label className="check cleanup-item" key={item.node.id}><input type="checkbox" disabled={busy || checking} checked={empty.includes(item.node.id)} onChange={() => toggle(item.node.id, empty, setEmpty)} />{item.path}</label>)}</div>
      <div className="cleanup-list"><h3>Merge similar folders</h3><p className="muted">Suggestions compare folder names and show their full paths. Selected source children are moved into the chosen destination, then the empty source is removed. Sources can share a destination; rescan for nested merges.</p>{analysis.merges.map(pair => {
        const ids = [pair.source.node.id, pair.target.node.id];
        const chosen = merges.find(merge => ids.includes(merge.sourceId) && ids.includes(merge.targetId));
        return <div className="cleanup-item" key={`${pair.source.node.id}:${pair.target.node.id}`}><label className="check"><input type="checkbox" disabled={busy || checking} checked={Boolean(chosen)} onChange={() => { setMerges(chosen ? merges.filter(merge => merge !== chosen) : [...merges, { sourceId: pair.source.node.id, targetId: pair.target.node.id }]); setReview(false); }} />Merge {pair.source.path} with {pair.target.path}</label><label>Keep folder / destination<select disabled={!chosen || busy || checking} value={chosen?.targetId ?? pair.target.node.id} onChange={event => { const targetId = event.target.value; setMerges(merges.map(merge => merge === chosen ? { targetId, sourceId: ids.find(id => id !== targetId)! } : merge)); setReview(false); }}><option value={pair.target.node.id}>{pair.target.path}</option><option value={pair.source.node.id}>{pair.source.path}</option></select></label></div>;
      })}</div>
      <div className="cleanup-list"><h3>Dead-link checks</h3><p className="muted">Optional checks contact bookmarked sites without cookies or referrers. Access is requested for the next batch’s sites only. Redirects, sign-in pages, errors, and timeouts are uncertain and are not selected as dead links.</p><div className="actions"><button disabled={busy || checking || analysis.urls.every(url => health[url])} onClick={() => void checkNext()}>{checking ? 'Checking…' : 'Check next 100 links'}</button>{checking && <button onClick={() => controller.current?.abort()}>Stop checks</button>}<span>{Object.keys(health).length} / {analysis.urls.length} checked</span></div>
      {Object.values(health).map(result => <div className="cleanup-item" key={result.url}><p>{result.state} {result.status ?? ''} · {result.url}<br /><small>{result.reason}</small></p>{result.state === 'dead' && analysis.flat.filter(item => item.mutable && item.node.url === result.url).map(item => <label className="check" key={item.node.id}><input type="checkbox" disabled={busy || checking} checked={dead.includes(item.node.id)} onChange={() => toggle(item.node.id, dead, setDead)} />Remove {item.path}</label>)}</div>)}
      </div>
      <button disabled={!total || busy || checking} onClick={showReview}>Review {total} cleanup selections</button>
      {review && <section className="delete-confirm"><h3>Review Chrome bookmark changes</h3><p>Delete {new Set([...plan.duplicateIds, ...plan.deadIds]).size} bookmarks, remove {empty.length} empty folders, and merge {merges.length} folder pairs.</p><ul>{[...new Set([...plan.duplicateIds, ...plan.deadIds]), ...empty].map(id => <li key={id}>Remove {analysis.flat.find(item => item.node.id === id)?.path}</li>)}{merges.map(merge => <li key={merge.sourceId}>Move children from {analysis.flat.find(item => item.node.id === merge.sourceId)?.path} to {analysis.flat.find(item => item.node.id === merge.targetId)?.path}</li>)}</ul><p>A local snapshot is saved before writes. Chrome operations are sequential, so failures can leave partial changes. Changed trees are rejected; dead-link candidates are checked again before removal.</p><div className="actions"><button className="danger" disabled={busy || checking} onClick={() => void apply()}>Apply to Chrome bookmarks</button><button disabled={busy} onClick={() => setReview(false)}>Cancel</button></div></section>}
    </>}
  </details>;
}
