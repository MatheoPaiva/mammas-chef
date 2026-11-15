import { motion } from "framer-motion";
import { ArrowRight, Sparkles, Baby, Leaf, Camera, Heart } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import heroImage from "@/assets/hero-food.jpg";

const HeroSection = () => {
  return (
    <section className="relative flex items-center overflow-hidden pt-24 pb-12 md:pt-0 md:pb-0 md:min-h-[100svh]">
      {/* Background image */}
      <div className="absolute inset-0">
        <img
          src={heroImage}
          alt="Mediterranean food spread"
          className="w-full h-full object-cover"
          loading="eager"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-foreground/85 via-foreground/60 to-foreground/30" />
      </div>

      <div className="container mx-auto px-6 relative z-10">
        <div className="max-w-2xl">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7 }}
          >
            <div className="flex items-center gap-2 mb-6">
              <span className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-secondary/90 text-secondary-foreground text-xs font-semibold uppercase tracking-wider">
                <Sparkles className="w-3.5 h-3.5" /> AI-Powered & Personalized
              </span>
            </div>

            <h1 className="font-heading font-extrabold text-5xl md:text-7xl leading-[1.05] text-primary-foreground mb-6">
              Mamma's
              <br />
              <span className="text-secondary">Chef</span>
            </h1>

            <p className="text-lg md:text-xl text-primary-foreground/80 mb-8 max-w-lg font-body leading-relaxed">
              Snap a photo of your pantry, set your dietary needs and allergies,
              and get a fully personalized 7-day Mediterranean meal plan — with
              smart shopping lists, prep strategies, and printable recipe packets.
            </p>

            <div className="flex flex-col sm:flex-row gap-3">
              <Link to="/planner">
                <Button size="lg" className="gradient-hero text-primary-foreground border-0 rounded-lg px-8 py-6 text-base font-semibold shadow-elevated hover:opacity-90 transition-opacity">
                  Start Planning
                  <ArrowRight className="w-5 h-5 ml-2" />
                </Button>
              </Link>
            </div>

            <div className="flex flex-wrap items-center gap-x-6 gap-y-3 mt-10">
              <div className="flex items-center gap-2 text-primary-foreground/70 text-sm">
                <Camera className="w-4 h-4 text-secondary" />
                <span>Pantry Photo Input</span>
              </div>
              <div className="flex items-center gap-2 text-primary-foreground/70 text-sm">
                <Baby className="w-4 h-4 text-secondary" />
                <span>Toddler-Friendly</span>
              </div>
              <div className="flex items-center gap-2 text-primary-foreground/70 text-sm">
                <Leaf className="w-4 h-4 text-primary" />
                <span>Glucose-Friendly</span>
              </div>
              <div className="flex items-center gap-2 text-primary-foreground/70 text-sm">
                <Heart className="w-4 h-4 text-destructive/80" />
                <span>Allergy-Safe</span>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
};

export default HeroSection;
