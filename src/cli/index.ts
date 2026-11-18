import pkg from "../../package.json";
import { parseScaffoldArgs, type Stack, type Subcommand } from "./args.ts";
import { buildCopierArgs, runCopier } from "./copier.ts";

export { parseScaffoldArgs } from "./args.ts";
export { buildCopierArgs, runCopier } from "./copier.ts";
export type {
  AdoptCommand,
  CopierCommand,
  NewCommand,
  ParsedCommand,
  RustKind,
  SharedFlags,
  Stack,
  Subcommand,
  SyncCommand,
  Visibility,
} from "./args.ts";

export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  runCopier: (copierArgs: readonly string[]) => Promise<number>;
  cwd?: string;
}

const defaultIo: CliIo = {
  stdout: (text) => {
    process.stdout.write(text);
  },
  stderr: (text) => {
    process.stderr.write(text);
  },
  runCopier,
};

const ROOT_HELP = `scaffold ${pkg.version}

Unified Copier project scaffold and governance sync CLI for Taitide.

Usage:
  scaffold <command> [options]

Commands:
  new <stack> <dir> [options]      Create a new project from the scaffold template
  adopt <stack> [dir] [options]    Adopt scaffold governance files into an existing repository
  sync [dir] [options]             Update an existing project from its scaffold template

Options:
  -h, --help                       Print help
  -V, --version                    Print version
`;

const SYNC_HELP = `Usage:
  scaffold sync [dir] [options]

Arguments:
  dir                      Target directory (default: .)

Options:
  --defaults               Use default answers for template updates
  -n, --dry-run            Run without writing files
  -q, --quiet              Suppress non-error output
  -h, --help               Print help
  -V, --version            Print version
`;

function formatStackListHelp(command: "new" | "adopt"): string {
  const signature =
    command === "new"
      ? "scaffold new <stack> <dir> [options]"
      : "scaffold adopt <stack> [dir] [options]";

  return `Usage:
  ${signature}

Subcommands:
  base                     Shared governance, docs, and CI baseline
  rust                     Rust workspace or CLI project
  uv                       Python project managed by uv
  bun                      TypeScript CLI or package managed by Bun

Options:
  -h, --help               Print help
  -V, --version            Print version

Run 'scaffold ${command} <stack> --help' for stack-specific options.
`;
}

function formatStackOptionsHelp(command: "new" | "adopt", stack: Stack): string {
  const lines: string[] = [
    "Usage:",
    command === "new"
      ? `  scaffold new ${stack} <dir> [options]`
      : `  scaffold adopt ${stack} [dir] [options]`,
  ];

  if (command === "adopt") {
    lines.push("", "Arguments:", "  dir                      Target directory (default: .)");
  }

  lines.push(
    "",
    "Options:",
    "  --name <slug>            Project slug matching ^[a-z][a-z0-9-]*$",
    "  --description <text>     Short project description",
  );

  if (stack === "rust") {
    lines.push("  --kind <kind>            Rust project layout (workspace, cli)");
  }

  lines.push(
    "  --visibility <vis>       Repository visibility (public, private)",
    "  --org <name>             GitHub organization name",
  );

  if (stack !== "base") {
    lines.push("  --publish-registries     Enable public registry publishing in release workflow");
  }

  if (command === "new") {
    lines.push(
      "  --create-remote          Create GitHub repository, configure rules, and open init PR",
    );
  }

  lines.push(
    "  --template <src>         Template source (default: https://github.com/taitide-labs/scaffold.git)",
    "  --defaults               Use default answers for unprovided questions",
    "  -n, --dry-run            Run without writing files",
    "  -q, --quiet              Suppress non-error output",
    "  -h, --help               Print help",
    "  -V, --version            Print version",
    "",
  );

  return lines.join("\n");
}

export function formatHelp(command?: Subcommand, stack?: Stack): string {
  if (command === "sync") {
    return SYNC_HELP;
  }
  if (command === "new" || command === "adopt") {
    if (stack !== undefined) {
      return formatStackOptionsHelp(command, stack);
    }
    return formatStackListHelp(command);
  }
  return ROOT_HELP;
}

export async function runMain(args: readonly string[], io: CliIo = defaultIo): Promise<number> {
  const parsed = parseScaffoldArgs(args, io.cwd);

  if (parsed.kind === "version") {
    io.stdout(`scaffold ${pkg.version}\n`);
    return 0;
  }
  if (parsed.kind === "help") {
    io.stdout(formatHelp(parsed.command, parsed.stack));
    return 0;
  }
  if (parsed.kind === "error") {
    const helpCommand = parsed.helpCommand ?? "scaffold";
    io.stderr(`error: ${parsed.message}\nRun '${helpCommand} --help' for usage.\n`);
    return 2;
  }

  const copierArgs = buildCopierArgs(parsed);
  try {
    const code = await io.runCopier(copierArgs);
    return code === 0 ? 0 : 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.stderr(`error: ${message}\nRun 'scaffold --help' for usage.\n`);
    return 1;
  }
}

if (import.meta.main) {
  const code = await runMain(process.argv.slice(2));
  process.exit(code);
}
