import path from "node:path";

export const DEFAULT_TEMPLATE = "https://github.com/taitide-labs/scaffold.git";
export const PROJECT_NAME_PATTERN = /^[a-z][a-z0-9-]*$/;

export type Stack = "base" | "rust" | "uv" | "bun";
export type RustKind = "workspace" | "cli";
export type Visibility = "public" | "private";
export type Subcommand = "new" | "sync" | "adopt";

export interface SharedFlags {
  defaults: boolean;
  dryRun: boolean;
  quiet: boolean;
}

export interface NewCommand extends SharedFlags {
  kind: "new";
  stack: Stack;
  dir: string;
  name?: string;
  description?: string;
  rustKind?: RustKind;
  visibility?: Visibility;
  org?: string;
  publishRegistries: boolean;
  createRemote: boolean;
  template: string;
}

export interface AdoptCommand extends SharedFlags {
  kind: "adopt";
  stack: Stack;
  dir: string;
  name?: string;
  description?: string;
  rustKind?: RustKind;
  visibility?: Visibility;
  org?: string;
  publishRegistries: boolean;
  template: string;
}

export interface SyncCommand extends SharedFlags {
  kind: "sync";
  dir: string;
}

export type CopierCommand = NewCommand | AdoptCommand | SyncCommand;

export type ParsedCommand =
  | { kind: "help"; command?: Subcommand; stack?: Stack }
  | { kind: "version" }
  | { kind: "error"; message: string; helpCommand?: string }
  | CopierCommand;

const STACKS: ReadonlySet<string> = new Set(["base", "rust", "uv", "bun"]);
const RUST_KINDS: ReadonlySet<string> = new Set(["workspace", "cli"]);
const VISIBILITIES: ReadonlySet<string> = new Set(["public", "private"]);

function isSubcommand(value: string): value is Subcommand {
  return value === "new" || value === "sync" || value === "adopt";
}

function isStack(value: string): value is Stack {
  return STACKS.has(value);
}

function isRustKind(value: string): value is RustKind {
  return RUST_KINDS.has(value);
}

function isVisibility(value: string): value is Visibility {
  return VISIBILITIES.has(value);
}

function splitFlag(token: string): { flag: string; inlineValue?: string } {
  const eqIndex = token.indexOf("=");
  if (eqIndex === -1) {
    return { flag: token };
  }
  return {
    flag: token.slice(0, eqIndex),
    inlineValue: token.slice(eqIndex + 1),
  };
}

function consumeFlagValue(
  rest: readonly string[],
  index: number,
  flag: string,
  inlineValue: string | undefined,
): { ok: true; value: string; nextIndex: number } | { ok: false; message: string } {
  if (inlineValue !== undefined) {
    return { ok: true, value: inlineValue, nextIndex: index };
  }
  const next = rest[index + 1];
  if (next === undefined) {
    return { ok: false, message: `missing value for ${flag}` };
  }
  return { ok: true, value: next, nextIndex: index + 1 };
}

function findMetaCommand(args: readonly string[]): ParsedCommand | undefined {
  const first = args[0];
  const subcommand = first !== undefined && isSubcommand(first) ? first : undefined;
  const second = args[1];
  const stack =
    (subcommand === "new" || subcommand === "adopt") && second !== undefined && isStack(second)
      ? second
      : undefined;

  for (const token of args) {
    if (token === "--") {
      break;
    }
    if (token === "-h" || token === "--help") {
      if (subcommand === undefined) {
        return { kind: "help" };
      }
      if (stack !== undefined) {
        return { kind: "help", command: subcommand, stack };
      }
      return { kind: "help", command: subcommand };
    }
    if (token === "-V" || token === "--version") {
      return { kind: "version" };
    }
  }
  return undefined;
}

