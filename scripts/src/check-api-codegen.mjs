import { spawnSync } from "node:child_process";

const generatedPaths = [
  "lib/api-zod/src/generated",
  "lib/api-client-react/src/generated",
];

function run(command, args, cwd, capture = false) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: capture ? "pipe" : "inherit",
  });
  if (result.error) throw result.error;
  if (result.status === null) {
    throw new Error(`${command} terminated by ${result.signal}`);
  }
  return result;
}

try {
  const rootResult = run("git", ["rev-parse", "--show-toplevel"], process.cwd(), true);
  if (rootResult.status !== 0) throw new Error(rootResult.stderr);
  const root = rootResult.stdout.trim();

  const generation = run(
    "pnpm",
    ["--filter", "@workspace/api-spec", "run", "codegen"],
    root,
  );
  if (generation.status !== 0) {
    throw new Error("API code generation failed; freshness could not be checked.");
  }

  // HEAD includes staged changes too; an index-only diff would miss those.
  const diff = run(
    "git",
    ["diff", "--exit-code", "HEAD", "--", ...generatedPaths],
    root,
  );
  if (diff.status > 1) throw new Error("Could not compare generated API files.");

  // git diff does not report new files. Include ignored files as well so no
  // generated output can silently escape the check through an ignore rule.
  const untracked = run(
    "git",
    ["ls-files", "--others", "--", ...generatedPaths],
    root,
    true,
  );
  if (untracked.status !== 0) throw new Error(untracked.stderr);

  if (diff.status !== 0 || untracked.stdout.length > 0) {
    if (untracked.stdout) {
      console.error(`Uncommitted generated files:\n${untracked.stdout}`);
    }
    throw new Error(
      "Generated API files are out of date. Run " +
        "`pnpm --filter @workspace/api-spec run codegen` and commit both " +
        "lib/api-zod/src/generated and lib/api-client-react/src/generated.",
    );
  }
  console.info("Generated API files match the committed output.");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
