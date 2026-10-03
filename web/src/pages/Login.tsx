import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { api, ApiError } from '@/lib/api';

const ERROR_MESSAGES: Record<string, string> = {
  invalid_credentials: 'Wrong email or password',
  email_taken: 'That email is already registered',
  invalid_email: 'Enter a valid email address',
  weak_password: 'Password must be at least 8 characters',
  rate_limited: 'Too many attempts, wait a minute',
  signup_disabled: 'Sign-up is disabled',
};

function ErrorMessage({ code }: { code: string }) {
  const message = ERROR_MESSAGES[code] ?? 'Something went wrong';
  return (
    <Alert variant="destructive">
      <AlertTitle>Error</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

export default function Login() {
  const [tab, setTab] = useState<'signin' | 'register'>('signin');
  const [error, setError] = useState<ApiError | null>(null);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const loginMutation = useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) =>
      api.login(email, password),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['me'] });
      navigate('/');
    },
    onError: (err: ApiError) => setError(err),
  });

  const registerMutation = useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) =>
      api.register(email, password),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['me'] });
      navigate('/');
    },
    onError: (err: ApiError) => setError(err),
  });

  const handleSignIn = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const form = e.currentTarget;
    const email = (form.elements.namedItem('signin-email') as HTMLInputElement).value;
    const password = (form.elements.namedItem('signin-password') as HTMLInputElement).value;
    loginMutation.mutate({ email, password });
  };

  const handleRegister = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const form = e.currentTarget;
    const email = (form.elements.namedItem('register-email') as HTMLInputElement).value;
    const password = (form.elements.namedItem('register-password') as HTMLInputElement).value;
    registerMutation.mutate({ email, password });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/40 px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-lg">Expense Tracker</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs value={tab} onValueChange={(v) => { setTab(v as 'signin' | 'register'); setError(null); }}>
            <TabsList className="grid h-12 w-full grid-cols-2">
              <TabsTrigger value="signin">Sign in</TabsTrigger>
              <TabsTrigger value="register">Create account</TabsTrigger>
            </TabsList>

            <TabsContent value="signin">
              <form onSubmit={handleSignIn} className="flex flex-col gap-4 mt-4">
                <div className="grid gap-2">
                  <Label htmlFor="signin-email">Email</Label>
                  <Input
                    id="signin-email"
                    name="signin-email"
                    type="email"
                    autoComplete="email"
                    required
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="signin-password">Password</Label>
                  <Input
                    id="signin-password"
                    name="signin-password"
                    type="password"
                    autoComplete="current-password"
                    required
                  />
                </div>
                {error && <ErrorMessage code={error.code} />}
                <Button
                  type="submit"
                  className="w-full"
                  disabled={loginMutation.isPending}
                >
                  {loginMutation.isPending ? 'Please wait...' : 'Sign in'}
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="register">
              <form onSubmit={handleRegister} className="flex flex-col gap-4 mt-4">
                <div className="grid gap-2">
                  <Label htmlFor="register-email">Email</Label>
                  <Input
                    id="register-email"
                    name="register-email"
                    type="email"
                    autoComplete="email"
                    required
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="register-password">Password</Label>
                  <Input
                    id="register-password"
                    name="register-password"
                    type="password"
                    autoComplete="new-password"
                    minLength={8}
                    required
                  />
                </div>
                {error && <ErrorMessage code={error.code} />}
                <Button
                  type="submit"
                  className="w-full"
                  disabled={registerMutation.isPending}
                >
                  {registerMutation.isPending ? 'Please wait...' : 'Create account'}
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
