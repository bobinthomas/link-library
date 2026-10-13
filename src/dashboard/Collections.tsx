import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../storage/db';
import { createCollection } from '../storage/organization';

export function Collections({ selected, onSelect }: { selected: string; onSelect: (id: string) => void }) {
  const collections = useLiveQuery(() => db.collections.orderBy('name').toArray(), []);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  async function create() {
    try { const id = await createCollection(name); setName(''); setError(''); onSelect(id); }
    catch (error) { setError(error instanceof Error ? error.message : 'Unable to create collection.'); }
  }
  return <><nav aria-label="Collections">{collections?.map(collection => <button key={collection.id} aria-pressed={selected === collection.id} onClick={() => onSelect(collection.id)}>{collection.name} ({collection.linkIds.length})</button>)}</nav>
    <form className="collection-form" onSubmit={event => { event.preventDefault(); void create(); }}><label htmlFor="collection-name">New collection</label><input id="collection-name" value={name} onChange={event => setName(event.target.value)} maxLength={100} placeholder="Learning" /><button type="submit" disabled={!name.trim()}>Create collection</button></form>{error && <p role="alert">{error}</p>}</>;
}
