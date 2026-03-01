// clipsStore.ts — clips.json 读写（含旧格式自动迁移）
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { ClipBookmark } from "./types.js";

const CLIPS_PATH = path.join(homedir(), ".config/pinix/clips.json");

// 旧格式 → 新格式迁移
function isLegacy(obj: Record<string, unknown>): boolean {
  return typeof obj.alias === "string" && typeof obj.host === "string" && typeof obj.port === "number";
}

function migrateEntry(obj: Record<string, unknown>): ClipBookmark {
  if (isLegacy(obj)) {
    return {
      name: obj.alias as string,
      server_url: `http://${obj.host}:${obj.port}`,
      token: String(obj.token ?? ""),
      ...(obj.windowState ? { windowState: obj.windowState as ClipBookmark["windowState"] } : {}),
    };
  }
  return obj as unknown as ClipBookmark;
}

export function readClips(): ClipBookmark[] {
  try {
    const data = readFileSync(CLIPS_PATH, "utf-8");
    const parsed = JSON.parse(data);
    if (!Array.isArray(parsed.clips)) return [];
    const clips = parsed.clips.map((c: Record<string, unknown>) => migrateEntry(c));
    // 有旧格式条目时立即写回新格式
    if (parsed.clips.some((c: Record<string, unknown>) => isLegacy(c))) {
      writeClips(clips);
    }
    return clips;
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
