// Open the celebration popup right now, without involving git.
import { spawnSync } from "node:child_process";
import { basename } from "node:path";
import { PLUGIN_ID, findHerdrBin, herdr, loadConfig, sanitizeText } from "./lib.mjs";

const config = loadConfig();
const bin = findHerdrBin();
if (!bin) {
  console.error("herdr binary not found; is Herdr installed?");
  process.exit(1);
}

function gitOut(args) {
  const result = spawnSync("git", args, { encoding: "utf8", timeout: 5000 });
  return result.status === 0 ? result.stdout.trim() : "";
}

const top = gitOut(["rev-parse", "--show-toplevel"]);
const repo = top ? basename(top) : "demo-repo";
const branch = gitOut(["symbolic-ref", "--short", "HEAD"]) || "main";

let effect = String(process.argv[2] || config.effect).toLowerCase();
if (!["confetti", "fireworks"].includes(effect)) {
  effect = Math.random() < 0.5 ? "confetti" : "fireworks";
}

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
    `PUSH_REPO=${sanitizeText(repo, 40)}`,
    "--env",
    `PUSH_BRANCH=${sanitizeText(branch, 48)}`,
    "--env",
    "PUSH_REMOTE=origin",
    "--env",
    "PUSH_REFS=1",
    "--env",
    `PUSH_EFFECT=${effect}`,
  ],
  { bin, timeout: 15000 },
);

if (result.json) {
  console.log(JSON.stringify(result.json, null, 2));
} else {
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
}
process.exit(result.ok ? 0 : 1);
