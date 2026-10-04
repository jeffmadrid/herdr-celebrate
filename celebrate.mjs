// The celebration itself: a short truecolor particle animation rendered with
// half-block cells inside a herdr popup pane.
import { spawn } from "node:child_process";
import { loadConfig, sanitizeText } from "./lib.mjs";

const config = loadConfig();
const out = process.stdout;
const inp = process.stdin;

if (!out.isTTY) {
  out.write("🎉 pushed!\n");
  process.exit(0);
}

const BG = [8, 10, 22];
const CYCLE_MS = Math.max(1500, (config.cycle_seconds ?? 4) * 1000);
const FRAME_MS = 33;

let effect = String(process.env.PUSH_EFFECT || config.effect || "random").toLowerCase();
if (!["confetti", "fireworks"].includes(effect)) {
  effect = Math.random() < 0.5 ? "confetti" : "fireworks";
}

const info = {
  repo: sanitizeText(process.env.PUSH_REPO || "repo", 40),
  branch: sanitizeText(process.env.PUSH_BRANCH || "main", 48),
  remote: sanitizeText(process.env.PUSH_REMOTE || "origin", 32),
  refs: Number.parseInt(process.env.PUSH_REFS || "1", 10) || 1,
};

let W = Math.max(20, out.columns || 80);
let H = Math.max(6, out.rows || 24);
let FOOTER = H >= 8 ? 2 : 0;
let PXH = Math.max(2, H - FOOTER);

let alpha = new Float32Array(W * PXH * 2);
let color = new Uint8Array(W * PXH * 2 * 3);
let particles = [];
let nextSpawnAt = 0;
let cleaned = false;
let timer = null;
let startedAt = 0;
let lastTick = 0;

function hslToRgb(h, s, l) {
  const hue = ((((h % 360) + 360) % 360) / 360);
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t) => {
    let value = t;
    if (value < 0) value += 1;
    if (value > 1) value -= 1;
    if (value < 1 / 6) return p + (q - p) * 6 * value;
    if (value < 1 / 2) return q;
    if (value < 2 / 3) return p + (q - p) * (2 / 3 - value) * 6;
    return p;
  };
  return [
    Math.round(channel(hue + 1 / 3) * 255),
    Math.round(channel(hue) * 255),
    Math.round(channel(hue - 1 / 3) * 255),
  ];
}

function spawnSpark(x, y, angle, speed, hue, life) {
  particles.push({
    kind: "spark",
    x,
    y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    rgb: hslToRgb(hue, 0.85, 0.6),
    life,
    maxLife: life,
    grav: 55,
    twinkle: Math.random() * Math.PI * 2,
  });
}

function burst(x, y, count, angle, spread, speedMin, speedMax, hue, hueSpread) {
  for (let i = 0; i < count; i++) {
    const a = angle + (Math.random() - 0.5) * spread;
    const speed = speedMin + Math.random() * (speedMax - speedMin);
    const h = hue + (Math.random() - 0.5) * hueSpread;
    spawnSpark(x, y, a, speed, h, 1.7 + Math.random() * 1.6);
  }
}

function launchRocket(x, targetY, hue, delay) {
  particles.push({
    kind: "rocket",
    x,
    y: PXH * 2 - 1,
    vx: (Math.random() - 0.5) * 12,
    vy: -(150 + Math.random() * 60),
    targetY,
    hue,
    rgb: hslToRgb(hue, 0.9, 0.72),
    life: 6,
    maxLife: 6,
    trail: 0,
    delay,
  });
}

function explode(rocket, extra) {
  const count = 130 + Math.floor(Math.random() * 70);
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 60 + Math.random() * 190;
    const hue = rocket.hue + (Math.random() - 0.5) * 50;
    const life = 1.4 + Math.random() * 1.4;
    extra.push({
      kind: "spark",
      x: rocket.x,
      y: rocket.y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      rgb: hslToRgb(hue, 0.85, 0.6),
      life,
      maxLife: life,
      grav: 50,
      twinkle: Math.random() * Math.PI * 2,
    });
  }
}

