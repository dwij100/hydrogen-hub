import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { Loader2 } from 'lucide-react';

export const AuthGuard = ({ children }: { children: React.ReactNode }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const nextParam = encodeURIComponent(`${location.pathname}${location.search}`);
    const loginUrl = `/?next=${nextParam}`;

    supabase.auth
      .getSession()
      .then(({ data, error: sessionError }) => {
        if (!mounted) return;
        if (sessionError) {
          setError(sessionError.message);
          setChecking(false);
          return;
        }
        if (!data.session) {
          navigate(loginUrl, { replace: true });
          return;
        }
        setSession(data.session);
        setChecking(false);
      })
      .catch((err: unknown) => {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : 'Could not verify your session');
        setChecking(false);
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, currentSession) => {
      if (!mounted) return;
      if (event === 'SIGNED_OUT' || !currentSession) {
        setSession(null);
        navigate(loginUrl, { replace: true });
      } else {
        setSession(currentSession);
        setChecking(false);
        setError(null);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [navigate, location.pathname, location.search]);

  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="font-medium text-destructive">We couldn&apos;t verify your session</p>
        <p className="text-sm text-muted-foreground">{error}</p>
        <button
          className="text-sm text-primary hover:underline"
          onClick={() => navigate('/', { replace: true })}
        >
          Go to sign in
        </button>
      </div>
    );
  }

  if (checking || !session) {
    return (
      <div className="min-h-screen flex items-center justify-center" role="status" aria-live="polite">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <span className="sr-only">Checking your session…</span>
      </div>
    );
  }

  return <>{children}</>;
};
