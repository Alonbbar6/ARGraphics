import express, { type Express, type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import helmet from "helmet";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const isProduction = process.env.NODE_ENV === "production";

const app: Express = express();
app.set("trust proxy", 1);
// Express advertises itself by default; partners' data does not need the hint.
app.disable("x-powered-by");

/*
 * Security headers. The API only ever answers JSON, so a locked-down CSP costs nothing.
 * HSTS is sent in production only: on a Mac the dashboard and phones talk plain http.
 */
app.use(helmet({
  contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
  crossOriginResourcePolicy: { policy: "same-site" },
  strictTransportSecurity: isProduction ? { maxAge: 60 * 60 * 24 * 365, includeSubDomains: true } : false,
  referrerPolicy: { policy: "no-referrer" },
}));

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

/*
 * Browsers that may call the API from another origin. In production that is only the
 * dashboard's own origin(s), listed in APP_ORIGINS (comma separated); with nothing listed,
 * no cross-origin browser request is allowed. The iOS app sends no Origin and is unaffected.
 * Development keeps the permissive default so phones on the wifi can reach a Mac.
 */
const allowedOrigins = (process.env.APP_ORIGINS ?? "").split(",").map((origin) => origin.trim()).filter(Boolean);
app.use(cors({
  origin: isProduction ? (allowedOrigins.length ? allowedOrigins : false) : true,
  allowedHeaders: ["Content-Type", "x-api-key"],
  // PUT: local-storage uploads when the dashboard and storage URLs use different hosts.
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
}));
app.use(express.json({ limit: "256kb" }));
app.use(express.urlencoded({ extended: true, limit: "256kb" }));

app.use("/api", router);

/*
 * Anything a handler failed to catch ends here: logged with the request id, answered with
 * a plain JSON message. Express's default page would leak a stack trace outside production.
 */
app.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
  const status = typeof error === "object" && error !== null && "status" in error
    && typeof error.status === "number" && error.status >= 400 && error.status < 600
    ? error.status : 500;
  if (status >= 500) req.log.error({ err: error }, "Unhandled request error");
  if (res.headersSent) return;
  res.status(status).json({
    error: status === 413 ? "That request is too large."
      : status === 400 ? "That request could not be read."
      : status < 500 ? "That request could not be completed."
      : "Something went wrong on our side. Please try again.",
  });
});

export default app;
