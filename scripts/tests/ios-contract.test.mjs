import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parse, stringify } from "yaml";
import { compareIosContracts } from "../src/ios-contract.mjs";
import { checkApproval, digest, contractPath } from "../src/check-ios-contract.mjs";

const baseline = parse(readFileSync(new URL("../../lib/api-spec/openapi.yaml", import.meta.url), "utf8"));
const menuPath = "/v1/bars/{slug}/menu";
const eventPath = "/v1/bars/{slug}/events";
const cardsPath = "/v1/bars/{slug}/table-cards";
const assetPath = "/storage/public-objects/{filePath}";
const checker = fileURLToPath(new URL("../src/check-ios-contract.mjs", import.meta.url));
const schemas = (doc) => doc.components.schemas;
const mutate = (change) => {
  const proposed = structuredClone(baseline);
  change(proposed);
  return compareIosContracts(baseline, proposed);
};

const breaking = [
  ["removed nested response field", (d) => { delete schemas(d).PublicDrink.properties.priceCents; }, /priceCents.*field removed/],
  ["changed integer response type", (d) => { schemas(d).MenuVersion.properties.version.type = "string"; }, /version.*type/],
  ["changed array item type", (d) => { schemas(d).PublicMenu.properties.drinks.items = { type: "string" }; }, /drinks\[\].*type/],
  ["removed table card width", (d) => { delete schemas(d).PublicTableCard.properties.physicalWidthCm; }, /physicalWidthCm.*field removed/],
  ["response required field became optional", (d) => { schemas(d).PublicMenu.required = ["drinks"]; }, /barName.*no longer guaranteed/],
  ["response newly nullable", (d) => { schemas(d).PublicDrink.properties.name.type = ["string", "null"]; }, /name.*nullability/],
  ["changed date format", (d) => { schemas(d).PublicDrink.properties.updatedAt.format = "date"; }, /updatedAt.*format/],
  ["new required header", (d) => { d.paths[menuPath].get.parameters.push({ in: "header", name: "x-client-version", required: true, schema: { type: "string" } }); }, /x-client-version.*new required/],
  ["new required query", (d) => { d.paths[menuPath].get.parameters.push({ in: "query", name: "locale", required: true, schema: { type: "string" } }); }, /locale.*new required/],
  ["new required body field", (d) => { schemas(d).ArEventInput.properties.sessionId = { type: "string" }; schemas(d).ArEventInput.required.push("sessionId"); }, /sessionId.*required/],
  ["narrowed event enum", (d) => { schemas(d).ArEventInput.properties.eventType.enum = ["view"]; }, /eventType.*enum/],
  ["tightened event constraint", (d) => { schemas(d).ArEventInput.properties.drinkId.maxLength = 20; }, /drinkId.*maxLength/],
  ["disallowed extra input", (d) => { schemas(d).ArEventInput.additionalProperties = false; }, /unknown inputs/],
  ["changed pattern", (d) => { schemas(d).ArEventInput.properties.drinkId.pattern = "^new-"; }, /drinkId.*unsupported structural/],
  ["removed operation", (d) => { delete d.paths[eventPath].post; }, /operation removed/],
  ["removed path", (d) => { delete d.paths[menuPath]; }, /operation removed/],
  ["removed public asset path", (d) => { delete d.paths[assetPath]; }, /public-objects.*operation removed/],
  ["removed public asset method", (d) => { delete d.paths[assetPath].get; }, /public-objects.*operation removed/],
  ["changed public asset binary response", (d) => { d.paths[assetPath].get.responses["200"].content["application/octet-stream"].schema.type = "object"; }, /public-objects.*type/],
  ["removed public asset media type", (d) => { delete d.paths[assetPath].get.responses["200"].content["application/octet-stream"]; }, /public-objects.*media type removed/],
  ["removed response status", (d) => { delete d.paths[menuPath].get.responses["200"]; }, /200.*status removed/],
  ["removed response media type", (d) => { delete d.paths[menuPath].get.responses["200"].content["application/json"]; }, /media type removed/],
  ["changed base URL", (d) => { d.servers[0].url = "/api-v2"; }, /server URL/],
  ["new security requirement", (d) => { d.security = [{ bearer: [] }]; }, /security requirements/],
  ["optional response field removed", (d) => { schemas(d).PublicDrink.required = schemas(d).PublicDrink.required.filter((k) => k !== "modelGlbUrl"); delete schemas(d).PublicDrink.properties.modelGlbUrl; }, /modelGlbUrl.*field removed/],
  ["retagging cannot hide a removed field", (d) => { d.paths[menuPath].get.tags = ["owner"]; delete schemas(d).PublicMenu.properties.barName; }, /barName.*field removed/],
];
for (const [name, change, pattern] of breaking) {
  test(`rejects ${name}`, () => assert.match(mutate(change).join("\n"), pattern));
}

