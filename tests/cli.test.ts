import { describe, expect, test } from "bun:test";
import pkg from "../package.json";
import { buildCopierArgs, parseScaffoldArgs, runMain, type CliIo } from "../src/cli/index.ts";

function createTestIo(opts?: { cwd?: string; copierExitCode?: number; copierError?: Error }): {
  io: CliIo;
  stdout: string[];
  stderr: string[];
  invocations: string[][];
} {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const invocations: string[][] = [];

  const io: CliIo = {
    cwd: opts?.cwd,
    stdout: (text) => {
      stdout.push(text);
    },
    stderr: (text) => {
      stderr.push(text);
    },
    runCopier: async (copierArgs) => {
      invocations.push([...copierArgs]);
      if (opts?.copierError !== undefined) {
        throw opts.copierError;
      }
      return opts?.copierExitCode ?? 0;
    },
  };

  return { io, stdout, stderr, invocations };
}

describe("parseScaffoldArgs", () => {
  test("handles empty args, help, and version flags across all subcommand levels", () => {
    expect(parseScaffoldArgs([])).toEqual({ kind: "help" });
    expect(parseScaffoldArgs(["-h"])).toEqual({ kind: "help" });
    expect(parseScaffoldArgs(["--help"])).toEqual({ kind: "help" });
    expect(parseScaffoldArgs(["new", "--help"])).toEqual({ kind: "help", command: "new" });
    expect(parseScaffoldArgs(["adopt", "-h"])).toEqual({ kind: "help", command: "adopt" });
    expect(parseScaffoldArgs(["sync", "-h"])).toEqual({ kind: "help", command: "sync" });
    expect(parseScaffoldArgs(["new", "base", "--help"])).toEqual({
      kind: "help",
      command: "new",
      stack: "base",
    });
    expect(parseScaffoldArgs(["new", "rust", "--help"])).toEqual({
      kind: "help",
      command: "new",
      stack: "rust",
    });
    expect(parseScaffoldArgs(["adopt", "uv", "-h"])).toEqual({
      kind: "help",
      command: "adopt",
      stack: "uv",
    });
    expect(parseScaffoldArgs(["adopt", "bun", "--help"])).toEqual({
      kind: "help",
      command: "adopt",
      stack: "bun",
    });
    expect(parseScaffoldArgs(["-V"])).toEqual({ kind: "version" });
    expect(parseScaffoldArgs(["--version"])).toEqual({ kind: "version" });
    expect(parseScaffoldArgs(["new", "rust", "--version"])).toEqual({ kind: "version" });
  });

  test("parses new rust with explicit options", () => {
    const parsed = parseScaffoldArgs([
      "new",
      "rust",
      "apps/demo-cli",
      "--name",
      "demo-cli",
      "--description=Demo CLI tool",
      "--kind=cli",
      "--visibility",
      "public",
      "--org",
      "taitide-labs",
      "--publish-registries",
      "--create-remote",
      "--template",
      "/tmp/local-template",
      "--defaults",
      "-n",
      "-q",
    ]);

    expect(parsed).toEqual({
      kind: "new",
      stack: "rust",
      dir: "apps/demo-cli",
      name: "demo-cli",
      description: "Demo CLI tool",
      rustKind: "cli",
      visibility: "public",
      org: "taitide-labs",
      publishRegistries: true,
      createRemote: true,
      template: "/tmp/local-template",
      defaults: true,
      dryRun: true,
      quiet: true,
    });
  });

  test("infers project_name from resolved dir basename when --defaults is set without --name", () => {
    const newParsed = parseScaffoldArgs(["new", "rust", "my-service", "--defaults"], "/tmp/work");
    expect(newParsed.kind).toBe("new");
    if (newParsed.kind === "new") {
      expect(newParsed.name).toBe("my-service");
    }

    const adoptParsed = parseScaffoldArgs(["adopt", "uv", "--defaults"], "/tmp/existing-repo");
    expect(adoptParsed.kind).toBe("adopt");
    if (adoptParsed.kind === "adopt") {
      expect(adoptParsed.stack).toBe("uv");
      expect(adoptParsed.dir).toBe(".");
      expect(adoptParsed.name).toBe("existing-repo");
    }
  });

  test("does not require valid basename when interactive (without --defaults or --name)", () => {
    const parsed = parseScaffoldArgs(["new", "base", "MyFolder"], "/tmp");
    expect(parsed.kind).toBe("new");
    if (parsed.kind === "new") {
      expect(parsed.name).toBeUndefined();
    }
  });

  test("rejects missing or invalid stack subcommand and leaky cross-stack flags", () => {
    expect(parseScaffoldArgs(["new"])).toEqual({
      kind: "error",
      message: "missing subcommand: expected base, rust, uv, or bun",
      helpCommand: "scaffold new",
    });
    expect(parseScaffoldArgs(["adopt"])).toEqual({
      kind: "error",
      message: "missing subcommand: expected base, rust, uv, or bun",
      helpCommand: "scaffold adopt",
    });
    expect(parseScaffoldArgs(["new", "go", "app"])).toEqual({
      kind: "error",
      message: "unknown subcommand: go",
      helpCommand: "scaffold new",
    });
    expect(parseScaffoldArgs(["adopt", "go", "app"])).toEqual({
      kind: "error",
      message: "unknown subcommand: go",
      helpCommand: "scaffold adopt",
    });

    expect(parseScaffoldArgs(["new", "base", "app", "--kind", "cli"])).toEqual({
      kind: "error",
      message: "unknown option: --kind",
      helpCommand: "scaffold new base",
    });
    expect(parseScaffoldArgs(["new", "base", "app", "--publish-registries"])).toEqual({
      kind: "error",
      message: "unknown option: --publish-registries",
      helpCommand: "scaffold new base",
    });
    expect(parseScaffoldArgs(["new", "uv", "app", "--kind", "cli"])).toEqual({
      kind: "error",
      message: "unknown option: --kind",
      helpCommand: "scaffold new uv",
    });
    expect(parseScaffoldArgs(["new", "bun", "app", "--kind", "workspace"])).toEqual({
      kind: "error",
      message: "unknown option: --kind",
      helpCommand: "scaffold new bun",
    });
    expect(parseScaffoldArgs(["new", "rust", "app", "--stack", "uv"])).toEqual({
      kind: "error",
      message: "unknown option: --stack",
      helpCommand: "scaffold new rust",
    });
    expect(parseScaffoldArgs(["new", "rust", "app", "--rust-kind", "cli"])).toEqual({
      kind: "error",
      message: "unknown option: --rust-kind",
      helpCommand: "scaffold new rust",
    });
    expect(parseScaffoldArgs(["new", "rust", "app", "--publish-registries"])).toEqual({
      kind: "error",
      message: "--publish-registries requires --kind cli for rust",
      helpCommand: "scaffold new rust",
    });
    expect(
      parseScaffoldArgs(["new", "rust", "app", "--kind", "workspace", "--publish-registries"]).kind,
    ).toBe("error");
    expect(
      parseScaffoldArgs(["new", "uv", "app", "--visibility", "private", "--publish-registries"])
        .kind,
    ).toBe("error");
  });

  test("rejects invalid project_name, inferred basename, and invalid command syntax", () => {
    expect(parseScaffoldArgs(["new", "base", "my-app", "--name", "BadName"]).kind).toBe("error");
    expect(parseScaffoldArgs(["new", "base", "my-app", "--name", "1abc"]).kind).toBe("error");
    expect(parseScaffoldArgs(["new", "base", "my-app", "--name", "bad_name"]).kind).toBe("error");
    expect(parseScaffoldArgs(["new", "base", "BadDir", "--defaults"], "/tmp").kind).toBe("error");
    expect(parseScaffoldArgs(["adopt", "base", "--defaults"], "/tmp/BadDir").kind).toBe("error");
    expect(parseScaffoldArgs(["new", "rust", "my-app", "--kind", "lib"]).kind).toBe("error");
    expect(parseScaffoldArgs(["new", "base", "my-app", "--visibility", "internal"]).kind).toBe(
      "error",
    );
    expect(parseScaffoldArgs(["adopt", "rust", ".", "--create-remote"]).kind).toBe("error");
    expect(parseScaffoldArgs(["sync", ".", "--name", "demo"]).kind).toBe("error");
    expect(parseScaffoldArgs(["new", "base"]).kind).toBe("error");
    expect(parseScaffoldArgs(["unknown-cmd"]).kind).toBe("error");
    expect(parseScaffoldArgs(["--unknown-flag"]).kind).toBe("error");
    expect(parseScaffoldArgs(["new", "base", "a", "b"]).kind).toBe("error");
    expect(parseScaffoldArgs(["new", "base", "a", "--name"]).kind).toBe("error");
  });

  test("parses sync and adopt defaults cleanly", () => {
    expect(parseScaffoldArgs(["sync"])).toEqual({
      kind: "sync",
      dir: ".",
      defaults: false,
      dryRun: false,
      quiet: false,
    });
    expect(parseScaffoldArgs(["sync", "repo-dir", "--defaults", "--dry-run", "--quiet"])).toEqual({
      kind: "sync",
      dir: "repo-dir",
      defaults: true,
      dryRun: true,
      quiet: true,
    });
    expect(parseScaffoldArgs(["adopt", "base"])).toEqual({
      kind: "adopt",
      stack: "base",
      dir: ".",
      name: undefined,
      description: undefined,
      rustKind: undefined,
      visibility: undefined,
      org: undefined,
      publishRegistries: false,
      template: "gh:taitide-labs/scaffold",
      defaults: false,
      dryRun: false,
      quiet: false,
    });
  });
});

