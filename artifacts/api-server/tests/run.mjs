import { build } from "esbuild";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Use the existing build tool; no extra test runner or production build needed.
const root = fileURLToPath(new URL("../", import.meta.url));
const tmp = path.join(root, "tmp");
await mkdir(tmp, { recursive: true });
const output = await mkdtemp(path.join(tmp, "isolation-"));
try {
  const outfile = path.join(output, "isolation.test.cjs");
  await build({
    entryPoints: [path.join(root, "tests/isolation.test.ts")],
    outfile,
    bundle: true,
    platform: "node",
    format: "cjs",
    sourcemap: "inline",
    // Native image decoders must load their own runtime files, as in the server build.
    external: ["pg-native", "@google-cloud/storage", "pino", "pino-http", "sharp"],
    logLevel: "warning",
  });
  const child = spawn(process.execPath, ["--test", outfile], {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      // Synthetic credentials used only inside this child process.
      SESSION_SECRET: "isolation-test-session-secret-not-for-production",
      IOS_API_KEY: "isolation-test-ios-key-not-for-production",
    },
  });
  process.exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
} finally {
  await rm(output, { recursive: true, force: true });
}