function parseSyncArgs(rest: readonly string[]): ParsedCommand {
  let defaults = false;
  let dryRun = false;
  let quiet = false;
  let dir: string | undefined;
  let afterDoubleDash = false;
  const helpCommand = "scaffold sync";

  for (let i = 0; i < rest.length; i++) {
    const token = rest[i];
    if (token === undefined) {
      continue;
    }
    if (!afterDoubleDash && token === "--") {
      afterDoubleDash = true;
      continue;
    }
    if (!afterDoubleDash && token.startsWith("-") && token !== "-") {
      const { flag, inlineValue } = splitFlag(token);
      if (inlineValue !== undefined) {
        return { kind: "error", message: `unknown option: ${flag}`, helpCommand };
      }
      if (flag === "--defaults") {
        defaults = true;
      } else if (flag === "-n" || flag === "--dry-run") {
        dryRun = true;
      } else if (flag === "-q" || flag === "--quiet") {
        quiet = true;
      } else {
        return { kind: "error", message: `unknown option: ${flag}`, helpCommand };
      }
      continue;
    }
    if (dir !== undefined) {
      return { kind: "error", message: `unexpected argument: ${token}`, helpCommand };
    }
    dir = token;
  }

  return {
    kind: "sync",
    dir: dir ?? ".",
    defaults,
    dryRun,
    quiet,
  };
}

