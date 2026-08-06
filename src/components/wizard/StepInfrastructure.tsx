import { useState, useMemo } from 'react';
import { useHydrogenProject } from '@/context/HydrogenProjectContext';
import { InfrastructureTable } from './InfrastructureTable';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Plus, AlertTriangle } from 'lucide-react';
import { useInfrastructureData } from '@/hooks/useInfrastructureData';

export function StepInfrastructure() {
  const { project, updateProject } = useHydrogenProject();
  const [activeTab, setActiveTab] = useState('mills');
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const infrastructureData = useInfrastructureData();

  const getTabTitle = () => {
    switch (activeTab) {
      case 'mills': return 'Palm Oil Mills';
      case 'wastewater': return 'Wastewater Treatment Plants';
      case 'biogas': return 'Biogas Steam Plants';
      case 'hubs': return 'Biomass Hydrogen Hubs';
      case 'solar': return 'Solar Farms';
      default: return 'Infrastructure';
    }
  };



  const totalSelected = useMemo(() => {
    return {
      palmOilMills: project.palmOilMills.length,
      wastewaterPlants: project.wastewaterPlants.length,
      biogasSteamPlants: project.biogasSteamPlants.length,
      biomassHydrogenHubs: project.biomassHydrogenHubs.length,
      solarFarms: project.solarFarms.length,
    };
  }, [project]);

  const needsBiogasOrHub = project.wastewaterPlants.length > 0 && 
    project.biogasSteamPlants.length === 0 && 
    project.biomassHydrogenHubs.length === 0;

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-xl font-bold text-foreground">Infrastructure Configuration</h2>
        <p className="text-sm text-muted-foreground">
          Select infrastructure from one or more Malaysian states
        </p>
      </div>

      {infrastructureData.error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            Infrastructure data could not be loaded: {infrastructureData.error}. Selections are
            unavailable until this is resolved.
          </AlertDescription>
        </Alert>
      )}

      {infrastructureData.loading && (
        <p className="text-sm text-muted-foreground">Loading infrastructure data…</p>
      )}

      {needsBiogasOrHub && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            At least one <strong>Biogas Steam Plant</strong> or <strong>Biomass Hydrogen Hub</strong> is required when a Wastewater Treatment Plant is selected.
          </AlertDescription>
        </Alert>
      )}

      <Alert>
        <AlertDescription>
          This version uses the audited model's existing plant parameters and fixed baseline
          electrical storage. Hydrogen tanks, alternative processing approaches, and editable
          storage capacities are not supported and are not staged into solver runs.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg">{getTabTitle()}</CardTitle>
              <CardDescription className="text-sm">Select infrastructure type below and add new items</CardDescription>
            </div>
              <Button onClick={() => setIsAddDialogOpen(true)} size="sm">
                <Plus className="h-4 w-4 mr-2" />
                Add
              </Button>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="grid w-full grid-cols-5">
              <TabsTrigger value="mills">Mills</TabsTrigger>
              <TabsTrigger value="wastewater">Wastewater</TabsTrigger>
              <TabsTrigger value="biogas">Biogas</TabsTrigger>
              <TabsTrigger value="hubs">Hubs</TabsTrigger>
              <TabsTrigger value="solar">Solar</TabsTrigger>
            </TabsList>

            <TabsContent value="mills" className="mt-3">
              <InfrastructureTable
                title="Palm Oil Mills"
                description="Add palm oil mills from your selected states"
                items={project.palmOilMills}
            allItems={project.palmOilMills}
            isAddDialogOpen={isAddDialogOpen && activeTab === 'mills'}
            onAddDialogChange={setIsAddDialogOpen}
            fields={[
              { 
                key: 'state', 
                label: 'State', 
                type: 'select', 
                required: true, 
                options: [...new Set(infrastructureData.getAssetsByType('palm_oil_mill').map(a => a.state))].sort()
              },
              { 
                key: 'location', 
                label: 'Location', 
                type: 'cascade-select', 
                required: true,
                cascadeOptions: (state: string) => 
                  infrastructureData.getAssetsByState(state, 'palm_oil_mill').map(asset => ({
                    value: asset.locationName,
                    label: asset.locationName,
                    capacity: asset.capacity,
                    capacityUnit: asset.capacityUnit,
                    address: asset.address,
                    latitude: asset.latitude,
                    longitude: asset.longitude
                  })),
                onCascadeChange: (location: string, setFormData: (data: Record<string, unknown>) => void, formData: Record<string, unknown>) => {
                  const asset = infrastructureData.assets.find(a => 
                    a.assetType === 'palm_oil_mill' && a.locationName === location
                  );
                  if (asset) {
                    setFormData({ 
                      ...formData, 
                      location,
                      catalogId: asset.infrastructureID,
                      capacity: asset.capacity,
                      capacityUnit: asset.capacityUnit,
                      address: asset.address,
                      latitude: asset.latitude,
                      longitude: asset.longitude
                    });
                  }
                }
              },
              { key: 'catalogId', label: 'Catalog ID', type: 'text', required: true, readOnly: true, hidden: true },
              { 
                key: 'capacity', 
                label: 'Capacity', 
                type: 'number', 
                required: true, 
                readOnly: true 
              },
              { 
                key: 'capacityUnit', 
                label: 'Unit', 
                type: 'text', 
                required: true, 
                readOnly: true,
                hidden: true
              },
              { 
                key: 'address', 
                label: 'Address', 
                type: 'text', 
                required: true, 
                readOnly: true,
                hidden: true
              },
              { 
                key: 'latitude', 
                label: 'Latitude', 
                type: 'number', 
                required: true, 
                readOnly: true,
                hidden: true
              },
              { 
                key: 'longitude', 
                label: 'Longitude', 
                type: 'number', 
                required: true, 
                readOnly: true,
                hidden: true
              },
            ]}
            onAdd={(item) =>
              updateProject({
                palmOilMills: [...project.palmOilMills, { ...item, id: crypto.randomUUID() }],
              })
            }
            onEdit={(id, item) =>
              updateProject({
                palmOilMills: project.palmOilMills.map((m) => (m.id === id ? { ...item, id } : m)),
              })
            }
            onDelete={(id) =>
              updateProject({
                palmOilMills: project.palmOilMills.filter((m) => m.id !== id),
              })
            }
              />
            </TabsContent>

            <TabsContent value="wastewater" className="mt-3">
              <InfrastructureTable
                title="Wastewater Treatment Plants"
                description="Add wastewater treatment plants"
                items={project.wastewaterPlants}
            allItems={project.wastewaterPlants}
            isAddDialogOpen={isAddDialogOpen && activeTab === 'wastewater'}
            onAddDialogChange={setIsAddDialogOpen}
            fields={[
              { 
                key: 'state', 
                label: 'State', 
                type: 'select', 
                required: true, 
                options: [...new Set(infrastructureData.getAssetsByType('wastewater_plant').map(a => a.state))].sort()
              },
              { 
                key: 'location', 
                label: 'Location', 
                type: 'cascade-select', 
                required: true,
                cascadeOptions: (state: string) => 
                  infrastructureData.getAssetsByState(state, 'wastewater_plant').map(asset => ({
                    value: asset.locationName,
                    label: asset.locationName,
                    capacity: asset.capacity,
                    capacityUnit: asset.capacityUnit,
                    address: asset.address,
                    latitude: asset.latitude,
                    longitude: asset.longitude
                  })),
                onCascadeChange: (location: string, setFormData: (data: Record<string, unknown>) => void, formData: Record<string, unknown>) => {
                  const asset = infrastructureData.assets.find(a => 
                    a.assetType === 'wastewater_plant' && a.locationName === location
                  );
                  if (asset) {
                    setFormData({ 
                      ...formData, 
                      location,
                      catalogId: asset.infrastructureID,
                      capacityEffluent: asset.capacity,
                      capacityUnit: asset.capacityUnit,
                      address: asset.address,
                      latitude: asset.latitude,
                      longitude: asset.longitude
                    });
                  }
                }
              },
              { key: 'catalogId', label: 'Catalog ID', type: 'text', required: true, readOnly: true, hidden: true },
              { key: 'capacityEffluent', label: 'Capacity', type: 'number', required: true, readOnly: true },
              { key: 'capacityUnit', label: 'Unit', type: 'text', required: true, readOnly: true, hidden: true },
              { key: 'address', label: 'Address', type: 'text', required: true, readOnly: true, hidden: true },
              { key: 'latitude', label: 'Latitude', type: 'number', required: true, readOnly: true, hidden: true },
              { key: 'longitude', label: 'Longitude', type: 'number', required: true, readOnly: true, hidden: true },
            ]}
            onAdd={(item) =>
              updateProject({
                wastewaterPlants: [...project.wastewaterPlants, { ...item, id: crypto.randomUUID() }],
              })
            }
            onEdit={(id, item) =>
              updateProject({
                wastewaterPlants: project.wastewaterPlants.map((w) => (w.id === id ? { ...item, id } : w)),
              })
            }
            onDelete={(id) =>
              updateProject({
                wastewaterPlants: project.wastewaterPlants.filter((w) => w.id !== id),
              })
            }
              />
            </TabsContent>

            <TabsContent value="biogas" className="mt-3">
              <InfrastructureTable
                title="Biogas Steam Plants"
                description="Add biogas steam plants"
                items={project.biogasSteamPlants}
            allItems={project.biogasSteamPlants}
            isAddDialogOpen={isAddDialogOpen && activeTab === 'biogas'}
            onAddDialogChange={setIsAddDialogOpen}
            fields={[
              { 
                key: 'state', 
                label: 'State', 
                type: 'select', 
                required: true, 
                options: [...new Set(infrastructureData.getAssetsByType('biogas_steam_plant').map(a => a.state))].sort()
              },
              { 
                key: 'location', 
                label: 'Location', 
                type: 'cascade-select', 
                required: true,
                cascadeOptions: (state: string) => 
                  infrastructureData.getAssetsByState(state, 'biogas_steam_plant').map(asset => ({
                    value: asset.locationName,
                    label: asset.locationName,
                    capacity: asset.capacity,
                    capacityUnit: asset.capacityUnit,
                    address: asset.address,
                    latitude: asset.latitude,
                    longitude: asset.longitude
                  })),
                onCascadeChange: (location: string, setFormData: (data: Record<string, unknown>) => void, formData: Record<string, unknown>) => {
                  const asset = infrastructureData.assets.find(a => 
                    a.assetType === 'biogas_steam_plant' && a.locationName === location
                  );
                  if (asset) {
                    setFormData({ 
                      ...formData, 
                      location,
                      catalogId: asset.infrastructureID,
                      capacityBiogas: asset.capacity,
                      capacityUnit: asset.capacityUnit,
                      address: asset.address,
                      latitude: asset.latitude,
                      longitude: asset.longitude
                    });
                  }
                }
              },
              { key: 'catalogId', label: 'Catalog ID', type: 'text', required: true, readOnly: true, hidden: true },
              { key: 'capacityBiogas', label: 'Capacity', type: 'number', required: true, readOnly: true },
              { key: 'capacityUnit', label: 'Unit', type: 'text', required: true, readOnly: true, hidden: true },
              { key: 'address', label: 'Address', type: 'text', required: true, readOnly: true, hidden: true },
              { key: 'latitude', label: 'Latitude', type: 'number', required: true, readOnly: true, hidden: true },
              { key: 'longitude', label: 'Longitude', type: 'number', required: true, readOnly: true, hidden: true },
            ]}
            onAdd={(item) =>
              updateProject({
                biogasSteamPlants: [...project.biogasSteamPlants, { ...item, id: crypto.randomUUID() }],
              })
            }
            onEdit={(id, item) =>
              updateProject({
                biogasSteamPlants: project.biogasSteamPlants.map((b) => (b.id === id ? { ...item, id } : b)),
              })
            }
            onDelete={(id) =>
              updateProject({
                biogasSteamPlants: project.biogasSteamPlants.filter((b) => b.id !== id),
              })
            }
              />
            </TabsContent>

            <TabsContent value="hubs" className="mt-3">
              <InfrastructureTable
                title="Biomass Hydrogen Hubs"
                description="Add biomass hydrogen hubs"
                items={project.biomassHydrogenHubs}
            allItems={project.biomassHydrogenHubs}
            isAddDialogOpen={isAddDialogOpen && activeTab === 'hubs'}
            onAddDialogChange={setIsAddDialogOpen}
            fields={[
              { 
                key: 'state', 
                label: 'State', 
                type: 'select', 
                required: true, 
                options: [...new Set(infrastructureData.getAssetsByType('biomass_h2_hub').map(a => a.state))].sort()
              },
              { 
                key: 'location', 
                label: 'Location', 
                type: 'cascade-select', 
                required: true,
                cascadeOptions: (state: string) => 
                  infrastructureData.getAssetsByState(state, 'biomass_h2_hub').map(asset => ({
                    value: asset.locationName,
                    label: asset.locationName,
                    capacity: asset.capacity,
                    capacityUnit: asset.capacityUnit,
                    address: asset.address,
                    latitude: asset.latitude,
                    longitude: asset.longitude
                  })),
                onCascadeChange: (location: string, setFormData: (data: Record<string, unknown>) => void, formData: Record<string, unknown>) => {
                  const asset = infrastructureData.assets.find(a => 
                    a.assetType === 'biomass_h2_hub' && a.locationName === location
                  );
                  if (asset) {
                    setFormData({ 
                      ...formData, 
                      location,
                      catalogId: asset.infrastructureID,
                      processingCapacity: asset.capacity,
                      capacityUnit: asset.capacityUnit,
                      address: asset.address,
                      latitude: asset.latitude,
                      longitude: asset.longitude
                    });
                  }
                }
              },
              { key: 'catalogId', label: 'Catalog ID', type: 'text', required: true, readOnly: true, hidden: true },
              { key: 'processingCapacity', label: 'Capacity', type: 'number', required: true, readOnly: true },
              { key: 'capacityUnit', label: 'Unit', type: 'text', required: true, readOnly: true, hidden: true },
              { key: 'address', label: 'Address', type: 'text', required: true, readOnly: true, hidden: true },
              { key: 'latitude', label: 'Latitude', type: 'number', required: true, readOnly: true, hidden: true },
              { key: 'longitude', label: 'Longitude', type: 'number', required: true, readOnly: true, hidden: true },
            ]}
            onAdd={(item) =>
              updateProject({
                biomassHydrogenHubs: [...project.biomassHydrogenHubs, { ...item, id: crypto.randomUUID() }],
              })
            }
            onEdit={(id, item) =>
              updateProject({
                biomassHydrogenHubs: project.biomassHydrogenHubs.map((h) => (h.id === id ? { ...item, id } : h)),
              })
            }
            onDelete={(id) =>
              updateProject({
                biomassHydrogenHubs: project.biomassHydrogenHubs.filter((h) => h.id !== id),
              })
            }
              />
            </TabsContent>

            <TabsContent value="solar" className="mt-3">
              <InfrastructureTable
                title="Solar Farms"
                description="Add solar farms"
                items={project.solarFarms}
            allItems={project.solarFarms}
            isAddDialogOpen={isAddDialogOpen && activeTab === 'solar'}
            onAddDialogChange={setIsAddDialogOpen}
            fields={[
              { 
                key: 'state', 
                label: 'State', 
                type: 'select', 
                required: true, 
                options: [...new Set(infrastructureData.getAssetsByType('solar_farm').map(a => a.state))].sort()
              },
              { 
                key: 'location', 
                label: 'Location', 
                type: 'cascade-select', 
                required: true,
                cascadeOptions: (state: string) => 
                  infrastructureData.getAssetsByState(state, 'solar_farm').map(asset => ({
                    value: asset.locationName,
                    label: asset.locationName,
                    capacity: asset.capacity,
                    capacityUnit: asset.capacityUnit,
                    address: asset.address,
                    latitude: asset.latitude,
                    longitude: asset.longitude
                  })),
                onCascadeChange: (location: string, setFormData: (data: Record<string, unknown>) => void, formData: Record<string, unknown>) => {
                  const asset = infrastructureData.assets.find(a => 
                    a.assetType === 'solar_farm' && a.locationName === location
                  );
                  if (asset) {
                    setFormData({ 
                      ...formData, 
                      location,
                      catalogId: asset.infrastructureID,
                      capacity: asset.capacity,
                      capacityUnit: asset.capacityUnit,
                      address: asset.address,
                      latitude: asset.latitude,
                      longitude: asset.longitude
                    });
                  }
                }
              },
              { key: 'catalogId', label: 'Catalog ID', type: 'text', required: true, readOnly: true, hidden: true },
              { key: 'capacity', label: 'Capacity', type: 'number', required: true, readOnly: true },
              { key: 'capacityUnit', label: 'Unit', type: 'text', required: true, readOnly: true, hidden: true },
              { key: 'address', label: 'Address', type: 'text', required: true, readOnly: true, hidden: true },
              { key: 'latitude', label: 'Latitude', type: 'number', required: true, readOnly: true, hidden: true },
              { key: 'longitude', label: 'Longitude', type: 'number', required: true, readOnly: true, hidden: true },
            ]}
            onAdd={(item) =>
              updateProject({
                solarFarms: [...project.solarFarms, { ...item, id: crypto.randomUUID() }],
              })
            }
            onEdit={(id, item) =>
              updateProject({
                solarFarms: project.solarFarms.map((s) => (s.id === id ? { ...item, id } : s)),
              })
            }
            onDelete={(id) =>
              updateProject({
                solarFarms: project.solarFarms.filter((s) => s.id !== id),
              })
            }
              />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Selection Summary</CardTitle>
          <CardDescription className="text-sm">Infrastructure selected across all states</CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="grid grid-cols-5 gap-3">
            <div>
              <p className="text-xs text-muted-foreground">Mills</p>
              <p className="text-xl font-bold">{totalSelected.palmOilMills}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Wastewater</p>
              <p className="text-xl font-bold">{totalSelected.wastewaterPlants}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Biogas</p>
              <p className="text-xl font-bold">{totalSelected.biogasSteamPlants}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Hubs</p>
              <p className="text-xl font-bold">{totalSelected.biomassHydrogenHubs}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Solar</p>
              <p className="text-xl font-bold">{totalSelected.solarFarms}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
