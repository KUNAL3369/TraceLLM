import { useEffect, lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore } from "../stores/authStore";
import AppLayout from "../components/layout/AppLayout";
import ErrorBoundary from "../components/ui/ErrorBoundary";
import { AlertProvider } from "../components/ui/AlertProvider";

const Login = lazy(() => import("../pages/Login"));
const Signup = lazy(() => import("../pages/Signup"));
const Dashboard = lazy(() => import("../pages/Dashboard"));
const Chat = lazy(() => import("../pages/Chat"));
const Conversations = lazy(() => import("../pages/Conversations"));
const InferenceLogs = lazy(() => import("../pages/InferenceLogs"));
const Errors = lazy(() => import("../pages/Errors"));
const Projects = lazy(() => import("../pages/Projects"));
const Alerts = lazy(() => import("../pages/Alerts"));
const Billing = lazy(() => import("../pages/Billing"));
const AuditLogs = lazy(() => import("../pages/AuditLogs"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60000,
      gcTime: 300000,
      retry: 2,
      refetchOnWindowFocus: false,
    },
  },
});

function LoadingFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0f172a]">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
        <span className="text-sm text-gray-500">Loading...</span>
      </div>
    </div>
  );
}

function ProtectedRoute({ children }) {
  const { user, loading } = useAuthStore();
  if (loading) return <LoadingFallback />;
  if (!user) return <Navigate to="/login" replace />;
  return <AppLayout>{children}</AppLayout>;
}

function PublicRoute({ children }) {
  const { user, loading } = useAuthStore();
  if (loading) return <LoadingFallback />;
  if (user) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  const initialize = useAuthStore((s) => s.initialize);

  useEffect(() => {
    initialize();
  }, [initialize]);

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AlertProvider>
          <BrowserRouter>
            <Suspense fallback={<LoadingFallback />}>
              <Routes>
                <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
                <Route path="/signup" element={<PublicRoute><Signup /></PublicRoute>} />
                <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
                <Route path="/chat" element={<ProtectedRoute><Chat /></ProtectedRoute>} />
                <Route path="/conversations" element={<ProtectedRoute><Conversations /></ProtectedRoute>} />
                <Route path="/logs" element={<ProtectedRoute><InferenceLogs /></ProtectedRoute>} />
                <Route path="/errors" element={<ProtectedRoute><Errors /></ProtectedRoute>} />
                <Route path="/projects" element={<ProtectedRoute><Projects /></ProtectedRoute>} />
                <Route path="/alerts" element={<ProtectedRoute><Alerts /></ProtectedRoute>} />
                <Route path="/billing" element={<ProtectedRoute><Billing /></ProtectedRoute>} />
                <Route path="/audit" element={<ProtectedRoute><AuditLogs /></ProtectedRoute>} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
          </BrowserRouter>
        </AlertProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
