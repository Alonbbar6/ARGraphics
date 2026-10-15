import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const checker = fileURLToPath(new URL("../src/check-api-codegen.mjs", import.meta.url));
const outputs = [
  "lib/api-zod/src/generated/api.ts",
  "lib/api-client-react/src/generated/api.ts",
];

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), "api-codegen-check-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  function git(...args) {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  }
  git("init", "--quiet");
  git("config", "user.email", "fixture@example.invalid");
  git("config", "user.name", "Fixture");
  for (const output of outputs) {
    mkdirSync(path.dirname(path.join(root, output)), { recursive: true });
    writeFileSync(path.join(root, output), "export const value = 1;\n");
  }
  git("add", ".");
  git("commit", "--quiet", "-m", "Baseline generated output");

  const bin = path.join(root, "bin");
  mkdirSync(bin);
  const pnpm = path.join(bin, "pnpm");
  // Simulate generation while using a real repository/diff. No dependency
  // installation, external services, or paid API calls are involved.
  writeFileSync(pnpm, `#!/usr/bin/env node
const fs = require("node:fs");
const assert = require("node:assert/strict");
assert.deepEqual(process.argv.slice(2), ["--filter", "@workspace/api-spec", "run", "codegen"]);
const action = JSON.parse(fs.readFileSync("action.json", "utf8"));
if (action.fail) process.exit(2);
for (const [file, content] of Object.entries(action.files || {})) {
  if (content === null) fs.rmSync(file);
  else fs.writeFileSync(file, content);
}
`);
  chmodSync(pnpm, 0o755);
  return {
    root,
    git,
    check(action = {}) {
      writeFileSync(path.join(root, "action.json"), JSON.stringify(action));
      return spawnSync(process.execPath, [checker], {
        cwd: root,
        env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` },
        encoding: "utf8",
      });
    },
  };
}

test("passes when regeneration matches both committed libraries", (t) => {
  const result = fixture(t).check();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /match the committed output/);
});

for (const output of outputs) {
  test(`rejects changed generated content in ${output}`, (t) => {
    const result = fixture(t).check({ files: { [output]: "export const value = 2;\n" } });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /out of date/);
    assert.match(result.stdout, /export const value = 2/);
  });

  test(`rejects newly generated files beside ${output}`, (t) => {
    const newFile = path.join(path.dirname(output), "new-schema.ts");
    const result = fixture(t).check({ files: { [newFile]: "export type New = string;\n" } });
    assert.equal(result.status, 1);
    assert.ok(result.stderr.includes(newFile));
  });

  test(`rejects deleted generated files in ${output}`, (t) => {
    const result = fixture(t).check({ files: { [output]: null } });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /out of date/);
  });
}

test("compares against HEAD, not just the staging index", (t) => {
  const repo = fixture(t);
  writeFileSync(path.join(repo.root, outputs[0]), "export const value = 2;\n");
  repo.git("add", outputs[0]);
  assert.equal(repo.check().status, 1);
});

test("does not omit ignored newly generated files", (t) => {
  const repo = fixture(t);
  writeFileSync(path.join(repo.root, ".gitignore"), "ignored-schema.ts\n");
  const newFile = "lib/api-zod/src/generated/ignored-schema.ts";
  const result = repo.check({ files: { [newFile]: "export type New = string;\n" } });
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes(newFile));
});

test("fails explicitly when generation fails", (t) => {
  const result = fixture(t).check({ fail: true });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /code generation failed/);
  assert.doesNotMatch(result.stdout, /match the committed output/);
});
