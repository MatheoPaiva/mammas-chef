import { format } from "date-fns";
import type { MealPlanResponse } from "@/types/mealPlan";
import { ingredientToString } from "@/lib/ingredientParser";

interface PrintContentProps {
  mealPlan: MealPlanResponse;
  startDate?: Date;
  showToddlerTips?: boolean;
  showGlucoseTips?: boolean;
}

const PrintContent = ({ mealPlan, startDate, showToddlerTips = true, showGlucoseTips = true }: PrintContentProps) => {
  return (
    <div className="hidden print:block print-content font-body text-black bg-white">
      {/* Header */}
      <div className="text-center mb-8">
        <h1 className="font-heading text-3xl font-bold mb-2">
          {mealPlan.weekPlan.title}
        </h1>
        <p className="text-sm text-gray-600">
          {mealPlan.weekPlan.days.length} days
          {startDate && ` · Starting ${format(startDate, "MM/dd/yyyy")}`}
        </p>
      </div>

      {/* Days */}
      {mealPlan.weekPlan.days.map((day) => (
        <div key={day.day} className="mb-6 print-day-section">
          {/* Day header + first meal kept together */}
          <h2 className="font-heading text-xl font-bold mb-1 print-day-header">
            {day.day} Recipes
          </h2>
          <hr className="border-black mb-4" />

          {day.meals.map((meal, idx) => (
            <div key={meal.id} className="mb-5 print-meal-block">
              <h3 className="text-base font-bold mb-1">
                {meal.mealType.toUpperCase()}: {meal.title}
              </h3>

              {/* Full recipe details */}
              <p className="text-xs text-gray-500 mb-2">
                Prep: {meal.prepTime} · Servings: {meal.servings} · {meal.calories} cal · P: {meal.protein}g · C: {meal.carbs}g · F: {meal.fats}g
              </p>

              {meal.tags && meal.tags.length > 0 && (
                <p className="text-xs text-gray-500 mb-2">
                  Tags: {meal.tags.join(", ")}
                </p>
              )}

              <p className="text-sm mb-1">
                <strong>Ingredients:</strong> {meal.ingredients.map(ingredientToString).join(", ")}
              </p>

              <div className="text-sm mb-1">
                <strong>Method:</strong>
                <ol className="list-decimal list-inside mt-1 space-y-0.5">
                  {meal.steps.map((step, sIdx) => (
                    <li key={sIdx}>{step}</li>
                  ))}
                </ol>
              </div>

              {showToddlerTips && meal.toddlerTip && (
                <p className="text-sm italic mb-1 mt-2">
                  🍼 Toddler Tip: {meal.toddlerTip}
                </p>
              )}

              {showGlucoseTips && meal.glucoseTip && (
                <p className="text-sm italic mb-1">
                  🩸 Glucose Tip: {meal.glucoseTip}
                </p>
              )}

              {idx < day.meals.length - 1 && (
                <hr className="border-gray-300 mt-3" />
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
};

export default PrintContent;
