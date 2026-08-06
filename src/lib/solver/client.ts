import { supabase } from '@/integrations/supabase/client';
import { isLocalMode } from '@/lib/localMode';
import type {
  HealthResponse,
  RunResults,
  RunStatusResponse,
  ScenarioConfig,
  SubmitRunRequest,
  SubmitRunResponse,
  ValidateResponse,
} from './types';

export const SOLVER_NOT_CONNECTED_MESSAGE = 'The local optimization service is not responding.';

export function getSolverApiUrl(): string {
  const configured = String(import.meta.env.VITE_SOLVER_API_URL ?? '').trim().replace(/\/+$/, '');
  if (configured) return configured;
  return isLocalMode() && typeof window !== 'undefined' ? window.location.origin : '';
}

export function isSolverConfigured(): boolean {
  return getSolverApiUrl().length > 0;
}

export class SolverApiError extends Error {
  constructor(
    message: string,
    public status = 0,
    public code?: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'SolverApiError';
  }
}

interface RequestOptions { method?: 'GET' | 'POST'; body?: unknown; signal?: AbortSignal; anonymous?: boolean }

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const base = getSolverApiUrl();
  if (!base) throw new SolverApiError(SOLVER_NOT_CONNECTED_MESSAGE, 0, 'solver_not_configured');
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (!isLocalMode() && !options.anonymous) {
    const { data, error } = await supabase.auth.getSession();
    if (error || !data.session?.access_token) {
      throw new SolverApiError('You must be signed in to use the optimizer.', 401, 'no_session');
    }
    headers.Authorization = `Bearer ${data.session.access_token}`;
  }
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') throw error;
    throw new SolverApiError(SOLVER_NOT_CONNECTED_MESSAGE, 0, 'network_error');
  }
  const text = await response.text();
  let payload: unknown;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }
  if (!response.ok) {
    const envelope = (payload ?? {}) as {
      code?: string;
      message?: string;
      detail?: string | { code?: string; message?: string };
    };
    const detail = typeof envelope.detail === 'object' ? envelope.detail : undefined;
    const message = detail?.message ?? envelope.message ??
      (typeof envelope.detail === 'string' ? envelope.detail : `Optimizer request failed (HTTP ${response.status}).`);
    throw new SolverApiError(message, response.status, detail?.code ?? envelope.code, payload);
  }
  return payload as T;
}

export const solverApi = {
  health: (signal?: AbortSignal) => request<HealthResponse>('/healthz', { anonymous: true, signal }),
  validateScenario: (scenario: ScenarioConfig, signal?: AbortSignal) =>
    request<ValidateResponse>('/api/v1/validate', {
      method: 'POST', body: { scenario }, signal,
    }),
  submitRun: (payload: SubmitRunRequest, signal?: AbortSignal) =>
    request<SubmitRunResponse>('/api/v1/runs', { method: 'POST', body: payload, signal }),
  getRun: (runId: string, signal?: AbortSignal) =>
    request<RunStatusResponse>(`/api/v1/runs/${encodeURIComponent(runId)}`, { signal }),
  getResults: (runId: string, signal?: AbortSignal) =>
    request<RunResults>(`/api/v1/runs/${encodeURIComponent(runId)}/results`, { signal }),
  cancelRun: (runId: string, signal?: AbortSignal) =>
    request<RunStatusResponse>(`/api/v1/runs/${encodeURIComponent(runId)}/cancel`, {
      method: 'POST', signal,
    }),
};
