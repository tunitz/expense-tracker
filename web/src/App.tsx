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
import { User, LayoutDashboard, ReceiptText, FileText } from 'lucide-react';

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

const NAV = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/transactions', label: 'Spending', icon: ReceiptText, end: false },
  { to: '/documents', label: 'Statements', icon: FileText, end: false },
] as const;

function Shell() {
  const user = queryClient.getQueryData(['me']) as { email: string } | undefined;
  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-20 border-b bg-background/90 backdrop-blur pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-3 px-4">
          <span className="text-base font-semibold tracking-tight">Expenses</span>
          <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
            {NAV.map(({ to, label, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  `rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  }`
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="ghost" size="sm" className="h-11 min-w-11 gap-2 md:h-9" aria-label="Account" />}
            >
              <User className="size-4 shrink-0" />
              <span className="hidden max-w-[10rem] truncate md:inline">{user?.email}</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-48">
              {user?.email && (
                <div className="truncate px-2 py-2 text-xs text-muted-foreground">{user.email}</div>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="cursor-pointer py-3 text-destructive focus:text-destructive md:py-1.5"
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
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-5 md:pb-10">
        <Outlet />
      </main>
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        <ul className="mx-auto grid max-w-md grid-cols-3">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <li key={to}>
              <NavLink
                to={to}
                end={end}
                className={({ isActive }) =>
                  `flex h-16 flex-col items-center justify-center gap-1 text-xs font-medium transition-colors ${
                    isActive ? 'text-primary' : 'text-muted-foreground'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <span
                      className={`flex h-8 w-16 items-center justify-center rounded-full transition-colors ${
                        isActive ? 'bg-accent' : ''
                      }`}
                    >
                      <Icon className="size-5" strokeWidth={isActive ? 2.4 : 1.9} />
                    </span>
                    {label}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
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
