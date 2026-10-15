import { createServer as createHttpServer, type Server } from "node:http";
import path from "node:path";
import express from "express";
import { chromium, firefox, webkit, type Browser, type BrowserContext } from "playwright";
import { createServer as createViteServer, type ViteDevServer } from "vite";
import { app, manifest, origin } from "../storage-smoke/setup";
import { trackSmokeUploads } from "./track-uploads";
import type { SmokeEngine } from "./engines";

/** Test-owned listeners only; never touches the running workspace services. */
export async function startBrowserSmoke(engine: SmokeEngine = "chromium") {
  let api: Server | undefined;
  let web: ViteDevServer | undefined;
  let browser: Browser | undefined;
  let phase = `${engine} launch (install Playwright engine and platform dependencies; see README prerequisites)`;
  async function close() {
    // One shutdown failure must not prevent the other resources closing.
    const results = await Promise.allSettled([
      browser?.close(),
      web?.close(),
      api?.listening ? new Promise<void>((resolve, reject) =>
        api!.close((error) => error ? reject(error) : resolve())) : undefined,
    ]);
    if (results.some((result) => result.status === "rejected")) {
      throw new Error("Could not close an isolated browser smoke resource.");
    }
    // Shared setup's afterAll independently cleans every manifest object.
  }
  try {
    browser = await { chromium, firefox, webkit }[engine].launch({
      executablePath: process.env[`BROWSER_SMOKE_${engine.toUpperCase()}_PATH`] || undefined,
    });
    phase = "API listener";
    const isolated = express();
    // Record before the response arrives, including failed/abandoned PUTs.
    isolated.use(trackSmokeUploads(manifest));
    isolated.use(app);
    api = createHttpServer(isolated);
    await new Promise<void>((resolve, reject) => {
      api!.once("error", reject);
      api!.listen(0, "127.0.0.1", resolve);
    });
    const address = api.address();
    if (!address || typeof address === "string") throw new Error("Missing isolated API port.");
    const root = path.resolve(import.meta.dirname, "../../../garnish");
    phase = "Vite initialization";
    web = await createViteServer({
      configFile: path.join(root, "vite.config.ts"),
      server: {
        host: "127.0.0.1", port: 4179, strictPort: true,
        proxy: { "/api": `http://127.0.0.1:${address.port}` },
      },
      logLevel: "silent",
    });
    phase = "Vite listener";
    await web.listen();
    return { browser, close };
  } catch {
    await close();
    throw new Error(`Isolated browser smoke startup failed during ${phase}; sensitive diagnostics redacted.`);
  }
}

export async function restrictSmokeNetwork(context: BrowserContext, errors: string[]) {
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin || url.protocol === "blob:") return route.continue();
    if (url.origin === "https://fonts.googleapis.com") {
      return route.fulfill({ status: 200, contentType: "text/css", body: "" });
    }
    if (url.origin === "https://storage.googleapis.com"
      && decodeURIComponent(url.pathname).startsWith(`${manifest.directory}/uploads/`)) {
      return route.continue();
    }
    errors.push("Forbidden browser network destination");
    return route.abort();
  });
}
