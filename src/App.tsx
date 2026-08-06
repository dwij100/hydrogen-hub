import { Toaster } from "@/components/ui/toaster";
import type { ReactNode } from "react";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { HydrogenProjectProvider } from "@/context/HydrogenProjectContext";
import { SolverRunProvider } from "@/context/SolverRunContext";
import { AuthGuard } from "@/components/AuthGuard";
import AuthPage from "./pages/AuthPage";
import Dashboard from "./pages/Dashboard";
import HydrogenHome from "./pages/HydrogenHome";
import HydrogenWizard from "./pages/HydrogenWizard";
import NotFound from "./pages/NotFound";
import OAuthConsent from "./pages/OAuthConsent";
import { isLocalMode } from "@/lib/localMode";

const queryClient = new QueryClient();
const LOCAL_MODE = isLocalMode();
const Protected = ({ children }: { children: ReactNode }) =>
  LOCAL_MODE ? <>{children}</> : <AuthGuard>{children}</AuthGuard>;

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <HydrogenProjectProvider>
        <SolverRunProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/" element={LOCAL_MODE ? <Navigate to="/hydrogen" replace /> : <AuthPage />} />
              <Route path="/dashboard" element={<Protected><Dashboard /></Protected>} />
              <Route path="/hydrogen" element={<Protected><HydrogenHome /></Protected>} />
              <Route path="/hydrogen/setup" element={<Protected><HydrogenWizard /></Protected>} />
              <Route path="/.lovable/oauth/consent" element={<OAuthConsent />} />
              <Route path="/404" element={<NotFound />} />
              <Route path="*" element={<Navigate to="/404" replace />} />
            </Routes>
          </BrowserRouter>
        </SolverRunProvider>
      </HydrogenProjectProvider>
    </TooltipProvider>

  </QueryClientProvider>
);

export default App;
