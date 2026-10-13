import type { Source } from '../domain/models';
export function sourcePermissions(sources: Source[]): (Source | 'tabs')[] {
  return [...new Set<Source | 'tabs'>([...sources, ...(sources.includes('sessions') ? ['tabs' as const] : [])])];
}
