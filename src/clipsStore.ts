// clipsStore.ts — clips.json 读写
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { ClipBookmark } from "./types.js";

const CLIPS_PATH = path.join(homedir(), ".config/pinix/clips.json");

export function readClips(): ClipBookmark[] {
  try {
    const data = readFileSync(CLIPS_PATH, "utf-8");
    const parsed = JSON.parse(data);
    if (!Array.isArray(parsed.clips)) return [];
    return parsed.clips as ClipBookmark[];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error("[readClips] failed:", err);
    }
    return [];
  }
}

export function writeClips(clips: ClipBookmark[]): void {
  const dir = path.dirname(CLIPS_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmp = CLIPS_PATH + ".tmp";
  writeFileSync(tmp, JSON.stringify({ clips }, null, 2), "utf-8");
  renameSync(tmp, CLIPS_PATH);
}
