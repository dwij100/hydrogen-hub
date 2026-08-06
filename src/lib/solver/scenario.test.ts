import { describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', async () => {
  const mod = await import('@/test/supabaseMock');
  return { supabase: mod.supabase };
});
import { defaultProject, type HydrogenProject } from '@/context/HydrogenProjectContext';
import { buildScenario } from './scenario';
import { computeInputHash } from './inputHash';

function configured(): HydrogenProject {
  return {
    ...defaultProject,
    projectName: 'Johor baseline',
    palmOilMills: [{
      id: 'row-pom', catalogId: 'INF-POM-001', location: 'Mill', state: 'Johor',
      capacity: 10, capacityUnit: 't FFB', address: '', latitude: 1, longitude: 103,
    }],
    wastewaterPlants: [{
      id: 'row-wwtp', catalogId: 'INF-WWTP-001', location: 'WWTP', state: 'Johor',
      capacityEffluent: 10, capacityUnit: 'm3', address: '', latitude: 1, longitude: 103,
    }],
    solarFarms: [{
      id: 'row-sf', catalogId: 'INF-SF-002', location: 'Solar', state: 'Johor',
      capacity: 48, capacityUnit: 'kWp', address: '', latitude: 1, longitude: 103,
    }],
    consumers: [{
      id: 'row-consumer', consumerLocationId: 'CON-HC-002', state: 'Johor',
      locationName: 'Consumer', demandPerDay: 240,
    }],
    transport: {
      ...defaultProject.transport, pomeTrucks: 2, gaseousHydrogenTrailers: 1,
      useRailway: true, railTrains: 2,
    },
    railFreightStations: [{
      id: 'row-station', stationId: 'RFS-002', state: 'Johor',
      locationName: 'Pasir Gudang', address: '', latitude: 1, longitude: 103,
    }],
  };
}

describe('project-to-solver scenario', () => {
  it('maps catalog IDs, demand, vehicle templates, and railway exactly', () => {
    expect(buildScenario(configured())).toEqual({
      dataset_id: 'johor118', horizon_hours: 24,
      infrastructure_ids: ['INF-POM-001', 'INF-WWTP-001'],
      solar_farm_ids: ['INF-SF-002'],
      consumers: [{ consumer_id: 'CON-HC-002', demand_kg_per_day: 240 }],
      vehicles: {
        pome_trucks: 2, biogas_trucks: 0, biomass_trucks: 0, bioh2_trucks: 0,
        gaseous_h2_trailers: 1, bev_fleet: 0, fcev_fleet: 0,
      },
      railway: { enabled: true, station_ids: ['RFS-002'], train_count: 2 },
    });
  });

  it('uses only the bundled dataset and fixed 24-hour horizon', () => {
    const scenario = buildScenario(configured());
    expect(scenario.dataset_id).toBe('johor118');
    expect(scenario.horizon_hours).toBe(24);
  });

  it('turns railway details off when railway is disabled', () => {
    const project = configured();
    project.transport = { ...project.transport, useRailway: false };
    expect(buildScenario(project).railway).toEqual({ enabled: false, station_ids: [], train_count: 0 });
  });

  it('does not treat row UUIDs as solver catalog IDs', () => {
    const project = configured();
    project.palmOilMills = [{ ...project.palmOilMills[0], catalogId: undefined }];
    expect(buildScenario(project).infrastructure_ids).toContain('');
    expect(buildScenario(project).infrastructure_ids).not.toContain('row-pom');
  });

  it('does not mark results stale when only the project name changes', () => {
    const project = configured();
    expect(computeInputHash({ ...project, projectName: 'Renamed' })).toBe(computeInputHash(project));
  });

  it('changes the hash when daily demand or a template quantity changes', () => {
    const project = configured();
    const demand = { ...project, consumers: [{ ...project.consumers[0], demandPerDay: 241 }] };
    const vehicles = { ...project, transport: { ...project.transport, pomeTrucks: 3 } };
    expect(computeInputHash(demand)).not.toBe(computeInputHash(project));
    expect(computeInputHash(vehicles)).not.toBe(computeInputHash(project));
  });
});
