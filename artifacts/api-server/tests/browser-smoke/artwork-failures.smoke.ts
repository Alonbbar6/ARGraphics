import { readFile } from "node:fs/promises";
import type { Request } from "playwright";
import { expect, it } from "vitest";
import { resetDatabase } from "../support/database";
import { manifest, origin } from "../storage-smoke/setup";
import { restrictSmokeNetwork, startBrowserSmoke } from "./harness";

const successMessage = "Table card saved. Its PDF is ready to download.";
const cases = [
  { stage: "upload-url", message: "Could not start the artwork upload. Please try again." },
  { stage: "signed-put", message: "The artwork upload did not finish. Please try again." },
  { stage: "card-save", message: "Could not save the table card." },
  { stage: "pdf-fetch", message: "Could not load the artwork to make the PDF." },
] as const;

// Separate contexts and reset PGlite between cases. Never mock provider behavior
// globally: only the single failing browser request is intercepted.
it.each(cases)("recovers after $stage without a false save or download", async ({ stage, message }) => {
  let harness: Awaited<ReturnType<typeof startBrowserSmoke>> | undefined;
  let phase = "fixture startup";
  let releaseFailure: (() => void) | undefined;
  const errors: string[] = [];
  try {
    await resetDatabase();
    harness = await startBrowserSmoke();
    const owner = await harness.browser.newContext({ acceptDownloads: true, serviceWorkers: "block" });
    await restrictSmokeNetwork(owner, errors);
    const login = await owner.request.post(`${origin}/api/auth/login`, {
      data: { email: "demo@garnish.app", password: "fixture-password" },
    });
    expect(login.status()).toBe(200);
    const page = await owner.newPage();
    page.on("pageerror", () => errors.push("Uncaught browser error"));
    page.on("requestfailed", (request) => {
      if (request.failure()?.errorText !== "net::ERR_ABORTED") errors.push("Unexpected browser request failure");
    });
    const counts = { urls: 0, puts: 0, saves: 0, downloads: 0 };
    page.on("download", () => { counts.downloads++; });
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (request.method() === "POST" && url.pathname === "/api/storage/uploads/request-url") counts.urls++;
      if (request.method() === "PUT" && url.origin === "https://storage.googleapis.com") counts.puts++;
      if (request.method() === "POST" && url.pathname === "/api/table-cards") counts.saves++;
    });
    const listCards = async () => {
      const response = await owner.request.get(`${origin}/api/table-cards`);
      expect(response.status()).toBe(200);
      return response.json() as Promise<Array<{ id: string; name: string; referenceImageUrl: string }>>;
    };
    phase = "artwork selection";
    await page.goto(`${origin}/table-cards`);
    await expect.poll(() => page.getByRole("heading", { name: "Table cards." }).count()).toBe(1);
    const baseline = await listCards();
    expect(baseline).toEqual([]);
    // Keep DOM globals out of the shared Node test compiler.
    const base64 = await page.evaluate<string>(`(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 160; canvas.height = 80;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("No canvas context");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, 160, 80);
      ctx.fillStyle = "#000"; ctx.fillRect(0, 0, 80, 80);
      return canvas.toDataURL("image/png").split(",")[1];
    })()`);
    const picker = page.waitForEvent("filechooser");
    await page.getByText("Choose a PNG, JPEG, or WebP (up to 10 MB)", { exact: true }).click();
    await (await picker).setFiles({ name: "retry-artwork.png", mimeType: "image/png", buffer: Buffer.from(base64, "base64") });
    await expect.poll(() => page.getByText("160 × 80 px", { exact: true }).count()).toBe(1);
    const name = `Retry ${stage}`;
    await page.getByLabel("Card name", { exact: true }).fill(name);
    await page.getByRole("spinbutton", { name: "Printed width centimeters", exact: true }).fill("12");
    const saveButton = page.getByRole("button", { name: "Save table card", exact: true });
    const alert = page.getByRole("alert");
    const status = page.getByText(successMessage, { exact: true });
    const ownedPaths: string[] = [];

    async function saveSuccessfully() {
      const uploaded = page.waitForResponse((response) =>
        new URL(response.url()).pathname === "/api/storage/uploads/request-url").catch(() => null);
      const saved = page.waitForResponse((response) =>
        new URL(response.url()).pathname === "/api/table-cards" && response.request().method() === "POST").catch(() => null);
      await saveButton.click();
      const upload = await uploaded;
      if (!upload) throw new Error("Retry upload URL response missing");
      expect(upload.status()).toBe(200);
      const { objectPath } = await upload.json() as { objectPath: string };
      manifest.assertOwned(objectPath);
      ownedPaths.push(objectPath);
      const savedResponse = await saved;
      if (!savedResponse) throw new Error("Retry save response missing");
      expect(savedResponse.status()).toBe(201);
      await expect.poll(() => status.count()).toBe(1);
      await expect.poll(() => alert.count()).toBe(0);
      expect(await page.getByLabel("Card name", { exact: true }).inputValue()).toBe("");
      expect(await page.getByAltText("Artwork preview", { exact: true }).count()).toBe(0);
      const cards = await listCards();
      expect(cards.map((card) => card.name)).toEqual([name]);
      return cards;
    }

    let beforeFailure = baseline;
    let privatePath = "";
    if (stage === "pdf-fetch") {
      phase = "PDF setup save and private reload";
      beforeFailure = await saveSuccessfully();
      privatePath = new URL(beforeFailure[0].referenceImageUrl, origin).pathname;
      // Reload clears the earlier save status. Only the PDF fetch should fail,
      // never the saved card's <img> request.
      await page.reload();
      const imageAlt = `${name} reference artwork`;
      await page.getByAltText(imageAlt, { exact: true }).waitFor();
      await page.evaluate(`(async () => {
        const image = document.querySelector('img[alt=' + ${JSON.stringify(JSON.stringify(imageAlt))} + ']');
        await image.decode();
      })()`);
    }

    function isFailureTarget(request: Request) {
      const url = new URL(request.url());
      if (stage === "upload-url") return url.origin === origin && url.pathname === "/api/storage/uploads/request-url" && request.method() === "POST";
      if (stage === "signed-put") return url.origin === "https://storage.googleapis.com"
        && decodeURIComponent(url.pathname).startsWith(`${manifest.directory}/uploads/`) && request.method() === "PUT";
      if (stage === "card-save") return url.origin === origin && url.pathname === "/api/table-cards" && request.method() === "POST";
      return url.origin === origin && url.pathname === privatePath && request.resourceType() === "fetch";
    }
    let injected = 0;
    const gate = new Promise<void>((resolve) => { releaseFailure = resolve; });
    await page.route("**/*", async (route) => {
      if (!isFailureTarget(route.request()) || injected !== 0) return route.fallback();
      injected++;
      // Hold the failed response to prove the save button is disabled in flight.
      await gate;
      await route.fulfill({
        status: 503,
        // Return an observable HTTP error, not a cross-origin fetch rejection.
        // OPTIONS still falls back to the unchanged real provider preflight.
        headers: stage === "signed-put" ? { "Access-Control-Allow-Origin": origin } : {},
        contentType: "application/json",
        body: JSON.stringify({ error: message }),
      });
    });

    phase = `${stage} injected failure`;
    const failedUpload = stage !== "pdf-fetch" ? page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/storage/uploads/request-url").catch(() => null) : undefined;
    const downloadButton = page.getByRole("button", { name: `Download print PDF for ${name}`, exact: true });
    if (stage === "pdf-fetch") await downloadButton.click();
    else await saveButton.click();
    await expect.poll(() => injected).toBe(1);
    if (stage !== "pdf-fetch") {
      expect(await page.getByRole("button", { name: "Uploading artwork…", exact: true }).isDisabled()).toBe(true);
    }
    releaseFailure!();
    phase = `${stage} error message`;
    // The generated API client prefixes mutation errors with HTTP status;
    // direct upload/PDF fetch handlers display the actionable message alone.
    await expect.poll(() => alert.textContent()).toBe(stage === "card-save"
      ? `HTTP 503 Service Unavailable: ${message}` : message);
    phase = `${stage} no false success or persisted change`;
    expect(await status.count()).toBe(0);
    expect(counts.downloads).toBe(0);
    expect(await listCards()).toEqual(beforeFailure);
    if (failedUpload) {
      const upload = await failedUpload;
      if (!upload) throw new Error("Failed attempt upload URL response missing");
      expect(upload.status()).toBe(stage === "upload-url" ? 503 : 200);
      if (upload.ok()) {
        const { objectPath } = await upload.json() as { objectPath: string };
        // Includes the rejected PUT and the orphan left by a rejected save.
        manifest.assertOwned(objectPath);
        ownedPaths.push(objectPath);
      }
    }
    if (stage !== "pdf-fetch") {
      phase = `${stage} retained input and enabled controls`;
      expect(await saveButton.isEnabled()).toBe(true);
      expect(await page.getByLabel("Card name", { exact: true }).inputValue()).toBe(name);
      expect(await page.getByRole("spinbutton", { name: "Printed width centimeters", exact: true }).inputValue()).toBe("12");
      expect(await page.getByAltText("Artwork preview", { exact: true }).count()).toBe(1);
      expect(await page.getByRole("button", { name: `Download print PDF for ${name}`, exact: true }).count()).toBe(0);
      expect(counts).toEqual({
        urls: 1, puts: stage === "upload-url" ? 0 : 1,
        saves: stage === "card-save" ? 1 : 0, downloads: 0,
      });
    } else {
      expect(await downloadButton.isEnabled()).toBe(true);
      expect(counts).toEqual({ urls: 1, puts: 1, saves: 1, downloads: 0 });
    }

    phase = `${stage} successful retry`;
    // Single-shot injection is exhausted: retries go through the unchanged API
    // and storage provider. A route accidentally matching twice fails below.
    if (stage === "pdf-fetch") {
      const downloaded = page.waitForEvent("download");
      await downloadButton.click();
      const download = await downloaded;
      expect(await download.failure()).toBeNull();
      expect(download.suggestedFilename()).toBe("Retry-pdf-fetch.pdf");
      const file = await download.path();
      if (!file) throw new Error("Missing retry PDF");
      const pdf = (await readFile(file)).toString("latin1");
      expect(pdf.startsWith("%PDF-")).toBe(true);
      expect(pdf.includes("/Subtype /Image")).toBe(true);
      await download.delete();
      await expect.poll(() => alert.count()).toBe(0);
      expect(await status.count()).toBe(0);
      expect(await listCards()).toEqual(beforeFailure);
      expect(counts).toEqual({ urls: 1, puts: 1, saves: 1, downloads: 1 });
    } else {
      await saveSuccessfully();
      expect(new Set(ownedPaths).size).toBe(ownedPaths.length);
      await page.reload();
      await page.getByAltText(`${name} reference artwork`, { exact: true }).waitFor();
      expect((await listCards()).map((card) => card.name)).toEqual([name]);
      expect(counts).toEqual({
        urls: 2, puts: stage === "upload-url" ? 1 : 2,
        saves: stage === "card-save" ? 2 : 1, downloads: 0,
      });
    }
    expect(injected).toBe(1);
    expect(errors).toEqual([]);
  } catch (cause) {
    // Assertion output / Playwright exceptions can contain signed URLs.
    if (cause instanceof Error && cause.message.startsWith("Isolated browser smoke startup failed during ")) throw cause;
    throw new Error(`Browser failure-path smoke failed during ${phase}; sensitive diagnostics redacted.`);
  } finally {
    releaseFailure?.();
    await harness?.close();
    // setup.ts afterAll deletes/verifies all manifested objects, even when this
    // test fails before reaching retry or when the failed PUT created no object.
  }
});
