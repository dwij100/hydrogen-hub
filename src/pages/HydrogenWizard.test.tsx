import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter, MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

vi.mock('@/integrations/supabase/client', async () => {
  const mod = await import('@/test/supabaseMock');
  return { supabase: mod.supabase };
});

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('sonner', () => ({ toast: toastMock, Toaster: () => null }));

// Wizard steps render heavy data-driven forms; stub them so navigation is under test.
vi.mock('@/components/wizard/StepTimePeriod', () => ({ StepTimePeriod: () => <div>Step Time Period</div> }));
vi.mock('@/components/wizard/StepInfrastructure', () => ({ StepInfrastructure: () => <div>Step Infrastructure</div> }));
vi.mock('@/components/wizard/StepTransport', () => ({ StepTransport: () => <div>Step Transport</div> }));
vi.mock('@/components/wizard/StepConsumers', () => ({ StepConsumers: () => <div>Step Consumers</div> }));

import { mockState, resetMockState } from '@/test/supabaseMock';
import HydrogenWizard from '@/pages/HydrogenWizard';
import { StepReview } from '@/components/wizard/StepReview';
import { SolverRunProvider } from '@/context/SolverRunContext';
import {
  HydrogenProjectProvider,
  ACTIVE_PROJECT_KEY,
  type HydrogenProject,
} from '@/context/HydrogenProjectContext';

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

const completeConfig: Partial<HydrogenProject> = {
  timePeriod: { startDate: '2026-01-01', endDate: '2026-12-31', resolution: 'hourly', peakBiomassSeason: false },
  palmOilMills: [
    { id: 'a', catalogId: 'INF-POM-001', location: 'Mill A', state: 'Johor', capacity: 10, address: '', latitude: 1, longitude: 103, capacityUnit: 't FFB' },
  ],
  transport: {
    pomeTrucks: 0, biogasTrucks: 0, biomassTrucks: 2,
    prePurifiedHydrogenTrucks: 0, gaseousHydrogenTrailers: 0,
    bevFleet: 0, fcevFleet: 0, useRailway: false, railTrains: 0,
  },
  consumers: [
    { id: 'c1', consumerLocationId: 'CON-HC-001', state: 'Johor', locationName: 'Ammonia Plant', demandPerDay: 100 },
  ],
};

function renderWizard(entry: string) {
  window.history.pushState({}, '', entry);
  return render(
    <BrowserRouter>
      <HydrogenProjectProvider>
        <SolverRunProvider>
          <LocationProbe />
          <Routes>
            <Route path="/hydrogen" element={<div>Hydrogen Home</div>} />
            <Route path="/hydrogen/setup" element={<HydrogenWizard />} />
          </Routes>
        </SolverRunProvider>
      </HydrogenProjectProvider>
    </BrowserRouter>,
  );
}

beforeEach(() => {
  resetMockState();
  sessionStorage.clear();
  mockState.session = { user: { id: 'user-1' } };
});

describe('wizard navigation', () => {
  it('restores the step from the URL on refresh', async () => {
    mockState.projects = [{ id: 'project-1', name: 'Plan', config: completeConfig as never }];
    sessionStorage.setItem(ACTIVE_PROJECT_KEY, 'project-1');

    renderWizard('/hydrogen/setup?step=3');
    expect(await screen.findByText('Step Transport')).toBeInTheDocument();
  });

  it('writes the step into the URL and supports Next/Back', async () => {
    const user = userEvent.setup();
    mockState.projects = [{ id: 'project-1', name: 'Plan', config: completeConfig as never }];
    sessionStorage.setItem(ACTIVE_PROJECT_KEY, 'project-1');

    renderWizard('/hydrogen/setup');
    await screen.findByText('Step Time Period');
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('step=1'));

    await user.click(screen.getByRole('button', { name: /next/i }));
    expect(await screen.findByText('Step Infrastructure')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('step=2');

    await user.click(screen.getByRole('button', { name: /back/i }));
    expect(await screen.findByText('Step Time Period')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('step=1');
  });

  it('keeps browser Back/Forward in sync with the step', async () => {
    const user = userEvent.setup();
    mockState.projects = [{ id: 'project-1', name: 'Plan', config: completeConfig as never }];
    sessionStorage.setItem(ACTIVE_PROJECT_KEY, 'project-1');

    renderWizard('/hydrogen/setup?step=1');
    await screen.findByText('Step Time Period');
    await user.click(screen.getByRole('button', { name: /next/i }));
    await screen.findByText('Step Infrastructure');

    window.history.back();
    await waitFor(() => expect(screen.getByText('Step Time Period')).toBeInTheDocument());

    window.history.forward();
    await waitFor(() => expect(screen.getByText('Step Infrastructure')).toBeInTheDocument());
  });

  it('clamps an out-of-range step in the URL', async () => {
    mockState.projects = [{ id: 'project-1', name: 'Plan', config: {} }];
    sessionStorage.setItem(ACTIVE_PROJECT_KEY, 'project-1');

    renderWizard('/hydrogen/setup?step=99');
    await screen.findByRole('heading', { name: /optimization results/i, level: 2 });
    expect(screen.getByTestId('location')).toHaveTextContent('step=6');
  });

  it('blocks advancing past an invalid step', async () => {
    const user = userEvent.setup();
    mockState.projects = [{ id: 'project-1', name: 'Plan', config: {} }];
    sessionStorage.setItem(ACTIVE_PROJECT_KEY, 'project-1');

    renderWizard('/hydrogen/setup?step=2');
    await screen.findByText('Step Infrastructure');
    await user.click(screen.getByRole('button', { name: /next/i }));
    expect(toastMock.error).toHaveBeenCalled();
    expect(screen.getByText('Step Infrastructure')).toBeInTheDocument();
  });

  it('routes Hydrogen Home and Finish to /hydrogen', async () => {
    const user = userEvent.setup();
    mockState.projects = [{ id: 'project-1', name: 'Plan', config: completeConfig as never }];
    sessionStorage.setItem(ACTIVE_PROJECT_KEY, 'project-1');

    renderWizard('/hydrogen/setup?step=6');
    const finish = await screen.findByRole('button', { name: /finish/i });
    // Only one Finish control exists.
    expect(screen.getAllByRole('button', { name: /finish/i })).toHaveLength(1);
    await user.click(finish);
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/hydrogen'));
  });
});

describe('review and run', () => {
  const renderReview = () =>
    render(
      <MemoryRouter>
        <HydrogenProjectProvider>
          <SolverRunProvider>
            <StepReview />
          </SolverRunProvider>
        </HydrogenProjectProvider>
      </MemoryRouter>,
    );

  it('labels the mathematical objective accurately and shows no obsolete export', async () => {
    renderReview();
    expect(screen.getByText(/minimize total hydrogen imbalance/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /export configuration/i })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/local optimization service is not responding/i)).toBeInTheDocument());
  });

  it('keeps Run disabled until server validation and readiness succeed', async () => {
    renderReview();
    expect(screen.getByRole('button', { name: /run optimization/i })).toBeDisabled();
  });
});
