import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { MailCheck } from 'lucide-react';

export const USERNAME_DOMAIN = '@netzero.app';
export const USERNAME_PATTERN = /^[a-z0-9._-]{3,30}$/;

export function normalizeUsername(value: string) {
  return value.trim().toLowerCase();
}

/** Returns an error message when the username cannot be turned into a valid address. */
export function validateUsername(value: string): string | null {
  const normalized = normalizeUsername(value);
  if (!normalized) return 'Please enter a username';
  if (normalized.length < 3) return 'Username must be at least 3 characters';
  if (normalized.length > 30) return 'Username must be 30 characters or fewer';
  if (!USERNAME_PATTERN.test(normalized)) {
    return 'Username can only contain letters, numbers, dots, dashes and underscores';
  }
  return null;
}

export function usernameToEmail(value: string) {
  return `${normalizeUsername(value)}${USERNAME_DOMAIN}`;
}

const AuthPage = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const nextParam = searchParams.get('next');
  const safeNext =
    nextParam && nextParam !== '/' && nextParam.startsWith('/') && !nextParam.startsWith('//')
      ? nextParam
      : null;
  const goNext = () => {
    navigate(safeNext ?? '/hydrogen', { replace: true });
  };
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);
  const [confirmationRequired, setConfirmationRequired] = useState(false);

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (active && session) {
        navigate(safeNext ?? '/hydrogen', { replace: true });
      }
    });

    return () => {
      active = false;
    };
  }, [navigate, safeNext]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setConfirmationRequired(false);

    const usernameError = validateUsername(username);
    if (usernameError) {
      toast.error(usernameError);
      return;
    }
    setLoading(true);

    try {
      const email = usernameToEmail(username);

      if (isLogin) {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success('Logged in successfully');
        goNext();
      } else {
        if (!displayName.trim()) {
          toast.error('Please enter your display name');
          setLoading(false);
          return;
        }
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { name: displayName.trim() },
            emailRedirectTo: window.location.origin,
          },
        });
        if (error) throw error;

        if (data.session) {
          // Signup already created a session — do not sign in a second time.
          toast.success('Account created');
          goNext();
        } else {
          setConfirmationRequired(true);
          toast.info('Check your email to confirm your account before signing in.');
        }
      }
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold">Net Zero Optimization</CardTitle>
          <CardDescription>
            {isLogin ? 'Sign in to your account' : 'Create a new account'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {confirmationRequired && (
            <Alert className="mb-4">
              <MailCheck className="h-4 w-4" />
              <AlertDescription>
                Your account was created. Please confirm your email address, then sign in.
              </AlertDescription>
            </Alert>
          )}
          <form onSubmit={handleSubmit} className="space-y-4">
            {!isLogin && (
              <div className="space-y-2">
                <Label htmlFor="displayName">Display Name *</Label>
                <Input
                  id="displayName"
                  placeholder="Enter your display name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  required={!isLogin}
                />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="username">Username *</Label>
              <Input
                id="username"
                placeholder="Enter your username"
                value={username}
                onChange={(e) => setUsername(e.target.value.replace(/\s/g, ''))}
                required
              />
              <p className="text-xs text-muted-foreground">
                3–30 characters: letters, numbers, dots, dashes or underscores.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password *</Label>
              <Input
                id="password"
                type="password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
              />
            </div>

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Please wait...' : isLogin ? 'Sign In' : 'Create Account'}
            </Button>

            <div className="text-center text-sm">
              <button
                type="button"
                className="text-primary hover:underline"
                onClick={() => {
                  setIsLogin(!isLogin);
                  setConfirmationRequired(false);
                }}
              >
                {isLogin ? "Don't have an account? Register" : 'Already have an account? Sign in'}
              </button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};

export default AuthPage;
