import { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';

export interface RailStation {
  id: string;
  stationId: string;
  state: string;
  locationName: string;
  address: string;
  latitude: number;
  longitude: number;
}

interface RailStationRow {
  StationID?: string;
  State?: string;
  LocationName?: string;
  Address?: string;
  Latitude?: number;
  Longitude?: number;
}

export function useRailFreightStations() {
  const [stations, setStations] = useState<RailStation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const response = await fetch('/rail_freight_stations.csv');
        if (!response.ok) {
          throw new Error(`Failed to load rail_freight_stations.csv (${response.status})`);
        }
        const csvText = await response.text();
        const workbook = XLSX.read(csvText, { type: 'string' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json<RailStationRow>(sheet);
        if (cancelled) return;
        setStations(
          rows
            .filter((row) => row.StationID)
            .map((row) => ({
              id: String(row.StationID),
              stationId: String(row.StationID),
              state: row.State ?? '',
              locationName: row.LocationName ?? '',
              address: row.Address ?? '',
              latitude: Number(row.Latitude ?? 0),
              longitude: Number(row.Longitude ?? 0),
            })),
        );
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load rail freight stations');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return { stations, loading, error };
}
