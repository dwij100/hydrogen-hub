import React, { createContext, useContext, useState, useEffect, useRef, useCallback, ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { isLocalMode } from '@/lib/localMode';
import { createLocalProject, getLocalProject, updateLocalProject } from '@/lib/localProjects';

export interface PalmOilMill {
  id: string;
  catalogId?: string;
  location: string;
  state: string;
  capacity: number;
  address: string;
  latitude: number;
  longitude: number;
  capacityUnit: string;
}

export interface WastewaterPlant {
  id: string;
  catalogId?: string;
  location: string;
  state: string;
  capacityEffluent: number;
  address: string;
  latitude: number;
  longitude: number;
  capacityUnit: string;
}

export interface BiogasSteamPlant {
  id: string;
  catalogId?: string;
  location: string;
  state: string;
  capacityBiogas: number;
  address: string;
  latitude: number;
  longitude: number;
  capacityUnit: string;
}

export interface BiomassHydrogenHub {
  id: string;
  catalogId?: string;
  location: string;
  state: string;
  processingCapacity: number;
  address: string;
  latitude: number;
  longitude: number;
  capacityUnit: string;
}

export interface SolarFarm {
  id: string;
  catalogId?: string;
  location: string;
  state: string;
  address: string;
  latitude: number;
  longitude: number;
  capacity: number;
  capacityUnit: string;
}

export interface Consumer {
  id: string;
  consumerLocationId: string;
  state: string;
  locationName: string;
  /** Always expressed in kg H2/day. */
  demandPerDay: number;
  address?: string;
  latitude?: number;
  longitude?: number;
  productionCapacity?: number;
}

export interface RailFreightStation {
  id: string;
  stationId: string;
  state: string;
  locationName: string;
  address: string;
  latitude: number;
  longitude: number;
}

export interface Transport {
  pomeTrucks: number;
  biogasTrucks: number;
  biomassTrucks: number;
  prePurifiedHydrogenTrucks: number;
  gaseousHydrogenTrailers: number;
  bevFleet: number;
  fcevFleet: number;
  useRailway: boolean;
  railTrains: number;
}

export interface TimePeriod {
  startDate: string;
  endDate: string;
  resolution: 'hourly';
  peakBiomassSeason: boolean;
}

export interface DatasetSelection {
  /** The first supported release intentionally accepts only the immutable bundle. */
  kind: 'bundled';
  id: 'johor118';
}

export interface HydrogenProject {
  userName: string;
  projectName: string;
  mode: 'hydrogen' | 'solar' | 'other';
  dataset: DatasetSelection;
  timePeriod: TimePeriod;
  palmOilMills: PalmOilMill[];
  wastewaterPlants: WastewaterPlant[];
  biogasSteamPlants: BiogasSteamPlant[];
  biomassHydrogenHubs: BiomassHydrogenHub[];
  solarFarms: SolarFarm[];
  transport: Transport;
  consumers: Consumer[];
  railFreightStations: RailFreightStation[];
}

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export const ACTIVE_PROJECT_KEY = 'activeProjectId';
export const DRAFT_PROJECT_NAME = 'Untitled Hydrogen Project';
const LOCAL_MODE = isLocalMode();

interface HydrogenProjectContextType {
  project: HydrogenProject;
  updateProject: (updates: Partial<HydrogenProject>) => void;
  resetProject: () => void;
  /** True once the active project (if any) has been loaded from the backend. */
  hydrated: boolean;
  activeProjectId: string | null;
  saveStatus: SaveStatus;
  saveError: string | null;
  /** Loads a stored project into context and marks it active. */
  loadProject: (id: string) => Promise<boolean>;
  /** Returns the active project id, creating a draft project if none exists. */
  ensureActiveProject: () => Promise<string | null>;
  /** Forgets the active project (e.g. after deletion or logout). */
  clearActiveProject: () => void;
}

export const BUNDLED_DATASETS = [
  { id: 'johor118', name: 'Johor 118 (bundled)' },
] as const;

export const defaultProject: HydrogenProject = {
  userName: '',
  projectName: '',
  mode: 'hydrogen',
  dataset: { kind: 'bundled', id: BUNDLED_DATASETS[0].id },
  timePeriod: {
    startDate: '',
    endDate: '',
    resolution: 'hourly',
    peakBiomassSeason: false,
  },
  palmOilMills: [],
  wastewaterPlants: [],
  biogasSteamPlants: [],
  biomassHydrogenHubs: [],
  solarFarms: [],
  transport: {
    pomeTrucks: 0,
    biogasTrucks: 0,
    biomassTrucks: 0,
    prePurifiedHydrogenTrucks: 0,
    gaseousHydrogenTrailers: 0,
    bevFleet: 0,
    fcevFleet: 0,
    useRailway: false,
    railTrains: 0,
  },
  consumers: [],
  railFreightStations: [],
};

type PlainObject = Record<string, unknown>;

const isPlainObject = (value: unknown): value is PlainObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Deep-merges a saved config over the defaults so new fields never end up undefined. */
export function mergeWithDefaults<T>(defaults: T, saved: unknown): T {
  const defaultsObj = defaults as unknown as PlainObject;
  if (!isPlainObject(saved)) return { ...defaultsObj } as unknown as T;
  const result: PlainObject = { ...defaultsObj };
  for (const key of Object.keys(saved)) {
    const savedValue = saved[key];
    const defaultValue = defaultsObj[key];
    if (savedValue === undefined || savedValue === null) continue;
    if (isPlainObject(defaultValue) && isPlainObject(savedValue)) {
      result[key] = mergeWithDefaults(defaultValue, savedValue);
    } else {
      result[key] = savedValue;
    }
  }
  return result as unknown as T;
}

const HydrogenProjectContext = createContext<HydrogenProjectContextType | undefined>(undefined);

export function HydrogenProjectProvider({ children }: { children: ReactNode }) {
  const [project, setProject] = useState<HydrogenProject>(defaultProject);
  const [hydrated, setHydrated] = useState(false);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNextSaveRef = useRef(true);
  const activeIdRef = useRef<string | null>(null);

  const setActiveId = useCallback((id: string | null) => {
    activeIdRef.current = id;
    setActiveProjectId(id);
    if (id) sessionStorage.setItem(ACTIVE_PROJECT_KEY, id);
    else sessionStorage.removeItem(ACTIVE_PROJECT_KEY);
  }, []);

  const applyConfig = useCallback((name: string, config: unknown) => {
    skipNextSaveRef.current = true;
    setProject({ ...mergeWithDefaults(defaultProject, config), projectName: name });
  }, []);

  const clearActiveProject = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setActiveId(null);
    skipNextSaveRef.current = true;
    setProject(defaultProject);
    setSaveStatus('idle');
    setSaveError(null);
  }, [setActiveId]);

  const loadProject = useCallback(
    async (id: string) => {
      if (LOCAL_MODE) {
        const stored = getLocalProject(id);
        if (!stored) {
          clearActiveProject();
          return false;
        }
        applyConfig(stored.name, stored.config);
        setActiveId(stored.id);
        setSaveStatus('idle');
        setSaveError(null);
        return true;
      }
      const { data, error } = await supabase
        .from('projects')
        .select('id, name, config')
        .eq('id', id)
        .maybeSingle();

      if (error || !data) {
        clearActiveProject();
        return false;
      }
      applyConfig(data.name, data.config);
      setActiveId(data.id);
      setSaveStatus('idle');
      setSaveError(null);
      return true;
    },
    [applyConfig, clearActiveProject, setActiveId],
  );

  // Hydrate the active project before any autosave can run.
  useEffect(() => {
    let cancelled = false;
    const storedId = sessionStorage.getItem(ACTIVE_PROJECT_KEY);

    const hydrate = async () => {
      if (storedId) {
        await loadProject(storedId);
      }
      if (!cancelled) setHydrated(true);
    };

    hydrate();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ensureActiveProject = useCallback(async (): Promise<string | null> => {
    if (activeIdRef.current) return activeIdRef.current;

    if (LOCAL_MODE) {
      const name = project.projectName?.trim() || DRAFT_PROJECT_NAME;
      const record = createLocalProject(name);
      setActiveId(record.id);
      if (!project.projectName) {
        skipNextSaveRef.current = true;
        setProject((prev) => ({ ...prev, projectName: record.name, userName: 'Local user' }));
      }
      return record.id;
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    const name = project.projectName?.trim() || DRAFT_PROJECT_NAME;
    const { data, error } = await supabase
      .from('projects')
      .insert({ name, user_id: user.id, config: {} })
      .select('id, name')
      .single();

    if (error || !data) {
      setSaveStatus('error');
      setSaveError(error?.message ?? 'Could not create a project');
      return null;
    }

    setActiveId(data.id);
    if (!project.projectName) {
      skipNextSaveRef.current = true;
      setProject((prev) => ({ ...prev, projectName: data.name }));
    }
    return data.id;
  }, [project.projectName, setActiveId]);

  const saveToDb = useCallback(async (current: HydrogenProject, projectId: string) => {
    setSaveStatus('saving');
    const { userName: _userName, projectName, ...config } = current;
    if (LOCAL_MODE) {
      try {
        updateLocalProject(projectId, projectName || DRAFT_PROJECT_NAME, config);
        setSaveStatus('saved');
        setSaveError(null);
      } catch (error) {
        setSaveStatus('error');
        setSaveError(error instanceof Error ? error.message : 'Could not save local project');
      }
      return;
    }
    const { error } = await supabase
      .from('projects')
      .update({ name: projectName || DRAFT_PROJECT_NAME, config: config as never })
      .eq('id', projectId);

    if (error) {
      setSaveStatus('error');
      setSaveError(error.message);
    } else {
      setSaveStatus('saved');
      setSaveError(null);
    }
  }, []);

  // Auto-save with debounce, but never before hydration completes.
  useEffect(() => {
    if (!hydrated) return;
    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false;
      return;
    }
    const projectId = activeIdRef.current;
    if (!projectId) return;

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveToDb(project, projectId);
    }, 1500);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [project, hydrated, saveToDb]);

  const updateProject = useCallback((updates: Partial<HydrogenProject>) => {
    setProject((prev) => ({ ...prev, ...updates }));
  }, []);

  const resetProject = useCallback(() => {
    clearActiveProject();
  }, [clearActiveProject]);

  return (
    <HydrogenProjectContext.Provider
      value={{
        project,
        updateProject,
        resetProject,
        hydrated,
        activeProjectId,
        saveStatus,
        saveError,
        loadProject,
        ensureActiveProject,
        clearActiveProject,
      }}
    >
      {children}
    </HydrogenProjectContext.Provider>
  );
}

export function useHydrogenProject() {
  const context = useContext(HydrogenProjectContext);
  if (context === undefined) {
    throw new Error('useHydrogenProject must be used within a HydrogenProjectProvider');
  }
  return context;
}
