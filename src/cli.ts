#!/usr/bin/env node
import path from "node:path";
import fs from "node:fs/promises";
import chokidar from "chokidar";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import pc from "picocolors";
import { buildJsxTree } from "./buildTree.ts";
import type { BuildOptions } from "./types.js";
import { normalizeRelDir, toPosixPath } from "./pathing.ts";
import { clearScreen, renderTree } from "./render.ts";
import { startInteractiveUI } from "./interactive.ts";

async function ensureFileExists(p: string) {
  const st = await fs.stat(p);
  if (!st.isFile()) throw new Error(`Not a file: ${p}`);
}

function parseIgnoreList(raw: unknown): string[] {
  if (!raw) return [];
  const s = String(raw);
  if (!s.trim()) return [];
  return s
    .split(",")
    .map((x) => normalizeRelDir(x))
    .filter(Boolean);
}

async function runOnce(opts: BuildOptions & { showExpandedFrom: boolean }) {
  const res = await buildJsxTree(opts);
  const header = pc.bold(pc.cyan("JSX Tree")) + pc.dim(`  root=${toPosixPath(path.relative(process.cwd(), opts.rootDir))}`);
  const meta = pc.dim(
    `start=${toPosixPath(path.relative(opts.rootDir, opts.startFile))}  depth<=${opts.maxDepth}  files=${res.filesTouched.size}`
  );

  clearScreen();
  process.stdout.write(header + "\n");
  process.stdout.write(meta + "\n\n");
  process.stdout.write(renderTree(res.root, { showExpandedFrom: opts.showExpandedFrom }) + "\n");

  if (res.warnings.length) {
    process.stdout.write("\n" + pc.yellow(pc.bold("Warnings")) + "\n");
    for (const w of res.warnings.slice(0, 25)) process.stdout.write(pc.yellow(`- ${w}\n`));
    if (res.warnings.length > 25) process.stdout.write(pc.yellow(`- ... (${res.warnings.length - 25} more)\n`));
  }
}

function createFocusedWatcher(params: {
  initialFiles: Iterable<string>;
  onAny: () => void;
}) {
  const watcher = chokidar.watch(Array.from(params.initialFiles), {
    ignoreInitial: true
  });
  watcher.on("add", params.onAny);
  watcher.on("change", params.onAny);
  watcher.on("unlink", params.onAny);
  watcher.on("error", () => {
    // Ignore watcher errors; rebuilds can still be triggered by other files.
  });

  const watched = new Set<string>(Array.from(params.initialFiles));

  const syncFiles = async (nextFiles: Iterable<string>) => {
    const next = new Set<string>();
    for (const f of nextFiles) next.add(f);

    const toAdd: string[] = [];
    const toRemove: string[] = [];
    for (const f of next) if (!watched.has(f)) toAdd.push(f);
    for (const f of watched) if (!next.has(f)) toRemove.push(f);

    if (toRemove.length) await watcher.unwatch(toRemove);
    if (toAdd.length) watcher.add(toAdd);

    watched.clear();
    for (const f of next) watched.add(f);
  };

  return { watcher, syncFiles };
}

