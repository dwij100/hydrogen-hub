import { describe, it, expect, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', async () => {
  const mod = await import('@/test/supabaseMock');
  return { supabase: mod.supabase };
});
import {
  getStepError,
  isStepComplete,
  getCompletedSteps,
  MIN_INFRASTRUCTURE_LOCATIONS,
} from '@/lib/wizardValidation';
import { defaultProject, mergeWithDefaults, type HydrogenProject } from '@/context/HydrogenProjectContext';

const mill = (id: string) => ({
  id,
  catalogId: `INF-POM-${id.padStart(3, '0')}`,
  location: `Mill ${id}`,
  state: 'Johor',
  capacity: 10,
  address: '',
  latitude: 1,
  longitude: 103,
  capacityUnit: 't FFB',
});

const completeProject = (): HydrogenProject => ({
  ...defaultProject,
  timePeriod: { ...defaultProject.timePeriod, startDate: '2026-01-01', endDate: '2026-12-31' },
  palmOilMills: [mill('1')],
  transport: { ...defaultProject.transport, biomassTrucks: 2 },
  consumers: [
    {
      id: 'c1',
      consumerLocationId: 'CON-HC-001',
      state: 'Johor',
      locationName: 'Ammonia Plant',
      demandPerDay: 100,
    },
  ],
});

describe('wizard validation', () => {
  it('uses the preserved fixed 24-hour horizon on step 1', () => {
    expect(getStepError(1, defaultProject)).toBeNull();
    expect(getStepError(1, completeProject())).toBeNull();
  });

  it('consistently requires at least one supported non-solar facility on step 2', () => {
    const solarOnly = { ...completeProject(), palmOilMills: [], solarFarms: [{
      id: 's1', catalogId: 'INF-SF-001', location: 'Solar 1', state: 'Johor', address: '',
      latitude: 1, longitude: 103, capacity: 48, capacityUnit: 'kWp',
    }] };
    expect(MIN_INFRASTRUCTURE_LOCATIONS).toBe(1);
    expect(getStepError(2, solarOnly)).toMatch(/POM, WWTP, BSP or BHH/i);
    // Progress completion and Next validation share the same function.
    expect(isStepComplete(2, solarOnly)).toBe(false);
    expect(getCompletedSteps(solarOnly)).not.toContain(2);
    expect(getStepError(2, completeProject())).toBeNull();
  });

  it('requires a biogas plant or hub when a wastewater plant is selected', () => {
    const project: HydrogenProject = {
      ...completeProject(),
      wastewaterPlants: [
        {
          id: 'w1',
          location: 'WW',
          state: 'Johor',
          capacityEffluent: 5,
          address: '',
          latitude: 1,
          longitude: 103,
          capacityUnit: 'm3',
        },
      ],
    };
    expect(getStepError(2, project)).toMatch(/Biogas Steam Plant or Biomass Hydrogen Hub/i);
  });

  it('requires transport and consumers', () => {
    const noTransport = { ...completeProject(), transport: { ...defaultProject.transport } };
    expect(getStepError(3, noTransport)).toMatch(/supported vehicle/i);

    const railOnlyNoStations = {
      ...completeProject(),
      transport: { ...defaultProject.transport, biomassTrucks: 1, useRailway: true, railTrains: 1 },
    };
    expect(getStepError(3, railOnlyNoStations)).toMatch(/station and one train/i);

    const noConsumers = { ...completeProject(), consumers: [] };
    expect(getStepError(4, noConsumers)).toMatch(/consumer location/i);
  });

  it('blocks the submit step until all earlier steps pass', () => {
    const partial = { ...completeProject(), consumers: [] };
    expect(getStepError(5, partial)).not.toBeNull();
    expect(getStepError(5, completeProject())).toBeNull();
    expect(getCompletedSteps(completeProject())).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('mergeWithDefaults', () => {
  it('deep-merges saved config over defaults', () => {
    const merged = mergeWithDefaults(defaultProject, {
      timePeriod: { startDate: '2026-02-01' },
      transport: { biomassTrucks: 4 },
      consumers: [{ id: 'x' }],
    });
    expect(merged.timePeriod.startDate).toBe('2026-02-01');
    expect(merged.timePeriod.resolution).toBe('hourly');
    expect(merged.transport.biomassTrucks).toBe(4);
    expect(merged.transport.gaseousHydrogenTrailers).toBe(0);
    expect(merged.solarFarms).toEqual([]);
    expect(merged.consumers).toHaveLength(1);
  });

  it('falls back to defaults for missing or invalid config', () => {
    expect(mergeWithDefaults(defaultProject, null)).toEqual(defaultProject);
    expect(mergeWithDefaults(defaultProject, 'nope')).toEqual(defaultProject);
  });
});
