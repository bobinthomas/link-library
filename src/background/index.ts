import { initializeSettings } from '../storage/db';
import { collectArchive } from '../collectors/collect';

chrome.runtime.onInstalled.addListener(() => {
  void initializeSettings().catch(error => console.error('Archive initialization failed', error));
});
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || message?.type !== 'collect') return;
  collectArchive().then(() => respond({ ok: true }), error => respond({ ok: false, error: error instanceof Error ? error.message : 'Collection failed.' }));
  return true;
});
