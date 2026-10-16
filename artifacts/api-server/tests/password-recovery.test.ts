import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { app } from "./support/setup";
import { db, schema } from "./support/database";
import { signIn } from "./support/requests";
import { allowRecoveryAttempt, hashResetToken, issuePasswordReset, recoveryConfig } from "../src/lib/password-recovery";

const mail = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("@replit/connectors-sdk", () => ({
  ReplitConnectors: class {
    createProxyFetch() { return mail.send; }
  },
}));
// Acknowledgement padding is intentionally constant in the handler; do not
// spend four seconds per request in a regression test. No real timers/network.
vi.mock("node:timers/promises", () => ({
  setTimeout: vi.fn().mockResolvedValue(undefined),
}));

const email = "demo@argraphics.app";
const newPassword = "Recovery-test-new-2026!";

async function ownerRecord() {
  const [user] = await db.select().from(schema.usersTable).where(eq(schema.usersTable.email, email));
  return user;
}
function deliveredLink() {
  const body = JSON.parse(mail.send.mock.lastCall![1].body);
  return new URL(body.text.match(/https:\/\/\S+/)[0]);
}
function deliveredToken() {
  return new URLSearchParams(deliveredLink().hash.slice(1)).get("token")!;
}
const recover = (address = email) => request(app).post("/api/auth/password-reset/request").send({ email: address });
const confirm = (token: string, password = newPassword) =>
  request(app).post("/api/auth/password-reset/confirm").send({ token, password });

beforeEach(() => {
  vi.stubEnv("PASSWORD_RESET_FROM", "ARGraphics <sender@example.test>");
  vi.stubEnv("PASSWORD_RESET_APP_URL", "https://argraphics.example.test/base");
  mail.send.mockReset().mockResolvedValue(new Response(JSON.stringify({ id: "fixture-email" }), { status: 200 }));
});

