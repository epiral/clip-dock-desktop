// clipsStore.ts — clips.json 读写
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
const CLIPS_PATH = path.join(homedir(), ".config/pinix/clips.json");
export function readClips() {
    try {
        const data = readFileSync(CLIPS_PATH, "utf-8");
        const parsed = JSON.parse(data);
        return Array.isArray(parsed.clips) ? parsed.clips : [];
    }
    catch {
        return [];
    }
}
export function writeClips(clips) {
    const dir = path.dirname(CLIPS_PATH);
    if (!existsSync(dir))
        mkdirSync(dir, { recursive: true });
    writeFileSync(CLIPS_PATH, JSON.stringify({ clips }, null, 2), "utf-8");
}
