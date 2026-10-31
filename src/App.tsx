import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { lazy, Suspense } from "react";
import { useActivityLogger } from "@/hooks/useActivityLogger";
import { AuthProvider } from "@/contexts/AuthContext";
import Navbar from "@/components/Navbar";
import ProtectedRoute from "@/components/ProtectedRoute";

const Index = lazy(() => import("./pages/Index"));
const Planner = lazy(() => import("./pages/Planner"));
const Home = lazy(() => import("./pages/Home"));
const Profile = lazy(() => import("./pages/Profile"));
const ShoppingList = lazy(() => import("./pages/ShoppingList"));
const Auth = lazy(() => import("./pages/Auth"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const NotFound = lazy(() => import("./pages/NotFound"));
const Recipes = lazy(() => import("./pages/Recipes"));
const CustomRecipeEditor = lazy(() => import("./pages/CustomRecipeEditor"));
const Onboarding = lazy(() => import("./pages/Onboarding"));
const RecipeReview = lazy(() => import("./pages/RecipeReview"));

const queryClient = new QueryClient();

const AppRoutes = () => {
  useActivityLogger();
  return (
    <>
      <Navbar />
      <Suspense fallback={<div className="flex items-center justify-center min-h-screen"><div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" /></div>}>
      <Routes>
        <Route path="/" element={<Index />} />
        <Route path="/auth" element={<Auth />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route element={<ProtectedRoute />}>
          <Route path="/home" element={<Home />} />
          <Route path="/onboarding" element={<Onboarding />} />
          <Route path="/planner" element={<Planner />} />
          <Route path="/shopping" element={<ShoppingList />} />
          <Route path="/recipes" element={<Recipes />} />
          <Route path="/recipes/new" element={<CustomRecipeEditor />} />
          <Route path="/recipes/:id/edit" element={<CustomRecipeEditor />} />
          <Route path="/recipe-review" element={<RecipeReview />} />
          <Route path="/profile" element={<Profile />} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
      </Suspense>
    </>
  );
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
