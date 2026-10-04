// Shared helpers for the jeffmadrid.celebrate herdr plugin.
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

export const PLUGIN_ROOT = dirname(fileURLToPath(import.meta.url));
export const PLUGIN_ID = "jeffmadrid.celebrate";

export const DEFAULT_CONFIG = Object.freeze({
  enabled: true,
  effect: "random", // "confetti" | "fireworks" | "random"
  cycle_seconds: 4,
  sound: false,
  cooldown_seconds: 5,
  ignore_remotes: [],
  width: "100%",
  height: "100%",
  fallback_notification: true,
});

const LOG_MAX_BYTES = 512 * 1024;

export function stateDir() {
  if (process.env.HERDR_PLUGIN_STATE_DIR) return process.env.HERDR_PLUGIN_STATE_DIR;
  const base = process.env.XDG_STATE_HOME || join(homedir(), ".local", "state");
  return join(base, "herdr", "plugins", PLUGIN_ID);
}

export function configDir() {
  if (process.env.HERDR_PLUGIN_CONFIG_DIR) return process.env.HERDR_PLUGIN_CONFIG_DIR;
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "herdr", "plugins", "config", PLUGIN_ID);
}

export function configPath() {
  return join(configDir(), "config.json");
}

function clamp(number, lo, hi) {
  return Math.min(hi, Math.max(lo, number));
}

function isPopupSize(value) {
  if (Number.isInteger(value) && value > 0 && value <= 500) return true;
  return typeof value === "string" && /^(100|[1-9][0-9]?)%$/.test(value);
}

export function loadConfig() {
  const config = { ...DEFAULT_CONFIG };
  let raw;
  try {
    raw = readFileSync(configPath(), "utf8");
  } catch {
    return config;
  }
  let user;
  try {
    user = JSON.parse(raw);
  } catch (error) {
    log(`config: invalid JSON in ${configPath()} (${error.message}); using defaults`);
    return config;
  }
  if (!user || typeof user !== "object") return config;

  if (typeof user.enabled === "boolean") config.enabled = user.enabled;
  if (["confetti", "fireworks", "random"].includes(user.effect)) config.effect = user.effect;
  const cycle = Number.isFinite(user.cycle_seconds) ? user.cycle_seconds : user.duration_seconds;
  if (Number.isFinite(cycle)) config.cycle_seconds = clamp(cycle, 1, 30);
  if (typeof user.sound === "boolean") config.sound = user.sound;
  if (Number.isFinite(user.cooldown_seconds)) config.cooldown_seconds = clamp(user.cooldown_seconds, 0, 600);
  if (Array.isArray(user.ignore_remotes)) {
    config.ignore_remotes = user.ignore_remotes
      .filter((value) => typeof value === "string" && value.trim())
      .map((value) => value.trim());
  }
  if (isPopupSize(user.width)) config.width = user.width;
  if (isPopupSize(user.height)) config.height = user.height;
  if (typeof user.fallback_notification === "boolean") config.fallback_notification = user.fallback_notification;
  return config;
}

export function log(message) {
  try {
    mkdirSync(stateDir(), { recursive: true });
    const file = join(stateDir(), "celebrate.log");
    try {
      if (statSync(file).size > LOG_MAX_BYTES) renameSync(file, `${file}.1`);
    } catch {
      // no previous log
    }
    appendFileSync(file, `${new Date().toISOString()} ${message}\n`);
  } catch {
    // logging must never break a push
  }
}

export function findHerdrBin() {
  const candidates = [];
  if (process.env.HERDR_BIN_PATH) candidates.push(process.env.HERDR_BIN_PATH);
  for (const dir of (process.env.PATH || "").split(":")) {
    if (dir) candidates.push(join(dir, "herdr"));
  }
  candidates.push(
    join(homedir(), ".local", "bin", "herdr"),
    "/opt/homebrew/bin/herdr",
    "/usr/local/bin/herdr",
  );
  for (const candidate of candidates) {
    try {
      if (existsSync(candidate)) return candidate;
    } catch {
      // keep looking
    }
  }
  return null;
}

export function herdr(args, { bin, timeout = 10000 } = {}) {
  const executable = bin || findHerdrBin() || "herdr";
  const result = spawnSync(executable, args, {
    encoding: "utf8",
    timeout,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  let json = null;
  try {
    json = JSON.parse((result.stdout || "").trim());
  } catch {
    // not JSON; leave null
  }
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    error: result.error || null,
    json,
  };
}

export function readJsonEnv(name) {
  const raw = process.env[name];
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function sanitizeText(value, max) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function atomicWrite(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, data);
  renameSync(tmp, path);
}
