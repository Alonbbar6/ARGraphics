import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { once } from "node:events";
import { eq, sql } from "drizzle-orm";
import { pool, db, barsTable, drinksTable, arEventsTable, usersTable, photoCleanupLimitsTable } from "@workspace/db";
import type { Drink, Insights, PublicMenu, Session } from "@workspace/api-zod";
import { acquireCleanupLease, releaseCleanupLease } from "../src/lib/photo-cleanup-limits";

type Owner = { cookie: string; slug: string; barId: string; drinks: string[] };
const schema = `isolation_test_${randomUUID().replaceAll("-", "")}`;
const iosKey = "isolation-test-ios-key-not-for-production";
const owners: Owner[] = [];
let server: Server | undefined;
let base = "";
let schemaCreated = false;

async function request<T = unknown>(path: string, options: {
  method?: string;
  cookie?: string;
  body?: unknown;
  apiKey?: string;
} = {}) {
  const headers: Record<string, string> = {};
  if (options.cookie) headers.Cookie = options.cookie;
  if (options.apiKey) headers["x-api-key"] = options.apiKey;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(`${base}/api${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: AbortSignal.timeout(10_000),
  });
  return {
    status: response.status,
    body: await response.json() as T,
    cookie: response.headers.get("set-cookie")?.split(";")[0],
  };
}

before(async () => {
  assert.equal(process.env.NODE_ENV, "test", "Run with pnpm test:isolation, not the app workflow.");
  // Clone only table definitions, never data. Exclude public from search_path
  // so a missing test table fails rather than reading or writing live fixtures.
  // The project database must already have its normal schema (db push).
  const admin = await pool.connect();
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    schemaCreated = true;
    for (const table of ["bars", "users", "drinks", "menu_version", "ar_events", "table_cards", "photo_cleanup_limits"]) {
      await admin.query(`CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`);
    }
    // LIKE does not copy foreign keys. Keep their behavior inside the test schema.
    for (const table of ["users", "drinks", "menu_version", "ar_events", "table_cards"]) {
      await admin.query(`ALTER TABLE "${schema}"."${table}" ADD FOREIGN KEY (bar_id)
        REFERENCES "${schema}".bars(id) ON DELETE CASCADE`);
    }
    await admin.query(`ALTER TABLE "${schema}".ar_events ADD FOREIGN KEY (drink_id)
      REFERENCES "${schema}".drinks(id) ON DELETE CASCADE`);
    await admin.query(`ALTER TABLE "${schema}".photo_cleanup_limits ADD FOREIGN KEY (owner_id)
      REFERENCES "${schema}".users(id) ON DELETE CASCADE`);
  } finally {
    admin.release(true);
  }
  pool.options.options = `-c search_path=${schema}`;
  const result = await pool.query("SELECT current_schema() AS schema");
  assert.equal(result.rows[0].schema, schema);

  // Import only after isolation is established; run the real application,
  // routing, auth middleware, response schemas, and Drizzle queries.
  const { default: app } = await import("../src/app");
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  base = `http://127.0.0.1:${address.port}`;

  for (const label of ["Alpha", "Beta"]) {
    const registration = await request<Session>("/auth/register", {
      method: "POST",
      body: {
        name: `${label} Owner`,
        barName: `${label} Isolation Bar`,
        email: `${label.toLowerCase()}@isolation.example`,
        password: "synthetic-test-password-123",
      },
    });
    assert.equal(registration.status, 201);
    assert(registration.cookie);
    assert(registration.body.barSlug);
    const [bar] = await db.select().from(barsTable)
      .where(eq(barsTable.slug, registration.body.barSlug));
    assert(bar);
    const owner: Owner = {
      cookie: registration.cookie, slug: bar.slug, barId: bar.id, drinks: [],
    };
    // All combinations of publication and availability, with non-constant
    // fixture counts across bars so insight leaks cannot cancel each other out.
    for (const [index, [isPublished, isAvailable]] of [
      [true, true], [false, true], [true, false], [false, false],
    ].entries()) {
      const created = await request<Drink>("/drinks", {
        method: "POST", cookie: owner.cookie,
        body: {
          name: `${label} drink ${index}`, description: `${label} private description`,
          priceCents: 1200 + index, category: label === "Alpha" ? "signature" : "classic",
          // A malicious client cannot choose the owner of a new drink.
          barId: "another-bar",
        },
      });
      assert.equal(created.status, 201);
      owner.drinks.push(created.body.id);
      await db.update(drinksTable).set({
        isPublished, isAvailable, modelGlbUrl: "https://example.com/test.glb",
        sourcePhotoUrl: `/objects/uploads/${created.body.id}/source.png`,
        cleanedPhotoUrl: `/objects/uploads/${created.body.id}/cleaned.png`,
      }).where(eq(drinksTable.id, created.body.id));
    }
    owners.push(owner);
  }
  // Distinct counts, plus an old view and a non-view event for each bar.
  for (const [index, owner] of owners.entries()) {
    for (let count = 0; count < index + 2; count++) {
      const event = await request(`/v1/bars/${owner.slug}/events`, {
        method: "POST", apiKey: iosKey,
        body: { drinkId: owner.drinks[0], eventType: "view" },
      });
      assert.equal(event.status, 201);
    }
    await db.insert(arEventsTable).values([
      {
        id: randomUUID(), barId: owner.barId, drinkId: owner.drinks[1],
        eventType: "view", createdAt: new Date(Date.now() - 10 * 86400_000),
      },
      {
        id: randomUUID(), barId: owner.barId, drinkId: owner.drinks[1],
        eventType: "place",
      },
    ]);
  }
}, { timeout: 30_000 });

