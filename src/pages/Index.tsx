import HeroSection from "@/components/HeroSection";
import FeatureCards from "@/components/FeatureCards";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";

const Index = () => {
  return (
    <main>
      <HeroSection />
      <FeatureCards />

      {/* CTA Section */}
      <section className="py-24 bg-card">
        <div className="container mx-auto px-6 text-center">
          <h2 className="font-heading font-bold text-3xl md:text-4xl text-foreground mb-4">
            Ready to Simplify Mealtime?
          </h2>
          <p className="text-muted-foreground text-lg mb-8 max-w-md mx-auto">
            Snap your pantry, set your preferences, and let the AI handle the rest — personalized plans in seconds.
          </p>
          <Link to="/planner">
            <Button size="lg" className="gradient-hero text-primary-foreground border-0 rounded-lg px-8 py-6 text-base font-semibold shadow-elevated hover:opacity-90">
              Create Your Meal Plan <ArrowRight className="w-5 h-5 ml-2" />
            </Button>
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 bg-background border-t border-border">
        <div className="container mx-auto px-6 text-center text-muted-foreground text-sm">
          © {new Date().getFullYear()} Mamma's Chef. Made with ❤️ for families.
        </div>
      </footer>
    </main>
  );
};

export default Index;
