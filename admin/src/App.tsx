import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster } from "sonner";
import { AuthDialog } from "@/components/auth/AuthDialog";
import { AppLayout } from "@/components/layout/AppLayout";
import { ConfigProvider, useConfig } from "@/context/ConfigContext";
import { AuthPage } from "@/pages/AuthPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { IntegrationPage } from "@/pages/IntegrationPage";
import { ModelsPage } from "@/pages/ModelsPage";
import { OpsPage } from "@/pages/OpsPage";
import { ProvidersPage } from "@/pages/ProvidersPage";
import { RoutingPage } from "@/pages/RoutingPage";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
});

function Bootstrap() {
  const { loadConfig } = useConfig();
  useEffect(() => {
    loadConfig(false).catch(() => undefined);
  }, [loadConfig]);
  return null;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ConfigProvider>
        <BrowserRouter basename="/admin">
          <Bootstrap />
          <AuthDialog />
          <Routes>
            <Route element={<AppLayout />}>
              <Route index element={<DashboardPage />} />
              <Route path="providers" element={<ProvidersPage />} />
              <Route path="routing" element={<RoutingPage />} />
              <Route path="auth" element={<AuthPage />} />
              <Route path="integration" element={<IntegrationPage />} />
              <Route path="ops" element={<OpsPage />} />
              <Route path="models" element={<ModelsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
        <Toaster position="bottom-right" theme="dark" richColors />
      </ConfigProvider>
    </QueryClientProvider>
  );
}
