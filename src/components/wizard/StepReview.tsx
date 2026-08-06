import { useHydrogenProject } from '@/context/HydrogenProjectContext';
import { SolverSubmitPanel } from '@/components/wizard/SolverSubmitPanel';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Info } from 'lucide-react';

export function StepReview() {
  const { project } = useHydrogenProject();
  const infrastructure = [
    ...project.palmOilMills.map((item) => ['POM', item.location]),
    ...project.wastewaterPlants.map((item) => ['WWTP', item.location]),
    ...project.biogasSteamPlants.map((item) => ['BSP', item.location]),
    ...project.biomassHydrogenHubs.map((item) => ['BHH', item.location]),
    ...project.solarFarms.map((item) => ['Solar', item.location]),
  ];
  const transport = [
    ['POME trucks', project.transport.pomeTrucks],
    ['Biogas trucks', project.transport.biogasTrucks],
    ['Biomass trucks', project.transport.biomassTrucks],
    ['BioH₂ trucks', project.transport.prePurifiedHydrogenTrucks],
    ['99H₂ trailers', project.transport.gaseousHydrogenTrailers],
    ['BEVs', project.transport.bevFleet],
    ['FCEVs', project.transport.fcevFleet],
  ].filter(([, quantity]) => Number(quantity) > 0);

  return (
    <div className="space-y-6">
      <div><h2 className="text-2xl font-bold text-foreground">Review and Run</h2>
        <p className="mt-1 text-muted-foreground">Validate the exact restricted scenario before optimization</p>
      </div>
      <Alert><Info className="h-4 w-4" /><AlertDescription>
        Objective: minimize total hydrogen imbalance over the fixed 24-hour Johor model. The listed
        capacities are baseline data; they are not user-edited solver parameters.
      </AlertDescription></Alert>
      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border p-4"><p className="text-sm text-muted-foreground">Infrastructure</p><p className="text-2xl font-bold">{infrastructure.length}</p></div>
        <div className="rounded-lg border p-4"><p className="text-sm text-muted-foreground">Vehicle templates</p><p className="text-2xl font-bold">{transport.reduce((sum, [, value]) => sum + Number(value), 0)}</p></div>
        <div className="rounded-lg border p-4"><p className="text-sm text-muted-foreground">Daily demand</p><p className="text-2xl font-bold">{project.consumers.reduce((sum, item) => sum + item.demandPerDay, 0).toFixed(2)} kg</p></div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-lg border p-4"><h3 className="font-semibold">Selected assets</h3>
          <ul className="mt-2 space-y-1 text-sm text-muted-foreground">{infrastructure.map(([type, location], index) => <li key={`${type}-${location}-${index}`}>{type}: {location}</li>)}</ul>
        </section>
        <section className="rounded-lg border p-4"><h3 className="font-semibold">Transport</h3>
          <ul className="mt-2 space-y-1 text-sm text-muted-foreground">{transport.map(([label, quantity]) => <li key={String(label)}>{label}: {quantity}</li>)}
            <li>Railway: {project.transport.useRailway ? `${project.transport.railTrains} train(s), ${project.railFreightStations.length} station(s)` : 'Off'}</li>
          </ul>
        </section>
      </div>
      <section className="rounded-lg border p-4"><h3 className="font-semibold">Consumers</h3>
        <ul className="mt-2 space-y-1 text-sm text-muted-foreground">{project.consumers.map((item) => <li key={item.id}>{item.locationName}: {item.demandPerDay} kg H₂/day</li>)}</ul>
      </section>
      <SolverSubmitPanel />
    </div>
  );
}
