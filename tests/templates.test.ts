import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

interface MatrixCase {
  id: string;
  projectName: string;
  stack: "rust" | "uv" | "bun" | "base";
  rustKind?: "workspace" | "cli";
  visibility: "public" | "private";
  publishRegistries: boolean;
}

const MATRIX: readonly MatrixCase[] = [
  {
    id: "rust-ws-pub",
    projectName: "demo-rust-ws",
    stack: "rust",
    rustKind: "workspace",
    visibility: "public",
    publishRegistries: false,
  },
  {
    id: "rust-cli-pub",
    projectName: "demo-rust-cli",
    stack: "rust",
    rustKind: "cli",
    visibility: "public",
    publishRegistries: true,
  },
  {
    id: "rust-ws-priv",
    projectName: "demo-rust-priv",
    stack: "rust",
    rustKind: "workspace",
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
        if (variant.rustKind !== undefined) {
          copierArgs.push("-d", `rust_kind=${variant.rustKind}`);
        }
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
        expect(answers).not.toContain("# Changes here");

        const isPublic = variant.visibility === "public";
        expect(existsSync(path.join(tempDir, ".github/ruleset.json"))).toBe(isPublic);
        expect(existsSync(path.join(tempDir, ".github/workflows/pr-policy.yml"))).toBe(isPublic);
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

        const miseToml = readFileSync(path.join(tempDir, "mise.toml"), "utf8");
        expect(miseToml).toContain('zizmor = "1"');
        if (variant.stack === "rust") {
          expect(miseToml).toContain("cargo deny check");
          const releaseConfig = JSON.parse(
            readFileSync(path.join(tempDir, "release-please-config.json"), "utf8"),
          ) as { "release-type": string };
          expect(releaseConfig["release-type"]).toBe(
            variant.rustKind === "workspace" ? "simple" : "rust",
          );
        } else if (variant.stack === "uv") {
          expect(miseToml).toContain("osv-scanner");
        } else if (variant.stack === "bun") {
          expect(miseToml).toContain("bun audit");
        }

        const gitInit = runSync(["git", "init", "-q", "-b", "main"], tempDir);
        expect(gitInit.status, gitInit.stderr).toBe(0);
        const gitAdd = runSync(["git", "add", "-A"], tempDir);
        expect(gitAdd.status, gitAdd.stderr).toBe(0);

        const hkValidate = runSync(["hk", "validate"], tempDir);
        expect(hkValidate.status, hkValidate.stderr).toBe(0);

        const hkArgs = [
          "hk",
          "check",
          "--all",
          "--silent",
          "-n",
          "--step",
          "autocorrect",
          "--step",
          "rumdl",
          "--step",
          "mmdr",
          "--step",
          "lychee",
          "--step",
          "typos",
          "--step",
          "zizmor",
        ];
        if (variant.stack === "bun") {
          hkArgs.push("--step", "oxfmt", "--step", "oxlint");
        }

        const hkCheck = runSync(hkArgs, tempDir);
        expect(hkCheck.status, `${hkCheck.stdout}\n${hkCheck.stderr}`).toBe(0);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    }, 30_000);
  }
});
