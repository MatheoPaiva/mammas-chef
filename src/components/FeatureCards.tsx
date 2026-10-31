import { motion } from "framer-motion";
import { CalendarDays, ShoppingCart, Clock, BookOpen, Camera, Printer, Heart, UserCheck } from "lucide-react";

const features = [
  {
    icon: UserCheck,
    title: "Personalized for You",
    description: "Set your household size, dietary preferences, and allergies during onboarding — every plan adapts automatically.",
    colorClass: "bg-primary/10 text-primary",
  },
  {
    icon: Camera,
    title: "Multimodal Input",
    description: "Snap a pantry photo, type what you have, or pin favorite recipes — the AI builds your plan from any combination.",
    colorClass: "bg-secondary/10 text-secondary",
  },
  {
    icon: CalendarDays,
    title: "7-Day Meal Plans",
    description: "AI-generated weekly plans grounded in Mediterranean nutrition, with toddler tips and glucose-friendly insights on every recipe.",
    colorClass: "bg-primary/10 text-primary",
  },
  {
    icon: ShoppingCart,
    title: "Smart Shopping Lists",
    description: "Automatically consolidated grocery lists organized by aisle, with pantry-aware deduplication.",
    colorClass: "bg-secondary/10 text-secondary",
  },
  {
    icon: Clock,
    title: "Prep Strategies",
    description: "Prep day guides and night-before timelines that save hours during the week.",
    colorClass: "bg-accent/30 text-accent-foreground",
  },
  {
    icon: Printer,
    title: "Export Everything",
    description: "Print a polished Mediterranean Packet, sync meals to your calendar (.ics), or download a full CSV spreadsheet.",
    colorClass: "bg-terracotta/10 text-terracotta-dark",
  },
  {
    icon: Heart,
    title: "Favorite Recipes",
    description: "Save standout recipes from any plan to your personal collection and pin them into future meal plans.",
    colorClass: "bg-destructive/10 text-destructive",
  },
  {
    icon: BookOpen,
    title: "Full Recipe Details",
    description: "Every dish includes macros, calories, servings, step-by-step instructions, and specialized toddler & glucose tips.",
    colorClass: "bg-accent/30 text-accent-foreground",
  },
];

const FeatureCards = () => {
  return (
    <section className="py-24 bg-background">
      <div className="container mx-auto px-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="text-center mb-16"
        >
          <h2 className="font-heading font-bold text-3xl md:text-4xl text-foreground mb-4">
            Everything Your Kitchen Needs
          </h2>
          <p className="text-muted-foreground text-lg max-w-xl mx-auto">
            From personalized AI planning to organized prep workflows and one-click exports — designed for real families.
          </p>
        </motion.div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          {features.map((feature, i) => (
            <motion.div
              key={feature.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: i * 0.08 }}
              className="bg-card rounded-lg p-8 shadow-card hover:shadow-elevated transition-shadow"
            >
              <div className={`w-12 h-12 rounded-lg ${feature.colorClass} flex items-center justify-center mb-5`}>
                <feature.icon className="w-6 h-6" />
              </div>
              <h3 className="font-heading font-semibold text-lg text-foreground mb-2">
                {feature.title}
              </h3>
              <p className="text-muted-foreground text-sm leading-relaxed">
                {feature.description}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default FeatureCards;
