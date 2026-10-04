// Detached watcher: waits for the `git push` process to exit, verifies the push
// actually landed, then opens the celebration popup through the herdr CLI.
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { spawnSync } from "node:child_process";
import { PLUGIN_ID, findHerdrBin, herdr, loadConfig, log, stateDir } from "./lib.mjs";

const inflightPath = process.argv[2];
const config = loadConfig();

function cleanup() {
  try {
    if (inflightPath) rmSync(inflightPath);
  } catch {
    // already gone
  }
}

function bail(message) {
  log(message);
  cleanup();
  process.exit(0);
}

if (!config.enabled) bail("watcher: celebrations disabled");
if (!inflightPath || !existsSync(inflightPath)) bail("watcher: no inflight file");

const lines = readFileSync(inflightPath, "utf8").split("\n");
const meta = {};
const refs = [];
for (const line of lines) {
  const parts = line.split("\t");
  if (parts[0] === "META" && parts[1]) {
    const equals = parts[1].indexOf("=");
    if (equals > 0) meta[parts[1].slice(0, equals)] = parts[1].slice(equals + 1);
  } else if (parts[0] === "REF" && parts.length >= 6) {
    refs.push({
      localRef: parts[1],
      localSha: parts[2],
      remoteRef: parts[3],
      remoteSha: parts[4],
      before: parts[5],
    });
  }
}

if (refs.length === 0) bail("watcher: no refs recorded, skipping");

const remote = meta.remote || "origin";
const remoteUrl = meta.url || "";
const cwd = meta.cwd || process.cwd();
const ZERO = /^0{8,}$/;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const ignored = config.ignore_remotes.some(
  (entry) => entry && (entry === remote || remoteUrl.includes(entry)),
);
if (ignored) bail(`watcher: remote '${remote}' is in ignore_remotes`);

function git(args, timeout = 10000) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    timeout,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  return {
    ok: result.status === 0,
    out: (result.stdout || "").trim(),
    error: result.error || null,
  };
}

function labelFor(ref) {
  return ref.remoteRef.replace(/^refs\/heads\//, "").replace(/^refs\/tags\//, "");
}

function trackingRefFor(remoteRef) {
  const branch = remoteRef.replace(/^refs\/heads\//, "");
  if (branch === remoteRef) return null; // tags and other refs have no tracking ref
  return `refs/remotes/${remote}/${branch}`;
}

// Fast path: the remote-tracking ref moved to the pushed SHA.
function auditTrackingRefs() {
  let any = false;
  for (const ref of refs) {
    const tracking = trackingRefFor(ref.remoteRef);
    if (!tracking) continue;
    const after = git(["rev-parse", "--verify", "--quiet", tracking]).out;
    const deleted = ZERO.test(ref.localSha);
    if ((!deleted && after === ref.localSha) || (deleted && !after && ref.before)) {
      ref.verified = true;
      any = true;
    }
  }
  return any;
}

// Authoritative fallback: ask the remote (works for tags and custom fetch refspecs).
function auditRemote() {
  const pending = refs.filter((ref) => !ref.verified);
  if (pending.length === 0) return true;
  const result = git(["ls-remote", remote, ...pending.map((ref) => ref.remoteRef)], 15000);
  if (!result.ok) {
    log(`watcher: ls-remote '${remote}' failed${result.error ? ` (${result.error.message})` : ""}`);
    return false;
  }
  const byRef = new Map();
  for (const line of result.out.split("\n")) {
    const [sha, name] = line.split(/\s+/);
    if (sha && name) byRef.set(name, sha);
  }
  let any = false;
  for (const ref of pending) {
    const current = byRef.get(ref.remoteRef) || null;
    const deleted = ZERO.test(ref.localSha);
    if ((!deleted && current === ref.localSha) || (deleted && !current)) {
      ref.verified = true;
      any = true;
    }
  }
  return any;
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error && error.code === "EPERM";
  }
}

async function waitForGitExit() {
  const pid = Number.parseInt(meta.git_pid || "", 10);
  if (!Number.isFinite(pid) || pid <= 1) {
    await sleep(1500);
    return;
  }
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    if (!isAlive(pid)) {
      await sleep(400);
      return;
    }
    await sleep(200);
  }
  log("watcher: timed out waiting for git; auditing anyway");
  await sleep(400);
}

function cooldownActive() {
  try {
    const last = statSync(join(stateDir(), "last-celebration"));
    return Date.now() - last.mtimeMs < config.cooldown_seconds * 1000;
  } catch {
    return false;
  }
}

function markCelebrated() {
  try {
    mkdirSync(stateDir(), { recursive: true });
    writeFileSync(join(stateDir(), "last-celebration"), `${new Date().toISOString()}\n`);
  } catch {
    // non-fatal
  }
}

function summary() {
  const labels = [...new Set(refs.map(labelFor))];
  return {
    label: labels.length === 1 ? labels[0] : `${labels.length} refs`,
  };
}

function repoName() {
  const top = git(["rev-parse", "--show-toplevel"]).out;
  return top ? basename(top) : basename(cwd);
}

async function main() {
  await waitForGitExit();

  let verified = auditTrackingRefs();
  if (!verified) verified = auditRemote();
  if (!verified) {
    bail(`watcher: push to '${remote}' not confirmed (${refs.map(labelFor).join(", ")}); no celebration`);
  }

  if (cooldownActive()) bail("watcher: cooldown active; skipping celebration");

  const bin = findHerdrBin();
  if (!bin) bail("watcher: herdr binary not found");

  const { label } = summary();
  const effect =
    config.effect === "random" ? (Math.random() < 0.5 ? "confetti" : "fireworks") : config.effect;

  const result = herdr(
    [
      "plugin",
      "pane",
      "open",
      "--plugin",
      PLUGIN_ID,
      "--entrypoint",
      "celebrate",
      "--placement",
      "popup",
      "--width",
      String(config.width),
      "--height",
      String(config.height),
      "--env",
      `PUSH_REPO=${repoName()}`,
      "--env",
      `PUSH_BRANCH=${label}`,
      "--env",
      `PUSH_REMOTE=${remote}`,
      "--env",
      `PUSH_REFS=${refs.length}`,
      "--env",
      `PUSH_EFFECT=${effect}`,
    ],
    { bin, timeout: 15000 },
  );

  let opened = false;
  let reason = "";
  if (result.json?.result) {
    opened = true;
  } else if (result.json?.error) {
    reason = result.json.error.code || result.json.error.message || "error";
  } else if (result.ok) {
    opened = true;
  } else {
    reason = result.error ? result.error.message : (result.stderr.trim().split("\n")[0] || `exit ${result.status}`);
  }

  if (opened) {
    markCelebrated();
    log(`watcher: celebration opened for ${label} (${effect}) in '${repoName()}'`);
    return;
  }

  log(`watcher: popup failed (${reason})`);
  if (config.fallback_notification) {
    const note = herdr(
      ["notification", "show", `🚀 pushed ${label}`, "--body", `${repoName()} → ${remote}`],
      { bin, timeout: 8000 },
    );
    if (note.ok) {
      markCelebrated();
      log("watcher: notification fallback shown");
    }
  }
}

main()
  .catch((error) => log(`watcher: unexpected error: ${error.message}`))
  .finally(() => {
    cleanup();
    process.exit(0);
  });
