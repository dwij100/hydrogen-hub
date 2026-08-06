import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle, Info } from 'lucide-react';
import { useHydrogenProject } from '@/context/HydrogenProjectContext';
import { useRailFreightStations } from '@/hooks/useRailFreightStations';

const VEHICLES = [
  ['pomeTrucks', 'POME trucks', 5],
  ['biogasTrucks', 'Biogas trucks', 5],
  ['biomassTrucks', 'Biomass trucks', 5],
  ['prePurifiedHydrogenTrucks', 'BioH₂ trucks', 5],
  ['gaseousHydrogenTrailers', '99H₂ gaseous trailers', 5],
  ['bevFleet', 'Battery-electric vehicles', 30],
  ['fcevFleet', 'Fuel-cell vehicles', 20],
] as const;

export function StepTransport() {
  const { project, updateProject } = useHydrogenProject();
  const { stations, loading, error } = useRailFreightStations();
  const updateTransport = (key: keyof typeof project.transport, value: number | boolean) =>
    updateProject({ transport: { ...project.transport, [key]: value } });
  const toggleRailway = (enabled: boolean) => updateProject({
    transport: { ...project.transport, useRailway: enabled, railTrains: enabled ? Math.max(1, project.transport.railTrains) : 0 },
    railFreightStations: enabled ? project.railFreightStations : [],
  });
  const toggleStation = (id: string, checked: boolean) => {
    const station = stations.find((item) => item.id === id);
    if (!station) return;
    updateProject({
      railFreightStations: checked
        ? project.railFreightStations.some((item) => item.stationId === station.stationId)
          ? project.railFreightStations : [...project.railFreightStations, station]
        : project.railFreightStations.filter((item) => item.stationId !== station.stationId),
    });
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-foreground">Transport Configuration</h2>
        <p className="text-muted-foreground mt-1">Select deterministic templates from the bundled model</p>
      </div>
      <Alert><Info className="h-4 w-4" /><AlertDescription>
        Quantities select the first available templates of each model type in numeric order. Liquid
        hydrogen trailers are not represented by the preserved solver and are unavailable.
      </AlertDescription></Alert>
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-lg">Vehicle templates</CardTitle><CardDescription>At least one vehicle is required</CardDescription></CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {VEHICLES.map(([key, label, maximum]) => (
            <div className="space-y-2" key={key}>
              <Label htmlFor={key}>{label}</Label>
              <Input id={key} type="number" min="0" max={maximum}
                value={project.transport[key] as number}
                onChange={(event) => updateTransport(key, Math.max(0, Math.min(maximum, Number.parseInt(event.target.value, 10) || 0)))} />
              <p className="text-xs text-muted-foreground">Available templates: {maximum}</p>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-lg">Railway</CardTitle><CardDescription>Existing RW1–RW3 templates only</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label htmlFor="useRailway">Enable railway transport</Label>
            <Switch id="useRailway" checked={project.transport.useRailway} onCheckedChange={toggleRailway} />
          </div>
          {project.transport.useRailway && <>
            <div className="space-y-2">
              <Label htmlFor="railTrains">Train templates (1–3)</Label>
              <Input id="railTrains" type="number" min="1" max="3" value={project.transport.railTrains}
                onChange={(event) => updateTransport('railTrains', Math.max(1, Math.min(3, Number.parseInt(event.target.value, 10) || 1)))} />
            </div>
            <div className="space-y-2"><Label>Rail freight stations</Label>
              {loading && <p className="text-xs text-muted-foreground">Loading stations…</p>}
              {error && <Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertDescription>{error}</AlertDescription></Alert>}
              {!loading && !error && <div className="divide-y rounded-lg border">
                {stations.map((station) => <label key={station.id} className="flex cursor-pointer items-center gap-3 p-3 text-sm">
                  <Checkbox checked={project.railFreightStations.some((item) => item.stationId === station.stationId)}
                    onCheckedChange={(value) => toggleStation(station.id, value === true)} />
                  <span>{station.locationName}</span>
                </label>)}
              </div>}
            </div>
          </>}
        </CardContent>
      </Card>
    </div>
  );
}
