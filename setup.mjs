// Enable/disable push celebrations by managing a global git pre-push hook.
// Every change is recorded so `uninstall` can restore the previous state exactly.
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { PLUGIN_ID, PLUGIN_ROOT, atomicWrite, configDir, loadConfig, stateDir } from "./lib.mjs";

const command = process.argv[2] || "status";

function runGit(args) {
  return spawnSync("git", args, { encoding: "utf8", timeout: 10000 });
}

function getGlobal(key) {
  const result = runGit(["config", "--global", "--get", key]);
  return result.status === 0 ? result.stdout.trim() : null;
}

function setGlobal(key, value) {
  const result = runGit(["config", "--global", key, value]);
  if (result.status !== 0) {
    throw new Error(`git config --global ${key} failed: ${(result.stderr || "").trim()}`);
  }
}

function unsetGlobal(key) {
  runGit(["config", "--global", "--unset", key]);
}

function expandHome(path) {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return path;
}

function recordPath() {
  return join(stateDir(), "install.json");
}

function readRecord() {
  try {
    return JSON.parse(readFileSync(recordPath(), "utf8"));
  } catch {
    return null;
  }
}

function hasMarker(content) {
  return content.includes("herdr-celebrate hook");
}

function removeOurHook(dir) {
  const file = join(dir, "pre-push");
  try {
    if (hasMarker(readFileSync(file, "utf8"))) rmSync(file);
  } catch {
    // nothing to remove
  }
}

function restoreBackup(dir) {
  const backup = join(dir, "pre-push.herdr-prev");
  if (existsSync(backup)) {
    try {
      renameSync(backup, join(dir, "pre-push"));
    } catch (error) {
      console.error(`warning: could not restore ${backup}: ${error.message}`);
    }
  }
}

function uninstall({ quiet = false } = {}) {
  const record = readRecord();
  const defaultDir = join(stateDir(), "git-hooks");
  const current = getGlobal("core.hooksPath");

  if (record) {
    if (record.mode === "global-dir") {
      if (current && resolve(expandHome(current)) === resolve(record.target_dir)) {
        unsetGlobal("core.hooksPath");
      }
      removeOurHook(record.target_dir);
      restoreBackup(record.target_dir);
    } else if (record.mode === "existing-dir") {
      removeOurHook(record.target_dir);
      restoreBackup(record.target_dir);
    }
    try {
      rmSync(recordPath());
    } catch {
      // already gone
    }
  } else {
    // Best effort when no install record exists.
    if (current && resolve(expandHome(current)) === resolve(defaultDir)) {
      unsetGlobal("core.hooksPath");
    }
    removeOurHook(defaultDir);
  }

  if (!quiet) {
    console.log("Push celebrations disabled. Global git config restored.");
  }
}

function install() {
  if (readRecord()) uninstall({ quiet: true });

  if (!existsSync(join(PLUGIN_ROOT, "watcher.mjs"))) {
    throw new Error(`watcher.mjs missing under ${PLUGIN_ROOT}`);
  }

  const defaultDir = join(stateDir(), "git-hooks");
  mkdirSync(defaultDir, { recursive: true });

  const previous = getGlobal("core.hooksPath");
  let mode;
  let targetDir;

  if (!previous) {
    mode = "global-dir";
    targetDir = defaultDir;
  } else {
    const expanded = expandHome(previous);
    if (!isAbsolute(expanded)) {
      throw new Error(
        `core.hooksPath is a relative path ('${previous}'); make it absolute before installing.`,
      );
    }
    if (resolve(expanded) === resolve(defaultDir)) {
      mode = "global-dir";
      targetDir = defaultDir;
    } else {
      mode = "existing-dir";
      targetDir = resolve(expanded);
      mkdirSync(targetDir, { recursive: true });
    }
  }

  const targetHook = join(targetDir, "pre-push");
  let backupPath = null;
  if (existsSync(targetHook)) {
    let content = "";
    try {
      content = readFileSync(targetHook, "utf8");
    } catch {
      // unreadable; treat as not ours
    }
    if (!hasMarker(content)) {
      backupPath = join(targetDir, "pre-push.herdr-prev");
      if (!existsSync(backupPath)) {
        renameSync(targetHook, backupPath);
      } else {
        rmSync(targetHook);
      }
    }
  }

  const template = readFileSync(join(PLUGIN_ROOT, "hooks", "pre-push.tmpl"), "utf8")
    .replaceAll("@PLUGIN_ROOT@", PLUGIN_ROOT)
    .replaceAll("@STATE_DIR@", stateDir())
    .replaceAll("@CONFIG_DIR@", configDir())
    .replaceAll("@TARGET_DIR@", targetDir)
    .replaceAll("@NODE_BIN@", process.execPath);

  writeFileSync(targetHook, template, { mode: 0o755 });
  chmodSync(targetHook, 0o755);

  if (mode === "global-dir") setGlobal("core.hooksPath", targetDir);

  atomicWrite(
    recordPath(),
    JSON.stringify(
      {
        version: 1,
        installed_at: new Date().toISOString(),
        mode,
        target_dir: targetDir,
        previous_hooks_path: previous,
        backup_path: backupPath,
        plugin_root: PLUGIN_ROOT,
      },
      null,
      2,
    ),
  );

  console.log("Push celebrations enabled.");
  console.log(`  hook: ${targetHook}`);
  console.log(
    `  mode: ${mode === "global-dir" ? "global core.hooksPath" : "installed into your existing core.hooksPath"}`,
  );
  if (backupPath) console.log(`  previous hook kept at: ${backupPath}`);
  console.log(`  test: herdr plugin action invoke ${PLUGIN_ID}.test`);
  console.log(`  undo: herdr plugin action invoke ${PLUGIN_ID}.uninstall-hooks`);
}

function status() {
  const record = readRecord();
  const current = getGlobal("core.hooksPath");
  const hookDir = record?.target_dir || join(stateDir(), "git-hooks");
  let hookInstalled = false;
  try {
    hookInstalled = hasMarker(readFileSync(join(hookDir, "pre-push"), "utf8"));
  } catch {
    hookInstalled = false;
  }
  console.log(
    JSON.stringify(
      {
        plugin: PLUGIN_ID,
        plugin_root: PLUGIN_ROOT,
        state_dir: stateDir(),
        core_hooks_path: current,
        hook_dir: hookDir,
        hook_installed: hookInstalled,
        install_record: record,
        config: loadConfig(),
      },
      null,
      2,
    ),
  );
}

try {
  if (command === "install") install();
  else if (command === "uninstall") uninstall();
  else status();
} catch (error) {
  console.error(`celebrate: ${error.message}`);
  process.exit(1);
}
