import type { HydrogenProject } from '@/context/HydrogenProjectContext';

export const WIZARD_STEP_LABELS = [
  'Time Period',
  'Infrastructure',
  'Transport',
  'Consumers',
  'Submit',
  'Results',
] as const;

export const TOTAL_STEPS = WIZARD_STEP_LABELS.length;
export const MIN_INFRASTRUCTURE_LOCATIONS = 1;

export function countInfrastructure(project: HydrogenProject): number {
  return (
    project.palmOilMills.length +
    project.wastewaterPlants.length +
    project.biogasSteamPlants.length +
    project.biomassHydrogenHubs.length +
    project.solarFarms.length
  );
}

export function hasAnyTransport(project: HydrogenProject): boolean {
  const t = project.transport;
  return (
    t.pomeTrucks > 0 ||
    t.biogasTrucks > 0 ||
    t.biomassTrucks > 0 ||
    t.prePurifiedHydrogenTrucks > 0 ||
    t.gaseousHydrogenTrailers > 0 ||
    t.bevFleet > 0 ||
    t.fcevFleet > 0
  );
}

/**
 * Single source of truth for wizard validation.
 * Returns null when the step is valid, otherwise a user-facing message.
 */
export function getStepError(step: number, project: HydrogenProject): string | null {
  switch (step) {
    case 1: {
      return null;
    }
    case 2: {
      const total = countInfrastructure(project);
      if (total === 0) return 'Please add at least one infrastructure location';
      const plants = total - project.solarFarms.length;
      if (plants < MIN_INFRASTRUCTURE_LOCATIONS) return 'Please add at least one POM, WWTP, BSP or BHH facility';
      if (
        project.wastewaterPlants.length > 0 &&
        project.biogasSteamPlants.length === 0 &&
        project.biomassHydrogenHubs.length === 0
      ) {
        return 'Please add at least one Biogas Steam Plant or Biomass Hydrogen Hub when a Wastewater Plant is selected';
      }
      return null;
    }
    case 3:
      if (!hasAnyTransport(project)) return 'Please configure at least one supported vehicle';
      if (project.transport.useRailway && (project.railFreightStations.length === 0 || project.transport.railTrains < 1)) {
        return 'Railway transport requires at least one station and one train';
      }
      return null;
    case 4:
      return project.consumers.length > 0 ? null : 'Please add at least one consumer location';
    case 5: {
      for (const prior of [1, 2, 3, 4]) {
        const error = getStepError(prior, project);
        if (error) return error;
      }
      return null;
    }
    case 6:
      return getStepError(5, project);
    default:
      return null;
  }
}

export function isStepComplete(step: number, project: HydrogenProject): boolean {
  return getStepError(step, project) === null;
}

export function getCompletedSteps(project: HydrogenProject): number[] {
  // The Results step is never "complete" on its own — it reflects step 5.
  return [1, 2, 3, 4, 5].filter((step) => isStepComplete(step, project));
}
