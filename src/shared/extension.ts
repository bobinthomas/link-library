export const isExtension = () => typeof chrome !== 'undefined' && Boolean(chrome.runtime?.id);
export async function refreshArchive(): Promise<void> {
  if (!isExtension()) throw new Error('Load the built extension in Chrome to collect real browser data.');
  const response = await chrome.runtime.sendMessage({ type: 'collect' });
  if (!response?.ok) throw new Error(response?.error ?? 'Collection could not start.');
}
