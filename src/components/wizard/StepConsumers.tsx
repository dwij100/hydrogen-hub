import { useState } from 'react';
import { useHydrogenProject } from '@/context/HydrogenProjectContext';
import { useConsumerLocations } from '@/hooks/useConsumerLocations';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription } from '@/components/ui/alert';

export function StepConsumers() {
  const { project, updateProject } = useHydrogenProject();
  const { locations, loading, error, getUniqueStates, getLocationsByState } = useConsumerLocations();
  
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedState, setSelectedState] = useState('');
  const [selectedLocationId, setSelectedLocationId] = useState('');
  const [demandPerDay, setDemandPerDay] = useState('');

  const handleOpenDialog = (consumerId?: string) => {
    if (consumerId) {
      const consumer = project.consumers.find((c) => c.id === consumerId);
      if (consumer) {
        setEditingId(consumerId);
        setSelectedState(consumer.state);
        setSelectedLocationId(consumer.consumerLocationId);
        setDemandPerDay(consumer.demandPerDay.toString());
      }
    } else {
      setEditingId(null);
      setSelectedState('');
      setSelectedLocationId('');
      setDemandPerDay('');
    }
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setEditingId(null);
    setSelectedState('');
    setSelectedLocationId('');
    setDemandPerDay('');
  };

  const handleSubmit = () => {
    const selectedLocation = locations.find((loc) => loc.id === selectedLocationId);
    if (!selectedLocation || !demandPerDay) return;

    const isDuplicate = project.consumers.some(
      (c) => c.consumerLocationId === selectedLocation.id && c.id !== editingId,
    );
    if (isDuplicate) {
      toast.error('This consumer location has already been added');
      return;
    }

    const consumerData = {
      consumerLocationId: selectedLocation.id,
      state: selectedLocation.state,
      locationName: selectedLocation.locationName,
      demandPerDay: parseFloat(demandPerDay),
      address: selectedLocation.address,
      latitude: selectedLocation.latitude,
      longitude: selectedLocation.longitude,
    };

    if (editingId) {
      // Edit existing consumer
      updateProject({
        consumers: project.consumers.map((c) =>
          c.id === editingId ? { ...consumerData, id: editingId } : c
        ),
      });
    } else {
      // Add new consumer
      updateProject({
        consumers: [...project.consumers, { ...consumerData, id: crypto.randomUUID() }],
      });
    }

    handleCloseDialog();
  };

  const handleDelete = (id: string) => {
    updateProject({
      consumers: project.consumers.filter((c) => c.id !== id),
    });
  };

  const isFormValid = selectedState && selectedLocationId && demandPerDay && parseFloat(demandPerDay) > 0;

  const filteredLocations = selectedState ? getLocationsByState(selectedState) : [];
  const selectedLocation = locations.find((loc) => loc.id === selectedLocationId);

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-bold text-foreground">Consumer Configuration</h2>
          <p className="text-muted-foreground mt-1">Loading consumer locations...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-bold text-foreground">Consumer Configuration</h2>
          <p className="text-muted-foreground mt-1">Define hydrogen demand points and consumption rates</p>
        </div>
        <Alert variant="destructive">
          <AlertDescription>Error loading consumer locations: {error}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-foreground">Consumer Configuration</h2>
        <p className="text-muted-foreground mt-1">Define hydrogen demand points and consumption rates</p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Hydrogen Consumers</CardTitle>
              <CardDescription>End users and their daily hydrogen demand</CardDescription>
            </div>
            <Button onClick={() => handleOpenDialog()} size="sm">
              <Plus className="h-4 w-4 mr-2" />
              Add Consumer
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {project.consumers.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No consumers added yet. Click 'Add Consumer' above to get started.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>State</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Demand per Day</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {project.consumers.map((consumer) => (
                  <TableRow key={consumer.id}>
                    <TableCell>{consumer.state}</TableCell>
                    <TableCell>{consumer.locationName}</TableCell>
                    <TableCell>{consumer.demandPerDay} kg H₂/day</TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleOpenDialog(consumer.id)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(consumer.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {project.consumers.length === 0 && (
        <Alert>
          <AlertDescription>
            Please add at least one consumer before proceeding to the next step.
          </AlertDescription>
        </Alert>
      )}

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>
              {editingId ? 'Edit Hydrogen Consumer' : 'Add Hydrogen Consumer'}
            </DialogTitle>
            <DialogDescription>
              Select a location and specify the daily hydrogen demand
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="state">State *</Label>
              <Select
                value={selectedState}
                onValueChange={(value) => {
                  setSelectedState(value);
                  setSelectedLocationId('');
                }}
              >
                <SelectTrigger id="state">
                  <SelectValue placeholder="Select state" />
                </SelectTrigger>
                <SelectContent>
                  {getUniqueStates().map((state) => (
                    <SelectItem key={state} value={state}>
                      {state}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="location">Location *</Label>
              <Select
                value={selectedLocationId}
                onValueChange={setSelectedLocationId}
                disabled={!selectedState}
              >
                <SelectTrigger id="location">
                  <SelectValue placeholder="Select location" />
                </SelectTrigger>
                <SelectContent>
                  {filteredLocations.map((location) => (
                    <SelectItem key={location.id} value={location.id}>
                      {location.locationName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedLocation && (
                <p className="text-xs text-muted-foreground">
                  {selectedLocation.address}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="demand">Demand per Day (kg H₂/day) *</Label>
              <Input
                id="demand"
                type="number"
                min="0"
                step="0.01"
                value={demandPerDay}
                onChange={(e) => setDemandPerDay(e.target.value)}
                placeholder="e.g. 1000"
              />
              <p className="text-xs text-muted-foreground">
                Enter the demand in kg H₂/day.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={handleCloseDialog}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={!isFormValid}>
              {editingId ? 'Update' : 'Add'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
