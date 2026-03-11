import { chmodSync, copyFileSync, createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
import net from "node:net";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import type { ClipBookmark } from "./types.js";

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
  description: string;
  commands: string[];
  hasWeb: boolean;
  online: boolean;
}

const PINIX_CONFIG = path.join(homedir(), ".config", "pinix", "config.yaml");
const DEFAULT_SERVER_URL = "http://localhost:9875";
const DEFAULT_BOXLITE_REST = "http://localhost:8100";
const BOXLITE_PORT = 8100;
const PINIX_PORT = 9875;

function bundledPath(...parts: string[]): string {
  const base = process.resourcesPath || path.join(process.cwd(), "vendor");
  return path.join(base, ...parts);
}

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

function findBinary(candidates: string[]): string {
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return "";
}

function readPinixConfig(): { superToken: string; serverUrl: string } {
  try {
    const raw = readFileSync(PINIX_CONFIG, "utf-8");
    const superTokenMatch = raw.match(/^super_token:\s*(.+)$/m);
    const serverUrlMatch = raw.match(/^server_url:\s*(.+)$/m);
    return {
      superToken: superTokenMatch ? superTokenMatch[1].trim() : "",
      serverUrl: serverUrlMatch ? serverUrlMatch[1].trim() : DEFAULT_SERVER_URL,
    };
  } catch {
    return { superToken: "", serverUrl: DEFAULT_SERVER_URL };
  }
}

async function checkHttp(url: string, timeoutMs = 3000): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const controller = new AbortController();
    timer = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    return response.status < 500;
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close();
      resolve(true);
    });
    server.listen(port, "127.0.0.1");
  });
}

async function waitForService(url: string, errorMessage: string): Promise<{ ok: boolean; error?: string }> {
  const running = await checkHttp(url);
  return running ? { ok: true } : { ok: false, error: errorMessage };
}

async function startDetachedProcess(binaryPath: string, args: string[], probeUrl: string, errorMessage: string): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    const child = spawn(binaryPath, args, {
      detached: true,
      stdio: "ignore",
    });

    child.once("error", (err) => {
      resolve({ ok: false, error: err.message });
    });

    child.unref();

    setTimeout(async () => {
      resolve(await waitForService(probeUrl, errorMessage));
    }, 2000);
  });
}

export async function detectEnvironment(serverUrl?: string): Promise<EnvStatus> {
  const boxlitePath = findBinary(boxlitePaths());
  const pinixPath = findBinary(pinixPaths());
  const config = readPinixConfig();
  const resolvedServerUrl = serverUrl || config.serverUrl;

  let boxliteStatus: EnvStatus["boxlite"] = "not_installed";
  if (boxlitePath) {
    boxliteStatus = (await checkHttp(DEFAULT_BOXLITE_REST)) ? "running" : "installed";
  }

  let pinixStatus: EnvStatus["pinix"] = "not_installed";
  if (pinixPath) {
    pinixStatus = (await checkHttp(`${resolvedServerUrl}/pinix.v1.AdminService/ListClips`)) ? "running" : "installed";
  }

  return {
    boxlite: boxliteStatus,
    boxlitePath,
    pinix: pinixStatus,
    pinixPath,
    serverUrl: resolvedServerUrl,
    superToken: config.superToken,
  };
}

export async function installFromBundle(): Promise<{ ok: boolean; error?: string }> {
  try {
    const binDir = path.join(homedir(), "bin");
    const rootfsDir = path.join(homedir(), ".boxlite", "rootfs");
    mkdirSync(binDir, { recursive: true });
    mkdirSync(rootfsDir, { recursive: true });

    for (const name of ["pinix", "boxlite", "boxlite-shim", "boxlite-guest", "libkrunfw.5.dylib"]) {
      const source = bundledPath("bin", name);
      const destination = path.join(binDir, name);
      if (existsSync(source) && !existsSync(destination)) {
        copyFileSync(source, destination);
        chmodSync(destination, 0o755);
      }
    }

    const rootfsGz = bundledPath("rootfs", "rootfs.ext4.gz");
    const rootfsDestination = path.join(rootfsDir, "rootfs.ext4");
    if (existsSync(rootfsGz) && !existsSync(rootfsDestination)) {
      await pipeline(createReadStream(rootfsGz), createGunzip(), createWriteStream(rootfsDestination));
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function hasBundledBinaries(): boolean {
  return existsSync(bundledPath("bin", "pinix")) && existsSync(bundledPath("bin", "boxlite"));
}

export async function discoverClips(serverUrl: string, superToken: string): Promise<DiscoveredClip[]> {
  const response = await fetch(`${serverUrl}/pinix.v1.AdminService/ListClips`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${superToken}`,
    },
    body: "{}",
  });

  if (!response.ok) {
    throw new Error(`ListClips failed: ${response.status}`);
  }

  const data = await response.json() as {
    clips?: Array<{
      clipId: string;
      name: string;
      description?: string;
      commands?: string[];
      hasWeb?: boolean;
      online?: boolean;
    }>;
  };

  return (data.clips ?? []).map((clip) => ({
    clipId: clip.clipId,
    name: clip.name,
    description: clip.description ?? "",
    commands: clip.commands ?? [],
    hasWeb: clip.hasWeb ?? false,
    online: clip.online ?? true,
  }));
}

export async function startBoxLite(binaryPath: string): Promise<{ ok: boolean; error?: string }> {
  if (!binaryPath) return { ok: false, error: "BoxLite binary not found" };
  if (!(await isPortFree(BOXLITE_PORT))) return { ok: false, error: `Port ${BOXLITE_PORT} already in use` };
  return startDetachedProcess(binaryPath, ["serve", "--port", String(BOXLITE_PORT)], DEFAULT_BOXLITE_REST, "BoxLite started but not responding");
}

export async function startPinix(binaryPath: string, boxliteRest?: string): Promise<{ ok: boolean; error?: string }> {
  if (!binaryPath) return { ok: false, error: "Pinix binary not found" };
  if (!(await isPortFree(PINIX_PORT))) return { ok: false, error: `Port ${PINIX_PORT} already in use` };
  return startDetachedProcess(
    binaryPath,
    ["serve", "--addr", `:${PINIX_PORT}`, "--boxlite-rest", boxliteRest || DEFAULT_BOXLITE_REST],
    `http://localhost:${PINIX_PORT}/pinix.v1.AdminService/ListClips`,
    "Pinix started but not responding",
  );
}

export async function generateBookmark(serverUrl: string, superToken: string, clipId: string): Promise<ClipBookmark> {
  const tokenResponse = await fetch(`${serverUrl}/pinix.v1.AdminService/GenerateToken`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${superToken}`,
    },
    body: JSON.stringify({ clipId, label: "dock-auto" }),
  });

  if (!tokenResponse.ok) {
    throw new Error(`GenerateToken failed: ${tokenResponse.status}`);
  }

  const tokenData = await tokenResponse.json() as { token?: string };
  if (!tokenData.token) throw new Error("no token in response");

  const infoResponse = await fetch(`${serverUrl}/pinix.v1.ClipService/GetInfo`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${tokenData.token}`,
    },
    body: "{}",
  });

  let clipName = clipId;
  if (infoResponse.ok) {
    const info = await infoResponse.json() as { name?: string };
    if (info.name) clipName = info.name;
  }

  return {
    name: clipName,
    server_url: serverUrl,
    token: tokenData.token,
  };
}

export async function addBookmarkFromDiscovery(serverUrl: string, superToken: string, clipId: string): Promise<ClipBookmark> {
  return generateBookmark(serverUrl, superToken, clipId);
}
