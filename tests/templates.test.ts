import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

interface MatrixCase {
  id: string;
  projectName: string;
  stack: "rust" | "uv" | "bun" | "base";
  visibility: "public" | "private";
  publishRegistries: boolean;
}

const MATRIX: readonly MatrixCase[] = [
  {
    id: "rust-pub",
    projectName: "demo-rust-ws",
    stack: "rust",
    visibility: "public",
    publishRegistries: false,
  },
  {
    id: "rust-priv",
    projectName: "demo-rust-priv",
    stack: "rust",
    visibility: "private",
    publishRegistries: false,
  },
  {
    id: "uv-pub",
    projectName: "demo-uv-app",
    stack: "uv",
    visibility: "public",
    publishRegistries: true,
  },
  {
    id: "bun-pub",
    projectName: "demo-bun-app",
    stack: "bun",
    visibility: "public",
    publishRegistries: true,
  },
  {
    id: "base-priv",
    projectName: "demo-base",
    stack: "base",
    visibility: "private",
    publishRegistries: false,
  },
];

const REPO_ROOT = path.resolve(import.meta.dir, "..");
const TEMPLATE_TOKENS = ["[%", "%]", "[[", "]]", "_copier_"] as const;

function collectFiles(rootDir: string): string[] {
  const results: string[] = [];
  const entries = readdirSync(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === ".git") {
      continue;
    }
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFiles(fullPath));
    } else if (entry.isFile()) {
      results.push(fullPath);
    }
  }
  return results;
}

const GIT_HOOK_VARS = new Set([
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_COMMON_DIR",
  "GIT_PREFIX",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
]);

function runSync(cmd: string[], cwd: string): { status: number; stdout: string; stderr: string } {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !GIT_HOOK_VARS.has(key)),
  );
  const proc = Bun.spawnSync(cmd, {
    cwd,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    status: proc.exitCode,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  };
}

function findSlashComment(content: string): boolean {
  for (const line of content.split(/\r?\n/)) {
    const withoutUrls = line.replace(/https?:\/\/\S+/g, "");
    if (/(?:^|\s)\/\//.test(withoutUrls)) {
      return true;
    }
  }
  return false;
}

function findPythonHashComment(content: string): boolean {
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const trimmed = line.trimStart();
    if (i === 0 && trimmed.startsWith("#!/usr/bin/env")) {
      continue;
    }
    if (trimmed.startsWith("#")) {
      return true;
    }
  }
  return false;
}

