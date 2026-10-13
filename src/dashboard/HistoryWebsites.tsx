import { useLiveQuery } from 'dexie-react-hooks';
import { archiveOverview } from '../storage/overview';
export function HistoryWebsites({ since, onWebsite }: { since: number; onWebsite: (domain: string) => void }) {
  const archive = useLiveQuery(() => archiveOverview(since), [since]);
  return <section><h2>History by website</h2><ul className="results">{archive?.websiteRows.map(row => <li key={row.domain}><button onClick={() => onWebsite(row.domain)}>{row.domain}</button><small>{row.pages} pages · {row.visits} recorded visits</small></li>)}</ul>{archive && !archive.websiteRows.length && <p>No archived history yet.</p>}</section>;
}