after(async () => {
  try {
    if (server) await new Promise<void>((resolve, reject) => {
      server!.close((error) => error ? reject(error) : resolve());
      server!.closeAllConnections();
    });
  } finally {
    try {
      if (schemaCreated) await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
    } finally {
      await pool.end();
    }
  }
});

test("shared cleanup admission serializes PostgreSQL connections and survives reconnects without paid calls", async () => {
  const [owner] = await db.select().from(usersTable).where(eq(usersTable.barId, owners[0].barId));
  const [otherOwner] = await db.select().from(usersTable).where(eq(usersTable.barId, owners[1].barId));
  const originalNow = Date.now;
  // Actual PostgreSQL clock is independent of every application server's clock.
  Date.now = () => 0;
  try {
    const admissions = await Promise.all(Array.from({ length: 24 }, () => acquireCleanupLease(owner.id)));
    const winners = admissions.filter(result => result.allowed);
    assert.equal(winners.length, 1);
    const winner = winners[0];
    assert(winner.allowed);
    const [entry] = await db.select().from(photoCleanupLimitsTable).where(eq(photoCleanupLimitsTable.ownerId, owner.id));
    assert.equal(entry.count, 1);
    await db.update(photoCleanupLimitsTable).set({ leaseExpiresAt: new Date(0) })
      .where(eq(photoCleanupLimitsTable.ownerId, owner.id));
    const replacement = await acquireCleanupLease(owner.id);
    assert(replacement.allowed);
    await releaseCleanupLease(owner.id, winner.token);
    assert.equal((await acquireCleanupLease(owner.id)).allowed, false);
    const independent = await acquireCleanupLease(otherOwner.id);
    assert(independent.allowed);
    await releaseCleanupLease(otherOwner.id, independent.token);
    await releaseCleanupLease(owner.id, replacement.token);
    // Dispose actual database connections, simulating a server restart.
    const connections = await Promise.all(Array.from({ length: 10 }, () => pool.connect()));
    connections.forEach(connection => connection.release(true));
    for (let i = 0; i < 2; i++) {
      const admitted = await acquireCleanupLease(owner.id);
      assert(admitted.allowed);
      await releaseCleanupLease(owner.id, admitted.token);
    }
    const denied = await acquireCleanupLease(owner.id);
    assert(!denied.allowed);
    assert(denied.retryAfterSeconds > 590 && denied.retryAfterSeconds <= 600);
    await db.update(photoCleanupLimitsTable).set({
      windowExpiresAt: sql`clock_timestamp() - interval '1 second'`,
    }).where(eq(photoCleanupLimitsTable.ownerId, owner.id));
    const reset = await acquireCleanupLease(owner.id);
    assert(reset.allowed);
    await releaseCleanupLease(owner.id, reset.token);
  } finally { Date.now = originalNow; }
});

