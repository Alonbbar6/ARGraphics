import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db, photoCleanupLimitsTable } from "@workspace/db";

export const cleanupWindowMs = 600_000;
export const cleanupAttemptLimit = 4;
// The request (including upload/decoding) must stop before abandoned leases expire.
// Leave a minute for cancellation to settle; never retry paid provider calls.
export const cleanupRequestTimeoutMs = 240_000;
export const cleanupLeaseMs = 300_000;

export type CleanupAdmission =
  | { allowed: true; token: string }
  | { allowed: false; retryAfterSeconds: number };

export async function acquireCleanupLease(ownerId: string): Promise<CleanupAdmission> {
  return db.transaction(async tx => {
    await tx.insert(photoCleanupLimitsTable).values({
      ownerId, count: 0, windowExpiresAt: new Date(0),
    }).onConflictDoNothing();
    // The owner row serializes admission across processes. No lock is held while
    // uploading, decoding, or waiting on OpenAI. Different owners use different rows.
    const [entry] = await tx.select().from(photoCleanupLimitsTable)
      .where(eq(photoCleanupLimitsTable.ownerId, ownerId)).for("update");
    // Read the database clock AFTER taking the lock, not a server clock or the
    // transaction-start timestamp (which can be stale after waiting on a lock).
    const [clock] = await tx.select({
      now: sql<number>`extract(epoch from clock_timestamp()) * 1000`.mapWith(Number),
    }).from(photoCleanupLimitsTable).where(eq(photoCleanupLimitsTable.ownerId, ownerId));
    const now = clock.now;
    const windowActive = entry.windowExpiresAt.getTime() > now;
    const count = windowActive ? entry.count : 0;
    const busyUntil = entry.leaseToken ? entry.leaseExpiresAt?.getTime() ?? 0 : 0;
    const blockedUntil = Math.max(
      busyUntil > now ? busyUntil : 0,
      count >= cleanupAttemptLimit ? entry.windowExpiresAt.getTime() : 0,
    );
    if (blockedUntil > now) {
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((blockedUntil - now) / 1000)) };
    }
    const token = randomUUID();
    await tx.update(photoCleanupLimitsTable).set({
      count: count + 1,
      windowExpiresAt: windowActive ? entry.windowExpiresAt : new Date(now + cleanupWindowMs),
      leaseToken: token,
      leaseExpiresAt: new Date(now + cleanupLeaseMs),
    }).where(eq(photoCleanupLimitsTable.ownerId, ownerId));
    return { allowed: true, token };
  });
}

export async function releaseCleanupLease(ownerId: string, token: string): Promise<void> {
  // An old request's finally block must never release its replacement's lease.
  await db.update(photoCleanupLimitsTable).set({ leaseToken: null, leaseExpiresAt: null })
    .where(and(eq(photoCleanupLimitsTable.ownerId, ownerId), eq(photoCleanupLimitsTable.leaseToken, token)));
}
