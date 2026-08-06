import { Fragment, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AlertTriangle, Download, Info, Loader2 } from 'lucide-react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useHydrogenProject } from '@/context/HydrogenProjectContext';
import { useSolverRun } from '@/context/SolverRunContext';
import { SOLVER_NOT_CONNECTED_MESSAGE } from '@/lib/solver/client';
import {
  ACTIVE_RUN_STATES,
  RUN_STATE_LABELS,
  type ChartCategory,
  type ResultChartGroup,
  type ResultTable,
} from '@/lib/solver/types';

const CATEGORY_LABELS: Record<ChartCategory, string> = {
  production: 'Hydrogen production',
  flows: 'Hydrogen flows',
  utilization: 'Infrastructure utilization',
  storage: 'Storage',
  transport: 'Transport',
};

const CATEGORY_ORDER: ChartCategory[] = [
  'production',
  'flows',
  'utilization',
  'storage',
  'transport',
];

const SERIES_COLORS = [
  'hsl(190 78% 38%)',
  'hsl(210 75% 56%)',
  'hsl(218 24% 55%)',
  'hsl(215 28% 32%)',
  'hsl(165 55% 42%)',
  'hsl(35 85% 50%)',
  'hsl(275 45% 52%)',
  'hsl(0 65% 52%)',
];

const SERIES_DASHES = [
  undefined,
  '9 4',
  '3 3',
  '12 4 3 4',
  '6 3',
  '2 3',
  '14 4',
  '8 3 2 3',
] as const;

const MODEL_HOURS = Array.from({ length: 24 }, (_, index) => index + 1);
const X_TICKS = [1, 4, 8, 12, 16, 20, 24];
const BAR_X_DOMAIN: [number, number] = [0.5, 24.5];
const PROFILE_X_DOMAIN: [number, number] = [1, 24];
const ZERO_TOLERANCE = 1e-12;

type RenderChartType = 'line' | 'step' | 'bar';
type ChartRow = Record<string, number>;

export function toChartData(group: ResultChartGroup): ChartRow[] {
  // Pre-create the complete numeric horizon. Values remain undefined until the
  // backend supplies them, so genuine missing solver values render as gaps.
  const byX = new Map<number, ChartRow>(
    MODEL_HOURS.map((hour) => [hour, { t: hour }]),
  );
  group.series.forEach((series) => {
    series.points.forEach((point) => {
      const hour = Number(point.t);
      const value = Number(point.value);
      if (!Number.isFinite(hour) || !Number.isFinite(value)) return;
      const existing = byX.get(hour) ?? { t: hour };
      existing[series.key] = value;
      byX.set(hour, existing);
    });
  });
  return Array.from(byX.values()).sort((a, b) => a.t - b.t);
}

function inferChartType(group: ResultChartGroup): RenderChartType {
  if (group.chartType) return group.chartType;
  if (/charge|discharge|load|unload|generation|outflow/i.test(group.label)) return 'bar';
  if (/state|inventory|transit|demand/i.test(group.label)) return 'step';
  return 'line';
}

function conciseSeriesLabel(label: string): string {
  return label
    .split(', ')
    .map((part) => {
      const equalsIndex = part.indexOf('=');
      return equalsIndex >= 0 ? part.slice(equalsIndex + 1) : part;
    })
    .join(' · ');
}

function niceAxisBound(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const roughStep = value / 4;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const normalized = roughStep / magnitude;
  const niceStep = normalized <= 1
    ? 1
    : normalized <= 2
      ? 2
      : normalized <= 2.5
        ? 2.5
        : normalized <= 5
          ? 5
          : 10;
  const step = niceStep * magnitude;
  return Math.ceil(value / step) * step;
}

/**
 * Return the plotted minimum and maximum.
 *
 * Bar series are stacked, so their axis must be based on the positive and
 * negative stack totals at each hour rather than the largest individual bar.
 * This prevents stacks from being clipped or receiving misleading tick marks.
 */
