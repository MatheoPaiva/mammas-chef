-- Backfill recipe_library nutrition, then constrain it (mirrors the recipes table).
-- SEQUENCING INVARIANT (Phase 4 / NUTR-03, D-03): backfill the NULL-nutrition rows
-- FIRST, then SET NOT NULL + ADD CHECK. Applying the constraints before the backfill
-- would fail on the 10 rows that ship with (null, null, null, null) nutrition.
-- Backfill values are LLM-estimated per-serving macros, human spot-checked & approved (D-04).

-- Step 1: Backfill NULL-nutrition rows (idempotent — each UPDATE only touches rows still missing nutrition).

-- Chicken Shawarma Sheet Pan Dinner (confidence 0.90)
UPDATE public.recipe_library
SET calories = 450, protein = 38, carbs = 12, fats = 22
WHERE id = '882fbc9a-c3b7-400e-b24b-58a9390b4bf0'
  AND (calories IS NULL OR protein IS NULL OR carbs IS NULL OR fats IS NULL);

-- Chickpea Greek Salad Lunch Boxes (confidence 0.85)
UPDATE public.recipe_library
SET calories = 400, protein = 15, carbs = 30, fats = 22
WHERE id = '52c8a6ea-e04e-46f8-a354-296fd0282f78'
  AND (calories IS NULL OR protein IS NULL OR carbs IS NULL OR fats IS NULL);

-- Egg Muffins with Spinach and Feta (confidence 0.90)
UPDATE public.recipe_library
SET calories = 180, protein = 14, carbs = 3, fats = 12
WHERE id = 'a3190067-8368-49f0-890c-cf7c10fb0800'
  AND (calories IS NULL OR protein IS NULL OR carbs IS NULL OR fats IS NULL);

-- Hummus Veggie Snack Plate (confidence 0.80)
UPDATE public.recipe_library
SET calories = 350, protein = 10, carbs = 40, fats = 12
WHERE id = '088521ac-59c8-4cd6-9d2d-b4b5959b8367'
  AND (calories IS NULL OR protein IS NULL OR carbs IS NULL OR fats IS NULL);

-- Lentil Vegetable Soup (confidence 0.90)
UPDATE public.recipe_library
SET calories = 220, protein = 14, carbs = 35, fats = 2
WHERE id = 'f5b6a6c2-e283-4477-b002-7d26a8976be0'
  AND (calories IS NULL OR protein IS NULL OR carbs IS NULL OR fats IS NULL);

-- Mediterranean Yogurt Parfait (confidence 0.85) — the customer's literal "350 cal / 0g / 0g / 0g" bug case
UPDATE public.recipe_library
SET calories = 280, protein = 20, carbs = 20, fats = 12
WHERE id = '54de5b8e-0aec-4500-bea7-a34d4979dbf8'
  AND (calories IS NULL OR protein IS NULL OR carbs IS NULL OR fats IS NULL);

-- Salmon with Lemon Dill Yogurt and Green Beans (confidence 0.90)
UPDATE public.recipe_library
SET calories = 480, protein = 45, carbs = 10, fats = 25
WHERE id = '53db2d60-9451-4bcc-8cf1-1dbfec1b1396'
  AND (calories IS NULL OR protein IS NULL OR carbs IS NULL OR fats IS NULL);

-- Turkey Kofta Plates (confidence 0.90) — shipped fully NULL
UPDATE public.recipe_library
SET calories = 520, protein = 45, carbs = 30, fats = 15
WHERE id = '4a3a7b75-6d82-449c-bdb3-b40009b980a5'
  AND (calories IS NULL OR protein IS NULL OR carbs IS NULL OR fats IS NULL);

-- Turkey Stuffed Peppers with Feta (confidence 0.90)
UPDATE public.recipe_library
SET calories = 460, protein = 40, carbs = 30, fats = 12
WHERE id = 'f320410b-1533-4507-bdaf-3ff144dfbe67'
  AND (calories IS NULL OR protein IS NULL OR carbs IS NULL OR fats IS NULL);

-- White Bean Tuna Toasts (confidence 0.90)
UPDATE public.recipe_library
SET calories = 420, protein = 40, carbs = 30, fats = 8
WHERE id = 'baff2817-c6af-4fdc-9087-acdbe725544c'
  AND (calories IS NULL OR protein IS NULL OR carbs IS NULL OR fats IS NULL);

-- Step 2: Verify zero NULL-nutrition rows remain before constraining (run manually if desired):
--   SELECT COUNT(*) FROM public.recipe_library
--   WHERE calories IS NULL OR protein IS NULL OR carbs IS NULL OR fats IS NULL; -- expected 0
-- If any row is still NULL here, the SET NOT NULL below will fail the migration — re-run the
-- backfill (npm run recipes:backfill-nutrition --apply) or add the missing UPDATE, then push again.

-- Step 3: Enforce presence — nutrition can never be NULL again.
ALTER TABLE public.recipe_library
  ALTER COLUMN calories SET NOT NULL,
  ALTER COLUMN protein SET NOT NULL,
  ALTER COLUMN carbs SET NOT NULL,
  ALTER COLUMN fats SET NOT NULL;

-- Step 4: Enforce validity — mirror the recipes_* CHECK constraints (20260323000000).
ALTER TABLE public.recipe_library
  ADD CONSTRAINT recipe_library_calories_positive CHECK (calories > 0),
  ADD CONSTRAINT recipe_library_protein_nonneg CHECK (protein >= 0),
  ADD CONSTRAINT recipe_library_carbs_nonneg CHECK (carbs >= 0),
  ADD CONSTRAINT recipe_library_fats_nonneg CHECK (fats >= 0);
