import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { ReplitConnectors } from "@replit/connectors-sdk";
import { db, usersTable } from "@workspace/db";
import { allowAttempt } from "./throttle";

export const recoveryMessage = "If an account exists for that email, you will receive a password-reset link. Check your inbox and spam folder.";
export const invalidResetMessage = "This reset link is invalid, expired, or already used. Request a new link.";
export const resetLifetimeMs = 30 * 60 * 1000;
export const hashResetToken = (token: string) => createHash("sha256").update(token).digest("hex");

export function recoveryConfig() {
  const from = process.env.PASSWORD_RESET_FROM;
  const appUrl = process.env.PASSWORD_RESET_APP_URL ||
    (process.env.NODE_ENV !== "production" && process.env.REPLIT_DEV_DOMAIN
      ? `https://${process.env.REPLIT_DEV_DOMAIN}` : undefined);
  if (!from || !appUrl) throw new Error("Password recovery needs a sender and trusted app URL.");
  const url = new URL(appUrl);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("Password recovery requires an HTTPS app URL without credentials, query, or fragment.");
  }
  return { from, appUrl: url };
}

// Database-backed buckets apply across server instances and restarts. No raw
// email addresses or client addresses are retained in the rate-limit table.
export async function allowRecoveryAttempt(scope: string, value: string, limit: number, now = new Date()) {
  return allowAttempt(scope, value, limit, { now });
}

export async function issuePasswordReset(email: string, now = new Date()) {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashResetToken(token);
  const [owner] = await db.update(usersTable).set({
    passwordResetHash: tokenHash,
    passwordResetExpiresAt: new Date(now.getTime() + resetLifetimeMs),
  }).where(eq(usersTable.email, email)).returning({ id: usersTable.id, email: usersTable.email });
  return owner ? { ...owner, token, tokenHash } : null;
}

export async function replacePassword(token: string, password: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token) || password.length < 12 ||
      password.length > 72 || Buffer.byteLength(password, "utf8") > 72) return false;
  const tokenHash = hashResetToken(token);
  // Reject invalid tokens before expensive bcrypt work. The guarded UPDATE below
  // rechecks expiry and ownership atomically, so racing submissions cannot win twice.
  const [valid] = await db.select({ id: usersTable.id }).from(usersTable).where(and(
    eq(usersTable.passwordResetHash, tokenHash),
    gt(usersTable.passwordResetExpiresAt, new Date()),
  )).limit(1);
  if (!valid) return false;
  const passwordHash = await bcrypt.hash(password, 12);
  const [updated] = await db.update(usersTable).set({
    passwordHash,
    passwordResetHash: null,
    passwordResetExpiresAt: null,
    sessionVersion: sql`${usersTable.sessionVersion} + 1`,
  }).where(and(
    eq(usersTable.id, valid.id),
    eq(usersTable.passwordResetHash, tokenHash),
    gt(usersTable.passwordResetExpiresAt, new Date()),
  )).returning({ id: usersTable.id });
  return Boolean(updated);
}

export async function sendResetEmail(email: string, token: string) {
  const { from, appUrl } = recoveryConfig();
  // Fragment tokens never reach access logs or HTTP Referer headers.
  const link = new URL(`${appUrl.pathname.replace(/\/$/, "")}/reset-password`, appUrl);
  link.hash = new URLSearchParams({ token }).toString();
  const message = JSON.stringify({
      from, to: [email], subject: "Reset your ARGraphics password",
      text: `Reset your ARGraphics password:\n\n${link.href}\n\nThis link expires in 30 minutes and can be used once. Requesting another link replaces this one. If you did not request a reset, ignore this email; your password has not changed.`,
    });
  // Off Replit, a plain Resend API key sends the mail; on Replit the connector still works.
  const apiKey = process.env.RESEND_API_KEY;
  const response = apiKey
    ? await fetch("https://api.resend.com/emails", {
        method: "POST",
        signal: AbortSignal.timeout(5000),
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: message,
      })
    : await new ReplitConnectors().createProxyFetch("resend")("/emails", {
        method: "POST",
        signal: AbortSignal.timeout(3000),
        headers: { "Content-Type": "application/json" },
        body: message,
      });
  if (!response.ok) throw new Error(`Reset email provider returned HTTP ${response.status}.`);
}