describe("buildCopierArgs", () => {
  test("builds copier copy args for new rust shopkit --create-remote --defaults", () => {
    const parsed = parseScaffoldArgs(
      ["new", "rust", "shopkit", "--create-remote", "--defaults"],
      "/tmp/work",
    );
    expect(parsed.kind).toBe("new");
    if (parsed.kind !== "new") {
      return;
    }

    expect(buildCopierArgs(parsed)).toEqual([
      "copy",
      "--trust",
      "--defaults",
      "-d",
      "project_name=shopkit",
      "-d",
      "stack=rust",
      "-d",
      "create_remote_repo=true",
      "gh:taitide-labs/scaffold",
      "shopkit",
    ]);
  });

  test("builds copier copy args for new rust kitcode --kind cli --publish-registries", () => {
    const parsed = parseScaffoldArgs([
      "new",
      "rust",
      "kitcode",
      "--kind",
      "cli",
      "--publish-registries",
    ]);
    expect(parsed.kind).toBe("new");
    if (parsed.kind !== "new") {
      return;
    }

    expect(buildCopierArgs(parsed)).toEqual([
      "copy",
      "--trust",
      "-d",
      "stack=rust",
      "-d",
      "rust_kind=cli",
      "-d",
      "publish_registries=true",
      "gh:taitide-labs/scaffold",
      "kitcode",
    ]);
  });

  test("builds copier copy args for adopt uv . --defaults", () => {
    const parsed = parseScaffoldArgs(["adopt", "uv", ".", "--defaults"], "/tmp/py-service");
    expect(parsed.kind).toBe("adopt");
    if (parsed.kind !== "adopt") {
      return;
    }

    expect(buildCopierArgs(parsed)).toEqual([
      "copy",
      "--trust",
      "--skip-tasks",
      "--overwrite",
      "--defaults",
      "-d",
      "project_name=py-service",
      "-d",
      "stack=uv",
      "gh:taitide-labs/scaffold",
      ".",
    ]);
  });

  test("builds copier update args for sync", () => {
    const parsed = parseScaffoldArgs(["sync"]);
    expect(parsed.kind).toBe("sync");
    if (parsed.kind !== "sync") {
      return;
    }

    expect(buildCopierArgs(parsed)).toEqual(["update", "--trust", "."]);
  });
});