function spawnWave() {
  if (effect === "confetti") {
    const baseY = PXH * 2 * 0.72;
    burst(W * 0.06, baseY, 150, -Math.PI / 3, 0.55, 130, 280, 200, 360);
    burst(W * 0.94, baseY, 150, (-2 * Math.PI) / 3, 0.55, 130, 280, 30, 360);
    burst(W * 0.5, PXH * 2 * 0.95, 220, -Math.PI / 2, 1.4, 110, 300, 320, 360);
  } else {
    launchRocket(W * 0.22, PXH * 2 * 0.28, 300, 0.05);
    launchRocket(W * 0.5, PXH * 2 * 0.18, 45, 0.75);
    launchRocket(W * 0.78, PXH * 2 * 0.32, 190, 1.45);
  }
}

function simulate(now, dt) {
  if (now >= nextSpawnAt) {
    nextSpawnAt = now + CYCLE_MS;
    spawnWave();
  }

  const extra = [];
  for (const p of particles) {
    p.life -= dt;
    if (p.kind === "rocket") {
      if (p.delay > 0) {
        p.delay -= dt;
        continue;
      }
      p.y += p.vy * dt;
      p.x += p.vx * dt;
      p.trail -= dt;
      if (p.trail <= 0 && p.y > 1) {
        p.trail = 0.02;
        extra.push({
          kind: "trail",
          x: p.x,
          y: p.y,
          vx: 0,
          vy: 25,
          rgb: p.rgb,
          life: 0.35,
          maxLife: 0.35,
          grav: 12,
        });
      }
      if (p.y <= p.targetY || p.vy > -40) {
        explode(p, extra);
        p.life = 0;
      }
    } else {
      p.vy += (p.grav || 50) * dt;
      const damp = Math.exp(-dt * 0.55);
      p.vx *= damp;
      p.vy *= damp;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }
  if (extra.length > 0) particles.push(...extra);
  particles = particles.filter(
    (p) => p.life > 0 && p.y < PXH * 2 + 10 && p.x > -10 && p.x < W + 10,
  );
}

function paint(now) {
  alpha.fill(0);
  for (const p of particles) {
    if (p.delay > 0) continue;
    const lifeRatio = Math.max(0, Math.min(1, p.life / p.maxLife));
    let a = Math.min(1, 0.35 + lifeRatio);
    if (p.twinkle !== undefined) a *= 0.72 + 0.28 * Math.sin(now / 75 + p.twinkle);
    a = Math.max(0, Math.min(1, a));
    if (a <= 0.01) continue;
    const px = Math.round(p.x);
    const py = Math.round(p.y);
    if (px < 0 || px >= W || py < 0 || py >= PXH * 2) continue;
    const idx = py * W + px;
    if (a > alpha[idx]) {
      alpha[idx] = a;
      color[idx * 3] = p.rgb[0];
      color[idx * 3 + 1] = p.rgb[1];
      color[idx * 3 + 2] = p.rgb[2];
    }
  }
}

function sample(idx) {
  const a = alpha[idx];
  if (a <= 0.02) return null;
  const r = color[idx * 3];
  const g = color[idx * 3 + 1];
  const b = color[idx * 3 + 2];
  return [
    Math.round(r * a + BG[0] * (1 - a)),
    Math.round(g * a + BG[1] * (1 - a)),
    Math.round(b * a + BG[2] * (1 - a)),
  ];
}

function renderRow(row) {
  let line = "";
  let empty = 0;
  const flush = () => {
    if (empty > 0) {
      line += `\x1b[48;2;${BG[0]};${BG[1]};${BG[2]}m${" ".repeat(empty)}`;
      empty = 0;
    }
  };
  for (let col = 0; col < W; col++) {
    const top = sample((row * 2) * W + col);
    const bottom = sample((row * 2 + 1) * W + col);
    if (!top && !bottom) {
      empty += 1;
      continue;
    }
    flush();
    if (top && bottom) {
      line += `\x1b[38;2;${top[0]};${top[1]};${top[2]}m\x1b[48;2;${bottom[0]};${bottom[1]};${bottom[2]}m▀`;
    } else if (top) {
      line += `\x1b[38;2;${top[0]};${top[1]};${top[2]}m\x1b[48;2;${BG[0]};${BG[1]};${BG[2]}m▀`;
    } else {
      line += `\x1b[38;2;${bottom[0]};${bottom[1]};${bottom[2]}m\x1b[48;2;${BG[0]};${BG[1]};${BG[2]}m▄`;
    }
  }
  flush();
  return `${line}\x1b[0m`;
}

function charWidth(char) {
  const cp = char.codePointAt(0);
  const wide =
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0x1f000 && cp <= 0x1faff);
  return wide ? 2 : 1;
}

