import { createHash } from "node:crypto";
import { lt, sql } from "drizzle-orm";
import { db, recoveryRateLimitsTable } from "@workspace/db";

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

/** Keys are hashed so the table never holds an email, address or partner id in clear. */
const bucketKey = (scope: string, value: string, bucket: number) =>
  createHash("sha256").update(`${scope}:${value}:${bucket}`).digest("hex");

/**
 * Fixed-window counter shared by every server instance and kept across restarts.
 * Returns true and records the attempt when it is within `limit` for the current window;
 * returns false (recording nothing) once the window is full.
 */
export async function allowAttempt(
  scope: string, value: string, limit: number, { windowMs = HOUR_MS, now = new Date() } = {},
) {
  const bucket = Math.floor(now.getTime() / windowMs);
  const key = bucketKey(scope, value, bucket);
  await db.delete(recoveryRateLimitsTable).where(lt(recoveryRateLimitsTable.expiresAt, now));
  const [entry] = await db.insert(recoveryRateLimitsTable).values({
    key, count: 1, expiresAt: new Date((bucket + 1) * windowMs),
  }).onConflictDoUpdate({
    target: recoveryRateLimitsTable.key,
    set: { count: sql`${recoveryRateLimitsTable.count} + 1` },
    setWhere: lt(recoveryRateLimitsTable.count, limit),
  }).returning({ count: recoveryRateLimitsTable.count });
  return Boolean(entry);
}

/** How many attempts the current window already holds, without recording one. */
export async function attemptsSoFar(scope: string, value: string, { windowMs = HOUR_MS, now = new Date() } = {}) {
  const bucket = Math.floor(now.getTime() / windowMs);
  const [entry] = await db.select({ count: recoveryRateLimitsTable.count }).from(recoveryRateLimitsTable)
    .where(sql`${recoveryRateLimitsTable.key} = ${bucketKey(scope, value, bucket)}`).limit(1);
  return entry?.count ?? 0;
}

/** Records one attempt without a ceiling (for counting failures). */
export async function recordAttempt(scope: string, value: string, { windowMs = HOUR_MS, now = new Date() } = {}) {
  const bucket = Math.floor(now.getTime() / windowMs);
  await db.insert(recoveryRateLimitsTable).values({
    key: bucketKey(scope, value, bucket), count: 1, expiresAt: new Date((bucket + 1) * windowMs),
  }).onConflictDoUpdate({
    target: recoveryRateLimitsTable.key,
    set: { count: sql`${recoveryRateLimitsTable.count} + 1` },
  });
}

/* ------------------------------------------------------------- sign-in */

/** Sign-in attempts (successful or not) one address may make per hour. */
export const LOGIN_IP_LIMIT = 100;
/** Failed sign-ins per account per hour before further attempts are refused. */
export const LOGIN_FAILURE_LIMIT = 10;

export const clientAddress = (req: { ip?: string; socket: { remoteAddress?: string } }) =>
  req.ip || req.socket.remoteAddress || "unknown";

/* ------------------------------------------------------------ 3D models */

/**
 * Paid Meshy generations one partner may start per day. Each one costs real credits on the
 * platform's key, so a stolen or careless account cannot run up the bill overnight.
 */
export const generationDailyLimit = () => {
  const configured = Number(process.env.GENERATION_DAILY_LIMIT);
  return Number.isInteger(configured) && configured > 0 ? configured : 10;
};