for (const [name, change] of [
  ["identical contract", () => {}],
  ["additional response property", (d) => { schemas(d).PublicDrink.properties.subtitle = { type: "string" }; }],
  ["additional required response property", (d) => { schemas(d).PublicDrink.properties.subtitle = { type: "string" }; schemas(d).PublicDrink.required.push("subtitle"); }],
  ["optional event field", (d) => { schemas(d).ArEventInput.properties.sessionId = { type: "string" }; }],
  ["optional query", (d) => { d.paths[menuPath].get.parameters.push({ in: "query", name: "locale", schema: { type: "string" } }); }],
  ["widened event enum", (d) => { schemas(d).ArEventInput.properties.eventType.enum.push("menu_open"); }],
  ["looser event length", (d) => { schemas(d).ArEventInput.properties.drinkId.maxLength = 200; }],
  ["new endpoint", (d) => { d.paths["/v1/new-feature"] = structuredClone(d.paths[menuPath]); }],
  ["owner-only breaking change", (d) => { delete schemas(d).Drink.properties.id; delete d.paths["/auth/login"]; }],
  ["documentation and schema key order", (d) => { schemas(d).PublicDrink.description = "New docs"; schemas(d).PublicDrink.required.reverse(); }],
]) {
  test(`allows ${name}`, () => assert.deepEqual(mutate(change), []));
}

test("path-level parameters and operation overrides preserve OpenAPI semantics", () => {
  const base = structuredClone(baseline);
  base.paths[menuPath].parameters = [{ in: "query", name: "locale", schema: { type: "string" } }];
  const next = structuredClone(base);
  next.paths[menuPath].get.parameters.push({ in: "query", name: "locale", required: true, schema: { type: "string" } });
  assert.match(compareIosContracts(base, next).join("\n"), /locale.*became required/);
});

test("optional request body becoming required is rejected", () => {
  const base = structuredClone(baseline);
  base.paths[eventPath].post.requestBody.required = false;
  assert.match(compareIosContracts(base, baseline).join("\n"), /body became required/);
});

test("response enum expansion breaks old exhaustive clients; narrowing is safe", () => {
  const base = structuredClone(baseline);
  schemas(base).PublicDrink.properties.category.enum = ["classic", "signature"];
  const next = structuredClone(base);
  schemas(next).PublicDrink.properties.category.enum.push("seasonal");
  assert.match(compareIosContracts(base, next).join("\n"), /response enum/);
  assert.deepEqual(compareIosContracts(next, base), []);
});

test("recursive internal refs terminate and still detect changed children", () => {
  const base = structuredClone(baseline);
  schemas(base).PublicMenu.properties.related = { $ref: "#/components/schemas/PublicMenu" };
  const next = structuredClone(base);
  schemas(next).PublicMenu.properties.barName.type = "integer";
  assert.match(compareIosContracts(base, next).join("\n"), /barName.*type/);
});