test("each independent owner lists only their own drinks and session", async () => {
  assert.notEqual(owners[0].barId, owners[1].barId);
  assert.notEqual(owners[0].cookie, owners[1].cookie);
  for (const owner of owners) {
    const listed = await request<Drink[]>(`/drinks?barId=${owners.find(o => o !== owner)!.barId}`, {
      cookie: owner.cookie,
    });
    assert.equal(listed.status, 200);
    assert.deepEqual(listed.body.map((drink: { id: string }) => drink.id), owner.drinks);
    const session = await request<Session>("/auth/session", { cookie: owner.cookie });
    assert.equal(session.status, 200);
    assert.equal(session.body.authenticated, true);
    assert.equal(session.body.barSlug, owner.slug);
    const stored = await db.select().from(drinksTable).where(eq(drinksTable.barId, owner.barId));
    assert.equal(stored.length, 4, "Submitted barId must not override session ownership.");
  }
});

test("insights contain only that owner's drink names, publication counts, and recent views", async () => {
  for (const [index, owner] of owners.entries()) {
    const insight = await request<Insights>(`/insights?barId=${owners[1 - index].barId}`, {
      cookie: owner.cookie,
    });
    assert.equal(insight.status, 200);
    assert.equal(insight.body.viewsThisWeek, index + 2);
    assert.equal(insight.body.publishedSignatures, index === 0 ? 2 : 0);
    const listed = await request<Drink[]>("/drinks", { cookie: owner.cookie });
    assert.deepEqual(
      insight.body.viewsByDrink.map((row: { drinkName: string }) => row.drinkName).sort(),
      listed.body.map((row: { name: string }) => row.name).sort(),
    );
    assert.equal(insight.body.mostViewedDrink, listed.body[0].name);
    assert.equal(insight.body.viewsByDrink[0].views, index + 2);
    assert(insight.body.viewsByDrink.slice(1).every((row: { views: number }) => row.views === 0));
  }
});

test("cross-bar updates and deletes return not found and preserve drinks, events, and menu versions", async () => {
  for (const [index, attacker] of owners.entries()) {
    const victim = owners[1 - index];
    const beforeDrinks = await db.select().from(drinksTable).where(eq(drinksTable.barId, victim.barId));
    const beforeEvents = await db.select().from(arEventsTable).where(eq(arEventsTable.barId, victim.barId));
    const versions = await pool.query("SELECT * FROM menu_version ORDER BY bar_id");
    for (const method of ["PATCH", "DELETE"]) {
      const response = await request(`/drinks/${victim.drinks[0]}`, {
        method, cookie: attacker.cookie,
        body: method === "PATCH" ? { name: "Stolen", priceCents: 1, isAvailable: false, barId: attacker.barId } : undefined,
      });
      assert.equal(response.status, 404);
      assert.deepEqual(response.body, { error: "Drink not found." });
    }
    assert.deepEqual(await db.select().from(drinksTable).where(eq(drinksTable.barId, victim.barId)), beforeDrinks);
    assert.deepEqual(await db.select().from(arEventsTable).where(eq(arEventsTable.barId, victim.barId)), beforeEvents);
    assert.deepEqual((await pool.query("SELECT * FROM menu_version ORDER BY bar_id")).rows, versions.rows);
  }
});

test("owners cannot inspect another bar's generation state, photos, or request an upload", async () => {
  for (const [index, attacker] of owners.entries()) {
    const id = owners[1 - index].drinks[0];
    for (const path of [`/drinks/${id}/generation`, `/drinks/${id}/photos/source`, `/drinks/${id}/photos/cleaned`]) {
      assert.equal((await request(path, { cookie: attacker.cookie })).status, 404);
    }
    assert.equal((await request(`/drinks/${id}/generation`, {
      method: "POST", cookie: attacker.cookie,
      body: { sourcePhotoPath: `/objects/uploads/${id}/source.png`, cleanedPhotoPath: `/objects/uploads/${id}/cleaned.png` },
    })).status, 404);
    assert.equal((await request("/storage/drink-photos/request-url", {
      method: "POST", cookie: attacker.cookie,
      body: { drinkId: id, kind: "original", name: "source.png", size: 100, contentType: "image/png" },
    })).status, 404);
    // Positive control: the state route exists and is readable by its owner.
    assert.equal((await request(`/drinks/${id}/generation`, {
      cookie: owners[1 - index].cookie,
    })).status, 200);
  }
});

