import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('optional cloud client in local mode', () => {
  it('imports without Supabase settings when local mode is enabled', async () => {
    vi.stubEnv('VITE_LOCAL_MODE', 'true');
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', '');
    const module = await import('./client');
    expect(module.supabase).toBeDefined();
  });
});
