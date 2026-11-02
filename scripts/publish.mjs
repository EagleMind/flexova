#!/usr/bin/env node
// Publish every workspace package whose current version is not on npm yet. Run by the release workflow
// after the Changesets "Version packages" pull request merges.
//
// `pnpm pack` turns workspace:* dependencies into real versions; `npm publish` then uploads the tarball
// with npm trusted publishing (OIDC, no stored token) and a provenance attestation. Prints
// "New tag: <name>@<version>" lines, which changesets/action reads to report what was published.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const out = join(root, "build", "pack");
const dryRun = process.argv.includes("--dry-run");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

function published(name, version) {
  const r = spawnSync("npm", ["view", `${name}@${version}`, "version"], { encoding: "utf8" });
  if (r.status === 0) return r.stdout.trim() === version;
  if (/E404|404 Not Found/.test(r.stderr)) return false;
  throw new Error(`npm view ${name}@${version} failed: ${r.stderr.trim()}`);
}

let failures = 0;
for (const dir of readdirSync(join(root, "packages"))) {
  const pkgDir = join(root, "packages", dir);
  const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
  if (pkg.private || pkg.version === "0.0.0") continue;
  if (published(pkg.name, pkg.version)) {
    console.log(`skip ${pkg.name}@${pkg.version} (already on npm)`);
    continue;
  }
  const tarball = execFileSync("pnpm", ["pack", "--pack-destination", out], {
    cwd: pkgDir,
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .pop();
  const args = ["publish", tarball, "--access", "public", ...(dryRun ? ["--dry-run"] : [])];
  const r = spawnSync("npm", args, { stdio: "inherit" });
  if (r.status !== 0) {
    failures++;
    continue;
  }
  if (!dryRun) {
    execFileSync("git", ["tag", `${pkg.name}@${pkg.version}`], { cwd: root });
    console.log(`New tag: ${pkg.name}@${pkg.version}`);
  }
}
process.exit(failures ? 1 : 0);