test("signed-out and forged-cookie requests cannot access owner routes or mutate data", async () => {
  const beforeDrinks = await db.select().from(drinksTable);
  const id = owners[0].drinks[0];
  for (const cookie of [undefined, "garnish_session=forged.invalid"]) {
    for (const [path, method, body] of [
      ["/drinks", "GET", undefined],
      ["/insights", "GET", undefined],
      ["/drinks", "POST", { name: "Unauthorized", description: "", priceCents: 1, category: "signature" }],
      [`/drinks/${id}`, "PATCH", { name: "Unauthorized" }],
      [`/drinks/${id}`, "DELETE", undefined],
      [`/drinks/${id}/generation`, "GET", undefined],
      [`/drinks/${id}/generation`, "POST", { sourcePhotoPath: "source", cleanedPhotoPath: "cleaned" }],
      [`/drinks/${id}/photos/source`, "GET", undefined],
      [`/drinks/${id}/photos/cleaned`, "GET", undefined],
      ["/storage/drink-photos/request-url", "POST", { drinkId: id, kind: "original", name: "photo.png", size: 100, contentType: "image/png" }],
    ] as const) {
      const response = await request(path, { method, body, cookie });
      assert.equal(response.status, 401, `${method} ${path}`);
    }
    const session = await request<Session>("/auth/session", { cookie });
    assert.equal(session.status, 200);
    assert.equal(session.body.authenticated, false);
    assert.equal(session.body.barSlug, null);
  }
  assert.deepEqual(await db.select().from(drinksTable), beforeDrinks);
});

test("public menus need an iOS key, not an owner session, and expose only available published drinks for that bar", async () => {
  for (const owner of owners) {
    const path = `/v1/bars/${owner.slug}/menu`;
    assert.equal((await request(path)).status, 401);
    assert.equal((await request(path, { apiKey: "wrong-key", cookie: owner.cookie })).status, 401);
    const response = await request<PublicMenu>(path, { apiKey: iosKey });
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.drinks.map((drink: { id: string }) => drink.id), [owner.drinks[0]]);
    assert.equal(response.body.barName, owner.slug === owners[0].slug ? "Alpha Isolation Bar" : "Beta Isolation Bar");
    const drink = response.body.drinks[0];
    for (const privateField of ["barId", "sourcePhotoUrl", "cleanedPhotoUrl", "meshyTaskId", "generationError"]) {
      assert.equal(Object.hasOwn(drink, privateField), false, privateField);
    }
  }
  assert.equal((await request("/v1/bars/missing-isolation-bar/menu", { apiKey: iosKey })).status, 404);
});

test("public events cannot attach another bar's drink to the requested bar's insights", async () => {
  const beforeEvents = await db.select().from(arEventsTable);
  for (const [index, owner] of owners.entries()) {
    const response = await request(`/v1/bars/${owner.slug}/events`, {
      method: "POST", apiKey: iosKey,
      body: { drinkId: owners[1 - index].drinks[0], eventType: "view" },
    });
    assert.equal(response.status, 404);
    assert.deepEqual(response.body, { error: "Drink not found." });
  }
  assert.deepEqual(await db.select().from(arEventsTable), beforeEvents);
});

test("an owner can still create, update, and delete their own drink", async () => {
  const owner = owners[0];
  const created = await request<Drink>("/drinks", {
    method: "POST", cookie: owner.cookie,
    body: { name: "Positive control", description: "", priceCents: 500, category: "classic" },
  });
  assert.equal(created.status, 201);
  const updated = await request<Drink>(`/drinks/${created.body.id}`, {
    method: "PATCH", cookie: owner.cookie, body: { name: "Edited", priceCents: 600 },
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.name, "Edited");
  assert.equal(updated.body.priceCents, 600);
  assert.equal((await request(`/drinks/${created.body.id}`, {
    method: "DELETE", cookie: owner.cookie,
  })).status, 200);
  assert.deepEqual(await db.select().from(drinksTable).where(eq(drinksTable.id, created.body.id)), []);
});
