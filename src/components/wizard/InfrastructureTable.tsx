import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

interface Field {
  key: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'cascade-select';
  required?: boolean;
  readOnly?: boolean;
  hidden?: boolean;
  options?: string[];
  cascadeOptions?: (selectedState: string) => { value: string; label: string; capacity?: number }[];
  onCascadeChange?: (
    value: string,
    setFormData: (data: Record<string, unknown>) => void,
    formData: Record<string, unknown>,
  ) => void;
}

interface InfrastructureTableProps<T extends { id: string }> {
  title: string;
  description: string;
  items: T[];
  allItems: T[];
  fields: Field[];
  onAdd: (item: Omit<T, 'id'>) => void;
  onEdit: (id: string, item: Omit<T, 'id'>) => void;
  onDelete: (id: string) => void;
  renderCell?: (item: T, fieldKey: string) => React.ReactNode;
  isAddDialogOpen?: boolean;
  onAddDialogChange?: (open: boolean) => void;
}

export function InfrastructureTable<T extends { id: string }>({
  title,
  description,
  items,
  allItems,
  fields,
  onAdd,
  onEdit,
  onDelete,
  renderCell,
  isAddDialogOpen: externalIsOpen,
  onAddDialogChange: externalSetOpen,
}: InfrastructureTableProps<T>) {
  const [internalIsOpen, setInternalIsOpen] = useState(false);
  const isDialogOpen = externalIsOpen !== undefined ? externalIsOpen : internalIsOpen;
  const setIsDialogOpen = externalSetOpen || setInternalIsOpen;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<Record<string, unknown>>({});

  const stateKey = fields[0]?.key ?? 'state';
  // Fields that are derived from the selected location and must be reset when the state changes.
  const dependentKeys = fields.map((f) => f.key).filter((key) => key !== stateKey);

  const duplicateKeyOf = (data: Record<string, unknown>) =>
    `${String(data[stateKey] ?? '').toLowerCase()}|${String(data.location ?? data.locationName ?? '').toLowerCase()}`;

  const handleOpenDialog = (item?: T) => {
    if (item) {
      setEditingId(item.id);
      const data: Record<string, unknown> = {};
      const source = item as unknown as Record<string, unknown>;
      fields.forEach((field) => {
        data[field.key] = source[field.key] ?? '';
      });
      setFormData(data);
    } else {
      setEditingId(null);
      const data: Record<string, unknown> = {};
      fields.forEach((field) => {
        data[field.key] = field.type === 'number' ? 0 : '';
      });
      setFormData(data);
    }
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setEditingId(null);
    setFormData({});
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validate required fields
    const missingFields = fields.filter(
      (field) => field.required && !formData[field.key]
    );
    
    if (missingFields.length > 0) {
      toast.error('Please fill in all required fields');
      return;
    }

    const key = duplicateKeyOf(formData);
    const isDuplicate = allItems.some((existing) => {
      if (editingId && existing.id === editingId) return false;
      return duplicateKeyOf(existing as unknown as Record<string, unknown>) === key;
    });
    if (isDuplicate) {
      toast.error('This location has already been added');
      return;
    }

    if (editingId) {
      onEdit(editingId, formData as Omit<T, 'id'>);
      toast.success('Item updated successfully');
    } else {
      onAdd(formData as Omit<T, 'id'>);
      toast.success('Item added successfully');
    }
    
    handleCloseDialog();
  };

  const handleDelete = (id: string) => {
    onDelete(id);
    toast.success('Item deleted');
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-lg font-semibold">{title}</h3>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </div>

      {items.length > 0 ? (
        <div className="border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                {fields.filter(f => !f.hidden).map((field) => (
                  <TableHead key={field.key}>{field.label}</TableHead>
                ))}
                <TableHead className="w-[100px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id}>
                  {fields.filter(f => !f.hidden).map((field) => (
                    <TableCell key={field.key}>
                      {renderCell
                        ? renderCell(item, field.key)
                        : String((item as unknown as Record<string, unknown>)[field.key] ?? '')}
                    </TableCell>
                  ))}
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleOpenDialog(item)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(item.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="border rounded-lg p-8 text-center">
          <p className="text-muted-foreground">No items added yet. Click "Add" to get started.</p>
        </div>
      )}

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit' : 'Add'} {title}</DialogTitle>
            <DialogDescription>
              {editingId ? 'Update the details below' : 'Enter the details below'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit}>
            <div className="space-y-4 py-4">
              {fields.filter(f => !f.hidden).map((field) => (
                <div key={field.key} className="space-y-2">
                  <Label htmlFor={field.key}>
                    {field.label} {field.required && '*'} {field.readOnly && '(read-only)'}
                  </Label>
                  {field.type === 'select' ? (
                    <Select
                      value={(formData[field.key] as string) || ''}
                      onValueChange={(value) => {
                        if (field.key === stateKey && value !== formData[stateKey]) {
                          // Changing the state invalidates the location and everything derived from it.
                          const cleared: Record<string, unknown> = { [stateKey]: value };
                          dependentKeys.forEach((key) => {
                            const dependent = fields.find((f) => f.key === key);
                            cleared[key] = dependent?.type === 'number' ? 0 : '';
                          });
                          setFormData(cleared);
                          return;
                        }
                        setFormData({
                          ...formData,
                          [field.key]: value,
                        });
                      }}
                      disabled={field.readOnly}
                    >
                      <SelectTrigger id={field.key}>
                        <SelectValue placeholder={`Select ${field.label.toLowerCase()}`} />
                      </SelectTrigger>
                      <SelectContent>
                        {field.options?.map((option) => (
                          <SelectItem key={option} value={option}>
                            {option}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : field.type === 'cascade-select' ? (
                    <Select
                      value={(formData[field.key] as string) || ''}
                      onValueChange={(value) => {
                        const newData: Record<string, unknown> = {
                          ...formData,
                          [field.key]: value,
                        };
                        setFormData(newData);
                        if (field.onCascadeChange) {
                          field.onCascadeChange(value, setFormData, newData);
                        }
                      }}
                      disabled={field.readOnly || (!!field.cascadeOptions && !formData[stateKey])}
                    >
                      <SelectTrigger id={field.key}>
                        <SelectValue placeholder={`Select ${field.label.toLowerCase()}`} />
                      </SelectTrigger>
                      <SelectContent>
                        {field.cascadeOptions
                          ? field.cascadeOptions((formData[stateKey] as string) || '').map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))
                          : field.options?.map((option) => (
                              <SelectItem key={option} value={option}>
                                {option}
                              </SelectItem>
                            ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      id={field.key}
                      type={field.type}
                      value={(formData[field.key] as string) || ''}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          [field.key]:
                            field.type === 'number'
                              ? parseFloat(e.target.value) || 0
                              : e.target.value,
                        })
                      }
                      required={field.required}
                      readOnly={field.readOnly}
                      className={field.readOnly ? 'bg-primary/10 border-primary/30 font-medium' : ''}
                    />
                  )}
                </div>
              ))}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={handleCloseDialog}>
                Cancel
              </Button>
              <Button type="submit">{editingId ? 'Update' : 'Add'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
