import { createRoot } from 'react-dom/client';
import { LinkSearch } from '../shared/LinkSearch';
import '../shared/styles.css';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../storage/db';

function Popup() {
  const settings = useLiveQuery(() => db.settings.get('local'), []);
  function openDashboard() {
    if (typeof chrome !== 'undefined' && chrome.runtime?.id) {
      void chrome.tabs.create({ url: chrome.runtime.getURL('index.html') });
    } else window.open('./index.html', '_blank', 'noopener');
  }
  return <main className="popup"><h1>Link Library</h1><p className="muted">{!settings?.onboardingCompleted ? 'Open dashboard to set up collection' : settings.paused ? 'Collection paused' : 'Manual collection enabled'}</p><LinkSearch compact installationName={settings?.installationName} /><button onClick={openDashboard}>Open dashboard ↗</button></main>;
}
createRoot(document.getElementById('root')!).render(<Popup />);