function fitToWidth(text) {
  let width = 0;
  let result = "";
  for (const char of text) {
    const charWidthValue = charWidth(char);
    if (width + charWidthValue > W) break;
    result += char;
    width += charWidthValue;
  }
  return result;
}

function centered(text) {
  const fitted = fitToWidth(text);
  let width = 0;
  for (const char of fitted) width += charWidth(char);
  const pad = Math.max(0, Math.floor((W - width) / 2));
  return " ".repeat(pad) + fitted;
}

function bgEscape() {
  return `\x1b[48;2;${BG[0]};${BG[1]};${BG[2]}m`;
}

function render(now) {
  let frame = "";
  for (let row = 0; row < PXH; row++) {
    frame += `\x1b[${row + 1};1H${renderRow(row)}`;
  }

  if (FOOTER > 0) {
    const refsPart = info.refs > 1 ? ` · ${info.refs} refs` : "";
    const line1 = `🚀 ${info.branch} → ${info.remote}${refsPart}`;
    const line2 = `${info.repo} · press any key to dismiss`;
    frame += `\x1b[${PXH + 1};1H${bgEscape()}\x1b[K\x1b[38;2;225;225;240m\x1b[1m${centered(line1)}`;
    frame += `\x1b[${PXH + 2};1H${bgEscape()}\x1b[K\x1b[38;2;150;150;175m${centered(line2)}`;
  }

  if (now < 1800) {
    const row = Math.max(1, Math.floor(PXH * 0.2));
    frame += `\x1b[${row};1H${bgEscape()}\x1b[K\x1b[38;2;255;236;150m\x1b[1m${centered("★  P U S H E D  ★")}`;
  }

  out.write(frame);
}

function cleanup() {
  if (cleaned) return;
  cleaned = true;
  if (timer) clearInterval(timer);
  try {
    inp.setRawMode(false);
  } catch {
    // not in raw mode
  }
  try {
    inp.pause();
  } catch {
    // already paused
  }
  try {
    out.write("\x1b[?25h\x1b[0m\x1b[?1049l");
  } catch {
    // terminal already gone
  }
}

function finish() {
  cleanup();
  process.exit(0);
}

out.write("\x1b[?1049h\x1b[?25l\x1b[2J");
try {
  inp.setRawMode(true);
  inp.resume();
  inp.on("data", finish);
} catch {
  // non-interactive stdin; animation still runs
}
process.on("SIGINT", finish);
process.on("SIGTERM", finish);
process.on("exit", cleanup);
out.on("resize", () => {
  W = Math.max(20, out.columns || 80);
  H = Math.max(6, out.rows || 24);
  FOOTER = H >= 8 ? 2 : 0;
  PXH = Math.max(2, H - FOOTER);
  alpha = new Float32Array(W * PXH * 2);
  color = new Uint8Array(W * PXH * 2 * 3);
  out.write("\x1b[2J");
});

if (config.sound && process.platform === "darwin") {
  try {
    spawn("afplay", ["/System/Library/Sounds/Glass.aiff"], {
      detached: true,
      stdio: "ignore",
    }).unref();
  } catch {
    // sound is best effort
  }
}

startedAt = performance.now();
lastTick = startedAt;
timer = setInterval(() => {
  const now = performance.now() - startedAt;
  const dt = Math.min(0.05, Math.max(0.001, (now - lastTick) / 1000));
  lastTick = now;
  simulate(now, dt);
  paint(now);
  render(now);
}, FRAME_MS);
