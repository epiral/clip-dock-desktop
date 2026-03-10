// environment.ts — Detect Pinix Server & BoxLite, discover clips, start services
import { readFileSync, existsSync, copyFileSync, mkdirSync, chmodSync, createReadStream, createWriteStream } from "node:fs";
import { createGunzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { execFile, spawn } from "node:child_process";
import net from "node:net";
import { homedir } from "node:os";
import path from "node:path";

// --- Bundled resources path (inside .app/Contents/Resources) ---
function bundledPath(...parts: string[]): string {
  // In packaged app: process.resourcesPath = .app/Contents/Resources
  // In dev: falls back to cwd
  const base = (process as any).resourcesPath || path.join(process.cwd(), "vendor");
  return path.join(base, ...parts);
}

// --- Types ---

export interface EnvStatus {
  boxlite: "not_installed" | "installed" | "running";
  boxlitePath: string;
  pinix: "not_installed" | "installed" | "running";
  pinixPath: string;
  serverUrl: string;
  superToken: string;
}

export interface DiscoveredClip {
  clipId: string;
  name: string;
  desc: string;
  commands: string[];
  hasWeb: boolean;
}

// --- Detection ---

function boxlitePaths(): string[] {
  return [
    path.join(homedir(), "bin", "boxlite"),
    path.join(homedir(), ".boxlite", "bin", "boxlite"),
    path.join(homedir(), ".local", "bin", "boxlite"),
    "/usr/local/bin/boxlite",
    bundledPath("bin", "boxlite"),
  ];
}

function pinixPaths(): string[] {
  return [
    path.join(homedir(), "bin", "pinix"),
    path.join(homedir(), ".local", "bin", "pinix"),
    "/usr/local/bin/pinix",
    bundledPath("bin", "pinix"),
  ];
}

const PINIX_CONFIG = path.join(homedir(), ".config", "pinix", "config.yaml");
const DEFAULT_SERVER_URL = "http://localhost:9875";
const DEFAULT_BOXLITE_REST = "http://localhost:8100";
const BOXLITE_PORT = 8100;
const PINIX_PORT = 9875;

function findBinary(candidates: string[]): string {
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return "";
}

function readPinixConfig(): { superToken: string; serverUrl: string } {
  try {
    const raw = readFileSync(PINIX_CONFIG, "utf-8");
    // Simple YAML parse: extract super_token value
    const match = raw.match(/^super_token:\s*(.+)$/m);
    return {
      superToken: match ? match[1].trim() : "",
      serverUrl: DEFAULT_SERVER_URL,
    };
  } catch {
    return { superToken: "", serverUrl: DEFAULT_SERVER_URL };
  }
}

async function checkHttp(url: string, timeoutMs = 3000): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const resp = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    clearTimeout(timer);
    return resp.status < 500;
  } catch {
    return false;
  }
}

export async function detectEnvironment(serverUrl?: string): Promise<EnvStatus> {
  const boxlitePath = findBinary(boxlitePaths());
  const pinixPath = findBinary(pinixPaths());
  const config = readPinixConfig();
  const url = serverUrl || config.serverUrl;

  // Check BoxLite REST API
  let boxliteStatus: EnvStatus["boxlite"] = "not_installed";
  if (boxlitePath) {
    boxliteStatus = "installed";
    const running = await checkHttp(DEFAULT_BOXLITE_REST);
    if (running) boxliteStatus = "running";
  }

  // Check Pinix Server
  let pinixStatus: EnvStatus["pinix"] = "not_installed";
  if (pinixPath) {
    pinixStatus = "installed";
    // Try connect to server (AdminService/ListClips requires auth, but even a 401 means server is up)
    const running = await checkHttp(url + "/pinix.v1.AdminService/ListClips");
    if (running) pinixStatus = "running";
  }

  return {
    boxlite: boxliteStatus,
    boxlitePath,
    pinix: pinixStatus,
    pinixPath,
    serverUrl: url,
    superToken: config.superToken,
  };
}

// --- Install from bundle ---

