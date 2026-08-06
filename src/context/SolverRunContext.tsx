import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { SOLVER_NOT_CONNECTED_MESSAGE, SolverApiError, isSolverConfigured, solverApi } from '@/lib/solver/client';
import type { HealthResponse, RunResults, RunStatusResponse, ValidateResponse, ValidationIssue } from '@/lib/solver/types';
import { ACTIVE_RUN_STATES, isTerminalRunState } from '@/lib/solver/types';
import { computeInputHash } from '@/lib/solver/inputHash';
import { buildScenario } from '@/lib/solver/scenario';
import { useHydrogenProject } from '@/context/HydrogenProjectContext';
import { POLL_INTERVAL_MS, RUN_STORAGE_PREFIX } from '@/lib/solver/runStorage';

interface StoredRun { runId: string; inputHash: string; datasetId: string; submittedAt: string }
const storageKey = (projectId: string | null) => `${RUN_STORAGE_PREFIX}${projectId ?? 'draft'}`;
function readStoredRun(projectId: string | null): StoredRun | null {
  try { const value = JSON.parse(localStorage.getItem(storageKey(projectId)) ?? 'null'); return value?.runId ? value : null; }
  catch { return null; }
}
function writeStoredRun(projectId: string | null, value: StoredRun | null) {
  try {
    if (value) localStorage.setItem(storageKey(projectId), JSON.stringify(value));
    else localStorage.removeItem(storageKey(projectId));
  }
  catch { /* refresh recovery is unavailable when browser storage is disabled */ }
}
const messageFor = (error: unknown) => error instanceof Error && error.message
  ? error.message : 'Something went wrong talking to the optimizer.';

interface SolverRunContextType {
  backendConfigured: boolean;
  health: HealthResponse | null;
  healthError: string | null;
  solverReady: boolean;
  refreshHealth: () => Promise<void>;
  run: RunStatusResponse | null;
  results: RunResults | null;
  runInputHash: string | null;
  currentInputHash: string;
  isStale: boolean;
  isSubmitting: boolean;
  isPolling: boolean;
  isLoadingResults: boolean;
  isCancelling: boolean;
  isValidating: boolean;
  validation: ValidateResponse | null;
  validationError: string | null;
  runError: string | null;
  resultsError: string | null;
  validate: () => Promise<boolean>;
  submitRun: () => Promise<string | null>;
  cancelRun: () => Promise<void>;
  loadRun: (runId: string) => Promise<void>;
  clearRun: () => void;
  resetValidation: () => void;
}

const SolverRunContext = createContext<SolverRunContextType | undefined>(undefined);

