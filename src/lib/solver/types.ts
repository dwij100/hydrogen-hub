/** Checked-in client types generated from the backend's versioned OpenAPI contract. */

export type RunState =
  | 'queued'
  | 'preparing'
  | 'validating'
  | 'solving'
  | 'processing_results'
  | 'completed'
  | 'failed'
  | 'cancelling'
  | 'cancelled'
  | 'timed_out';

export const TERMINAL_RUN_STATES: RunState[] = ['completed', 'failed', 'cancelled', 'timed_out'];
export const ACTIVE_RUN_STATES: RunState[] = [
  'queued', 'preparing', 'validating', 'solving', 'processing_results', 'cancelling',
];
export const RUN_STATE_LABELS: Record<RunState, string> = {
  queued: 'Queued',
  preparing: 'Preparing inputs',
  validating: 'Validating inputs',
  solving: 'Solving',
  processing_results: 'Processing results',
  completed: 'Completed',
  failed: 'Failed',
  cancelling: 'Cancelling',
  cancelled: 'Cancelled',
  timed_out: 'Timed out',
};
export const isTerminalRunState = (state: RunState) => TERMINAL_RUN_STATES.includes(state);

export interface ConsumerDemandInput {
  consumer_id: 'CON-HC-001' | 'CON-HC-002' | 'CON-HC-003';
  demand_kg_per_day: number;
}

export interface VehicleQuantitiesInput {
  pome_trucks: number;
  biogas_trucks: number;
  biomass_trucks: number;
  bioh2_trucks: number;
  gaseous_h2_trailers: number;
  bev_fleet: number;
  fcev_fleet: number;
}

export interface ScenarioConfig {
  dataset_id: 'johor118';
  horizon_hours: 24;
  infrastructure_ids: string[];
  solar_farm_ids: ('INF-SF-001' | 'INF-SF-002')[];
  consumers: ConsumerDemandInput[];
  vehicles: VehicleQuantitiesInput;
  railway: {
    enabled: boolean;
    station_ids: ('RFS-001' | 'RFS-002')[];
    train_count: number;
  };
}

export interface ValidationIssue {
  severity: 'error' | 'warning';
  code: string;
  table?: string | null;
  field?: string | null;
  row?: number | null;
  value?: string | null;
  expected?: string | null;
  message: string;
}

export interface DatasetSummary {
  id: 'johor118';
  name: string;
  source: 'bundled';
  tables?: { name: string; rows: number; columns?: number }[];
}

export interface ValidateResponse {
  valid: boolean;
  issues: ValidationIssue[];
  dataset?: DatasetSummary | null;
  resolved_configuration?: Record<string, unknown> | null;
}

export interface SubmitRunRequest {
  project_id?: string | null;
  project_name?: string | null;
  input_hash: string;
  idempotency_key: string;
  scenario: ScenarioConfig;
}

export interface SubmitRunResponse {
  run_id: string;
  status: RunState;
  duplicate: boolean;
}

export interface RunStatusResponse {
  run_id: string;
  project_id?: string | null;
  status: RunState;
  progress: number;
  message?: string | null;
  error?: string | null;
  error_code?: string | null;
  created_at: string;
  updated_at: string;
  started_at?: string | null;
  finished_at?: string | null;
  dataset: DatasetSummary;
  input_hash: string;
  solver_name: 'gurobi';
  termination_condition?: string | null;
  objective_value?: number | null;
  objective_label: string;
  solve_seconds?: number | null;
  cancellable: boolean;
}

export type ChartCategory = 'production' | 'flows' | 'utilization' | 'storage' | 'transport';
export interface ResultSeriesPoint { t: number | string; value: number }
export interface ResultSeries { key: string; label: string; unit: string; points: ResultSeriesPoint[] }
export type ResultChartType = 'line' | 'step' | 'bar';
export type ResultYAxisMode = 'auto' | 'fraction' | 'binary';
export interface ResultChartGroup {
  key: string;
  label: string;
  category: ChartCategory;
  xLabel: string;
  unit: string;
  series: ResultSeries[];
  chartType?: ResultChartType;
  yAxisMode?: ResultYAxisMode;
  description?: string | null;
}
export type ResultCell = string | number | boolean | null;
export interface ResultTable {
  key: string;
  label: string;
  columns: string[];
  rows: ResultCell[][];
  total_rows: number;
  page: number;
  page_size: number;
  truncated: boolean;
}
export interface RunResults {
  run_id: string;
  status: 'completed';
  solver_name: 'gurobi';
  termination_condition: string;
  objective_value: number;
  objective_label: string;
  objective_unit: string;
  solve_seconds?: number | null;
  dataset: DatasetSummary;
  input_summary: Record<string, ResultCell>;
  charts: ResultChartGroup[];
  tables: ResultTable[];
}

export interface HealthResponse {
  status: 'ok' | 'degraded';
  version: string;
  api: { ready: boolean; message: string };
  database: { ready: boolean; message: string };
  worker: { ready: boolean; message: string };
  storage: { ready: boolean; message: string };
  queue: { queued: number; active: number };
  solver: {
    name: 'gurobi';
    package_status: 'available' | 'unavailable';
    licence_status: 'missing' | 'invalid' | 'restricted' | 'full' | 'invocation_failed' | 'unchecked';
    ready: boolean;
    message: string;
  };
  dataset: { ready: boolean; message: string };
}