describe("owner password recovery", () => {
  it("acknowledges known and unknown addresses identically and normalizes emails", async () => {
    const known = await recover(` ${email.toUpperCase()} `).expect(200);
    const unknown = await recover("unknown@example.test").expect(200);
    expect(unknown.body).toEqual(known.body);
    expect(known.body).toEqual({ message: expect.stringContaining("If an account exists") });
    expect(mail.send).toHaveBeenCalledOnce();
    const link = deliveredLink();
    expect(link.origin).toBe("https://argraphics.example.test");
    expect(link.pathname).toBe("/base/reset-password");
    expect(link.search).toBe("");
    const token = deliveredToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const user = await ownerRecord();
    expect(user.passwordResetHash).toBe(hashResetToken(token));
    expect(user.passwordResetHash).not.toBe(token);
    expect(user.passwordResetExpiresAt!.getTime() - new Date().getTime()).toBeGreaterThan(29 * 60 * 1000);
    expect(JSON.stringify(known.body)).not.toContain(token);
  });

  it("changes a password once, safely hashes it, and revokes old signed-in sessions", async () => {
    const cookie = await signIn();
    await recover().expect(200);
    const token = deliveredToken();
    const result = await confirm(token).expect(200);
    expect(result.body.message).toContain("Password updated");
    expect(result.headers["set-cookie"][0]).toContain("Max-Age=0");
    await confirm(token).expect(400);
    const user = await ownerRecord();
    expect(user.passwordResetHash).toBeNull();
    expect(user.passwordResetExpiresAt).toBeNull();
    expect(user.sessionVersion).toBe(1);
    expect(bcrypt.getRounds(user.passwordHash)).toBe(12);
    await request(app).post("/api/auth/login").send({ email, password: "fixture-password" }).expect(401);
    const login = await request(app).post("/api/auth/login").send({ email, password: newPassword }).expect(200);
    await request(app).get("/api/auth/session").set("Cookie", cookie).expect(200)
      .expect(response => expect(response.body.authenticated).toBe(false));
    await request(app).get("/api/auth/session").set("Cookie", login.headers["set-cookie"][0].split(";")[0]).expect(200)
      .expect(response => expect(response.body.authenticated).toBe(true));
  });

  it("allows exactly one competing confirmation to use a token", async () => {
    const reset = await issuePasswordReset(email);
    const results = await Promise.all([confirm(reset!.token), confirm(reset!.token)]);
    expect(results.map(result => result.status).sort()).toEqual([200, 400]);
    expect((await ownerRecord()).sessionVersion).toBe(1);
  });

  it("rejects expired tokens and replaces old links when another link is issued", async () => {
    const first = await issuePasswordReset(email);
    const second = await issuePasswordReset(email);
    await confirm(first!.token).expect(400);
    await confirm(second!.token).expect(200);
    const expired = await issuePasswordReset(email, new Date(0));
    await confirm(expired!.token).expect(400);
    expect((await ownerRecord()).sessionVersion).toBe(1);
  });

  it.each(["short", "é".repeat(40), "x".repeat(73)])("rejects invalid passwords without consuming a link (%s)", async password => {
    const reset = await issuePasswordReset(email);
    await confirm(reset!.token, password).expect(400);
    expect((await ownerRecord()).passwordResetHash).toBe(reset!.tokenHash);
  });

  it("rejects malformed tokens and invalid email addresses", async () => {
    await confirm("invalid").expect(400);
    await recover("not-an-email").expect(400);
    expect(mail.send).not.toHaveBeenCalled();
  });

  it("keeps delivery failures generic and clears the undelivered link", async () => {
    mail.send.mockResolvedValueOnce(new Response("provider unavailable", { status: 503 }));
    const failure = await recover().expect(200);
    const unknown = await recover("unknown@example.test").expect(200);
    expect(failure.body).toEqual(unknown.body);
    expect((await ownerRecord()).passwordResetHash).toBeNull();
    await confirm(deliveredToken()).expect(400);
  });

  it("does not clear a newer token if an older email delivery fails", async () => {
    let newer: Awaited<ReturnType<typeof issuePasswordReset>>;
    mail.send.mockImplementationOnce(async () => {
      newer = await issuePasswordReset(email);
      throw new Error("fixture timeout");
    });
    await recover().expect(200);
    expect((await ownerRecord()).passwordResetHash).toBe(newer!.tokenHash);
    await confirm(newer!.token).expect(200);
  });

  it("limits each address without revealing registration and limits requests per IP", async () => {
    for (let i = 0; i < 5; i++) await recover().expect(200);
    const limited = await recover().expect(200);
    expect(mail.send).toHaveBeenCalledTimes(5);
    expect(limited.body.message).toContain("If an account exists");
    for (let i = 6; i < 20; i++) await recover(`unknown-${i}@example.test`).expect(200);
    const blocked = await recover("another@example.test").expect(429);
    expect(blocked.headers["retry-after"]).toBe("3600");
  });

  it("limits token-guessing attempts", async () => {
    for (let i = 0; i < 40; i++) await confirm("invalid").expect(400);
    await confirm("invalid").expect(429);
  });

  it("has persistent atomic rate limits, including concurrent calls and new windows", async () => {
    const now = new Date();
    const results = await Promise.all(Array.from({ length: 12 }, () => allowRecoveryAttempt("fixture", "same", 5, now)));
    expect(results.filter(Boolean)).toHaveLength(5);
    expect(await allowRecoveryAttempt("fixture", "same", 5, new Date(now.getTime() + 60 * 60 * 1000))).toBe(true);
  });

  it("fails closed for every address when production URL or sender is missing", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PASSWORD_RESET_APP_URL", "");
    expect(() => recoveryConfig()).toThrow();
    const known = await recover().expect(503);
    const unknown = await recover("unknown@example.test").expect(503);
    expect(known.body).toEqual(unknown.body);
    vi.stubEnv("PASSWORD_RESET_APP_URL", "http://untrusted.example.test");
    expect(() => recoveryConfig()).toThrow();
    vi.stubEnv("PASSWORD_RESET_APP_URL", "https://trusted.example.test/?redirect=untrusted");
    expect(() => recoveryConfig()).toThrow();
    expect(mail.send).not.toHaveBeenCalled();
  });
});
