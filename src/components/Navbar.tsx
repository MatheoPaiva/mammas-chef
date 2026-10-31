import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Menu, X, CookingPot, LogOut } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/contexts/AuthContext";

const publicNavItems = [
  { label: "Home", path: "/" },
  { label: "Meal Planner", path: "/planner" },
  { label: "Recipes", path: "/recipes" },
];

const privateNavItems = [
  { label: "Home", path: "/home" },
  { label: "Meal Planner", path: "/planner" },
  { label: "Recipes", path: "/recipes" },
];

const Navbar = () => {
  const [isOpen, setIsOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { user, signOut } = useAuth();

  const navItems = user
    ? [...privateNavItems, { label: "Profile", path: "/profile" }]
    : publicNavItems;

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-lg border-b border-border">
      <div className="container mx-auto px-6 py-4 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-full gradient-hero flex items-center justify-center">
            <CookingPot className="w-5 h-5 text-primary-foreground" />
          </div>
          <span className="font-heading font-bold text-xl text-foreground">
            Mamma's Chef
          </span>
        </Link>

        {/* Desktop */}
        <div className="hidden md:flex items-center gap-1">
          {navItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={`px-5 py-2.5 rounded-lg font-medium text-sm transition-all ${
                location.pathname === item.path
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
            >
              {item.label}
            </Link>
          ))}
          {user ? (
            <button
              onClick={handleSignOut}
              className="ml-3 px-5 py-2.5 rounded-lg font-medium text-sm border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-all flex items-center gap-2"
            >
              <LogOut className="w-4 h-4" />
              Sign Out
            </button>
          ) : (
            <Link
              to="/auth"
              className="ml-3 px-5 py-2.5 rounded-lg font-medium text-sm border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
            >
              Sign In
            </Link>
          )}
        </div>

        {/* Mobile toggle */}
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="md:hidden p-3 rounded-lg text-foreground hover:bg-muted tap-highlight-none touch-target"
        >
          {isOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {/* Mobile menu */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="md:hidden border-t border-border bg-background"
          >
            <div className="px-4 py-3 flex flex-col gap-1">
              {navItems.map((item) => (
                <Link
                  key={item.path}
                  to={item.path}
                  onClick={() => setIsOpen(false)}
                  className={`px-4 py-3.5 rounded-lg font-medium text-base transition-all tap-highlight-none active-scale ${
                    location.pathname === item.path
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  }`}
                >
                  {item.label}
                </Link>
              ))}
              {user ? (
                <button
                  onClick={() => { handleSignOut(); setIsOpen(false); }}
                  className="px-4 py-3 rounded-lg font-medium text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-all text-left flex items-center gap-2"
                >
                  <LogOut className="w-4 h-4" />
                  Sign Out
                </button>
              ) : (
                <Link
                  to="/auth"
                  onClick={() => setIsOpen(false)}
                  className="px-4 py-3 rounded-lg font-medium text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
                >
                  Sign In
                </Link>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
};

export default Navbar;