export function SolverRunProvider({ children }: { children: ReactNode }) {
  const { project, activeProjectId, hydrated } = useHydrogenProject();
  const backendConfigured = isSolverConfigured();
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [run, setRun] = useState<RunStatusResponse | null>(null);
  const [results, setResults] = useState<RunResults | null>(null);
  const [runInputHash, setRunInputHash] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPolling, setIsPolling] = useState(false);
  const [isLoadingResults, setIsLoadingResults] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [validation, setValidation] = useState<ValidateResponse | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [resultsError, setResultsError] = useState<string | null>(null);
  const submittingRef = useRef(false);
  const idempotencyRef = useRef<{ hash: string; key: string } | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelledRef = useRef(false);
  const currentInputHash = useMemo(() => computeInputHash(project), [project]);
  const solverReady = health?.solver?.ready === true && health?.worker?.ready === true && health?.database?.ready === true;

  const refreshHealth = useCallback(async () => {
    if (!backendConfigured) { setHealth(null); setHealthError(SOLVER_NOT_CONNECTED_MESSAGE); return; }
    try { setHealth(await solverApi.health()); setHealthError(null); }
    catch (error) { setHealth(null); setHealthError(messageFor(error)); }
  }, [backendConfigured]);

  useEffect(() => {
    void refreshHealth();
    const timer = window.setInterval(() => void refreshHealth(), 30_000);
    return () => window.clearInterval(timer);
  }, [refreshHealth]);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    pollTimerRef.current = null;
    setIsPolling(false);
  }, []);

  const fetchResults = useCallback(async (runId: string) => {
    setIsLoadingResults(true); setResultsError(null);
    try { setResults(await solverApi.getResults(runId)); }
    catch (error) { setResults(null); setResultsError(messageFor(error)); }
    finally { setIsLoadingResults(false); }
  }, []);

  const startPolling = useCallback((runId: string) => {
    stopPolling(); cancelledRef.current = false; setIsPolling(true);
    const tick = async () => {
      if (cancelledRef.current) return;
      try {
        const current = await solverApi.getRun(runId);
        if (cancelledRef.current) return;
        setRun(current); setRunError(null);
        if (isTerminalRunState(current.status)) {
          setIsPolling(false);
          if (current.status === 'completed') await fetchResults(runId);
          await refreshHealth();
          return;
        }
      } catch (error) { setRunError(messageFor(error)); setIsPolling(false); return; }
      pollTimerRef.current = setTimeout(tick, POLL_INTERVAL_MS);
    };
    void tick();
  }, [fetchResults, refreshHealth, stopPolling]);

  const loadRun = useCallback(async (runId: string) => {
    if (!backendConfigured) { setRunError(SOLVER_NOT_CONNECTED_MESSAGE); return; }
    stopPolling(); setResults(null); setResultsError(null);
    try {
      const current = await solverApi.getRun(runId);
      setRun(current); setRunError(null);
      setRunInputHash(current.input_hash ?? readStoredRun(activeProjectId)?.inputHash ?? null);
      if (current.status === 'completed') await fetchResults(runId);
      else if (!isTerminalRunState(current.status)) startPolling(runId);
    } catch (error) { setRun(null); setRunError(messageFor(error)); }
  }, [activeProjectId, backendConfigured, fetchResults, startPolling, stopPolling]);

  useEffect(() => {
    cancelledRef.current = false;
    setRun(null); setResults(null); setRunError(null); setResultsError(null);
    setValidation(null); setValidationError(null); setRunInputHash(null);
    if (!hydrated || !backendConfigured) return;
    const stored = readStoredRun(activeProjectId);
    if (stored) { setRunInputHash(stored.inputHash); void loadRun(stored.runId); }
    return () => { cancelledRef.current = true; stopPolling(); };
    // Project identity intentionally owns persisted run recovery.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProjectId, hydrated, backendConfigured]);

  useEffect(() => () => { cancelledRef.current = true; if (pollTimerRef.current) clearTimeout(pollTimerRef.current); }, []);

  const validate = useCallback(async () => {
    if (!backendConfigured) { setValidationError(SOLVER_NOT_CONNECTED_MESSAGE); return false; }
    setIsValidating(true); setValidationError(null);
    try {
      const response = await solverApi.validateScenario(buildScenario(project));
      setValidation(response);
      await refreshHealth();
      return response.valid;
    } catch (error) {
      const envelope = error instanceof SolverApiError
        ? error.details as { detail?: { issues?: ValidationIssue[] } } | undefined
        : undefined;
      const issues = envelope?.detail?.issues;
      if (Array.isArray(issues) && issues.length > 0) {
        setValidation({ valid: false, issues });
        setValidationError(null);
      } else {
        setValidation(null);
        setValidationError(messageFor(error));
      }
      return false;
    }
    finally { setIsValidating(false); }
  }, [backendConfigured, project, refreshHealth]);

  const submitRun = useCallback(async () => {
    if (!backendConfigured) { setRunError(SOLVER_NOT_CONNECTED_MESSAGE); return null; }
    if (!solverReady) { setRunError(health?.solver.message ?? 'Gurobi is not ready.'); return null; }
    if (submittingRef.current) return null;
    if (run && ACTIVE_RUN_STATES.includes(run.status)) { setRunError('A run is already in progress.'); return null; }
    submittingRef.current = true; setIsSubmitting(true); setRunError(null); setResults(null);
    const inputHash = currentInputHash;
    if (!idempotencyRef.current || idempotencyRef.current.hash !== inputHash) {
      idempotencyRef.current = { hash: inputHash, key: crypto.randomUUID() };
    }
    try {
      const response = await solverApi.submitRun({
        project_id: activeProjectId,
        project_name: project.projectName || null,
        input_hash: inputHash,
        idempotency_key: idempotencyRef.current.key,
        scenario: buildScenario(project),
      });
      idempotencyRef.current = null;
      setRunInputHash(inputHash);
      writeStoredRun(activeProjectId, { runId: response.run_id, inputHash, datasetId: 'johor118', submittedAt: new Date().toISOString() });
      startPolling(response.run_id);
      return response.run_id;
    } catch (error) {
      setRunError(error instanceof SolverApiError ? error.message : messageFor(error));
      return null;
    } finally { submittingRef.current = false; setIsSubmitting(false); }
  }, [activeProjectId, backendConfigured, currentInputHash, health, project, run, solverReady, startPolling]);

  const cancelRun = useCallback(async () => {
    if (!run?.cancellable) return;
    setIsCancelling(true);
    try { const current = await solverApi.cancelRun(run.run_id); setRun(current); if (isTerminalRunState(current.status)) stopPolling(); }
    catch (error) { setRunError(messageFor(error)); }
    finally { setIsCancelling(false); }
  }, [run, stopPolling]);

  const clearRun = useCallback(() => {
    stopPolling(); setRun(null); setResults(null); setRunError(null); setResultsError(null); setRunInputHash(null);
    writeStoredRun(activeProjectId, null);
  }, [activeProjectId, stopPolling]);
  const resetValidation = useCallback(() => { setValidation(null); setValidationError(null); }, []);
  const isStale = Boolean(run && runInputHash && runInputHash !== currentInputHash);

  return <SolverRunContext.Provider value={{
    backendConfigured, health, healthError, solverReady, refreshHealth, run, results, runInputHash,
    currentInputHash, isStale, isSubmitting, isPolling, isLoadingResults, isCancelling,
    isValidating, validation, validationError, runError, resultsError, validate, submitRun,
    cancelRun, loadRun, clearRun, resetValidation,
  }}>{children}</SolverRunContext.Provider>;
}

export function useSolverRun() {
  const context = useContext(SolverRunContext);
  if (!context) throw new Error('useSolverRun must be used within a SolverRunProvider');
  return context;
}