function parseStackCommandArgs(
  kind: "new" | "adopt",
  argsAfterSubcommand: readonly string[],
  cwd: string,
): ParsedCommand {
  const stackToken = argsAfterSubcommand[0];
  const parentHelpCommand = `scaffold ${kind}`;

  if (stackToken === undefined || stackToken.startsWith("-")) {
    return {
      kind: "error",
      message: "missing subcommand: expected base, rust, uv, or bun",
      helpCommand: parentHelpCommand,
    };
  }
  if (!isStack(stackToken)) {
    return {
      kind: "error",
      message: `unknown subcommand: ${stackToken}`,
      helpCommand: parentHelpCommand,
    };
  }

  const stack = stackToken;
  const helpCommand = `scaffold ${kind} ${stack}`;
  const rest = argsAfterSubcommand.slice(1);

  let defaults = false;
  let dryRun = false;
  let quiet = false;
  let dir: string | undefined;
  let name: string | undefined;
  let description: string | undefined;
  let rustKind: RustKind | undefined;
  let visibility: Visibility | undefined;
  let org: string | undefined;
  let publishRegistries = false;
  let createRemote = false;
  let template = DEFAULT_TEMPLATE;
  let afterDoubleDash = false;

  for (let i = 0; i < rest.length; i++) {
    const token = rest[i];
    if (token === undefined) {
      continue;
    }
    if (!afterDoubleDash && token === "--") {
      afterDoubleDash = true;
      continue;
    }
    if (!afterDoubleDash && token.startsWith("-") && token !== "-") {
      const { flag, inlineValue } = splitFlag(token);

      if (flag === "--defaults") {
        if (inlineValue !== undefined) {
          return { kind: "error", message: `option ${flag} does not take a value`, helpCommand };
        }
        defaults = true;
        continue;
      }
      if (flag === "-n" || flag === "--dry-run") {
        if (inlineValue !== undefined) {
          return { kind: "error", message: `option ${flag} does not take a value`, helpCommand };
        }
        dryRun = true;
        continue;
      }
      if (flag === "-q" || flag === "--quiet") {
        if (inlineValue !== undefined) {
          return { kind: "error", message: `option ${flag} does not take a value`, helpCommand };
        }
        quiet = true;
        continue;
      }
      if (flag === "--publish-registries") {
        if (stack === "base") {
          return { kind: "error", message: `unknown option: ${flag}`, helpCommand };
        }
        if (inlineValue !== undefined) {
          return { kind: "error", message: `option ${flag} does not take a value`, helpCommand };
        }
        publishRegistries = true;
        continue;
      }
      if (flag === "--create-remote") {
        if (kind !== "new") {
          return { kind: "error", message: `unknown option: ${flag}`, helpCommand };
        }
        if (inlineValue !== undefined) {
          return { kind: "error", message: `option ${flag} does not take a value`, helpCommand };
        }
        createRemote = true;
        continue;
      }
      if (flag === "--kind") {
        if (stack !== "rust") {
          return { kind: "error", message: `unknown option: ${flag}`, helpCommand };
        }
        const read = consumeFlagValue(rest, i, flag, inlineValue);
        if (!read.ok) {
          return { kind: "error", message: read.message, helpCommand };
        }
        i = read.nextIndex;
        if (!isRustKind(read.value)) {
          return {
            kind: "error",
            message: `invalid --kind "${read.value}": expected workspace or cli`,
            helpCommand,
          };
        }
        rustKind = read.value;
        continue;
      }

      if (
        flag === "--name" ||
        flag === "--description" ||
        flag === "--visibility" ||
        flag === "--org" ||
        flag === "--template"
      ) {
        const read = consumeFlagValue(rest, i, flag, inlineValue);
        if (!read.ok) {
          return { kind: "error", message: read.message, helpCommand };
        }
        i = read.nextIndex;
        const value = read.value;

        if (flag === "--name") {
          if (!PROJECT_NAME_PATTERN.test(value)) {
            return {
              kind: "error",
              message: `invalid --name "${value}": must match ^[a-z][a-z0-9-]*$`,
              helpCommand,
            };
          }
          name = value;
        } else if (flag === "--description") {
          if (value.trim().length === 0) {
            return {
              kind: "error",
              message: "invalid --description: cannot be empty",
              helpCommand,
            };
          }
          description = value;
        } else if (flag === "--visibility") {
          if (!isVisibility(value)) {
            return {
              kind: "error",
              message: `invalid --visibility "${value}": expected public or private`,
              helpCommand,
            };
          }
          visibility = value;
        } else if (flag === "--org") {
          if (value.trim().length === 0) {
            return { kind: "error", message: "invalid --org: cannot be empty", helpCommand };
          }
          org = value;
        } else if (flag === "--template") {
          if (value.trim().length === 0) {
            return { kind: "error", message: "invalid --template: cannot be empty", helpCommand };
          }
          template = value;
        }
        continue;
      }

      return { kind: "error", message: `unknown option: ${flag}`, helpCommand };
    }

    if (dir !== undefined) {
      return { kind: "error", message: `unexpected argument: ${token}`, helpCommand };
    }
    dir = token;
  }

  if (kind === "new" && dir === undefined) {
    return { kind: "error", message: "missing required argument: <dir>", helpCommand };
  }

  const targetDir = dir ?? ".";

  if (publishRegistries) {
    if (visibility === "private") {
      return {
        kind: "error",
        message: "--publish-registries is not supported with --visibility private",
        helpCommand,
      };
    }
    if (stack === "rust" && rustKind !== "cli") {
      return {
        kind: "error",
        message: "--publish-registries requires --kind cli for rust",
        helpCommand,
      };
    }
  }

  if (defaults && name === undefined) {
    const inferred = path.basename(path.resolve(cwd, targetDir));
    if (!PROJECT_NAME_PATTERN.test(inferred)) {
      return {
        kind: "error",
        message: `invalid inferred project name "${inferred}": must match ^[a-z][a-z0-9-]*$ (pass --name <slug>)`,
        helpCommand,
      };
    }
    name = inferred;
  }

  const shared = {
    stack,
    dir: targetDir,
    name,
    description,
    rustKind,
    visibility,
    org,
    publishRegistries,
    template,
    defaults,
    dryRun,
    quiet,
  };

  if (kind === "new") {
    return { kind: "new", ...shared, createRemote };
  }
  return { kind: "adopt", ...shared };
}

export function parseScaffoldArgs(
  args: readonly string[],
  cwd: string = process.cwd(),
): ParsedCommand {
  const meta = findMetaCommand(args);
  if (meta !== undefined) {
    return meta;
  }

  const first = args[0];
  if (first === undefined) {
    return { kind: "help" };
  }

  if (first === "new") {
    return parseStackCommandArgs("new", args.slice(1), cwd);
  }
  if (first === "adopt") {
    return parseStackCommandArgs("adopt", args.slice(1), cwd);
  }
  if (first === "sync") {
    return parseSyncArgs(args.slice(1));
  }

  if (first.startsWith("-")) {
    return { kind: "error", message: `unknown option: ${first}`, helpCommand: "scaffold" };
  }
  return { kind: "error", message: `unknown command: ${first}`, helpCommand: "scaffold" };
}
