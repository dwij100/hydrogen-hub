import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScenarioConfig, SubmitRunRequest } from './types';

const getSession = vi.hoisted(() => vi.fn());
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { auth: { getSession } },
}));

import {
  SOLVER_NOT_CONNECTED_MESSAGE,
  SolverApiError,
  getSolverApiUrl,
  isSolverConfigured,
  solverApi,
} from './client';

const fetchMock = vi.fn();
const scenario: ScenarioConfig = {
  dataset_id: 'johor118',
  horizon_hours: 24,
  infrastructure_ids: ['INF-POM-001'],
  solar_farm_ids: ['INF-SF-001'],
  consumers: [{ consumer_id: 'CON-HC-001', demand_kg_per_day: 100 }],
  vehicles: {
    pome_trucks: 1, biogas_trucks: 0, biomass_trucks: 0, bioh2_trucks: 0,
    gaseous_h2_trailers: 0, bev_fleet: 0, fcev_fleet: 0,
  },
  railway: { enabled: false, station_ids: [], train_count: 0 },
};
const runRequest: SubmitRunRequest = {
  project_id: 'project-1', input_hash: 'hash-1', idempotency_key: '12345678', scenario,
};

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('VITE_LOCAL_MODE', 'false');
  getSession.mockResolvedValue({
    data: { session: { access_token: 'token-123' } },
    error: null,
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('solver API configuration', () => {
  it('reports not configured when cloud mode has no solver URL', () => {
    vi.stubEnv('VITE_SOLVER_API_URL', '');
    expect(isSolverConfigured()).toBe(false);
  });

  it('strips trailing slashes from the configured base URL', () => {
    vi.stubEnv('VITE_SOLVER_API_URL', 'https://solver.example.com/');
    expect(getSolverApiUrl()).toBe('https://solver.example.com');
    expect(isSolverConfigured()).toBe(true);
  });

  it('uses the current origin in local mode', () => {
    vi.stubEnv('VITE_SOLVER_API_URL', '');
    vi.stubEnv('VITE_LOCAL_MODE', 'true');
    expect(getSolverApiUrl()).toBe(window.location.origin);
  });

  it('raises a typed error without calling fetch when unconfigured', async () => {
    vi.stubEnv('VITE_SOLVER_API_URL', '');
    await expect(solverApi.getRun('run-1')).rejects.toMatchObject({
      code: 'solver_not_configured', message: SOLVER_NOT_CONNECTED_MESSAGE,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('solver API requests', () => {
  beforeEach(() => vi.stubEnv('VITE_SOLVER_API_URL', 'https://solver.example.com'));

  it('sends the user access token in cloud mode and never a server key', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ run_id: 'run-1', status: 'queued' }));
    await solverApi.getRun('run-1');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://solver.example.com/api/v1/runs/run-1');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer token-123');
    expect(JSON.stringify(headers)).not.toMatch(/service[_-]?role/i);
  });

  it('does not require a user session for health', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ status: 'degraded' }));
    await solverApi.health();
    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });

  it('does not send an authorization header in local mode', async () => {
    vi.stubEnv('VITE_LOCAL_MODE', 'true');
    fetchMock.mockResolvedValue(jsonResponse({ run_id: 'run-1', status: 'queued' }));
    await solverApi.getRun('run-1');
    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });

  it('fails safely when cloud mode has no session', async () => {
    getSession.mockResolvedValue({ data: { session: null }, error: null });
    await expect(solverApi.getRun('run-1')).rejects.toMatchObject({ status: 401, code: 'no_session' });
  });

  it('posts authoritative validation JSON to the versioned route', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ valid: true, issues: [] }));
    const result = await solverApi.validateScenario(scenario);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://solver.example.com/api/v1/validate');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ scenario });
    expect(result.valid).toBe(true);
  });

  it('posts the complete typed run request', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ run_id: 'run-1', status: 'queued', duplicate: false }, 202));
    await solverApi.submitRun(runRequest);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://solver.example.com/api/v1/runs');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual(runRequest);
  });

  it('surfaces a structured backend error envelope', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: { code: 'scenario_invalid', message: 'bad selection' } }, 422));
    await expect(solverApi.submitRun(runRequest)).rejects.toMatchObject({
      message: 'bad selection', status: 422, code: 'scenario_invalid',
    });
  });

  it('reports network failures without fabricating results', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(solverApi.getResults('run-1')).rejects.toMatchObject({
      code: 'network_error', message: SOLVER_NOT_CONNECTED_MESSAGE,
    });
  });

  it('cancels a run via POST on the versioned route', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ run_id: 'run-1', status: 'cancelled' }));
    const status = await solverApi.cancelRun('run-1');
    expect(fetchMock.mock.calls[0][0]).toBe('https://solver.example.com/api/v1/runs/run-1/cancel');
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe('POST');
    expect(status.status).toBe('cancelled');
  });

  it('exposes SolverApiError for instanceof checks', () => {
    expect(new SolverApiError('x', 500)).toBeInstanceOf(Error);
  });
});
