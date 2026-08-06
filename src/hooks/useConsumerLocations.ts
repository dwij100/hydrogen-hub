import { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';

export interface ConsumerLocation {
  id: string;
  state: string;
  locationName: string;
  address: string;
  latitude: number;
  longitude: number;
  notes?: string;
}

interface ConsumerLocationData {
  ConsumerLocationID: string;
  State: string;
  LocationName: string;
  Address: string;
  Latitude: number;
  Longitude: number;
  Notes?: string;
}

export function useConsumerLocations() {
  const [locations, setLocations] = useState<ConsumerLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchLocations = async () => {
      try {
        // Try to load from CSV file first
        let data: ConsumerLocationData[];
        try {
          const response = await fetch('/consumer_locations.csv');
          if (response.ok) {
            const csvText = await response.text();
            const workbook = XLSX.read(csvText, { type: 'string' });
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            data = XLSX.utils.sheet_to_json(worksheet);
          } else {
            throw new Error('CSV file not found');
          }
        } catch {
          // Fallback to JSON if CSV fails
          console.log('Loading from JSON fallback');
          const response = await fetch('/consumer_locations.json');
          if (!response.ok) {
            throw new Error('Failed to fetch consumer locations');
          }
          data = await response.json();
        }
        
        const parsedLocations: ConsumerLocation[] = data.map((item) => ({
          id: item.ConsumerLocationID,
          state: item.State,
          locationName: item.LocationName,
          address: item.Address,
          latitude: item.Latitude,
          longitude: item.Longitude,
          notes: item.Notes,
        }));

        setLocations(parsedLocations);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };

    fetchLocations();
  }, []);

  const getUniqueStates = (): string[] => {
    const states = [...new Set(locations.map((loc) => loc.state))];
    return states.sort();
  };

  const getLocationsByState = (state: string): ConsumerLocation[] => {
    return locations.filter((loc) => loc.state === state);
  };

  return {
    locations,
    loading,
    error,
    getUniqueStates,
    getLocationsByState,
  };
}