export async function installFromBundle(): Promise<{ ok: boolean; error?: string }> {
  try {
    const binDir = path.join(homedir(), "bin");
    const rootfsDir = path.join(homedir(), ".boxlite", "rootfs");
    mkdirSync(binDir, { recursive: true });
    mkdirSync(rootfsDir, { recursive: true });

    // Copy binaries
    const bins = ["pinix", "boxlite", "boxlite-shim", "boxlite-guest", "libkrunfw.5.dylib"];
    for (const name of bins) {
      const src = bundledPath("bin", name);
      const dst = path.join(binDir, name);
      if (existsSync(src) && !existsSync(dst)) {
        copyFileSync(src, dst);
        chmodSync(dst, 0o755);
      }
    }

    // Decompress rootfs (gzipped in bundle)
    const rootfsGz = bundledPath("rootfs", "rootfs.ext4.gz");
    const rootfsDst = path.join(rootfsDir, "rootfs.ext4");
    if (existsSync(rootfsGz) && !existsSync(rootfsDst)) {
      await pipeline(
        createReadStream(rootfsGz),
        createGunzip(),
        createWriteStream(rootfsDst),
      );
    }

    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

export function hasBundledBinaries(): boolean {
  return existsSync(bundledPath("bin", "pinix")) && existsSync(bundledPath("bin", "boxlite"));
}

// --- Clip Discovery ---

export async function discoverClips(serverUrl: string, superToken: string): Promise<DiscoveredClip[]> {
  const resp = await fetch(serverUrl + "/pinix.v1.AdminService/ListClips", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + superToken,
    },
    body: "{}",
  });

  if (!resp.ok) {
    throw new Error(`ListClips failed: ${resp.status}`);
  }

  const data = await resp.json() as { clips?: Array<{
    clipId: string;
    name: string;
    desc?: string;
    commands?: string[];
    hasWeb?: boolean;
  }> };

  return (data.clips ?? []).map(c => ({
    clipId: c.clipId,
    name: c.name,
    desc: c.desc ?? "",
    commands: c.commands ?? [],
    hasWeb: c.hasWeb ?? false,
  }));
}

// --- Start Services ---

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => { server.close(); resolve(true); });
    server.listen(port, "127.0.0.1");
  });
}

export async function startBoxLite(binaryPath: string): Promise<{ ok: boolean; error?: string }> {
  if (!binaryPath) return { ok: false, error: "BoxLite binary not found" };

  const free = await isPortFree(BOXLITE_PORT);
  if (!free) return { ok: false, error: `Port ${BOXLITE_PORT} already in use` };

  return new Promise((resolve) => {
    const child = spawn(binaryPath, ["serve", "--port", String(BOXLITE_PORT)], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();

    // Wait a moment then check if it started
    setTimeout(async () => {
      const running = await checkHttp(DEFAULT_BOXLITE_REST);
      if (running) {
        resolve({ ok: true });
      } else {
        resolve({ ok: false, error: "BoxLite started but not responding" });
      }
    }, 2000);
  });
}

export async function startPinix(binaryPath: string, boxliteRest?: string): Promise<{ ok: boolean; error?: string }> {
  if (!binaryPath) return { ok: false, error: "Pinix binary not found" };

  const free = await isPortFree(PINIX_PORT);
  if (!free) return { ok: false, error: `Port ${PINIX_PORT} already in use` };

  const args = ["serve", "--addr", `:${PINIX_PORT}`, "--boxlite-rest", boxliteRest || DEFAULT_BOXLITE_REST];

  return new Promise((resolve) => {
    const child = spawn(binaryPath, args, {
      detached: true,
      stdio: "ignore",
    });
    child.unref();

    setTimeout(async () => {
      const running = await checkHttp(`http://localhost:${PINIX_PORT}/pinix.v1.AdminService/ListClips`);
      if (running) {
        resolve({ ok: true });
      } else {
        resolve({ ok: false, error: "Pinix started but not responding" });
      }
    }, 2000);
  });
}

// --- Generate Token + Bookmark ---

export async function generateBookmark(
  serverUrl: string,
  superToken: string,
  clipId: string,
): Promise<{ name: string; server_url: string; token: string }> {
  // Generate clip token
  const genResp = await fetch(serverUrl + "/pinix.v1.AdminService/GenerateToken", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + superToken,
    },
    body: JSON.stringify({ clipId, label: "dock-auto" }),
  });

  if (!genResp.ok) {
    throw new Error(`GenerateToken failed: ${genResp.status}`);
  }

  const genData = await genResp.json() as { token?: string };
  if (!genData.token) throw new Error("no token in response");

  // Get clip info
  const infoResp = await fetch(serverUrl + "/pinix.v1.ClipService/GetInfo", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + genData.token,
    },
    body: "{}",
  });

  let clipName = clipId;
  if (infoResp.ok) {
    const info = await infoResp.json() as { name?: string };
    if (info.name) clipName = info.name;
  }

  return {
    name: clipName,
    server_url: serverUrl,
    token: genData.token,
  };
}