export function chartExtents(
  data: ChartRow[],
  seriesKeys: string[],
  chartType: RenderChartType,
): [number, number] {
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;

  data.forEach((row) => {
    if (chartType === 'bar') {
      let positive = 0;
      let negative = 0;
      let found = false;
      seriesKeys.forEach((key) => {
        const value = Number(row[key]);
        if (!Number.isFinite(value)) return;
        found = true;
        if (value >= 0) positive += value;
        else negative += value;
      });
      if (found) {
        minimum = Math.min(minimum, negative);
        maximum = Math.max(maximum, positive);
      }
      return;
    }

    seriesKeys.forEach((key) => {
      const value = Number(row[key]);
      if (!Number.isFinite(value)) return;
      minimum = Math.min(minimum, value);
      maximum = Math.max(maximum, value);
    });
  });

  if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) return [0, 1];
  return [minimum, maximum];
}

function yAxisDomain(
  minimum: number,
  maximum: number,
  mode: ResultChartGroup['yAxisMode'],
): [number, number] {
  if (mode === 'fraction' || mode === 'binary') return [0, 1];
  if (minimum < 0) {
    return [
      -niceAxisBound(Math.abs(minimum) * 1.04),
      maximum > 0 ? niceAxisBound(maximum * 1.04) : 0,
    ];
  }
  return [0, niceAxisBound(maximum * 1.04)];
}

