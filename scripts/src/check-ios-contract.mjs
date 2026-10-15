import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parse } from "yaml";
import { compareIosContracts } from "./ios-contract.mjs";

export const contractPath = "lib/api-spec/openapi.yaml";
const approvalPath = "lib/api-spec/ios-breaking-change-approval.json";
export const digest = (text) => createHash("sha256").update(text).digest("hex");

function git(cwd, ...args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args[0]} failed: ${result.stderr.trim()}`);
  return result.stdout.trimEnd();
}

export function checkApproval(approval, baseText, proposedText, issues) {
  if (approval.baseSha256 !== digest(baseText) || approval.proposedSha256 !== digest(proposedText)) {
    throw new Error("Approval is stale: both exact contract hashes must match");
  }
  if (!Array.isArray(approval.issues) || JSON.stringify([...approval.issues].sort()) !== JSON.stringify(issues)) {
    throw new Error("Approval must list exactly the reported incompatibilities");
  }
  for (const key of ["reason", "migrationPlan", "apiOwner", "iosOwner", "approvalUrl"]) {
    if (typeof approval[key] !== "string" || !approval[key].trim()) throw new Error(`Approval requires ${key}`);
  }
  if (!/^https:\/\//.test(approval.approvalUrl)) throw new Error("approvalUrl must be an HTTPS review link");
}

export function run({ cwd = process.cwd(), baseRef }) {
  if (!baseRef) throw new Error("Specify --base-ref <target branch or commit>; no guessed baseline is allowed");
  cwd = git(cwd, "rev-parse", "--show-toplevel");
  const mergeBase = git(cwd, "merge-base", "HEAD", baseRef);
  // Read exact git blob bytes, not a working-tree file or the target branch tip.
  const result = spawnSync("git", ["show", `${mergeBase}:${contractPath}`], { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`Cannot read baseline contract at ${mergeBase}: ${result.stderr.trim()}`);
  const baseText = result.stdout;
  const proposedText = readFileSync(`${cwd}/${contractPath}`, "utf8");
  const issues = compareIosContracts(parse(baseText), parse(proposedText));
  console.log(`iOS contract baseline: ${mergeBase}`);
  if (!issues.length) {
    console.log("Public iOS contract is backward compatible.");
    return { requiresApproval: false };
  }
  console.error(issues.map((issue) => `- ${issue}`).join("\n"));
  console.error(`baseSha256: ${digest(baseText)}\nproposedSha256: ${digest(proposedText)}`);
  let approval;
  try { approval = JSON.parse(readFileSync(`${cwd}/${approvalPath}`, "utf8")); }
  catch (error) {
    if (error.code === "ENOENT") throw new Error(`Breaking iOS contract changes require ${approvalPath}; see README.md`);
    throw error;
  }
  checkApproval(approval, baseText, proposedText, issues);
  console.log("Exact breaking-change record found. CI still requires protected-environment approval.");
  return { requiresApproval: true };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 2 || args[0] !== "--base-ref") throw new Error("Usage: check-ios-contract.mjs --base-ref <ref>");
    const { requiresApproval } = run({ baseRef: args[1] });
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `requires_approval=${requiresApproval}\n`);
  } catch (error) {
    console.error(`iOS contract check failed: ${error.message}`);
    process.exitCode = 1;
  }
}
