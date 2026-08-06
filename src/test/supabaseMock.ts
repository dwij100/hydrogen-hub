import { vi } from 'vitest';

export interface MockProjectRow {
  id: string;
  name: string;
  config: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
}

interface MockState {
  session: { user: { id: string } } | null;
  sessionError: string | null;
  projects: MockProjectRow[];
  failInsert: boolean;
  failUpdate: boolean;
  updates: { id: string; name: string; config: unknown }[];
  authListeners: ((event: string, session: unknown) => void)[];
}

export const mockState: MockState = {
  session: null,
  sessionError: null,
  projects: [],
  failInsert: false,
  failUpdate: false,
  updates: [],
  authListeners: [],
};

export function resetMockState() {
  mockState.session = null;
  mockState.sessionError = null;
  mockState.projects = [];
  mockState.failInsert = false;
  mockState.failUpdate = false;
  mockState.updates = [];
  mockState.authListeners = [];
}

export const signInWithPassword = vi.fn(async ({ email }: { email: string }) => {
  if (email.startsWith('bad')) {
    return { data: { session: null, user: null }, error: { message: 'Invalid login credentials' } };
  }
  mockState.session = { user: { id: 'user-1' } };
  return { data: { session: mockState.session, user: mockState.session.user }, error: null };
});

export const signUp = vi.fn(async ({ email }: { email: string }) => {
  if (email.startsWith('confirm')) {
    // Email confirmation required: no session is returned.
    return { data: { session: null, user: { id: 'user-2' } }, error: null };
  }
  mockState.session = { user: { id: 'user-2' } };
  return { data: { session: mockState.session, user: mockState.session.user }, error: null };
});

export const signOut = vi.fn(async () => {
  mockState.session = null;
  mockState.authListeners.forEach((cb) => cb('SIGNED_OUT', null));
  return { error: null };
});

function tableApi(table: string) {
  const builder = {
    _filterId: undefined as string | undefined,
    select() {
      return builder;
    },
    order() {
      return Promise.resolve({ data: mockState.projects, error: null });
    },
    eq(_column: string, value: string) {
      builder._filterId = value;
      return builder;
    },
    maybeSingle() {
      const found = mockState.projects.find((p) => p.id === builder._filterId);
      return Promise.resolve(
        found ? { data: found, error: null } : { data: null, error: null },
      );
    },
    single() {
      const found = mockState.projects.find((p) => p.id === builder._filterId);
      return Promise.resolve(
        found ? { data: found, error: null } : { data: null, error: { message: 'Not found' } },
      );
    },
    insert(values: { name: string; user_id: string; config: Record<string, unknown> }) {
      if (mockState.failInsert) {
        return {
          select: () => ({
            single: () => Promise.resolve({ data: null, error: { message: 'insert failed' } }),
          }),
        };
      }
      const row: MockProjectRow = {
        id: `project-${mockState.projects.length + 1}`,
        name: values.name,
        config: values.config ?? {},
      };
      mockState.projects.push(row);
      return {
        select: () => ({ single: () => Promise.resolve({ data: row, error: null }) }),
      };
    },
    update(values: { name: string; config: unknown }) {
      return {
        eq: (_column: string, id: string) => {
          if (mockState.failUpdate) {
            return Promise.resolve({ error: { message: 'update failed' } });
          }
          mockState.updates.push({ id, ...values });
          const row = mockState.projects.find((p) => p.id === id);
          if (row) {
            row.name = values.name;
            row.config = values.config as Record<string, unknown>;
          }
          return Promise.resolve({ error: null });
        },
      };
    },
    delete() {
      return {
        eq: (_column: string, id: string) => {
          mockState.projects = mockState.projects.filter((p) => p.id !== id);
          return Promise.resolve({ error: null });
        },
      };
    },
  };
  void table;
  return builder;
}

export const supabase = {
  auth: {
    getSession: vi.fn(async () => {
      if (mockState.sessionError) {
        return { data: { session: null }, error: { message: mockState.sessionError } };
      }
      return { data: { session: mockState.session }, error: null };
    }),
    getUser: vi.fn(async () => ({ data: { user: mockState.session?.user ?? null }, error: null })),
    onAuthStateChange: vi.fn((cb: (event: string, session: unknown) => void) => {
      mockState.authListeners.push(cb);
      return {
        data: {
          subscription: {
            unsubscribe: () => {
              mockState.authListeners = mockState.authListeners.filter((l) => l !== cb);
            },
          },
        },
      };
    }),
    signInWithPassword,
    signUp,
    signOut,
  },
  from: vi.fn((table: string) => tableApi(table)),
};