describe("runMain", () => {
  test("prints version and scoped help to stdout with exit 0", async () => {
    const v = createTestIo();
    expect(await runMain(["--version"], v.io)).toBe(0);
    expect(v.stdout.join("")).toBe(`scaffold ${pkg.version}\n`);
    expect(v.stderr).toEqual([]);

    const rootHelp = createTestIo();
    expect(await runMain(["--help"], rootHelp.io)).toBe(0);
    expect(rootHelp.stdout.join("")).toContain("Commands:");
    expect(rootHelp.stderr).toEqual([]);

    for (const sub of ["new", "adopt"] as const) {
      const subHelp = createTestIo();
      expect(await runMain([sub, "--help"], subHelp.io)).toBe(0);
      expect(subHelp.stdout.join("")).toContain("Subcommands:");
      expect(subHelp.stdout.join("")).toContain("base");
      expect(subHelp.stdout.join("")).toContain("rust");
      expect(subHelp.stderr).toEqual([]);
    }

    const syncHelp = createTestIo();
    expect(await runMain(["sync", "--help"], syncHelp.io)).toBe(0);
    expect(syncHelp.stdout.join("")).toContain("scaffold sync");
    expect(syncHelp.stderr).toEqual([]);

    const baseHelp = createTestIo();
    expect(await runMain(["new", "base", "--help"], baseHelp.io)).toBe(0);
    expect(baseHelp.stdout.join("")).toContain("scaffold new base");
    expect(baseHelp.stdout.join("")).toContain("--create-remote");
    expect(baseHelp.stdout.join("")).not.toContain("--kind");
    expect(baseHelp.stdout.join("")).not.toContain("--publish-registries");

    const uvNewHelp = createTestIo();
    expect(await runMain(["new", "uv", "--help"], uvNewHelp.io)).toBe(0);
    expect(uvNewHelp.stdout.join("")).toContain("--publish-registries");
    expect(uvNewHelp.stdout.join("")).toContain("--create-remote");
    expect(uvNewHelp.stdout.join("")).not.toContain("--kind");

    const adoptBunHelp = createTestIo();
    expect(await runMain(["adopt", "bun", "--help"], adoptBunHelp.io)).toBe(0);
    expect(adoptBunHelp.stdout.join("")).toContain("--publish-registries");
    expect(adoptBunHelp.stdout.join("")).not.toContain("--kind");
    expect(adoptBunHelp.stdout.join("")).not.toContain("--create-remote");

    const rustHelp = createTestIo();
    expect(await runMain(["new", "rust", "--help"], rustHelp.io)).toBe(0);
    expect(rustHelp.stdout.join("")).toContain("--kind");
    expect(rustHelp.stdout.join("")).toContain("--publish-registries");
    expect(rustHelp.stdout.join("")).toContain("--create-remote");
  });

  test("returns exit 2 with scoped help hint on invalid usage", async () => {
    const cases: Array<{ args: string[]; expectedHint: string }> = [
      { args: ["new"], expectedHint: "Run 'scaffold new --help' for usage." },
      {
        args: ["new", "base", "app", "--kind", "cli"],
        expectedHint: "Run 'scaffold new base --help' for usage.",
      },
      {
        args: ["new", "base", "app", "--publish-registries"],
        expectedHint: "Run 'scaffold new base --help' for usage.",
      },
      {
        args: ["new", "uv", "app", "--kind", "cli"],
        expectedHint: "Run 'scaffold new uv --help' for usage.",
      },
      {
        args: ["new", "rust", "app", "--publish-registries"],
        expectedHint: "Run 'scaffold new rust --help' for usage.",
      },
      { args: ["unknown-cmd"], expectedHint: "Run 'scaffold --help' for usage." },
    ];

    for (const c of cases) {
      const res = createTestIo();
      expect(await runMain(c.args, res.io)).toBe(2);
      expect(res.stdout).toEqual([]);
      expect(res.stderr.join("")).toContain("error:");
      expect(res.stderr.join("")).toContain(c.expectedHint);
      expect(res.invocations).toEqual([]);
    }
  });

  test("dispatches valid command to copier and propagates exit status", async () => {
    const ok = createTestIo({ cwd: "/tmp/demo-app" });
    expect(await runMain(["new", "base", ".", "--defaults"], ok.io)).toBe(0);
    expect(ok.invocations).toEqual([
      [
        "copy",
        "--trust",
        "--defaults",
        "-d",
        "project_name=demo-app",
        "-d",
        "stack=base",
        "gh:taitide-labs/scaffold",
        ".",
      ],
    ]);

    const fail = createTestIo({ copierExitCode: 1 });
    expect(await runMain(["sync"], fail.io)).toBe(1);

    const crashed = createTestIo({ copierError: new Error("uvx not found") });
    expect(await runMain(["sync"], crashed.io)).toBe(1);
    expect(crashed.stderr.join("")).toContain("error: uvx not found");
  });
});