function formatChartValue(value: number): string {
  if (!Number.isFinite(value)) return '–';
  const absolute = Math.abs(value);
  if (absolute === 0) return '0';
  if (absolute >= 1000) {
    return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
  }
  if (absolute >= 100) {
    return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
  }
  if (absolute >= 1) {
    return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
  if (absolute >= 0.01) {
    return value.toLocaleString(undefined, { maximumFractionDigits: 3 });
  }
  if (absolute >= 0.0001) {
    return value.toLocaleString(undefined, { maximumFractionDigits: 5 });
  }
  return value.toExponential(2);
}

function download(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function tableToCsv(table: ResultTable): string {
  const escape = (cell: unknown) => {
    const value = cell === null || cell === undefined ? '' : String(cell);
    return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  };
  return [table.columns.map(escape).join(','), ...table.rows.map((r) => r.map(escape).join(','))]
    .join('\n');
}

function ChartDetails({ description }: { description?: string | null }) {
  if (!description) return null;
  return (
    <details className="mb-3 rounded-md border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
      <summary className="cursor-pointer select-none font-medium text-foreground">
        Chart details
      </summary>
      <p className="mt-2 leading-relaxed">{description}</p>
    </details>
  );
}

function SeriesLegend({
  series,
  hidden,
  onToggle,
  chartType,
}: {
  series: ResultChartGroup['series'];
  hidden: Set<string>;
  onToggle: (key: string) => void;
  chartType: RenderChartType;
}) {
  if (series.length <= 1) return null;
  return (
    <div
      className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3 lg:grid-cols-4"
      aria-label="Chart series controls"
    >
      {series.map((item, index) => {
        const isHidden = hidden.has(item.key);
        const color = SERIES_COLORS[index % SERIES_COLORS.length];
        return (
          <button
            key={item.key}
            type="button"
            aria-pressed={!isHidden}
            aria-label={`${isHidden ? 'Show' : 'Hide'} ${item.label}`}
            title={`${isHidden ? 'Show' : 'Hide'} ${item.label}`}
            onClick={() => onToggle(item.key)}
            className={`flex min-w-0 items-center gap-2 rounded-md border px-2 py-1.5 text-left text-[11px] transition-colors hover:bg-muted/60 ${
              isHidden ? 'opacity-45' : 'bg-background'
            }`}
          >
            <span
              aria-hidden="true"
              className={chartType === 'bar' ? 'h-2.5 w-2.5 shrink-0 rounded-sm' : 'h-0 w-5 shrink-0 border-t-2'}
              style={chartType === 'bar'
                ? { backgroundColor: color }
                : {
                    borderTopColor: color,
                    borderTopStyle: index % 3 === 0 ? 'solid' : index % 3 === 1 ? 'dashed' : 'dotted',
                  }}
            />
            <span className={isHidden ? 'truncate line-through' : 'truncate'}>
              {conciseSeriesLabel(item.label)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function ChartTooltip({
  active,
  payload,
  label,
  unit,
  yAxisMode,
  chartType,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number; color?: string; fill?: string }>;
  label?: number | string;
  unit: string;
  yAxisMode: ResultChartGroup['yAxisMode'];
  chartType: RenderChartType;
}) {
  if (!active || !payload?.length) return null;
  const available = payload.filter((entry) => {
    const value = Number(entry.value);
    if (!Number.isFinite(value)) return false;
    return chartType !== 'bar' || Math.abs(value) > ZERO_TOLERANCE;
  });

  return (
    <div className="max-w-xs rounded-md border bg-background/95 p-3 text-xs shadow-lg backdrop-blur-sm">
      <p className="mb-2 font-semibold">Hour {label}</p>
      {available.length === 0 ? (
        <p className="text-muted-foreground">No activity</p>
      ) : (
        <div className="space-y-1.5">
          {available.map((entry, index) => {
            const value = Number(entry.value);
            const formatted = yAxisMode === 'fraction'
              ? `${(value * 100).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`
              : formatChartValue(value);
            return (
              <div key={`${entry.name ?? 'series'}-${index}`} className="flex items-start justify-between gap-4">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span
                    className="mt-1 h-2 w-2 shrink-0 rounded-sm"
                    style={{ backgroundColor: entry.color ?? entry.fill }}
                  />
                  <span className="truncate">{entry.name}</span>
                </span>
                <span className="shrink-0 font-medium tabular-nums">
                  {formatted}{unit && yAxisMode !== 'fraction' ? ` ${unit}` : ''}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function BinaryTimeline({ group }: { group: ResultChartGroup }) {
  const values = useMemo(() => {
    const output = new Map<string, Map<number, number>>();
    group.series.forEach((series) => {
      output.set(series.key, new Map(
        series.points
          .map((point) => [Number(point.t), Number(point.value)] as const)
          .filter(([hour, value]) => Number.isFinite(hour) && Number.isFinite(value)),
      ));
    });
    return output;
  }, [group.series]);

  return (
    <div>
      <div className="overflow-x-auto pb-1">
        <div className="min-w-[900px]">
          <div
            className="grid gap-px overflow-hidden rounded-md border bg-border"
            style={{ gridTemplateColumns: 'minmax(110px, 1.5fr) repeat(24, minmax(24px, 1fr))' }}
          >
            <div className="bg-muted/60 px-2 py-1 text-[11px] font-medium">Series</div>
            {MODEL_HOURS.map((hour) => (
              <div
                key={`binary-hour-${hour}`}
                className="bg-muted/60 py-1 text-center text-[10px] tabular-nums text-muted-foreground"
              >
                {X_TICKS.includes(hour) ? hour : ''}
              </div>
            ))}
            {group.series.map((series, seriesIndex) => {
              const seriesValues = values.get(series.key) ?? new Map<number, number>();
              const color = SERIES_COLORS[seriesIndex % SERIES_COLORS.length];
              return (
                <Fragment key={series.key}>
                  <div
                    className="truncate bg-background px-2 py-1.5 text-[11px] font-medium"
                    title={series.label}
                  >
                    {conciseSeriesLabel(series.label)}
                  </div>
                  {MODEL_HOURS.map((hour) => {
                    const value = seriesValues.get(hour);
                    const missing = value === undefined;
                    const active = !missing && value >= 0.5;
                    return (
                      <div
                        key={`${series.key}-${hour}`}
                        title={`${conciseSeriesLabel(series.label)}, hour ${hour}: ${missing ? 'no solver value' : active ? 'active' : 'inactive'}`}
                        className={`h-7 bg-background ${active ? '' : 'hover:bg-muted/60'}`}
                        style={active
                          ? { backgroundColor: color }
                          : missing
                            ? {
                                backgroundImage: 'repeating-linear-gradient(135deg, transparent, transparent 4px, hsl(var(--muted)) 4px, hsl(var(--muted)) 6px)',
                              }
                            : undefined}
                      />
                    );
                  })}
                </Fragment>
              );
            })}
          </div>
        </div>
      </div>
      <p className="mt-2 text-center text-xs text-muted-foreground">
        Hour (1–24)
      </p>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Filled cells are active, empty cells are inactive, and hatched cells indicate a missing solver value.
      </p>
    </div>
  );
}

function ChartGroup({ group }: { group: ResultChartGroup }) {
  const data = useMemo(() => toChartData(group), [group]);
  const chartType = inferChartType(group);
  const yAxisMode = group.yAxisMode ?? 'auto';
  const seriesSignature = group.series.map((series) => series.key).join('|');
  const [hiddenSeries, setHiddenSeries] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    setHiddenSeries(new Set());
  }, [group.key, seriesSignature]);

  const visibleSeries = useMemo(
    () => group.series.filter((series) => !hiddenSeries.has(series.key)),
    [group.series, hiddenSeries],
  );

  const toggleSeries = (key: string) => {
    setHiddenSeries((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        const visibleCount = group.series.length - next.size;
        if (visibleCount <= 1) return current;
        next.add(key);
      }
      return next;
    });
  };

  const hasData = group.series.some((series) => series.points.length > 0);
  if (!hasData) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{group.label}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            The backend returned no data points for this chart.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (yAxisMode === 'binary') {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            {group.label}{group.unit ? ` (${group.unit})` : ''}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ChartDetails description={group.description} />
          <BinaryTimeline group={group} />
        </CardContent>
      </Card>
    );
  }

  const [minimum, maximum] = chartExtents(
    data,
    visibleSeries.map((series) => series.key),
    chartType,
  );
  const domain = yAxisDomain(minimum, maximum, yAxisMode);
  const hasNegative = minimum < 0;
  const yTicks = yAxisMode === 'fraction' ? [0, 0.25, 0.5, 0.75, 1] : undefined;
  const xDomain = chartType === 'bar' ? BAR_X_DOMAIN : PROFILE_X_DOMAIN;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">
          {group.label}{group.unit ? ` (${group.unit})` : ''}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ChartDetails description={group.description} />
        <div className="h-[310px] w-full" data-chart-type={chartType}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={data}
              margin={{ top: 10, right: 18, left: 8, bottom: 4 }}
              barCategoryGap="18%"
              barGap={1}
            >
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
              <XAxis
                dataKey="t"
                type="number"
                scale="linear"
                domain={xDomain}
                ticks={X_TICKS}
                allowDecimals={false}
                tick={{ fontSize: 12 }}
                tickLine={false}
                axisLine={{ stroke: 'hsl(var(--border))' }}
                tickMargin={8}
              />
              <YAxis
                domain={domain}
                ticks={yTicks}
                allowDecimals
                tick={{ fontSize: 12 }}
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                tickFormatter={yAxisMode === 'fraction'
                  ? (value) => `${Math.round(Number(value) * 100)}%`
                  : (value) => formatChartValue(Number(value))}
                width={76}
                tickCount={5}
              />
              {hasNegative && (
                <ReferenceLine
                  y={0}
                  stroke="hsl(var(--foreground))"
                  strokeOpacity={0.55}
                  strokeWidth={1.2}
                />
              )}
              <Tooltip
                cursor={chartType === 'bar' ? { fill: 'hsl(var(--muted) / 0.35)' } : false}
                content={(
                  <ChartTooltip
                    unit={group.unit}
                    yAxisMode={yAxisMode}
                    chartType={chartType}
                  />
                )}
              />
              {visibleSeries.map((series) => {
                const originalIndex = group.series.findIndex((item) => item.key === series.key);
                const color = SERIES_COLORS[originalIndex % SERIES_COLORS.length];
                if (chartType === 'bar') {
                  return (
                    <Bar
                      key={series.key}
                      dataKey={series.key}
                      name={conciseSeriesLabel(series.label)}
                      fill={color}
                      stackId="hourly-total"
                      barSize={14}
                      maxBarSize={16}
                      minPointSize={2}
                      isAnimationActive={false}
                    />
                  );
                }
                return (
                  <Line
                    key={series.key}
                    type={chartType === 'step' ? 'stepAfter' : 'linear'}
                    dataKey={series.key}
                    name={conciseSeriesLabel(series.label)}
                    stroke={color}
                    strokeDasharray={SERIES_DASHES[originalIndex % SERIES_DASHES.length]}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    dot={false}
                    activeDot={{ r: 3.5, strokeWidth: 1 }}
                    connectNulls={false}
                    strokeWidth={2}
                    isAnimationActive={false}
                  />
                );
              })}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-1 text-center text-xs text-muted-foreground">
          {group.xLabel || 'Hour (1–24)'}
        </p>
        <SeriesLegend
          series={group.series}
          hidden={hiddenSeries}
          onToggle={toggleSeries}
          chartType={chartType}
        />
        {chartType === 'bar' && (
          <p className="mt-2 text-[11px] text-muted-foreground">
            Bars are centred on each hourly bin and stacked to show the total activity and its composition.
            Hover over an hour for individual values.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function ResultTableView({ table }: { table: ResultTable }) {
  const [filter, setFilter] = useState('');
  const rows = useMemo(() => {
    if (!filter.trim()) return table.rows;
    const needle = filter.toLowerCase();
    return table.rows.filter((row) =>
      row.some((cell) => String(cell ?? '').toLowerCase().includes(needle)),
    );
  }, [filter, table.rows]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
        <CardTitle className="text-base">{table.label}</CardTitle>
        <div className="flex items-center gap-2">
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter rows"
            className="h-9 w-40"
            aria-label={`Filter ${table.label}`}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => download(`${table.key}.csv`, tableToCsv(table), 'text/csv')}
          >
            <Download className="mr-2 h-4 w-4" /> CSV
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {table.truncated && (
          <p className="mb-3 text-xs text-muted-foreground">
            Showing {table.rows.length.toLocaleString()} of {table.total_rows.toLocaleString()} non-zero rows.
            Use the downloaded JSON or API variable filter for additional pages.
          </p>
        )}
        {table.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            The backend returned no rows for this table.
          </p>
        ) : (
          <div className="max-h-96 overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-background">
                <tr className="border-b">
                  {table.columns.map((column) => (
                    <th key={column} className="text-left py-2 px-3 font-medium">
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={index} className="border-b">
                    {row.map((cell, cellIndex) => (
                      <td key={cellIndex} className="py-2 px-3">
                        {cell === null || cell === undefined ? '–' : String(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function StepResults() {
  const { project } = useHydrogenProject();
  const {
    backendConfigured,
    run,
    results,
    isStale,
    isPolling,
    isLoadingResults,
    runError,
    resultsError,
    loadRun,
  } = useSolverRun();
  const [searchParams] = useSearchParams();
  const deepLinkedRunId = searchParams.get('run');

  // Deep link: /hydrogen/setup?step=6&run=<id>
  useEffect(() => {
    if (!backendConfigured || !deepLinkedRunId) return;
    if (run?.run_id === deepLinkedRunId) return;
    void loadRun(deepLinkedRunId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkedRunId, backendConfigured]);

  const charts = results?.charts ?? [];
  const tables = results?.tables ?? [];
  const active = run ? ACTIVE_RUN_STATES.includes(run.status) : false;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground">Optimization Results</h2>
        <p className="text-muted-foreground mt-1">
          Results returned by the local Gurobi optimization service
        </p>
      </div>

      {!backendConfigured && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>{SOLVER_NOT_CONNECTED_MESSAGE}</AlertDescription>
        </Alert>
      )}

      {backendConfigured && !run && !runError && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            No optimization run for this project yet. Start one from the Submit step.
          </AlertDescription>
        </Alert>
      )}

      {runError && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Run unavailable</AlertTitle>
          <AlertDescription>{runError}</AlertDescription>
        </Alert>
      )}

      {isStale && run && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            Solver inputs have changed since this run — the results below are out of date.
          </AlertDescription>
        </Alert>
      )}

      {run && (
        <Card>
          <CardHeader>
            <CardTitle>Run status</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Status</span>
              <div className="font-medium flex items-center gap-2">
                {(active || isPolling) && <Loader2 className="h-4 w-4 animate-spin" />}
                <Badge variant={run.status === 'completed' ? 'secondary' : 'outline'}>
                  {RUN_STATE_LABELS[run.status]}
                </Badge>
              </div>
            </div>
            <div>
              <span className="text-muted-foreground">Run ID</span>
              <p className="font-medium break-all">{run.run_id}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Solver</span>
              <p className="font-medium">{run.solver_name ?? results?.solver_name ?? '–'}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Termination condition</span>
              <p className="font-medium">
                {run.termination_condition ?? results?.termination_condition ?? '–'}
              </p>
            </div>
            <div>
              <span className="text-muted-foreground">
                {run.objective_label ?? results?.objective_label ?? 'Objective value'}
              </span>
              <p className="font-medium">
                {run.objective_value ?? results?.objective_value ?? '–'} {results?.objective_unit ?? ''}
              </p>
            </div>
            <div>
              <span className="text-muted-foreground">Dataset</span>
              <p className="font-medium">
                {run.dataset?.name ?? results?.dataset?.name ?? project.dataset.id}
              </p>
            </div>
            {run.message && (
              <div className="md:col-span-3">
                <span className="text-muted-foreground">Message</span>
                <p className="font-medium">{run.message}</p>
              </div>
            )}
            {run.error && (
              <div className="md:col-span-3">
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>{run.error}</AlertDescription>
                </Alert>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {run && run.status !== 'completed' && !active && (
        <Alert variant={run.status === 'cancelled' ? 'default' : 'destructive'}>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>{RUN_STATE_LABELS[run.status]}</AlertTitle>
          <AlertDescription>
            This run did not produce an optimal solution, so no results are shown.
          </AlertDescription>
        </Alert>
      )}

      {isLoadingResults && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading results…
        </div>
      )}

      {resultsError && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Results unavailable</AlertTitle>
          <AlertDescription>{resultsError}</AlertDescription>
        </Alert>
      )}

      {results && run?.status === 'completed' && (
        <>
          <div className="flex justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                download(
                  `run-${results.run_id}.json`,
                  JSON.stringify(results, null, 2),
                  'application/json',
                )
              }
            >
              <Download className="mr-2 h-4 w-4" /> Download JSON
            </Button>
          </div>

          {results.input_summary && Object.keys(results.input_summary).length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Input summary</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                {Object.entries(results.input_summary).map(([key, value]) => (
                  <div key={key}>
                    <span className="text-muted-foreground">{key}</span>
                    <p className="font-medium">{value === null ? '–' : String(value)}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {charts.length === 0 && tables.length === 0 && (
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription>
                The run completed but returned no result series or tables.
              </AlertDescription>
            </Alert>
          )}

          {CATEGORY_ORDER.filter((category) =>
            charts.some((group) => group.category === category),
          ).map((category) => (
            <div key={category} className="space-y-4">
              <h3 className="text-lg font-semibold">{CATEGORY_LABELS[category]}</h3>
              {charts
                .filter((group) => group.category === category)
                .map((group) => (
                  <ChartGroup key={group.key} group={group} />
                ))}
            </div>
          ))}

          {tables.length > 0 && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold">Result tables</h3>
              {tables.map((table) => (
                <ResultTableView key={table.key} table={table} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
