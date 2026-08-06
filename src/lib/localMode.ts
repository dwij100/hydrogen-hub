export function isLocalMode(): boolean {
  return String(import.meta.env.VITE_LOCAL_MODE ?? 'false').toLowerCase() === 'true';
}
