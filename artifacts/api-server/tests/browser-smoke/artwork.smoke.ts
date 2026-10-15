import { createServer as createHttpServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import express from "express";
import { chromium, type Browser, type BrowserContext } from "playwright";
import { createServer as createViteServer, type ViteDevServer } from "vite";
import { expect, it } from "vitest";
import { app, manifest, origin } from "../storage-smoke/setup";
import { trackSmokeUploads } from "./track-uploads";

// No traces/HAR: they would persist signed upload URLs and session cookies.
it("selects, uploads, saves, privately reloads and exports PNG/JPEG/WebP in Chromium", async () => {
  let api: Server | undefined;
  let web: ViteDevServer | undefined;
  let browser: Browser | undefined;
  let phase = "isolated server startup";
  const errors: string[] = [];
  try {
    const isolated = express();
    // Record at the API boundary, before the browser can begin its PUT. Even a
    // browser crash or CORS failure therefore leaves a cleanup entry.
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
    web = await createViteServer({
      configFile: path.join(root, "vite.config.ts"),
      server: {
        host: "127.0.0.1", port: 4179, strictPort: true,
        proxy: { "/api": `http://127.0.0.1:${address.port}` },
      },
      logLevel: "silent",
    });
    await web.listen();
    browser = await chromium.launch({
      executablePath: process.env.BROWSER_SMOKE_CHROMIUM_PATH || undefined,
    });
    const owner = await browser.newContext({ acceptDownloads: true, serviceWorkers: "block" });
    // Restrict browser traffic too; signed PUTs continue unchanged rather than
    // being fulfilled/mocked. Real Chromium fetch enforces preflight and CORS.
    await owner.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin === origin || url.protocol === "blob:") return route.continue();
      // Fonts are irrelevant to artwork, and must not introduce an external
      // dependency or a spurious console/network error into this storage check.
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
    const page = await owner.newPage();
    page.on("pageerror", () => errors.push("Uncaught browser error"));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push("Browser console error");
    });
    page.on("requestfailed", (request) => {
      // Reload deliberately cancels obsolete UI/image requests. A browser CORS
      // or upload failure is not ERR_ABORTED and still fails this smoke.
      if (request.failure()?.errorText !== "net::ERR_ABORTED") errors.push("Browser request failed");
    });

    async function signIn(context: BrowserContext, email: string) {
      const response = await context.request.post(`${origin}/api/auth/login`, {
        data: { email, password: "fixture-password" },
      });
      expect(response.status()).toBe(200);
    }
    phase = "synthetic owner session";
    await signIn(owner, "demo@garnish.app");
    await page.goto(`${origin}/table-cards`);
    await expect.poll(() => page.getByRole("heading", { name: "Table cards." }).count()).toBe(1);

    for (const [extension, mime] of [
      ["png", "image/png"], ["jpg", "image/jpeg"], ["webp", "image/webp"],
    ]) {
      phase = `${extension} file picker and preview`;
      // High-contrast, non-square synthetic art; no owner artwork or files.
      // Browser-only expressions avoid adding DOM globals to the API's Node
      // typecheck. Strings must be invoked explicitly by Playwright.
      const base64 = await page.evaluate<string>(`(() => {
        const type = ${JSON.stringify(mime)};
        const canvas = document.createElement("canvas");
        canvas.width = 160; canvas.height = 80;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas context unavailable");
        ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, 160, 80);
        ctx.fillStyle = "#000"; ctx.fillRect(0, 0, 80, 80);
        const data = canvas.toDataURL(type, 0.95);
        if (!data.startsWith("data:" + type + ";")) throw new Error("Unsupported fixture encoding");
        return data.split(",")[1];
      })()`);
      const bytes = Buffer.from(base64, "base64");
      const name = `Browser smoke ${extension}`;
      phase = `${extension} opening artwork file chooser`;
      const picker = page.waitForEvent("filechooser");
      await page.getByText("Choose a PNG, JPEG, or WebP (up to 10 MB)", { exact: true }).click();
      phase = `${extension} supplying synthetic file`;
      await (await picker).setFiles({ name: `artwork.${extension}`, mimeType: mime, buffer: bytes });
      phase = `${extension} preview dimensions`;
      await expect.poll(() => page.getByText("160 × 80 px", { exact: true }).count()).toBe(1);
      phase = `${extension} preview decode`;
      expect(await page.evaluate(`(async () => {
        const image = document.querySelector('img[alt="Artwork preview"]');
        await image.decode();
        return image.naturalWidth;
      })()`)).toBe(160);
      phase = `${extension} card name input`;
      await page.getByLabel("Card name", { exact: true }).fill(name);
      phase = `${extension} printed width input`;
      await page.getByRole("spinbutton", { name: "Printed width centimeters", exact: true }).fill("10");

      phase = `${extension} real browser PUT and save`;
      const uploadPromise = page.waitForResponse((res) =>
        new URL(res.url()).pathname === "/api/storage/uploads/request-url").catch(() => null);
      const putPromise = page.waitForResponse((res) =>
        new URL(res.url()).origin === "https://storage.googleapis.com" && res.request().method() === "PUT").catch(() => null);
      const savePromise = page.waitForResponse((res) =>
        new URL(res.url()).pathname === "/api/table-cards" && res.request().method() === "POST").catch(() => null);
      await page.getByRole("button", { name: "Save table card", exact: true }).click();
      const upload = await uploadPromise;
      if (!upload) throw new Error("Upload URL request did not complete.");
      phase = `${extension} upload URL response (HTTP ${upload.status()})`;
      expect(upload.status()).toBe(200);
      const { objectPath } = await upload.json() as { objectPath: string };
      manifest.assertOwned(objectPath);
      phase = `${extension} browser storage PUT`;
      const put = await putPromise;
      if (!put) throw new Error("Browser PUT did not complete.");
      phase = `${extension} browser storage PUT (HTTP ${put.status()})`;
      expect(put.status()).toBe(200);
      const saved = await savePromise;
      if (!saved) throw new Error("Save did not complete.");
      phase = `${extension} saving uploaded artwork (HTTP ${saved.status()})`;
      expect(saved.status()).toBe(201);
      await expect.poll(() => page.getByText("Table card saved. Its PDF is ready to download.", { exact: true }).count()).toBe(1);

      phase = `${extension} private reload`;
      await page.reload();
      const imageAlt = `${name} reference artwork`;
      const savedImage = page.getByAltText(imageAlt, { exact: true });
      await savedImage.waitFor();
      expect(await page.evaluate(`(async () => {
        const image = document.querySelector('img[alt=' + ${JSON.stringify(JSON.stringify(imageAlt))} + ']');
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas context unavailable");
        ctx.drawImage(image, 0, 0);
        // Pixel access fails on a tainted canvas; also ensure real art loaded.
        const pixels = ctx.getImageData(0, 0, 160, 80).data;
        return [image.naturalWidth, image.naturalHeight, pixels[0], pixels[159 * 4]];
      })()`)).toEqual([160, 80, 0, 255]);
      const privateURL = `${origin}/api/storage${objectPath}`;
      const read = await owner.request.get(privateURL);
      expect(read.status()).toBe(200);
      expect((await read.body()).equals(bytes)).toBe(true);
      expect(read.headers()["content-type"]).toContain(mime);
      for (const email of [null, "other@example.test"]) {
        const denied = await browser.newContext();
        try {
          if (email) await signIn(denied, email);
          expect((await denied.request.get(privateURL)).status()).toBe(email ? 404 : 401);
        } finally { await denied.close(); }
      }

      phase = `${extension} print PDF export`;
      const downloadPromise = page.waitForEvent("download");
      await page.getByRole("button", { name: `Download print PDF for ${name}`, exact: true }).click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toBe(`Browser-smoke-${extension}.pdf`);
      expect(await download.failure()).toBeNull();
      const file = await download.path();
      if (!file) throw new Error("PDF was not downloaded.");
      const pdf = (await readFile(file)).toString("latin1");
      expect(pdf.startsWith("%PDF-")).toBe(true);
      expect(pdf.includes("/Subtype /Image")).toBe(true);
      const box = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(pdf);
      expect(box !== null).toBe(true);
      expect(Number(box![1])).toBeCloseTo(100 * 72 / 25.4, 2);
      expect(Number(box![2])).toBeCloseTo(50 * 72 / 25.4, 2);
      await download.delete();
    }
    phase = `browser diagnostics (${errors.join(", ") || "clean"})`;
    expect(errors).toEqual([]);
  } catch {
    // Playwright errors can contain signed URLs or cookies. Expose only phase.
    throw new Error(`Browser storage smoke failed during ${phase}; sensitive diagnostics redacted.`);
  } finally {
    await browser?.close();
    await web?.close();
    if (api?.listening) await new Promise<void>((resolve, reject) =>
      api!.close((error) => error ? reject(error) : resolve()));
    // Shared setup's afterAll deletes and verifies every manifest object.
  }
});
