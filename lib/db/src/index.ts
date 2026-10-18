import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

/**
 * Partner and guest data travels to the database encrypted. In production the connection
 * must use TLS with a verified certificate; set DATABASE_SSL to "no-verify" for a provider
 * that hands out a self-signed certificate, or "disable" only on a private network where the
 * database is not reachable from the internet. Development and tests connect however the
 * URL says (a local Postgres on this Mac has no certificate).
 */
function sslConfig(): false | { rejectUnauthorized: boolean } | undefined {
  const mode = (process.env.DATABASE_SSL ?? "").toLowerCase();
  if (mode === "disable") return false;
  if (mode === "no-verify") return { rejectUnauthorized: false };
  if (mode === "require" || process.env.NODE_ENV === "production") return { rejectUnauthorized: true };
  return undefined;
}

const ssl = sslConfig();
export const pool = new Pool({ connectionString, ...(ssl === undefined ? {} : { ssl }) });
export const db = drizzle(pool, { schema });

export * from "./schema";
