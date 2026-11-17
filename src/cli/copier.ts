import type { CopierCommand } from "./args.ts";

function appendSharedCopierFlags(target: string[], command: CopierCommand): void {
  if (command.defaults) {
    target.push("--defaults");
  }
  if (command.dryRun) {
    target.push("--pretend");
  }
  if (command.quiet) {
    target.push("--quiet");
  }
}

function appendTemplateDataFlags(
  target: string[],
  command: Extract<CopierCommand, { kind: "new" | "adopt" }>,
): void {
  if (command.name !== undefined) {
    target.push("-d", `project_name=${command.name}`);
  }
  if (command.description !== undefined) {
    target.push("-d", `description=${command.description}`);
  }
  target.push("-d", `stack=${command.stack}`);
  if (command.rustKind !== undefined) {
    target.push("-d", `rust_kind=${command.rustKind}`);
  }
  if (command.visibility !== undefined) {
    target.push("-d", `visibility=${command.visibility}`);
  }
  if (command.org !== undefined) {
    target.push("-d", `org=${command.org}`);
  }
  if (command.publishRegistries) {
    target.push("-d", "publish_registries=true");
  }
  if (command.kind === "new" && command.createRemote) {
    target.push("-d", "create_remote_repo=true");
  }
}

export function buildCopierArgs(command: CopierCommand): string[] {
  if (command.kind === "sync") {
    const args = ["update", "--trust"];
    appendSharedCopierFlags(args, command);
    args.push(command.dir);
    return args;
  }

  const args = ["copy", "--trust"];
  if (command.kind === "adopt") {
    args.push("--skip-tasks", "--overwrite");
  }
  appendSharedCopierFlags(args, command);
  appendTemplateDataFlags(args, command);
  args.push(command.template, command.dir);
  return args;
}

export async function runCopier(copierArgs: readonly string[]): Promise<number> {
  const proc = Bun.spawn(["uvx", "copier", ...copierArgs], {
    stdio: ["inherit", "inherit", "inherit"],
  });
  const exitCode = await proc.exited;
  return exitCode === 0 ? 0 : 1;
}
