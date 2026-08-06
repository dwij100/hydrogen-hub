import type { HydrogenProject } from '@/context/HydrogenProjectContext';
import type { ScenarioConfig } from './types';

const catalogId = (item: { id: string; catalogId?: string }) =>
  item.catalogId || (item.id.startsWith('INF-') ? item.id : '');

export function buildScenario(project: HydrogenProject): ScenarioConfig {
  const infrastructure = [
    ...project.palmOilMills,
    ...project.wastewaterPlants,
    ...project.biogasSteamPlants,
    ...project.biomassHydrogenHubs,
  ].map(catalogId);
  const solar = project.solarFarms.map(catalogId).filter(Boolean);
  return {
    dataset_id: 'johor118',
    horizon_hours: 24,
    infrastructure_ids: infrastructure,
    solar_farm_ids: solar as ScenarioConfig['solar_farm_ids'],
    consumers: project.consumers.map((consumer) => ({
      consumer_id: consumer.consumerLocationId as ScenarioConfig['consumers'][number]['consumer_id'],
      demand_kg_per_day: consumer.demandPerDay,
    })),
    vehicles: {
      pome_trucks: project.transport.pomeTrucks,
      biogas_trucks: project.transport.biogasTrucks,
      biomass_trucks: project.transport.biomassTrucks,
      bioh2_trucks: project.transport.prePurifiedHydrogenTrucks,
      gaseous_h2_trailers: project.transport.gaseousHydrogenTrailers,
      bev_fleet: project.transport.bevFleet,
      fcev_fleet: project.transport.fcevFleet,
    },
    railway: {
      enabled: project.transport.useRailway,
      station_ids: (project.transport.useRailway
        ? project.railFreightStations.map((station) => station.stationId)
        : []) as ScenarioConfig['railway']['station_ids'],
      train_count: project.transport.useRailway ? project.transport.railTrains : 0,
    },
  };
}
