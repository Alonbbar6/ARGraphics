import { readFile } from "node:fs/promises";
import type { BrowserContext, Request } from "playwright";
import sharp from "sharp";
import { expect, it } from "vitest";
import { manifest, origin } from "../storage-smoke/setup";
import { isReloadCancellation, selectedEngines } from "./engines";
import { restrictSmokeNetwork, startBrowserSmoke } from "./harness";

// No traces/HAR: they would persist signed upload URLs and session cookies.
// Vitest runs these sequentially: one loopback port and one shared manifest.
it.each(selectedEngines(process.env.BROWSER_SMOKE_BROWSERS))(
  "selects, uploads, saves, privately reloads and exports PNG/JPEG/WebP in %s", async (engine) => {
  let harness: Awaited<ReturnType<typeof startBrowserSmoke>> | undefined;
  let phase = "isolated server startup";
  const errors: string[] = [];
  try {
    harness = await startBrowserSmoke(engine);
    const { browser } = harness;
    const owner = await browser.newContext({ acceptDownloads: true, serviceWorkers: "block" });
    // Restrict browser traffic too; signed PUTs continue unchanged rather than
    // being fulfilled/mocked. Every engine enforces real preflight and CORS.
    await restrictSmokeNetwork(owner, errors);
    const page = await owner.newPage();
    const successfulPuts = new WeakSet<Request>();
    page.on("response", (response) => {
      if (response.request().method() === "PUT" && response.status() === 200) {
        successfulPuts.add(response.request());
      }
    });
    page.on("pageerror", () => errors.push("Uncaught browser error"));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push("Browser console error");
    });
    page.on("requestfailed", (request) => {
      // Some engines abandon successful PUT response bodies. Accept only a
      // known cancellation after HTTP 200; private reload still checks every
      // stored byte. Failed PUTs/preflights and other failures must still fail.
      if (!isReloadCancellation(request.method(), request.failure()?.errorText,
        successfulPuts.has(request) ? 200 : undefined)) {
        const error = request.failure()?.errorText;
        const code = ["net::ERR_ABORTED", "NS_BINDING_ABORTED", "Load request cancelled",
          "net::ERR_FAILED", "net::ERR_BLOCKED_BY_CLIENT"].includes(error ?? "") ? error : "redacted";
        const method = ["GET", "POST", "PUT", "OPTIONS", "HEAD"].includes(request.method())
          ? request.method() : "other";
        errors.push(`Browser request failed (${method}, ${code})`);
      }
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
      // All engines decode identical in-memory art, including WebKit versions
      // that decode WebP but cannot encode it with canvas.toDataURL.
      const pixels = Buffer.alloc(160 * 80 * 3);
      for (let y = 0; y < 80; y++) {
        pixels.fill(255, (y * 160 + 80) * 3, (y + 1) * 160 * 3);
      }
      const encoder = sharp(pixels, { raw: { width: 160, height: 80, channels: 3 } });
      const bytes = await (extension === "png" ? encoder.png()
        : extension === "jpg" ? encoder.jpeg({ quality: 95 })
          : encoder.webp({ lossless: true })).toBuffer();
      const name = `Browser smoke ${engine} ${extension}`;
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

      const savedCard = await saved.json() as { referenceImageUrl: string };
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
      expect((await owner.request.get(`${origin}/api/storage${objectPath}`)).status()).toBe(404);
      const privateURL = `${origin}${savedCard.referenceImageUrl}`;
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
      expect(download.suggestedFilename()).toBe(`Browser-smoke-${engine}-${extension}.pdf`);
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
  } catch (cause) {
    // Playwright errors can contain signed URLs or cookies. Expose only phase.
    if (cause instanceof Error && cause.message.startsWith("Isolated browser smoke startup failed during ")) throw cause;
    throw new Error(`${engine} browser storage smoke failed during ${phase}; sensitive diagnostics redacted.`);
  } finally {
    await harness?.close();
    // Shared setup's afterAll deletes and verifies every manifest object.
  }
});

      const acceptedPath = savedCard.referenceImageUrl.slice("/api/storage".length);
