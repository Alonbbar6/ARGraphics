import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Applies every migration in ./migrations that the database has not seen yet, in order,
 * and records each in drizzle's own __drizzle_migrations table. Safe to run on every deploy:
 * an up-to-date database is a no-op. Never uses `drizzle-kit push` against real data.
 */
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL must be set to run migrations.");

const mode = (process.env.DATABASE_SSL ?? "").toLowerCase();
const ssl = mode === "disable" ? false
  : mode === "no-verify" ? { rejectUnauthorized: false }
  : mode === "require" || process.env.NODE_ENV === "production" ? { rejectUnauthorized: true }
  : undefined;

const pool = new pg.Pool({ connectionString, ...(ssl === undefined ? {} : { ssl }), max: 1 });
const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations");

try {
  await migrate(drizzle(pool), { migrationsFolder });
  console.log("Database schema is up to date.");
} finally {
  await pool.end();
}
