// clipsStore.ts — clips.json 读写
import { readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { ClipBookmark } from "./types.js";

const CLIPS_PATH = path.join(homedir(), ".config/pinix/clips.json");

type ClipsFile = {
  clips: ClipBookmark[];
};

function isWindowState(value: unknown): value is NonNullable<ClipBookmark["windowState"]> {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.width === "number" && Number.isFinite(candidate.width) &&
    typeof candidate.height === "number" && Number.isFinite(candidate.height) &&
    (candidate.x === undefined || (typeof candidate.x === "number" && Number.isFinite(candidate.x))) &&
    (candidate.y === undefined || (typeof candidate.y === "number" && Number.isFinite(candidate.y)))
  );
}

function isClipBookmark(value: unknown): value is ClipBookmark {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.name === "string" && candidate.name.length > 0 &&
    typeof candidate.server_url === "string" && candidate.server_url.length > 0 &&
    typeof candidate.token === "string" &&
    (candidate.windowState === undefined || isWindowState(candidate.windowState))
  );
}

function parseClipsFile(value: unknown): ClipBookmark[] {
  if (typeof value !== "object" || value === null) return [];
  const maybeFile = value as Partial<ClipsFile>;
  if (!Array.isArray(maybeFile.clips)) return [];
  return maybeFile.clips.filter(isClipBookmark);
}

export function readClips(): ClipBookmark[] {
  try {
    const data = readFileSync(CLIPS_PATH, "utf-8");
    return parseClipsFile(JSON.parse(data));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error("[readClips] failed:", err);
    }
    return [];
  }
}

export function writeClips(clips: ClipBookmark[]): void {
  const dir = path.dirname(CLIPS_PATH);
  mkdirSync(dir, { recursive: true });
  const tmp = `${CLIPS_PATH}.tmp`;
  writeFileSync(tmp, JSON.stringify({ clips: clips.filter(isClipBookmark) }, null, 2), "utf-8");
  renameSync(tmp, CLIPS_PATH);
}