describe("template matrix rendering", () => {
  for (const variant of MATRIX) {
    test(`renders and validates ${variant.id}`, () => {
      const tempDir = mkdtempSync(path.join(os.tmpdir(), `scaffold-${variant.id}-`));
      try {
        const copierArgs = [
          "uvx",
          "copier",
          "copy",
          "--skip-tasks",
          "--defaults",
          "--trust",
          "--quiet",
        ];
        if (existsSync(path.join(REPO_ROOT, ".git"))) {
          copierArgs.push("--vcs-ref=HEAD");
        }
        copierArgs.push(
          "-d",
          `project_name=${variant.projectName}`,
          "-d",
          `description=Integration test project for ${variant.id}.`,
          "-d",
          `stack=${variant.stack}`,
          "-d",
          `visibility=${variant.visibility}`,
        );
        if (variant.publishRegistries) {
          copierArgs.push("-d", "publish_registries=true");
        }
        copierArgs.push(REPO_ROOT, tempDir);

        const copyResult = runSync(copierArgs, REPO_ROOT);
        expect(copyResult.status, copyResult.stderr).toBe(0);

        const files = collectFiles(tempDir);
        expect(files.length).toBeGreaterThan(0);

        for (const filePath of files) {
          const content = readFileSync(filePath, "utf8");
          for (const token of TEMPLATE_TOKENS) {
            expect(content.includes(token), `${filePath} contained ${token}`).toBe(false);
          }

          if (filePath.endsWith(".rs") || filePath.endsWith(".ts") || filePath.endsWith(".js")) {
            expect(findSlashComment(content), `${filePath} contained slash comment`).toBe(false);
          }
          if (filePath.endsWith(".py")) {
            expect(findPythonHashComment(content), `${filePath} contained hash comment`).toBe(
              false,
            );
          }
        }

        const answersPath = path.join(tempDir, ".copier-answers.yml");
        expect(existsSync(answersPath)).toBe(true);
        const answers = readFileSync(answersPath, "utf8");
        expect(answers).toContain("_src_path:");
        expect(answers).not.toContain("create_remote_repo");
        expect(answers).not.toContain("package_module");
        expect(answers).not.toContain("rust_kind");
        expect(answers).not.toContain("# Changes here");

        const isPublic = variant.visibility === "public";
        expect(existsSync(path.join(tempDir, ".github/ruleset.json"))).toBe(isPublic);
        expect(existsSync(path.join(tempDir, ".github/workflows/close-fork-prs.yml"))).toBe(
          isPublic,
        );
        expect(existsSync(path.join(tempDir, ".github/workflows/pr-policy.yml"))).toBe(false);
        expect(existsSync(path.join(tempDir, ".github/ISSUE_TEMPLATE/bug_report.yml"))).toBe(
          isPublic,
        );

        const securityYml = readFileSync(
          path.join(tempDir, ".github/workflows/security.yml"),
          "utf8",
        );
        const renovateJson = readFileSync(path.join(tempDir, ".github/renovate.json"), "utf8");
        const parsedRenovate = JSON.parse(renovateJson) as {
          copier?: { enabled: boolean };
          platformAutomerge?: boolean;
        };
        expect(parsedRenovate.copier).toEqual({ enabled: false });
        if (isPublic) {
          expect(renovateJson).not.toContain('"platformAutomerge": false');
        } else {
          expect(securityYml).not.toContain("codeql");
          expect(securityYml).toContain("advanced-security: false");
          expect(renovateJson).toContain('"platformAutomerge": false');
        }

        const ciYml = readFileSync(path.join(tempDir, ".github/workflows/ci.yml"), "utf8");
        expect(ciYml).toMatch(/predicate-quantifier:\s*['"]some-with-excludes['"]/);
        expect(ciYml).toContain("group: ci-${{ github.head_ref || github.ref }}");
        expect(ciYml).toContain("runs-on: ubuntu-24.04");
        expect(ciYml).not.toContain("ubuntu-latest");
        expect(ciYml).toContain("!startsWith(github.head_ref, 'release-please--')");
        expect(ciYml).not.toContain("install_args: --locked");
        expect(ciYml).toContain("hk check --all -q -n -p docs");
        if (isPublic) {
          expect(ciYml).toContain("merge_group:");
          expect(ciYml).not.toContain("\n  push:\n");
        } else {
          expect(ciYml).toContain("\n  push:\n");
          expect(ciYml).not.toContain("merge_group:");
        }
        if (variant.stack !== "base") {
          expect(ciYml).toContain("hk check --all -q -n -p code");
          expect(ciYml).toContain("mise run audit");
        } else {
          expect(ciYml).not.toContain("mise run audit");
        }

        const releaseYml = readFileSync(
          path.join(tempDir, ".github/workflows/release.yml"),
          "utf8",
        );
        expect(releaseYml).not.toContain("ubuntu-latest");
        expect(securityYml).not.toContain("ubuntu-latest");

        const hkPkl = readFileSync(path.join(tempDir, ".config/hk.pkl"), "utf8");
        expect(hkPkl).toContain('profiles = List("docs", "code")');
        expect(hkPkl).toContain('"!fmt"');
        expect(hkPkl).not.toContain('["pre-push"]');

        const agentsMd = readFileSync(path.join(tempDir, "AGENTS.md"), "utf8");
        expect(agentsMd).toContain("[CONTRIBUTING.md](CONTRIBUTING.md)");
        expect(agentsMd).toContain("[development_rules.md](docs/development_rules.md)");

        const contributingMd = readFileSync(path.join(tempDir, "CONTRIBUTING.md"), "utf8");
        expect(contributingMd).toContain("## Commit 与版本规范");
        expect(contributingMd).not.toContain("Feature Flag");
        expect(contributingMd).not.toContain("pre-push");

        const devRulesMd = readFileSync(path.join(tempDir, "docs/development_rules.md"), "utf8");
        expect(devRulesMd).toContain("context-map.md");
        expect(devRulesMd).toContain("mise tasks");
        if (variant.stack === "rust") {
          expect(devRulesMd).toContain("`rules/`");
        } else {
          expect(devRulesMd).not.toContain("`rules/`");
        }
        if (isPublic) {
          expect(devRulesMd).toContain("gh pr merge --auto --delete-branch");
        } else {
          expect(devRulesMd).not.toContain("gh pr merge --auto");
        }

        const miseToml = readFileSync(path.join(tempDir, "mise.toml"), "utf8");
        expect(miseToml).toContain('zizmor = "1.32.0"');
        expect(miseToml).toContain('run = "hk fix --all -q -n -p docs -p code -p fmt"');
        expect(miseToml).toContain('run = "hk check --all -q -n"');
        expect(miseToml).not.toContain("sccache");
        expect(miseToml.indexOf("[tasks.fmt]")).toBeLessThan(miseToml.indexOf("[tasks.check]"));
        if (variant.stack !== "base") {
          expect(miseToml.indexOf("[tasks.check]")).toBeLessThan(miseToml.indexOf("[tasks.audit]"));
        }
        if (variant.stack === "rust") {
          expect(miseToml).toContain("[tasks.audit]");
          expect(miseToml).toContain('run = "cargo deny check"');
          expect(miseToml).toContain('version_prefix = "cargo-nextest-"');
          expect(existsSync(path.join(tempDir, ".cargo/mutants.toml"))).toBe(true);
          expect(existsSync(path.join(tempDir, "backend/runtime/Cargo.toml"))).toBe(true);
          expect(existsSync(path.join(tempDir, "crates"))).toBe(false);
          expect(existsSync(path.join(tempDir, "rules/base/no-inline-tests.yml"))).toBe(true);
          expect(existsSync(path.join(tempDir, "rules/base/no-line-comments.yml"))).toBe(true);
          expect(existsSync(path.join(tempDir, "rules/backend/no-cross-slice-imports.yml"))).toBe(
            true,
          );
          expect(
            existsSync(path.join(tempDir, "rules/backend/no-http-in-infra-and-runtime.yml")),
          ).toBe(true);
          expect(
            existsSync(path.join(tempDir, "rules/clients/no-client-import-backend-internals.yml")),
          ).toBe(true);
          expect(existsSync(path.join(tempDir, "rules/clients/no-io-in-cli-pure-files.yml"))).toBe(
            true,
          );
          expect(existsSync(path.join(tempDir, ".github/codeql/codeql-config.yml"))).toBe(isPublic);

          const denyToml = readFileSync(path.join(tempDir, "deny.toml"), "utf8");
          expect(denyToml).toContain('multiple-versions = "allow"');

          const clippyToml = readFileSync(path.join(tempDir, "clippy.toml"), "utf8");
          expect(clippyToml).toContain("std::time::SystemTime::now");
          expect(clippyToml).not.toContain('"f32"');

          const cargoToml = readFileSync(path.join(tempDir, "Cargo.toml"), "utf8");
          expect(cargoToml).toContain('debug = "line-tables-only"');
          expect(cargoToml).toContain('[profile.dev.package."*"]');
          expect(cargoToml).toContain("debug = false");

          const crossSliceRule = readFileSync(
            path.join(tempDir, "rules/backend/no-cross-slice-imports.yml"),
            "utf8",
          );
          expect(crossSliceRule).toContain("backend/contexts/*/features/src/**/*.rs");
          expect(crossSliceRule).not.toContain("evt_");

          const clientBackendRule = readFileSync(
            path.join(tempDir, "rules/clients/no-client-import-backend-internals.yml"),
            "utf8",
          );
          expect(clientBackendRule).toContain(variant.projectName.replaceAll("-", "_"));

          expect(releaseYml).toContain("cache-targets: false");
          if (isPublic) {
            expect(securityYml).toContain("config-file: ./.github/codeql/codeql-config.yml");
            expect(securityYml).toContain("cargo build --workspace --locked");
            expect(releaseYml).toContain("ubuntu-24.04-arm");
          } else {
            expect(releaseYml).not.toContain("ubuntu-24.04-arm");
          }

          const releaseConfig = readFileSync(
            path.join(tempDir, "release-please-config.json"),
            "utf8",
          );
          expect(releaseConfig).toContain('"release-type": "simple"');
          expect(releaseConfig).toContain(`${variant.projectName}-runtime`);
        } else if (variant.stack === "uv") {
          expect(miseToml).toContain("[tasks.audit]");
          expect(miseToml).toContain("osv-scanner");
        } else if (variant.stack === "bun") {
          expect(miseToml).toContain("[tasks.audit]");
          expect(miseToml).toContain("bun audit");
        } else {
          expect(miseToml).not.toContain("[tasks.audit]");
        }

        const gitInit = runSync(["git", "init", "-q", "-b", "main"], tempDir);
        expect(gitInit.status, gitInit.stderr).toBe(0);
        const gitAdd = runSync(["git", "add", "-A"], tempDir);
        expect(gitAdd.status, gitAdd.stderr).toBe(0);

        const hkValidate = runSync(["hk", "validate"], tempDir);
        expect(hkValidate.status, hkValidate.stderr).toBe(0);

        const hkDocsCheck = runSync(["hk", "check", "--all", "-q", "-n", "-p", "docs"], tempDir);
        expect(hkDocsCheck.status, `${hkDocsCheck.stdout}\n${hkDocsCheck.stderr}`).toBe(0);

        const hkCodeArgs = ["hk", "check", "--all", "-q", "-n", "--step", "zizmor"];
        if (variant.stack === "bun") {
          hkCodeArgs.push("--step", "oxfmt", "--step", "oxlint");
        }

        const hkCheck = runSync(hkCodeArgs, tempDir);
        expect(hkCheck.status, `${hkCheck.stdout}\n${hkCheck.stderr}`).toBe(0);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    }, 30_000);
  }
});
