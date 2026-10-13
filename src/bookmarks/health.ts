export interface LinkHealth { url: string; state: 'alive' | 'dead' | 'redirected' | 'uncertain'; status?: number; checkedAt: number; reason: string }
export function originPermission(url: string) { const parsed = new URL(url); return `${parsed.protocol}//${parsed.hostname}/*`; }
export async function checkBookmarkUrl(url: string, fetcher: typeof fetch = fetch, signal?: AbortSignal): Promise<LinkHealth> {
  const result = (state: LinkHealth['state'], status: number | undefined, reason: string): LinkHealth => ({ url, state, status, reason, checkedAt: Date.now() });
  let parsed: URL;
  try { parsed = new URL(url); } catch { return result('uncertain', undefined, 'Invalid URL'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return result('uncertain', undefined, 'Unsupported URL or embedded credentials');
  try {
    const request = async (method: 'HEAD' | 'GET') => {
      const timeout = AbortSignal.timeout(8000);
      const response = await fetcher(url, { method, credentials: 'omit', redirect: 'manual', cache: 'no-store', referrerPolicy: 'no-referrer', signal: signal ? AbortSignal.any([timeout, signal]) : timeout });
      await response.body?.cancel();
      return response;
    };
    let response = await request('HEAD');
    if ([404, 410, 405, 501].includes(response.status)) response = await request('GET');
    if (response.type === 'opaqueredirect' || response.status >= 300 && response.status < 400) return result('redirected', response.status || undefined, 'Redirect detected; destination not checked');
    if ([404, 410].includes(response.status)) return result('dead', response.status, 'Page returned not found/gone; review before removing');
    if (response.ok) return result('alive', response.status, 'Responded successfully');
    return result('uncertain', response.status || undefined, 'May require sign-in, reject automated checks, or be temporarily unavailable');
  } catch { return result('uncertain', undefined, 'Network error or timeout; not evidence of a dead link'); }
}
export async function checkBookmarkBatch(urls: string[], onResult: (result: LinkHealth) => void, signal: AbortSignal) {
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(4, urls.length) }, async () => {
    while (!signal.aborted && cursor < urls.length) {
      const url = urls[cursor++];
      if (!await chrome.permissions.contains({ origins: [originPermission(url)] })) onResult({ url, state: 'uncertain', checkedAt: Date.now(), reason: 'Site permission unavailable' });
      else { const result = await checkBookmarkUrl(url, fetch, signal); if (!signal.aborted) onResult(result); }
    }
  }));
}
