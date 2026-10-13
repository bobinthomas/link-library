import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../storage/db';
import { saveOrganization } from '../storage/organization';
import type { Link, Collection } from '../domain/models';

export function LinkEditor({ link }: { link: Link }) {
  const collections = useLiveQuery(() => db.collections.toArray(), []);
  if (!collections) return <p>Loading organization…</p>;
  return <Editor key={link.id} link={link} collections={collections} />;
}
function Editor({ link, collections }: { link: Link; collections: Collection[] }) {
  const [tags, setTags] = useState(link.tags.join(', '));
  const [notes, setNotes] = useState(link.notes);
  const [membership, setMembership] = useState(collections.filter(value => value.linkIds.includes(link.id)).map(value => value.id));
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true); setMessage('');
    try { await saveOrganization(link.id, tags, notes, membership); setMessage('Tags, notes, and collections saved.'); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to save changes.'); }
    finally { setBusy(false); }
  }
  return <section className="editor"><h3>Organize this link</h3><label>Tags (comma separated)<input value={tags} onChange={event => setTags(event.target.value)} placeholder="work, learning" /></label><label>Notes<textarea value={notes} maxLength={20_000} onChange={event => setNotes(event.target.value)} /></label>
    <fieldset><legend>Collections</legend>{collections.length ? collections.map(collection => <label className="check" key={collection.id}><input type="checkbox" checked={membership.includes(collection.id)} onChange={event => setMembership(event.target.checked ? [...membership, collection.id] : membership.filter(value => value !== collection.id))} />{collection.name}</label>) : <p className="muted">Create a collection in the sidebar first.</p>}</fieldset>
    <button disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save organization'}</button>{message && <p role="status">{message}</p>}
  </section>;
}
