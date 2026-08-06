import type { HydrogenProject } from '@/context/HydrogenProjectContext';

export interface LocalProjectRecord {
  id: string;
  name: string;
  config: Partial<HydrogenProject>;
  created_at: string;
  updated_at: string;
}

const KEY = 'hydrogen-hub-local-projects-v1';

export function listLocalProjects(): LocalProjectRecord[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? '[]') as LocalProjectRecord[];
    return Array.isArray(parsed)
      ? parsed.sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      : [];
  } catch {
    return [];
  }
}

function write(records: LocalProjectRecord[]) {
  localStorage.setItem(KEY, JSON.stringify(records));
}

export function getLocalProject(id: string): LocalProjectRecord | null {
  return listLocalProjects().find((record) => record.id === id) ?? null;
}

export function createLocalProject(name: string): LocalProjectRecord {
  const now = new Date().toISOString();
  const record: LocalProjectRecord = {
    id: crypto.randomUUID(),
    name,
    config: {},
    created_at: now,
    updated_at: now,
  };
  write([record, ...listLocalProjects()]);
  return record;
}

export function updateLocalProject(id: string, name: string, config: Partial<HydrogenProject>) {
  const records = listLocalProjects();
  const index = records.findIndex((record) => record.id === id);
  if (index < 0) throw new Error('Local project no longer exists.');
  records[index] = { ...records[index], name, config, updated_at: new Date().toISOString() };
  write(records);
}

export function deleteLocalProject(id: string) {
  write(listLocalProjects().filter((record) => record.id !== id));
}
