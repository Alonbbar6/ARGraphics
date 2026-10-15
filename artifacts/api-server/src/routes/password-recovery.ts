import { Router, type IRouter } from "express";
import { setTimeout as delay } from "node:timers/promises";
import { and, eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import {
  RequestPasswordResetBody, RequestPasswordResetResponse,
  ConfirmPasswordResetBody, ConfirmPasswordResetResponse,
} from "@workspace/api-zod";
import {
  allowRecoveryAttempt, issuePasswordReset, replacePassword, sendResetEmail,
  recoveryConfig, recoveryMessage, invalidResetMessage,
} from "../lib/password-recovery";

const router: IRouter = Router();
router.use("/auth/password-reset", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});

router.post("/auth/password-reset/request", async (req, res): Promise<void> => {
  const startedAt = Date.now();
  const parsed = RequestPasswordResetBody.safeParse({
    ...req.body, email: typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : req.body?.email,
  });
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a valid email address." });
    return;
  }
  try { recoveryConfig(); } catch {
    req.log.error("Password recovery configuration is missing or invalid.");
    res.status(503).json({ error: "Password recovery is temporarily unavailable. Please try again later." });
    return;
  }
  if (!(await allowRecoveryAttempt("request-ip", req.ip || req.socket.remoteAddress || "unknown", 20))) {
    res.setHeader("Retry-After", "3600");
    res.status(429).json({ error: "Too many recovery requests. Try again in an hour." });
    return;
  }
  // Limit each email equally, including nonexistent accounts, without exposing
  // account existence or the per-email limit to the requester.
  if (await allowRecoveryAttempt("request-email", parsed.data.email, 5)) {
    const reset = await issuePasswordReset(parsed.data.email);
    if (reset) {
      await sendResetEmail(reset.email, reset.token).catch(async () => {
        // Do not log provider bodies: they can contain the link or recipient.
        req.log.error("Password reset email delivery failed.");
        await db.update(usersTable).set({ passwordResetHash: null, passwordResetExpiresAt: null })
          .where(and(eq(usersTable.id, reset.id), eq(usersTable.passwordResetHash, reset.tokenHash)));
      }).catch(() => { req.log.error("Could not clear an undelivered reset token."); });
    }
  }
  await delay(Math.max(0, 4000 - (Date.now() - startedAt)));
  res.json(RequestPasswordResetResponse.parse({ message: recoveryMessage }));
});

router.post("/auth/password-reset/confirm", async (req, res): Promise<void> => {
  if (!(await allowRecoveryAttempt("confirm-ip", req.ip || req.socket.remoteAddress || "unknown", 40))) {
    res.setHeader("Retry-After", "3600");
    res.status(429).json({ error: "Too many reset attempts. Try again in an hour." });
    return;
  }
  const parsed = ConfirmPasswordResetBody.safeParse(req.body);
  if (!parsed.success || Buffer.byteLength(parsed.data.password, "utf8") > 72) {
    res.status(400).json({ error: "Use a valid reset link and a password of at least 12 characters and no more than 72 bytes." });
    return;
  }
  if (!(await replacePassword(parsed.data.token, parsed.data.password))) {
    res.status(400).json({ error: invalidResetMessage });
    return;
  }
  res.setHeader("Set-Cookie", `garnish_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${process.env.NODE_ENV === "production" ? "; Secure" : ""}`);
  res.json(ConfirmPasswordResetResponse.parse({ message: "Password updated. Sign in with your new password." }));
});

export default router;
