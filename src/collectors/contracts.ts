import type { Settings, Source } from '../domain/models';

// Shared contract for future resumable/scheduled collectors; manual prototype lives in collect.ts.
export interface CollectorContext {
  settings: Settings;
  signal: AbortSignal;
  onProgress: (count: number) => void;
}
export interface Collector {
  source: Source;
  collect(context: CollectorContext): Promise<void>;
}
