import { useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, CheckCircle2, Info, Loader2, Play, RefreshCw, X } from 'lucide-react';
import { useSolverRun } from '@/context/SolverRunContext';
import { ACTIVE_RUN_STATES, RUN_STATE_LABELS } from '@/lib/solver/types';

export function SolverSubmitPanel() {
  const { health, healthError, solverReady, refreshHealth, run, isStale, isSubmitting,
    isValidating, isCancelling, validation, validationError, runError, validate, submitRun,
    cancelRun } = useSolverRun();
  const [, setSearchParams] = useSearchParams();
  const runActive = Boolean(run && ACTIVE_RUN_STATES.includes(run.status));
  const canRun = validation?.valid === true && solverReady && !isSubmitting && !runActive;
  const errors = validation?.issues.filter((issue) => issue.severity === 'error') ?? [];

  const handleRun = async () => {
    const runId = await submitRun();
    if (runId) setSearchParams((previous) => {
      const next = new URLSearchParams(previous); next.set('step', '6'); next.set('run', runId); return next;
    });
  };

  return <Card><CardHeader><CardTitle>Optimization service</CardTitle></CardHeader><CardContent className="space-y-4">
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant={health?.api.ready ? 'secondary' : 'destructive'}>API {health?.api.ready ? 'ready' : 'unavailable'}</Badge>
      <Badge variant={health?.worker.ready ? 'secondary' : 'destructive'}>Worker {health?.worker.ready ? 'ready' : 'unavailable'}</Badge>
      <Badge variant={health?.solver.ready ? 'secondary' : 'destructive'}>Gurobi {health?.solver.licence_status ?? 'unchecked'}</Badge>
      <Badge variant={health?.dataset.ready ? 'secondary' : 'destructive'}>Johor data {health?.dataset.ready ? 'verified' : 'failed'}</Badge>
      <Button size="sm" variant="ghost" onClick={() => void refreshHealth()}><RefreshCw className="mr-1 h-3 w-3" />Refresh</Button>
    </div>
    {(healthError || (health && !solverReady)) && <Alert variant="destructive"><AlertTriangle className="h-4 w-4" />
      <AlertTitle>Optimization is not ready</AlertTitle><AlertDescription>{healthError ?? health?.solver.message ?? health?.worker.message}</AlertDescription></Alert>}
    {!health && !healthError && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Checking the local services…</div>}
    <Alert><Info className="h-4 w-4" /><AlertDescription>Dataset: Johor 118 (bundled only). Horizon: 24 hourly steps. Validation is authoritative and server-side.</AlertDescription></Alert>
    <div className="flex flex-wrap gap-3">
      <Button variant="outline" onClick={() => void validate()} disabled={isValidating}>
        {isValidating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Validate configuration
      </Button>
      <Button onClick={() => void handleRun()} disabled={!canRun}>
        {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
        {isSubmitting ? 'Starting…' : 'Run optimization'}
      </Button>
      {run?.cancellable && <Button variant="outline" onClick={() => void cancelRun()} disabled={isCancelling}>
        <X className="mr-2 h-4 w-4" />{isCancelling ? 'Cancelling…' : 'Cancel run'}
      </Button>}
      {run && <Badge variant="secondary">Run {run.run_id.slice(0, 8)} · {RUN_STATE_LABELS[run.status]}</Badge>}
    </div>
    {validation?.valid && <Alert><CheckCircle2 className="h-4 w-4" /><AlertDescription>Configuration validated against freshly adapted Johor inputs.</AlertDescription></Alert>}
    {(validationError || runError) && <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertDescription>{validationError ?? runError}</AlertDescription></Alert>}
    {errors.map((issue, index) => <Alert variant="destructive" key={`${issue.code}-${index}`}><AlertTriangle className="h-4 w-4" /><AlertTitle>{issue.code}</AlertTitle><AlertDescription>{issue.message}</AlertDescription></Alert>)}
    {isStale && <Alert><AlertTriangle className="h-4 w-4" /><AlertDescription>Inputs changed after this run was submitted. Validate and run again for current results.</AlertDescription></Alert>}
  </CardContent></Card>;
}
