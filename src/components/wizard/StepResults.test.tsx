import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const state = vi.hoisted(() => ({ solver: {} as Record<string, unknown> }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
vi.mock('@/context/HydrogenProjectContext', () => ({
  useHydrogenProject: () => ({ project: { dataset: { id: 'johor118' } } }),
}));
vi.mock('@/context/SolverRunContext', () => ({ useSolverRun: () => state.solver }));

import { chartExtents, StepResults, toChartData } from './StepResults';

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() { /* jsdom layout is intentionally absent */ }
    unobserve() { /* jsdom layout is intentionally absent */ }
    disconnect() { /* jsdom layout is intentionally absent */ }
  });
});
afterAll(() => vi.unstubAllGlobals());

const run = {
  run_id: 'run-1', status: 'completed', progress: 100, input_hash: 'h1',
  solver_name: 'gurobi', termination_condition: 'optimal', objective_value: 0,
  objective_label: 'Total hydrogen imbalance', cancellable: false,
  dataset: { id: 'johor118', name: 'Johor 118 (bundled)', source: 'bundled' },
};
const results = {
  run_id: 'run-1', status: 'completed', solver_name: 'gurobi',
  termination_condition: 'optimal', objective_value: 0,
  objective_label: 'Total hydrogen imbalance', objective_unit: 'model hydrogen units',
  dataset: run.dataset, input_summary: {},
  charts: [{
    key: 'h2', label: 'Hydrogen inventory', category: 'flows', xLabel: 'Hour (1-24)', unit: 'kg H2',
    series: [{ key: 'c1', label: 'C1', unit: 'kg H2', points: [{ t: 1, value: 12.5 }] }],
    description: 'Source variable: h2_inven.',
  }],
  tables: [{
    key: 'raw', label: 'Raw variables', columns: ['Variable', 'Value'],
    rows: [['h2_inven', 12.5], ['pv_gen', 3]], total_rows: 2, page: 1, page_size: 2500, truncated: false,
  }],
};

beforeEach(() => {
  state.solver = {
    backendConfigured: true, run, results, isStale: false, isPolling: false,
    isLoadingResults: false, runError: null, resultsError: null, loadRun: vi.fn(),
  };
});

describe('real result presentation', () => {
  it('renders objective, source-labelled chart, units, and real raw rows', () => {
    render(<MemoryRouter><StepResults /></MemoryRouter>);
    expect(screen.getByText('Total hydrogen imbalance')).toBeInTheDocument();
    expect(screen.getByText(/Hydrogen inventory \(kg H2\)/)).toBeInTheDocument();
    expect(screen.getByText('h2_inven')).toBeInTheDocument();
    expect(screen.getByText('pv_gen')).toBeInTheDocument();
  });


  it('uses the complete 1-24 hour axis without converting missing values into zero', () => {
    const data = toChartData(results.charts[0]);
    expect(data).toHaveLength(24);
    expect(data[0]).toMatchObject({ t: 1, c1: 12.5 });
    expect(data[1]).toEqual({ t: 2 });
    expect(data[23]).toEqual({ t: 24 });
  });

  it('sizes stacked bar axes from the hourly stack total rather than one segment', () => {
    const group = {
      ...results.charts[0],
      chartType: 'bar' as const,
      series: [
        { key: 'a', label: 'A', unit: 'u', points: [{ t: 1, value: 25 }] },
        { key: 'b', label: 'B', unit: 'u', points: [{ t: 1, value: 30 }] },
        { key: 'c', label: 'C', unit: 'u', points: [{ t: 2, value: -12 }] },
      ],
    };
    const data = toChartData(group);
    expect(chartExtents(data, ['a', 'b', 'c'], 'bar')).toEqual([-12, 55]);
  });

  it('renders external series controls and can hide a crowded series', async () => {
    const user = userEvent.setup();
    state.solver = {
      ...state.solver,
      results: {
        ...results,
        charts: [{
          ...results.charts[0],
          series: [
            { key: 'a', label: 'storage_unit=BESS1', unit: 'u', points: [{ t: 1, value: 1 }] },
            { key: 'b', label: 'storage_unit=BESS2', unit: 'u', points: [{ t: 1, value: 2 }] },
          ],
        }],
      },
    };
    render(<MemoryRouter><StepResults /></MemoryRouter>);
    const toggle = screen.getByRole('button', { name: /hide storage_unit=BESS2/i });
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
  });

  it('renders binary states as an hourly activity matrix instead of overlapping lines', () => {
    state.solver = {
      ...state.solver,
      results: {
        ...results,
        charts: [{
          ...results.charts[0],
          label: 'Vehicles in transit',
          unit: 'binary',
          yAxisMode: 'binary' as const,
          chartType: 'step' as const,
          series: [{
            key: 'vehicle-1',
            label: 'vehicle=TK1',
            unit: 'binary',
            points: [{ t: 1, value: 0 }, { t: 2, value: 1 }],
          }],
        }],
      },
    };
    render(<MemoryRouter><StepResults /></MemoryRouter>);
    expect(screen.getByText(/filled cells are active/i)).toBeInTheDocument();
    expect(screen.getByTitle(/TK1, hour 2: active/i)).toBeInTheDocument();
  });

  it('filters raw-variable rows without replacing backend data', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><StepResults /></MemoryRouter>);
    await user.type(screen.getByRole('textbox', { name: /filter raw variables/i }), 'pv_gen');
    expect(screen.getByText('pv_gen')).toBeInTheDocument();
    expect(screen.queryByText('h2_inven')).not.toBeInTheDocument();
  });

  it('shows explicit empty states for empty chart and table responses', () => {
    state.solver = {
      ...state.solver,
      results: {
        ...results,
        charts: [{ ...results.charts[0], series: [] }],
        tables: [{ ...results.tables[0], rows: [], total_rows: 0 }],
      },
    };
    render(<MemoryRouter><StepResults /></MemoryRouter>);
    expect(screen.getByText(/no data points for this chart/i)).toBeInTheDocument();
    expect(screen.getByText(/no rows for this table/i)).toBeInTheDocument();
  });

  it('shows failed runs as failures without a result interface', () => {
    state.solver = {
      ...state.solver,
      run: { ...run, status: 'failed', error: 'The solver stopped.', termination_condition: null },
      results: null,
    };
    render(<MemoryRouter><StepResults /></MemoryRouter>);
    expect(screen.getByText(/did not produce an optimal solution/i)).toBeInTheDocument();
    expect(screen.queryByText('Raw variables')).not.toBeInTheDocument();
  });
});
