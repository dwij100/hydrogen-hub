import { useState, useEffect } from 'react';

export interface PalmOilMillOption {
  state: string;
  location: string;
  capacity: number;
}

export function usePalmOilMillsOptions() {
  const [options, setOptions] = useState<PalmOilMillOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadOptions = async () => {
      try {
        const response = await fetch('/palm_oil_mills_dummy.json');
        if (!response.ok) {
          throw new Error('Failed to load palm oil mills data');
        }
        const data = await response.json();
        setOptions(data.map((item: { State: string; Location: string; Capacity: number }) => ({
          state: item.State,
          location: item.Location,
          capacity: item.Capacity,
        })));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
        console.error('Error loading palm oil mills data:', err);
      } finally {
        setLoading(false);
      }
    };

    loadOptions();
  }, []);

  const getUniqueStates = () => {
    return Array.from(new Set(options.map(o => o.state))).sort();
  };

  const getLocationsByState = (state: string) => {
    return options.filter(o => o.state === state);
  };

  const getCapacityByLocation = (location: string) => {
    const option = options.find(o => o.location === location);
    return option?.capacity ?? 0;
  };

  return {
    options,
    loading,
    error,
    getUniqueStates,
    getLocationsByState,
    getCapacityByLocation,
  };
}