async function main() {
  const argv = await yargs(hideBin(process.argv))
    .scriptName("react-jsx-tree")
    .usage("$0 <startFile> [options]")
    .positional("startFile", { type: "string", describe: "Entry file (tsx/jsx) to start from" })
    .option("watch", { type: "boolean", default: false, describe: "Live update on file changes" })
    .option("ignore", {
      type: "string",
      default: "",
      describe: "Comma-separated folder(s) under the start file folder to ignore (ex: ui,components/ui)"
    })
    .option("depth", { type: "number", default: 25, describe: "Max component expansion depth" })
    .option("show-expanded-from", { type: "boolean", default: false, describe: "Show which file expanded a component" })
    .option("interactive", { type: "boolean", default: false, describe: "Interactive tree: arrow keys + Enter to expand/collapse" })
    .option("mouse", { type: "boolean", default: false, describe: "Enable mouse support (click to toggle) in interactive mode" })
    .demandCommand(1)
    .help()
    .parse();

  const startArg = String(argv._[0]);
  const startFile = path.resolve(process.cwd(), startArg);
  await ensureFileExists(startFile);

  const rootDir = path.dirname(startFile);
  const ignoreDirs = parseIgnoreList(argv.ignore);

  const opts: BuildOptions & { showExpandedFrom: boolean } = {
    startFile,
    rootDir,
    ignoreDirs,
    maxDepth: Number.isFinite(argv.depth) ? Number(argv.depth) : 25,
    showExpandedFrom: !!argv["show-expanded-from"]
  };

  if (argv.interactive) {
    // Collapsed by default: start with root collapsed.
    const collapsedIds = new Set<string>(["Fragment", "NoJSXReturnFound"]);
    // Root id uses the root node name; we'll set it after first build.
    let ui: ReturnType<typeof startInteractiveUI> | null = null;
    let focusedWatcher: ReturnType<typeof createFocusedWatcher> | null = null;

    let running = false;
    let queued = false;

    const rerun = async () => {
      if (running) {
        queued = true;
        return;
      }
      running = true;
      try {
        const res = await buildJsxTree(opts);
        const metaLine = `start=${toPosixPath(path.relative(opts.rootDir, opts.startFile))}  depth<=${opts.maxDepth}  files=${res.filesTouched.size}`;
        const rootId = res.root.name;
        if (!collapsedIds.has(rootId) && collapsedIds.size === 2) collapsedIds.add(rootId);

        if (!ui) {
          ui = startInteractiveUI({
            title: "JSX Tree (interactive)",
            metaLine,
            root: res.root,
            collapsedIds,
            enableMouse: !!argv.mouse
          });
          if (argv.watch) {
            focusedWatcher = createFocusedWatcher({
              initialFiles: res.filesTouched,
              onAny: () => void rerun()
            });
          }
        } else {
          ui.updateTree(res.root, metaLine);
        }

        if (argv.watch && focusedWatcher) {
          await focusedWatcher.syncFiles(res.filesTouched);
        }
      } catch (e) {
        // Fallback to plain error output; interactive screen will show stale tree until next rebuild.
        clearScreen();
        process.stdout.write(pc.red(pc.bold("Error")) + "\n\n");
        process.stdout.write(pc.red((e as Error).stack || String(e)) + "\n");
      } finally {
        running = false;
        if (queued) {
          queued = false;
          void rerun();
        }
      }
    };

    await rerun();
    if (!argv.watch) return;

    process.on("SIGINT", async () => {
      await focusedWatcher?.watcher.close();
      ui?.destroy();
      process.exit(0);
    });

    return;
  }

  if (!argv.watch) {
    await runOnce(opts);
    return;
  }

  let running = false;
  let queued = false;
  let focusedWatcher: ReturnType<typeof createFocusedWatcher> | null = null;

  const rerun = async () => {
    if (running) {
      queued = true;
      return;
    }
    running = true;
    try {
      const res = await buildJsxTree(opts);
      const header = pc.bold(pc.cyan("JSX Tree")) + pc.dim(`  root=${toPosixPath(path.relative(process.cwd(), opts.rootDir))}`);
      const meta = pc.dim(
        `start=${toPosixPath(path.relative(opts.rootDir, opts.startFile))}  depth<=${opts.maxDepth}  files=${res.filesTouched.size}`
      );

      clearScreen();
      process.stdout.write(header + "\n");
      process.stdout.write(meta + "\n\n");
      process.stdout.write(renderTree(res.root, { showExpandedFrom: opts.showExpandedFrom }) + "\n");

      if (res.warnings.length) {
        process.stdout.write("\n" + pc.yellow(pc.bold("Warnings")) + "\n");
        for (const w of res.warnings.slice(0, 25)) process.stdout.write(pc.yellow(`- ${w}\n`));
        if (res.warnings.length > 25) process.stdout.write(pc.yellow(`- ... (${res.warnings.length - 25} more)\n`));
      }

      if (!focusedWatcher) {
        focusedWatcher = createFocusedWatcher({
          initialFiles: res.filesTouched,
          onAny: () => void rerun()
        });
      } else {
        await focusedWatcher.syncFiles(res.filesTouched);
      }
    } catch (e) {
      clearScreen();
      process.stdout.write(pc.red(pc.bold("Error")) + "\n\n");
      process.stdout.write(pc.red((e as Error).stack || String(e)) + "\n");
    } finally {
      running = false;
      if (queued) {
        queued = false;
        void rerun();
      }
    }
  };

  await rerun();

  process.on("SIGINT", async () => {
    await focusedWatcher?.watcher.close();
    process.exit(0);
  });
}

void main();

