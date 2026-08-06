import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

vi.mock('@/integrations/supabase/client', async () => {
  const mod = await import('@/test/supabaseMock');
  return { supabase: mod.supabase };
});

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('sonner', () => ({ toast: toastMock, Toaster: () => null }));

import { mockState, resetMockState, signInWithPassword, signUp, signOut } from '@/test/supabaseMock';
import AuthPage from '@/pages/AuthPage';
import { AuthGuard } from '@/components/AuthGuard';
import { LogoutButton } from '@/components/LogoutButton';
import { HydrogenProjectProvider, ACTIVE_PROJECT_KEY } from '@/context/HydrogenProjectContext';

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

function renderApp(initialEntry: string, protectedElement = <div>Hydrogen Home</div>) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <HydrogenProjectProvider>
        <LocationProbe />
        <Routes>
          <Route path="/" element={<AuthPage />} />
          <Route path="/hydrogen" element={<AuthGuard>{protectedElement}</AuthGuard>} />
          <Route
            path="/hydrogen/setup"
            element={<AuthGuard><div>Wizard</div></AuthGuard>}
          />
        </Routes>
      </HydrogenProjectProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  resetMockState();
  sessionStorage.clear();
});

describe('login', () => {
  it('signs in with a username and redirects to /hydrogen', async () => {
    const user = userEvent.setup();
    renderApp('/');

    await user.type(screen.getByLabelText(/username/i), 'dulhan');
    await user.type(screen.getByLabelText(/password/i), 'secret123');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(signInWithPassword).toHaveBeenCalledWith({
        email: 'dulhan@netzero.app',
        password: 'secret123',
      });
      expect(screen.getByTestId('location')).toHaveTextContent('/hydrogen');
    });
  });

  it('rejects invalid usernames before calling the backend', async () => {
    const user = userEvent.setup();
    renderApp('/');

    await user.type(screen.getByLabelText(/username/i), 'a!');
    await user.type(screen.getByLabelText(/password/i), 'secret123');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(signInWithPassword).not.toHaveBeenCalled();
    expect(toastMock.error).toHaveBeenCalled();
  });

  it('shows an error and stays on the page when credentials are wrong', async () => {
    const user = userEvent.setup();
    renderApp('/');

    await user.type(screen.getByLabelText(/username/i), 'baduser');
    await user.type(screen.getByLabelText(/password/i), 'nope1234');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
    expect(screen.getByTestId('location')).toHaveTextContent('/');
  });

  it('redirects an already-authenticated visitor away from /', async () => {
    mockState.session = { user: { id: 'user-1' } };
    renderApp('/');
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/hydrogen'));
  });

  it('honours the next parameter after signing in', async () => {
    const user = userEvent.setup();
    renderApp('/?next=%2Fhydrogen%2Fsetup%3Fstep%3D3');

    await user.type(screen.getByLabelText(/username/i), 'dulhan');
    await user.type(screen.getByLabelText(/password/i), 'secret123');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('/hydrogen/setup?step=3'),
    );
  });
});

describe('registration', () => {
  it('uses the session returned by signUp without a second sign-in', async () => {
    const user = userEvent.setup();
    renderApp('/');

    await user.click(screen.getByRole('button', { name: /register/i }));
    await user.type(screen.getByLabelText(/display name/i), 'Dulhan');
    await user.type(screen.getByLabelText(/username/i), 'newuser');
    await user.type(screen.getByLabelText(/password/i), 'secret123');
    await user.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/hydrogen'));
    expect(signUp).toHaveBeenCalled();
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it('shows a confirmation message when signup returns no session', async () => {
    const user = userEvent.setup();
    renderApp('/');

    await user.click(screen.getByRole('button', { name: /register/i }));
    await user.type(screen.getByLabelText(/display name/i), 'Dulhan');
    await user.type(screen.getByLabelText(/username/i), 'confirmme');
    await user.type(screen.getByLabelText(/password/i), 'secret123');
    await user.click(screen.getByRole('button', { name: /create account/i }));

    expect(await screen.findByText(/confirm your email address/i)).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/');
  });
});

describe('AuthGuard', () => {
  it('shows a loading indicator while the session is being checked', async () => {
    let resolveSession: (value: unknown) => void = () => undefined;
    const { supabase } = await import('@/test/supabaseMock');
    (supabase.auth.getSession as unknown as { mockImplementationOnce: (fn: () => unknown) => void })
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveSession = resolve;
      }));

    renderApp('/hydrogen');
    expect(screen.getByRole('status')).toBeInTheDocument();

    resolveSession({ data: { session: { user: { id: 'user-1' } } }, error: null });
    expect(await screen.findByText('Hydrogen Home')).toBeInTheDocument();
  });

  it('preserves a protected deep link via ?next=', async () => {
    renderApp('/hydrogen/setup?step=3');
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(
        '/?next=%2Fhydrogen%2Fsetup%3Fstep%3D3',
      ),
    );
  });

  it('renders an error state instead of a blank page when getSession fails', async () => {
    mockState.sessionError = 'network down';
    renderApp('/hydrogen');
    expect(await screen.findByText(/couldn.t verify your session/i)).toBeInTheDocument();
    expect(screen.getByText('network down')).toBeInTheDocument();
  });

  it('allows access with an active session', async () => {
    mockState.session = { user: { id: 'user-1' } };
    renderApp('/hydrogen');
    expect(await screen.findByText('Hydrogen Home')).toBeInTheDocument();
  });
});

describe('logout', () => {
  it('clears the active project and returns to /', async () => {
    const user = userEvent.setup();
    mockState.session = { user: { id: 'user-1' } };
    mockState.projects = [{ id: 'project-1', name: 'Saved', config: {} }];
    sessionStorage.setItem(ACTIVE_PROJECT_KEY, 'project-1');

    renderApp('/hydrogen', <LogoutButton />);

    const logout = await screen.findByRole('button', { name: /log ?out|sign out/i });
    await user.click(logout);
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: /log ?out|sign out/i }));

    await waitFor(() => {
      expect(signOut).toHaveBeenCalled();
      expect(sessionStorage.getItem(ACTIVE_PROJECT_KEY)).toBeNull();
      expect(screen.getByTestId('location')).toHaveTextContent('/');
    });
  });
});
