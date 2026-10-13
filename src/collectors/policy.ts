export function allowedUrl(url: string, exclusions: string[]): boolean {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol) && !exclusions.some(domain => parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`));
  } catch { return false; }
}
export function parseExclusions(value: string): string[] {
  return [...new Set(value.split(/[\s,]+/).filter(Boolean).map(value => {
    const host = new URL(value.includes('://') ? value : `https://${value}`).hostname.toLowerCase();
    if (!host || host.includes('*')) throw new Error('Enter domain names without wildcards.');
    return host;
  }))];
}
