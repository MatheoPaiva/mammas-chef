import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { recipeLibraryCollectionSchema } from "../src/lib/recipeLibrarySchema";
import { prepareRecipeLibraryInsert } from "../src/lib/recipeLibraryPrepare";
import { formatRecipeFixtureCoverage, getRecipeFixtureCoverageIssues, summarizeRecipeFixtureCoverage } from "../src/lib/recipeFixtureCoverage";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const fixtureArg = args.find((arg) => !arg.startsWith("--"));
const fixturePath = resolve(root, fixtureArg ?? "data/recipes/seed-recipes.json");
const shouldWrite = args.includes("--write");
const allowCoverageIssues = args.includes("--allow-coverage-issues");

function readFlagValue(flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index < 0) return undefined;
  const value = args[index + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

const outputDirArg = readFlagValue("--out-dir");
const outputPrefixArg = readFlagValue("--out-prefix");
const batchSizeArg = readFlagValue("--batch-size");
const outputDir = resolve(root, outputDirArg ?? "supabase/seed");
const outputPrefix = outputPrefixArg ?? "recipe-library";
const jsonOutputPath = resolve(outputDir, `${outputPrefix}-prepared.json`);
const sqlOutputPath = resolve(outputDir, `${outputPrefix}.sql`);
const batchSize = batchSizeArg ? Number(batchSizeArg) : 0;

const raw = JSON.parse(readFileSync(fixturePath, "utf8"));
const recipes = recipeLibraryCollectionSchema.parse(raw);
const prepared = recipes.map((recipe) => prepareRecipeLibraryInsert(recipe));
const chunkCount = prepared.reduce((total, item) => total + item.chunks.length, 0);
const coverage = summarizeRecipeFixtureCoverage(recipes);
const coverageIssues = getRecipeFixtureCoverageIssues(coverage);

function sql(value: string | number | null): string {
  if (value === null) return "null";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "null";
  return `'${value.replace(/'/g, "''")}'`;
}

function sqlTextArray(values: string[]): string {
  if (values.length === 0) return "'{}'::text[]";
  return `array[${values.map(sql).join(", ")}]::text[]`;
}

function sqlJsonb(value: unknown): string {
  return `${sql(JSON.stringify(value))}::jsonb`;
}

function buildSeedSql(items = prepared): string {
  const statements = items.map((item) => {
    const recipe = item.recipe;
    const source = item.source;
    const chunkValues = item.chunks.map((chunk) => [
      sql(chunk.chunk_type),
      sql(chunk.chunk_index),
      sql(chunk.content),
      sqlJsonb(chunk.metadata),
    ].join(", "));

    return `-- ${recipe.title}
with existing_source as (
  select id from public.recipe_sources
  where name = ${sql(source.name)}
    and url is not distinct from ${sql(source.url)}
    and author is not distinct from ${sql(source.author)}
    and license = ${sql(source.license)}
  limit 1
), inserted_source as (
  insert into public.recipe_sources (name, url, author, license, usage_notes)
  select ${sql(source.name)}, ${sql(source.url)}, ${sql(source.author)}, ${sql(source.license)}, ${sql(source.usage_notes)}
  where not exists (select 1 from existing_source)
  returning id
), source_row as (
  select id from existing_source
  union all
  select id from inserted_source
), recipe_row as (
  insert into public.recipe_library (
    source_id, title, cuisine, region, meal_types, diet_tags, flavor_tags, equipment,
    active_time_minutes, total_time_minutes, servings, calories, protein, carbs, fats,
    ingredients, steps, storage_notes, reheat_notes, prep_ahead_notes, toddler_tip,
    glucose_tip, status, source_url, source_attribution, canonical_text
  )
  select
    (select id from source_row),
    ${sql(recipe.title)}, ${sql(recipe.cuisine)}, ${sql(recipe.region)}, ${sqlTextArray(recipe.meal_types)},
    ${sqlTextArray(recipe.diet_tags)}, ${sqlTextArray(recipe.flavor_tags)}, ${sqlTextArray(recipe.equipment)},
    ${sql(recipe.active_time_minutes)}, ${sql(recipe.total_time_minutes)}, ${sql(recipe.servings)},
    ${sql(recipe.calories)}, ${sql(recipe.protein)}, ${sql(recipe.carbs)}, ${sql(recipe.fats)},
    ${sqlJsonb(recipe.ingredients)}, ${sqlJsonb(recipe.steps)}, ${sql(recipe.storage_notes)},
    ${sql(recipe.reheat_notes)}, ${sql(recipe.prep_ahead_notes)}, ${sql(recipe.toddler_tip)},
    ${sql(recipe.glucose_tip)}, ${sql(recipe.status)}, ${sql(recipe.source_url)},
    ${sql(recipe.source_attribution)}, ${sql(recipe.canonical_text)}
  on conflict (title) do update set
    source_id = excluded.source_id,
    cuisine = excluded.cuisine,
    region = excluded.region,
    meal_types = excluded.meal_types,
    diet_tags = excluded.diet_tags,
    flavor_tags = excluded.flavor_tags,
    equipment = excluded.equipment,
    active_time_minutes = excluded.active_time_minutes,
    total_time_minutes = excluded.total_time_minutes,
    servings = excluded.servings,
    calories = excluded.calories,
    protein = excluded.protein,
    carbs = excluded.carbs,
    fats = excluded.fats,
    ingredients = excluded.ingredients,
    steps = excluded.steps,
    storage_notes = excluded.storage_notes,
    reheat_notes = excluded.reheat_notes,
    prep_ahead_notes = excluded.prep_ahead_notes,
    toddler_tip = excluded.toddler_tip,
    glucose_tip = excluded.glucose_tip,
    status = excluded.status,
    source_url = excluded.source_url,
    source_attribution = excluded.source_attribution,
    canonical_text = excluded.canonical_text,
    updated_at = now()
  returning id
), deleted_chunks as (
  delete from public.recipe_chunks where recipe_id = (select id from recipe_row)
)
insert into public.recipe_chunks (recipe_id, chunk_type, chunk_index, content, metadata)
select (select id from recipe_row), v.chunk_type, v.chunk_index, v.content, v.metadata
from (values
  (${chunkValues.join("),\n  (")})
) as v(chunk_type, chunk_index, content, metadata);`;
  });

  return `-- Generated by npm run recipes:prepare. Do not hand-edit seed payloads here.
-- Source fixture: ${fixtureArg ?? "data/recipes/seed-recipes.json"}

begin;

${statements.join("\n\n")}

commit;
`;
}

console.log(`Validated ${recipes.length} recipe fixture(s).`);
console.log(`Reviewed/tested for MVP planning: ${coverage.reviewedOrTested}.`);
console.log(formatRecipeFixtureCoverage(coverage));
console.log(`Generated ${chunkCount} retrieval chunk(s).`);

if (coverageIssues.length > 0) {
  console.error("Recipe fixture coverage issues:");
  for (const issue of coverageIssues) console.error(`- ${issue}`);
  if (!allowCoverageIssues) process.exit(1);
}

if (shouldWrite) {
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(jsonOutputPath, `${JSON.stringify(prepared, null, 2)}\n`);
  if (batchSize > 0) {
    for (let index = 0; index < prepared.length; index += batchSize) {
      const batch = prepared.slice(index, index + batchSize);
      const batchNumber = String(Math.floor(index / batchSize) + 1).padStart(3, "0");
      const batchSqlPath = resolve(outputDir, `${outputPrefix}-batch-${batchNumber}.sql`);
      writeFileSync(batchSqlPath, buildSeedSql(batch));
    }
  } else {
    writeFileSync(sqlOutputPath, buildSeedSql());
  }
  console.log(`Wrote prepared seed payload to ${jsonOutputPath}.`);
  if (batchSize > 0) console.log(`Wrote batched idempotent SQL seeds to ${outputDir}.`);
  else console.log(`Wrote idempotent SQL seed to ${sqlOutputPath}.`);
}
