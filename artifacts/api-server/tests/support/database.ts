import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { generateDrizzleJson, generateMigration } from "drizzle-kit/api";
import * as schema from "@workspace/db/schema";
import bcrypt from "bcryptjs";

// Actual PostgreSQL execution and the production schema, with no connection URL
// or files on disk. Do not import @workspace/db's production pool here.
export const client = new PGlite();
export const db = drizzle(client, { schema });
export { schema };

export async function initializeDatabase() {
  const statements = await generateMigration(
    generateDrizzleJson({}),
    generateDrizzleJson(schema),
  );
  for (const statement of statements) await client.exec(statement);
  await resetDatabase();
}

export async function resetDatabase() {
  await client.exec("TRUNCATE bars CASCADE");
  await client.exec("TRUNCATE recovery_rate_limits");
  await db.insert(schema.barsTable).values([
    { id: "garnish-demo-bar", name: "Fixture Bar", slug: "demo-bar" },
    { id: "other-bar", name: "Other Fixture Bar", slug: "other-bar" },
  ]);
  await db.insert(schema.usersTable).values([
    {
      id: "owner", barId: "garnish-demo-bar", name: "Fixture Owner",
      email: "demo@garnish.app", passwordHash: bcrypt.hashSync("fixture-password", 4),
    },
    {
      id: "other-owner", barId: "other-bar", name: "Other Owner",
      email: "other@example.test", passwordHash: bcrypt.hashSync("fixture-password", 4),
    },
  ]);
  await db.insert(schema.drinksTable).values([
    { id: "fixture-drink", barId: "garnish-demo-bar", name: "Fixture Drink", isPublished: true },
    { id: "other-drink", barId: "other-bar", name: "Other Drink", isPublished: true },
  ]);
  await db.insert(schema.menuVersionTable).values([
    { barId: "garnish-demo-bar", version: 1 },
    { barId: "other-bar", version: 1 },
  ]);
}