test("unchanged composition refs cannot hide changed component schemas", () => {
  const base = structuredClone(baseline);
  schemas(base).PublicMenu.properties.meta = { allOf: [{ $ref: "#/components/schemas/MenuVersion" }] };
  const next = structuredClone(base);
  schemas(next).MenuVersion.properties.version.type = "string";
  assert.match(compareIosContracts(base, next).join("\n"), /meta.*unsupported structural/);
});

test("missing and external refs, unsupported version and empty scope fail explicitly", () => {
  for (const ref of ["#/components/schemas/Missing", "https://example.invalid/schema"]) {
    const next = structuredClone(baseline);
    next.paths[cardsPath].get.responses["200"].content["application/json"].schema = { $ref: ref };
    assert.throws(() => compareIosContracts(baseline, next), /reference/i);
  }
  assert.throws(() => compareIosContracts({ ...baseline, openapi: "3.0.0" }, baseline), /3.1.0/);
  assert.throws(() => compareIosContracts({ openapi: "3.1.0", paths: {} }, baseline), /no public iOS/);
});

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), "ios-contract-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => {
    const r = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  git("init", "--quiet", "-b", "target");
  git("config", "user.email", "fixture@example.invalid");
  git("config", "user.name", "Fixture");
  mkdirSync(path.join(root, "lib/api-spec"), { recursive: true });
  const write = (doc) => {
    mkdirSync(path.join(root, "lib/api-spec"), { recursive: true });
    writeFileSync(path.join(root, contractPath), stringify(doc));
  };
  write(baseline);
  git("add", ".");
  git("commit", "--quiet", "-m", "Baseline");
  const baseCommit = git("rev-parse", "HEAD");
  git("checkout", "--quiet", "-b", "proposed");
  return {
    root, git, write, baseCommit,
    check: (args = ["--base-ref", "target"]) => spawnSync(process.execPath, [checker, ...args], { cwd: root, encoding: "utf8", env: { ...process.env, GITHUB_OUTPUT: "" } }),
  };
}

test("CLI uses merge base, not target tip, and reads staged/unstaged proposed contract", (t) => {
  const repo = fixture(t);
  // Target diverges with a field an older iOS client does not yet know about.
  repo.git("checkout", "--quiet", "target");
  const target = structuredClone(baseline);
  schemas(target).PublicMenu.properties.newField = { type: "string" };
  repo.write(target);
  repo.git("add", ".");
  repo.git("commit", "--quiet", "-m", "Target progressed");
  repo.git("checkout", "--quiet", "proposed");
  writeFileSync(path.join(repo.root, "unrelated.txt"), "branch divergence");
  repo.git("add", ".");
  repo.git("commit", "--quiet", "-m", "Proposed work");
  const result = repo.check();
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes(repo.baseCommit));
  const next = structuredClone(baseline);
  delete schemas(next).PublicDrink.properties.name;
  repo.write(next);
  assert.equal(repo.check().status, 1);
  repo.git("add", ".");
  assert.equal(repo.check().status, 1);
});

test("CLI works when pnpm invokes it from the scripts package directory", (t) => {
  const repo = fixture(t);
  mkdirSync(path.join(repo.root, "scripts"));
  const result = spawnSync(process.execPath, [checker, "--base-ref", "target"], {
    cwd: path.join(repo.root, "scripts"), encoding: "utf8",
    env: { ...process.env, GITHUB_OUTPUT: "" },
  });
  assert.equal(result.status, 0, result.stderr);
});

test("CLI fails closed for missing refs, missing baseline blob, no explicit baseline, and malformed YAML", (t) => {
  const repo = fixture(t);
  assert.notEqual(repo.check(["--base-ref", "missing-target"]).status, 0);
  assert.notEqual(repo.check([]).status, 0);
  writeFileSync(path.join(repo.root, contractPath), "paths: [malformed");
  assert.notEqual(repo.check().status, 0);
  repo.git("checkout", "--", contractPath);
  repo.git("checkout", "--quiet", "target");
  repo.git("rm", contractPath);
  repo.git("commit", "--quiet", "-m", "Missing baseline");
  repo.git("checkout", "--quiet", "-b", "no-baseline");
  repo.write(baseline);
  assert.notEqual(repo.check().status, 0);
});

