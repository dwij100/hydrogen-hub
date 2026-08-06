import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';

vi.mock('@/integrations/supabase/client', async () => {
  const mod = await import('@/test/supabaseMock');
  return { supabase: mod.supabase };
});

import { mockState, resetMockState } from '@/test/supabaseMock';
import {
  HydrogenProjectProvider,
  useHydrogenProject,
  ACTIVE_PROJECT_KEY,
  DRAFT_PROJECT_NAME,
} from '@/context/HydrogenProjectContext';

type Api = ReturnType<typeof useHydrogenProject>;
let api: Api;

function Probe() {
  api = useHydrogenProject();
  return (
    <div>
      <span data-testid="hydrated">{String(api.hydrated)}</span>
      <span data-testid="active">{api.activeProjectId ?? 'none'}</span>
      <span data-testid="name">{api.project.projectName}</span>
      <span data-testid="start">{api.project.timePeriod.startDate}</span>
      <span data-testid="status">{api.saveStatus}</span>
      <span data-testid="error">{api.saveError ?? ''}</span>
    </div>
  );
}

const renderProvider = () =>
  render(
    <HydrogenProjectProvider>
      <Probe />
    </HydrogenProjectProvider>,
  );

beforeEach(() => {
  resetMockState();
  sessionStorage.clear();
  vi.useRealTimers();
});

describe('project persistence', () => {
  it('creates an "Untitled Hydrogen Project" draft when configuration starts', async () => {
    mockState.session = { user: { id: 'user-1' } };
    renderProvider();
    await waitFor(() => expect(screen.getByTestId('hydrated')).toHaveTextContent('true'));
    expect(screen.getByTestId('active')).toHaveTextContent('none');

    await act(async () => {
      await api.ensureActiveProject();
    });

    expect(mockState.projects[0].name).toBe(DRAFT_PROJECT_NAME);
    expect(sessionStorage.getItem(ACTIVE_PROJECT_KEY)).toBe(mockState.projects[0].id);
  });

  it('reuses the existing active project instead of creating duplicates', async () => {
    mockState.session = { user: { id: 'user-1' } };
    renderProvider();
    await waitFor(() => expect(screen.getByTestId('hydrated')).toHaveTextContent('true'));

    await act(async () => {
      await api.ensureActiveProject();
      await api.ensureActiveProject();
    });
    expect(mockState.projects).toHaveLength(1);
  });

  it('hydrates a saved project from the backend on refresh before rendering data', async () => {
    mockState.projects = [
      {
        id: 'project-1',
        name: 'Johor Plan',
        config: { timePeriod: { startDate: '2026-03-01' }, transport: { biomassTrucks: 3 } },
      },
    ];
    sessionStorage.setItem(ACTIVE_PROJECT_KEY, 'project-1');

    renderProvider();
    await waitFor(() => expect(screen.getByTestId('hydrated')).toHaveTextContent('true'));
    expect(screen.getByTestId('name')).toHaveTextContent('Johor Plan');
    expect(screen.getByTestId('start')).toHaveTextContent('2026-03-01');
    expect(api.project.transport.biomassTrucks).toBe(3);
    // Defaults are preserved for keys missing from the saved config.
    expect(api.project.transport.pomeTrucks).toBe(0);
    expect(api.project.transport.railTrains).toBe(0);
  });

  it('does not autosave defaults over a saved project before hydration completes', async () => {
    vi.useFakeTimers();
    mockState.projects = [
      { id: 'project-1', name: 'Johor Plan', config: { timePeriod: { startDate: '2026-03-01' } } },
    ];
    sessionStorage.setItem(ACTIVE_PROJECT_KEY, 'project-1');

    renderProvider();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(mockState.updates).toHaveLength(0);
    expect(mockState.projects[0].config).toEqual({ timePeriod: { startDate: '2026-03-01' } });
    vi.useRealTimers();
  });

  it('autosaves edits after hydration and reports saving/saved states', async () => {
    vi.useFakeTimers();
    mockState.projects = [{ id: 'project-1', name: 'Johor Plan', config: {} }];
    sessionStorage.setItem(ACTIVE_PROJECT_KEY, 'project-1');

    renderProvider();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });

    act(() => {
      api.updateProject({ projectName: 'Renamed' });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600);
    });

    expect(mockState.updates[mockState.updates.length - 1]?.name).toBe('Renamed');
    expect(screen.getByTestId('status')).toHaveTextContent('saved');
    vi.useRealTimers();
  });

  it('surfaces a save error state when the backend rejects the update', async () => {
    vi.useFakeTimers();
    mockState.projects = [{ id: 'project-1', name: 'Johor Plan', config: {} }];
    mockState.failUpdate = true;
    sessionStorage.setItem(ACTIVE_PROJECT_KEY, 'project-1');

    renderProvider();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    act(() => {
      api.updateProject({ projectName: 'Renamed' });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600);
    });

    expect(screen.getByTestId('status')).toHaveTextContent('error');
    expect(screen.getByTestId('error')).toHaveTextContent('update failed');
    vi.useRealTimers();
  });

  it('clears the active project when it was deleted or is unavailable', async () => {
    sessionStorage.setItem(ACTIVE_PROJECT_KEY, 'deleted-project');
    renderProvider();
    await waitFor(() => expect(screen.getByTestId('hydrated')).toHaveTextContent('true'));

    expect(screen.getByTestId('active')).toHaveTextContent('none');
    expect(sessionStorage.getItem(ACTIVE_PROJECT_KEY)).toBeNull();
    expect(screen.getByTestId('name')).toHaveTextContent('');
  });

  it('loads a selected project and clears it on demand', async () => {
    mockState.projects = [{ id: 'project-1', name: 'Johor Plan', config: {} }];
    renderProvider();
    await waitFor(() => expect(screen.getByTestId('hydrated')).toHaveTextContent('true'));

    await act(async () => {
      const ok = await api.loadProject('project-1');
      expect(ok).toBe(true);
    });
    expect(screen.getByTestId('active')).toHaveTextContent('project-1');

    act(() => api.clearActiveProject());
    expect(screen.getByTestId('active')).toHaveTextContent('none');
    expect(sessionStorage.getItem(ACTIVE_PROJECT_KEY)).toBeNull();
  });

  it('reports an error when a draft project cannot be created', async () => {
    mockState.session = { user: { id: 'user-1' } };
    mockState.failInsert = true;
    renderProvider();
    await waitFor(() => expect(screen.getByTestId('hydrated')).toHaveTextContent('true'));

    await act(async () => {
      const id = await api.ensureActiveProject();
      expect(id).toBeNull();
    });
    expect(screen.getByTestId('status')).toHaveTextContent('error');
  });
});
