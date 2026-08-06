import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/integrations/supabase/client', async () => {
  const mod = await import('@/test/supabaseMock');
  return { supabase: mod.supabase };
});
vi.mock('@/lib/solver/runStorage', async () => {
  const actual = await vi.importActual<typeof import('@/lib/solver/runStorage')>('@/lib/solver/runStorage');
  return { ...actual, POLL_INTERVAL_MS: 5 };
});

import { mockState, resetMockState } from '@/test/supabaseMock';
import { ACTIVE_PROJECT_KEY, HydrogenProjectProvider, useHydrogenProject } from './HydrogenProjectContext';
import { SolverRunProvider, useSolverRun } from './SolverRunContext';
import { RUN_STORAGE_PREFIX } from '@/lib/solver/runStorage';

const fetchMock = vi.fn();
const health = {
  status: 'ok', version: '1.0.0',
  api: { ready: true, message: 'ready' },
  database: { ready: true, message: 'ready' },
  worker: { ready: true, message: 'ready' },
  storage: { ready: true, message: 'ready' },
  queue: { queued: 0, active: 0 },
  solver: { name: 'gurobi', package_status: 'available', licence_status: 'full', ready: true, message: 'ready' },
  dataset: { ready: true, message: 'ready' },
};
const projectConfig = {
  palmOilMills: [{
    id: 'row-1', catalogId: 'INF-POM-001', location: 'POM 1', state: 'Johor',
    capacity: 1, address: '', latitude: 1, longitude: 103, capacityUnit: 't FFB',
  }],
  consumers: [{
    id: 'c1', consumerLocationId: 'CON-HC-001', state: 'Johor',
    locationName: 'Consumer 1', demandPerDay: 100,
  }],
  transport: { pomeTrucks: 1 },
};

function response(body: unknown, status = 200) {
  return { ok: status < 400, status, text: async () => JSON.stringify(body) } as unknown as Response;
}

function runStatus(status: string, extra: Record<string, unknown> = {}) {
  return {
    run_id: 'run-9', status, progress: status === 'completed' ? 100 : 50,
    input_hash: 'hash-from-api', cancellable: ['queued', 'preparing', 'validating', 'solving'].includes(status),
    ...extra,
  };
}

function completedResults() {
  return {
    run_id: 'run-9', status: 'completed', solver_name: 'gurobi',
    termination_condition: 'optimal', objective_value: 0, objective_label: 'Total hydrogen imbalance',
    objective_unit: 'model hydrogen units', dataset: { id: 'johor118', name: 'Johor 118 (bundled)', source: 'bundled' },
    input_summary: {}, charts: [], tables: [],
  };
}

function Harness() {
  const solver = useSolverRun();
  const { project, updateProject } = useHydrogenProject();
  return <div>
    <div data-testid="ready">{String(solver.solverReady)}</div>
    <div data-testid="status">{solver.run?.status ?? 'none'}</div>
    <div data-testid="valid">{String(solver.validation?.valid ?? 'none')}</div>
    <div data-testid="stale">{String(solver.isStale)}</div>
    <div data-testid="run-error">{solver.runError ?? ''}</div>
    <div data-testid="validation-error">{solver.validationError ?? ''}</div>
    <div data-testid="charts">{String(solver.results?.charts?.length ?? 'none')}</div>
    <button onClick={() => void solver.validate()}>validate</button>
    <button onClick={() => void solver.submitRun()}>submit</button>
    <button onClick={() => void solver.cancelRun()}>cancel</button>
    <button onClick={() => updateProject({ transport: { ...project.transport, pomeTrucks: 2 } })}>change input</button>
  </div>;
}

const renderHarness = () => render(<HydrogenProjectProvider><SolverRunProvider><Harness /></SolverRunProvider></HydrogenProjectProvider>);

