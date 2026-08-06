import { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';

export interface InfrastructureAsset {
  infrastructureID: string;
  assetType: 'palm_oil_mill' | 'wastewater_plant' | 'biogas_steam_plant' | 'biomass_h2_hub' | 'solar_farm';
  state: string;
  locationName: string;
  address: string;
  latitude: number;
  longitude: number;
  capacity: number;
  capacityUnit: string;
  storageType: 'gas' | 'liquid' | '';
  notes: string;
}

interface AssetRow {
  InfrastructureID?: string;
  AssetType?: InfrastructureAsset['assetType'];
  State?: string;
  LocationName?: string;
  Address?: string;
  Latitude?: number;
  Longitude?: number;
  Capacity?: number;
  CapacityUnit?: string;
  StorageType?: 'gas' | 'liquid' | '';
  Notes?: string;
}

export const INFRASTRUCTURE_CSV_FILES = [
  'palm_oil_mills.csv',
  'wastewater_plants.csv',
  'biogas_plants.csv',
  'hydrogen_hubs.csv',
  'solar_farms.csv',
] as const;

export function useInfrastructureData() {
  const [assets, setAssets] = useState<InfrastructureAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadAssets = async () => {
      try {
        const rows: AssetRow[] = [];

        // Every CSV must load — a partial dataset silently hides infrastructure options.
        for (const file of INFRASTRUCTURE_CSV_FILES) {
          const response = await fetch(`/${file}`);
          if (!response.ok) {
            throw new Error(`Failed to load ${file} (HTTP ${response.status})`);
          }
          const csvText = await response.text();
          const workbook = XLSX.read(csvText, { type: 'string' });
          const sheet = workbook.Sheets[workbook.SheetNames[0]];
          const parsed = XLSX.utils.sheet_to_json<AssetRow>(sheet);
          if (parsed.length === 0) {
            throw new Error(`${file} contains no rows`);
          }
          rows.push(...parsed);
        }

        if (cancelled) return;

        setAssets(
          rows.map((item) => ({
            infrastructureID: String(item.InfrastructureID ?? ''),
            assetType: item.AssetType as InfrastructureAsset['assetType'],
            state: item.State ?? '',
            locationName: item.LocationName ?? '',
            address: item.Address ?? '',
            latitude: Number(item.Latitude ?? 0),
            longitude: Number(item.Longitude ?? 0),
            capacity: Number(item.Capacity ?? 0),
            capacityUnit: item.CapacityUnit ?? '',
            storageType: item.StorageType ?? '',
            notes: item.Notes ?? '',
          })).filter((asset) =>
            asset.assetType !== 'solar_farm' || ['INF-SF-001', 'INF-SF-002'].includes(asset.infrastructureID),
          ),
        );
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load infrastructure data');
        setAssets([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadAssets();
    return () => {
      cancelled = true;
    };
  }, []);

  const getUniqueStates = () => Array.from(new Set(assets.map((a) => a.state))).sort();

  const getAssetsByType = (type: InfrastructureAsset['assetType']) =>
    assets.filter((a) => a.assetType === type);

  const getAssetsByState = (state: string, type?: InfrastructureAsset['assetType']) =>
    assets.filter((a) => a.state === state && (!type || a.assetType === type));

  return {
    assets,
    loading,
    error,
    getUniqueStates,
    getAssetsByType,
    getAssetsByState,
  };
}
