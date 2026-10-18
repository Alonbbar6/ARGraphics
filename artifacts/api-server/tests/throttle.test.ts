import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { app } from "./support/setup";
import { db, schema } from "./support/database";
import { signIn } from "./support/requests";
import { allowAttempt, attemptsSoFar, DAY_MS, HOUR_MS, LOGIN_FAILURE_LIMIT } from "../src/lib/throttle";

const email = "demo@argraphics.app";
const login = (password: string, address = email) =>
  request(app).post("/api/auth/login").send({ email: address, password });

describe("shared throttle buckets", () => {
  it("admits up to the limit in a window, then refuses until the window turns over", async () => {
    const now = new Date(Date.UTC(2026, 9, 14, 12));
    expect(await allowAttempt("unit", "k", 2, { now })).toBe(true);
    expect(await allowAttempt("unit", "k", 2, { now })).toBe(true);
    expect(await allowAttempt("unit", "k", 2, { now })).toBe(false);
    expect(await attemptsSoFar("unit", "k", { now })).toBe(2);
    // Another key in the same scope is independent.
    expect(await allowAttempt("unit", "other", 2, { now })).toBe(true);
    // The next hour is a fresh bucket.
    const later = new Date(now.getTime() + HOUR_MS);
    expect(await allowAttempt("unit", "k", 2, { now: later })).toBe(true);
  });

  it("supports daily windows for spend caps", async () => {
    const now = new Date(Date.UTC(2026, 9, 14, 1));
    expect(await allowAttempt("spend", "bar", 1, { windowMs: DAY_MS, now })).toBe(true);
    const sameDay = new Date(Date.UTC(2026, 9, 14, 23));
    expect(await allowAttempt("spend", "bar", 1, { windowMs: DAY_MS, now: sameDay })).toBe(false);
    const nextDay = new Date(Date.UTC(2026, 9, 15, 0, 1));
    expect(await allowAttempt("spend", "bar", 1, { windowMs: DAY_MS, now: nextDay })).toBe(true);
  });

  it("never stores the raw key", async () => {
    await allowAttempt("login-fail", "someone@example.test", 5);
    const rows = await db.select().from(schema.recoveryRateLimitsTable);
    expect(rows).toHaveLength(1);
    expect(rows[0].key).not.toContain("someone");
    expect(rows[0].key).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("sign-in throttling", () => {
  it("locks an account after repeated wrong passwords, even for the right one, without touching other accounts", async () => {
    for (let attempt = 0; attempt < LOGIN_FAILURE_LIMIT; attempt += 1) {
      await login("not-the-password").expect(401);
    }
    const locked = await login("fixture-password").expect(429);
    expect(locked.headers["retry-after"]).toBe("3600");
    expect(locked.headers["set-cookie"]).toBeUndefined();
    expect(locked.body.error).toMatch(/too many failed sign-ins/i);
    // A different partner signs in normally.
    await login("fixture-password", "other@example.test").expect(200);
  });

  it("does not count successful sign-ins as failures", async () => {
    for (let attempt = 0; attempt < LOGIN_FAILURE_LIMIT; attempt += 1) {
      await login("fixture-password").expect(200);
    }
    await login("fixture-password").expect(200);
  });
});

describe("paid 3D generation cap", () => {
  it("refuses a partner who has used today's generations before any provider call", async () => {
    vi.stubEnv("MESHY_API_KEY", "offline-fixture-not-a-real-key");
    vi.stubEnv("GENERATION_DAILY_LIMIT", "1");
    const paths = {
      sourcePhotoPath: "/objects/uploads/22222222-2222-4222-8222-222222222222",
      cleanedPhotoPath: "/objects/uploads/33333333-3333-4333-8333-333333333333",
    };
    await db.update(schema.drinksTable).set({ sourcePhotoUrl: paths.sourcePhotoPath, cleanedPhotoUrl: paths.cleanedPhotoPath })
      .where(eq(schema.drinksTable.id, "fixture-drink"));
    // Today's single generation has already been spent.
    expect(await allowAttempt("generation", "argraphics-demo-bar", 1, { windowMs: DAY_MS })).toBe(true);
    const cookie = await signIn();
    const fetch = vi.spyOn(globalThis, "fetch");
    const response = await request(app).post("/api/drinks/fixture-drink/generation")
      .set("Cookie", cookie).send(paths).expect(429);
    expect(response.body.error).toMatch(/limit of 1 3D previews/);
    expect(fetch).not.toHaveBeenCalled();
    const [drink] = await db.select().from(schema.drinksTable).where(eq(schema.drinksTable.id, "fixture-drink"));
    expect(drink.generationStatus).toBe("none");
  });
});

describe("hardened responses", () => {
  it("sends security headers and no server banner", async () => {
    const response = await request(app).get("/api/healthz").expect(200);
    expect(response.headers["x-powered-by"]).toBeUndefined();
    expect(response.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("answers malformed JSON with a plain message instead of a stack trace", async () => {
    const response = await request(app).post("/api/auth/login")
      .set("Content-Type", "application/json").send("{not json").expect(400);
    expect(response.body).toEqual({ error: "That request could not be read." });
  });
});
