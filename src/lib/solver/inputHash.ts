import type { HydrogenProject } from '@/context/HydrogenProjectContext';
import { buildScenario } from './scenario';

/** Stable JSON stringify (sorted keys) so hashing is order-independent. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

/** The subset of the project that actually changes the optimization problem. */
export function getSolverInputs(project: HydrogenProject) {
  return buildScenario(project);
}

/** FNV-1a 32-bit — deterministic, dependency-free, good enough for change detection. */
export function computeInputHash(project: HydrogenProject): string {
  const input = stableStringify(getSolverInputs(project));
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `h${hash.toString(16).padStart(8, '0')}${input.length.toString(16)}`;
}

export { stableStringify };
