import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { BrowserRouter, Routes, Route, Navigate, NavLink } from 'react-router-dom';
import { Outlet } from 'react-router-dom';
import { Toaster } from './components/ui/sonner';
import { Button } from './components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuItem,
} from './components/ui/dropdown-menu';
import { api, ApiError } from './lib/api';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Transactions from './pages/Transactions';
import Documents from './pages/Documents';
import { User } from 'lucide-react';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: false, staleTime: 30_000 },
  },
});

function AuthCheck() {
  const { data: user, isLoading, error } = useQuery({
    queryKey: ['me'],
    queryFn: api.me,
  });
  if (isLoading) return <div className="flex h-dvh items-center justify-center">Loading...</div>;
  if (error instanceof ApiError && error.status === 401) return <Navigate to="/login" replace />;
  if (!user) return <Navigate to="/login" replace />;
  return <Outlet />;
}

function Shell() {
  const user = queryClient.getQueryData(['me']) as { email: string } | undefined;
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b bg-background h-14 max-w-5xl mx-auto px-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 text-sm">
          <span className="font-semibold">Expenses</span>
          <NavLink
            to="/"
            className={({ isActive }) =>
              `font-medium transition-colors ${
                isActive ? 'font-semibold text-foreground' : 'text-muted-foreground'
              }`
            }
          >
            Dashboard
          </NavLink>
          <NavLink
            to="/transactions"
            className={({ isActive }) =>
              `font-medium transition-colors ${
                isActive ? 'font-semibold text-foreground' : 'text-muted-foreground'
              }`
            }
          >
            Transactions
          </NavLink>
          <NavLink
            to="/documents"
            className={({ isActive }) =>
              `font-medium transition-colors ${
                isActive ? 'font-semibold text-foreground' : 'text-muted-foreground'
              }`
            }
          >
            Statements
          </NavLink>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="sm" className="gap-2" />}>
            <User className="size-4 shrink-0" />
            <span className="hidden sm:inline truncate max-w-[8rem]">{user?.email}</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive cursor-pointer"
              onSelect={() => {
                api.logout();
                queryClient.clear();
                window.location.href = '/login';
              }}
            >
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>
      <main className="max-w-5xl mx-auto px-4 py-4">
        <Outlet />
      </main>
    </div>
  );
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<AuthCheck />}>
        <Route element={<Shell />}>
          <Route index element={<Dashboard />} />
          <Route path="transactions" element={<Transactions />} />
          <Route path="documents" element={<Documents />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Toaster />
        <AppRoutes />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