beforeEach(() => {
  resetMockState();
  sessionStorage.clear();
  localStorage.clear();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('VITE_LOCAL_MODE', 'false');
  vi.stubEnv('VITE_SOLVER_API_URL', 'https://solver.example.com');
  mockState.session = { user: { id: 'user-1' }, access_token: 'token-123' } as never;
  mockState.projects = [{ id: 'project-1', name: 'Plan', config: projectConfig }];
  sessionStorage.setItem(ACTIVE_PROJECT_KEY, 'project-1');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('solver run context', () => {
  it('reports authoritative backend validation errors', async () => {
    fetchMock.mockImplementation((url: string) => url.endsWith('/healthz')
      ? Promise.resolve(response(health))
      : Promise.resolve(response({ valid: false, issues: [{ severity: 'error', code: 'missing', message: 'missing plant' }] })));
    const user = userEvent.setup();
    renderHarness();
    await user.click(screen.getByText('validate'));
    await waitFor(() => expect(screen.getByTestId('valid')).toHaveTextContent('false'));
  });

  it('preserves field-level issues from request-schema validation', async () => {
    fetchMock.mockImplementation((url: string) => url.endsWith('/healthz')
      ? Promise.resolve(response(health))
      : Promise.resolve(response({ detail: {
        code: 'request_validation_error', message: 'Configuration request is invalid.',
        issues: [{ severity: 'error', code: 'missing', table: 'scenario', field: 'scenario.infrastructure_ids', message: 'Field required' }],
      } }, 422)));
    const user = userEvent.setup();
    renderHarness();
    await user.click(screen.getByText('validate'));
    await waitFor(() => expect(screen.getByTestId('valid')).toHaveTextContent('false'));
    expect(screen.getByTestId('validation-error')).toBeEmptyDOMElement();
  });

  it('submits, polls to completion, persists the run ID, and accepts empty real series', async () => {
    let poll = 0;
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith('/healthz')) return Promise.resolve(response(health));
      if (url.endsWith('/api/v1/runs') && init?.method === 'POST') return Promise.resolve(response({ run_id: 'run-9', status: 'queued', duplicate: false }, 202));
      if (url.endsWith('/api/v1/runs/run-9/results')) return Promise.resolve(response(completedResults()));
      if (url.endsWith('/api/v1/runs/run-9')) return Promise.resolve(response(runStatus(++poll > 1 ? 'completed' : 'solving')));
      throw new Error(`unexpected URL ${url}`);
    });
    const user = userEvent.setup();
    renderHarness();
    await waitFor(() => expect(screen.getByTestId('ready')).toHaveTextContent('true'));
    await user.click(screen.getByText('submit'));
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('completed'));
    expect(screen.getByTestId('charts')).toHaveTextContent('0');
    expect(localStorage.getItem(`${RUN_STORAGE_PREFIX}project-1`)).toContain('run-9');
  });

  it('prevents duplicate submissions while a run is active', async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith('/healthz')) return Promise.resolve(response(health));
      if (url.endsWith('/api/v1/runs') && init?.method === 'POST') return Promise.resolve(response({ run_id: 'run-9', status: 'queued', duplicate: false }, 202));
      return Promise.resolve(response(runStatus('solving')));
    });
    const user = userEvent.setup();
    renderHarness();
    await waitFor(() => expect(screen.getByTestId('ready')).toHaveTextContent('true'));
    await user.click(screen.getByText('submit'));
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('solving'));
    const submissions = () => fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith('/api/v1/runs') && (init as RequestInit)?.method === 'POST').length;
    const before = submissions();
    await user.click(screen.getByText('submit'));
    expect(submissions()).toBe(before);
  });

  it('cancels an active run and never requests successful results', async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith('/healthz')) return Promise.resolve(response(health));
      if (url.endsWith('/api/v1/runs') && init?.method === 'POST') return Promise.resolve(response({ run_id: 'run-9', status: 'queued', duplicate: false }, 202));
      if (url.endsWith('/cancel')) return Promise.resolve(response(runStatus('cancelled', { progress: 100, cancellable: false })));
      return Promise.resolve(response(runStatus('solving')));
    });
    const user = userEvent.setup();
    renderHarness();
    await waitFor(() => expect(screen.getByTestId('ready')).toHaveTextContent('true'));
    await user.click(screen.getByText('submit'));
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('solving'));
    await user.click(screen.getByText('cancel'));
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('cancelled'));
    expect(screen.getByTestId('charts')).toHaveTextContent('none');
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/results'))).toBe(false);
  });

  it('surfaces a failed run without loading results', async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith('/healthz')) return Promise.resolve(response(health));
      if (url.endsWith('/api/v1/runs') && init?.method === 'POST') return Promise.resolve(response({ run_id: 'run-9', status: 'queued', duplicate: false }, 202));
      return Promise.resolve(response(runStatus('failed', { progress: 100, error: 'solver stopped', cancellable: false })));
    });
    const user = userEvent.setup();
    renderHarness();
    await waitFor(() => expect(screen.getByTestId('ready')).toHaveTextContent('true'));
    await user.click(screen.getByText('submit'));
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('failed'));
    expect(screen.getByTestId('charts')).toHaveTextContent('none');
  });

  it('recovers a persisted active run after refresh', async () => {
    localStorage.setItem(`${RUN_STORAGE_PREFIX}project-1`, JSON.stringify({
      runId: 'run-stored', inputHash: 'saved-hash', datasetId: 'johor118', submittedAt: new Date().toISOString(),
    }));
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/healthz')) return Promise.resolve(response(health));
      return Promise.resolve(response(runStatus('timed_out', { run_id: 'run-stored', progress: 100, input_hash: 'saved-hash', cancellable: false })));
    });
    renderHarness();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('timed_out'));
  });

  it('flags completed results as stale when an applied solver input changes', async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith('/healthz')) return Promise.resolve(response(health));
      if (url.endsWith('/api/v1/runs') && init?.method === 'POST') return Promise.resolve(response({ run_id: 'run-9', status: 'queued', duplicate: false }, 202));
      if (url.endsWith('/results')) return Promise.resolve(response(completedResults()));
      return Promise.resolve(response(runStatus('completed', { progress: 100, cancellable: false })));
    });
    const user = userEvent.setup();
    renderHarness();
    await waitFor(() => expect(screen.getByTestId('ready')).toHaveTextContent('true'));
    await user.click(screen.getByText('submit'));
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('completed'));
    expect(screen.getByTestId('stale')).toHaveTextContent('false');
    await user.click(screen.getByText('change input'));
    await waitFor(() => expect(screen.getByTestId('stale')).toHaveTextContent('true'));
  });

  it('reports the backend as unavailable instead of inventing data', async () => {
    vi.stubEnv('VITE_SOLVER_API_URL', '');
    const user = userEvent.setup();
    renderHarness();
    await user.click(screen.getByText('submit'));
    await waitFor(() => expect(screen.getByTestId('run-error')).toHaveTextContent(/local optimization service is not responding/i));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports network failures during validation', async () => {
    fetchMock.mockImplementation((url: string) => url.endsWith('/healthz')
      ? Promise.resolve(response(health)) : Promise.reject(new TypeError('Failed to fetch')));
    const user = userEvent.setup();
    renderHarness();
    await user.click(screen.getByText('validate'));
    await waitFor(() => expect(screen.getByTestId('validation-error')).toHaveTextContent(/not responding/i));
  });

  it('blocks submission when Gurobi readiness is restricted', async () => {
    const restricted = { ...health, status: 'degraded', solver: { ...health.solver, ready: false, licence_status: 'restricted', message: 'size-limited' } };
    fetchMock.mockResolvedValue(response(restricted));
    const user = userEvent.setup();
    renderHarness();
    await waitFor(() => expect(screen.getByTestId('ready')).toHaveTextContent('false'));
    await user.click(screen.getByText('submit'));
    expect(screen.getByTestId('run-error')).toHaveTextContent('size-limited');
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/api/v1/runs'))).toHaveLength(0);
  });
});