function approval(base, proposed, issues) {
  return {
    baseSha256: digest(base), proposedSha256: digest(proposed), issues,
    reason: "Explicitly approved release change",
    migrationPlan: "Client rollout and old version retirement agreed",
    apiOwner: "API reviewer", iosOwner: "iOS reviewer",
    approvalUrl: "https://example.invalid/review",
  };
}

test("approvals bind exact hashes, exact issues, rationale, reviewers and migration plan", () => {
  const record = approval("old", "new", ["GET menu: removed"]);
  checkApproval(record, "old", "new", record.issues);
  assert.throws(() => checkApproval(record, "changed", "new", record.issues), /stale/);
  assert.throws(() => checkApproval(record, "old", "changed", record.issues), /stale/);
  assert.throws(() => checkApproval(record, "old", "new", ["different"]), /exactly/);
  for (const key of ["reason", "migrationPlan", "apiOwner", "iosOwner", "approvalUrl"]) {
    assert.throws(() => checkApproval({ ...record, [key]: "" }, "old", "new", record.issues), /requires/);
  }
});

test("CLI recognizes only the exact exception; stale record cannot approve another change", (t) => {
  const repo = fixture(t);
  const base = readFileSync(path.join(repo.root, contractPath), "utf8");
  const next = structuredClone(baseline);
  delete schemas(next).PublicMenu.properties.logoUrl;
  repo.write(next);
  const proposed = readFileSync(path.join(repo.root, contractPath), "utf8");
  const record = approval(base, proposed, compareIosContracts(baseline, next));
  writeFileSync(path.join(repo.root, "lib/api-spec/ios-breaking-change-approval.json"), JSON.stringify(record));
  assert.equal(repo.check().status, 0);
  schemas(next).PublicDrink.properties.name.type = "integer";
  repo.write(next);
  const result = repo.check();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /stale/);
});

test("CI gate accepts compatible and approved paths but blocks missing, failed or cancelled approval", () => {
  const workflow = parse(readFileSync(new URL("../../.github/workflows/ios-contract.yml", import.meta.url), "utf8"));
  assert.deepEqual(workflow.permissions, { contents: "read" });
  const review = workflow.jobs["approve-breaking-change"];
  assert.equal(review.environment, "ios-contract-breaking-change");
  assert.equal(review.if, "needs.compatibility.outputs.requires_approval == 'true'");
  assert.deepEqual(workflow.jobs["ios-contract-gate"].needs, ["compatibility", "approve-breaking-change"]);
  const script = workflow.jobs["ios-contract-gate"].steps[0].run;
  for (const [check, needsReview, reviewResult, passes] of [
    ["success", "false", "skipped", true],
    ["success", "true", "success", true],
    ["success", "true", "skipped", false],
    ["success", "true", "failure", false],
    ["success", "true", "cancelled", false],
    ["failure", "false", "skipped", false],
    ["cancelled", "true", "success", false],
    ["success", "", "skipped", false],
  ]) {
    const result = spawnSync("bash", ["-e", "-c", script], {
      encoding: "utf8",
      env: { ...process.env, CHECK_RESULT: check, REQUIRES_APPROVAL: needsReview, APPROVAL_RESULT: reviewResult },
    });
    assert.equal(result.status === 0, passes, `${check}/${needsReview}/${reviewResult}`);
  }
  // Do not ask a PR token to inspect repository administration settings or
  // introduce a privileged credential into a PR-controlled workflow.
  assert.ok(!workflow.jobs.compatibility.steps.some((step) => step.run?.includes("gh api")));
});
