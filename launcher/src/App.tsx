import { useEffect, useState } from "react";
import { Pencil, Trash2, RefreshCw } from "lucide-react";
import "@fontsource/playfair-display/400.css";
import "@fontsource/playfair-display/700.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

function App() {
  const [clips, setClips] = useState<ClipBookmark[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editIndex, setEditIndex] = useState(-1);
  const [form, setForm] = useState({ name: "", server_url: "", token: "" });
  const [clearedName, setClearedName] = useState<string | null>(null);

  // Import 状态
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importJson, setImportJson] = useState("");
  const [importParsed, setImportParsed] = useState<ClipBookmark[]>([]);
  const [importError, setImportError] = useState<string | null>(null);

  useEffect(() => {
    if (window.LauncherBridge) {
      window.LauncherBridge.getClips().then(setClips);
    } else {
      setClips([
        { name: "Notes", server_url: "http://100.66.47.40:9875", token: "demo" },
        { name: "Voice Inbox", server_url: "http://100.66.47.40:9875", token: "demo" },
      ]);
    }
  }, []);

  // 实时解析 JSON 输入
  useEffect(() => {
    const trimmed = importJson.trim();
    if (!trimmed) {
      setImportParsed([]);
      setImportError(null);
      return;
    }
    try {
      const parsed = JSON.parse(trimmed);
      const items: unknown[] = Array.isArray(parsed) ? parsed : [parsed];

      const valid = items.every(
        (item: unknown) =>
          item !== null &&
          typeof item === "object" &&
          typeof (item as Record<string, unknown>).name === "string" &&
          typeof (item as Record<string, unknown>).server_url === "string" &&
          typeof (item as Record<string, unknown>).token === "string",
      );

      if (!valid) {
        setImportError("Each item must have name, server_url, and token");
        setImportParsed([]);
      } else {
        setImportError(null);
        setImportParsed(items as ClipBookmark[]);
      }
    } catch {
      setImportError("Invalid JSON");
      setImportParsed([]);
    }
  }, [importJson]);

  function openAdd() {
    setEditIndex(-1);
    setForm({ name: "", server_url: "", token: "" });
    setDialogOpen(true);
  }

  function openEdit(index: number) {
    const c = clips[index];
    setEditIndex(index);
    setForm({ name: c.name, server_url: c.server_url, token: c.token });
    setDialogOpen(true);
  }

  async function handleSave() {
    const name = form.name.trim();
    const server_url = form.server_url.trim();
    const token = form.token.trim();
    if (!name || !server_url || !token) {
      alert("请填写所有字段");
      return;
    }
    const config: ClipBookmark = { name, server_url, token };
    const next = [...clips];
    if (editIndex >= 0) {
      next[editIndex] = config;
    } else {
      next.push(config);
    }
    if (window.LauncherBridge) await window.LauncherBridge.saveClips(next);
    setClips(next);
    setDialogOpen(false);
  }

  async function handleDelete(index: number) {
    if (!confirm(`确定删除 "${clips[index].name}"？`)) return;
    const next = clips.filter((_, i) => i !== index);
    if (window.LauncherBridge) await window.LauncherBridge.saveClips(next);
    setClips(next);
  }

  async function handleClearCache(name: string) {
    if (window.LauncherBridge?.clearCache) {
      await window.LauncherBridge.clearCache(name);
    }
    setClearedName(name);
    setTimeout(() => setClearedName(null), 1500);
  }

  async function handleOpen(index: number) {
    if (window.LauncherBridge) await window.LauncherBridge.openClip(clips[index]);
  }

  async function handleImport() {
    const existingNames = new Set(clips.map((c) => c.name));
    const toAdd = importParsed.filter((item) => !existingNames.has(item.name));

    if (toAdd.length === 0) {
      setImportDialogOpen(false);
      setImportJson("");
      return;
    }

    const next = [...clips, ...toAdd];
    if (window.LauncherBridge) await window.LauncherBridge.saveClips(next);
    setClips(next);
    setImportDialogOpen(false);
    setImportJson("");
  }

  // 从 server_url 提取显示用的 host 信息
  function displayUrl(url: string): string {
    try {
      const u = new URL(url);
      return u.host;
    } catch {
      return url;
    }
  }

  return (
    <div className="min-h-screen bg-background px-8 pt-10 pb-8 font-sans">
      <div className="mx-auto max-w-lg">
        {/* Header */}
        <header className="mb-8">
          <div className="flex items-baseline justify-between">
            <h1
              className="text-[2rem] font-bold tracking-tight text-foreground leading-none"
              style={{ fontFamily: "'Playfair Display', Georgia, serif" }}
            >
              Clip Dock
            </h1>
            <div className="flex gap-4">
              <button
                onClick={() => {
                  setImportJson("");
                  setImportDialogOpen(true);
                }}
                className="text-sm text-muted-foreground hover:text-foreground transition-colors underline underline-offset-4 decoration-border hover:decoration-foreground"
              >
                Import
              </button>
              <button
                onClick={openAdd}
                className="text-sm text-muted-foreground hover:text-foreground transition-colors underline underline-offset-4 decoration-border hover:decoration-foreground"
              >
                + New Clip
              </button>
            </div>
          </div>
          <div className="mt-3 h-[2px] bg-foreground" />
          <div className="mt-[2px] h-px bg-foreground" />
        </header>

        {/* Clip List */}
        {clips.length === 0 ? (
          <div className="py-16 text-center text-sm text-muted-foreground italic">
            No clips yet
          </div>
        ) : (
          <div>
            {clips.map((clip, i) => (
              <div
                key={i}
                className="group cursor-pointer border-b border-border py-3 first:pt-0 transition-colors hover:bg-accent/50"
                onClick={() => handleOpen(i)}
              >
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <div
                      className="text-lg font-normal text-foreground leading-snug"
                      style={{ fontFamily: "'Playfair Display', Georgia, serif" }}
                    >
                      {clip.name}
                    </div>
                    <div className="mt-0.5 font-mono text-[11px] tracking-wider text-muted-foreground">
                      {displayUrl(clip.server_url)}
                    </div>
                  </div>
                  <div className="ml-4 flex shrink-0 gap-2 opacity-0 group-hover:opacity-100 transition-opacity pt-1">
                    <button
                      onClick={(e) => { e.stopPropagation(); handleClearCache(clip.name); }}
                      title="Clear cache"
                      className="text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {clearedName === clip.name ? (
                        <span className="text-xs text-green-500">✓</span>
                      ) : (
                        <RefreshCw className="size-3.5" />
                      )}
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); openEdit(i); }}
                      title="编辑"
                      className="text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <Pencil className="size-3.5" />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(i); }}
                      title="删除"
                      className="text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Edit/New Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md rounded-sm border-border bg-background shadow-none">
          <DialogHeader>
            <DialogTitle
              className="text-xl font-normal"
              style={{ fontFamily: "'Playfair Display', Georgia, serif" }}
            >
              {editIndex >= 0 ? "Edit Clip" : "New Clip"}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-5 py-2">
            <div className="grid gap-1.5">
              <label htmlFor="name" className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                Name
              </label>
              <input
                id="name"
                placeholder="hello-world"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="h-9 w-full border-0 border-b border-border bg-transparent px-0 text-sm text-foreground placeholder:text-muted-foreground/60 outline-none focus:border-foreground transition-colors"
              />
            </div>
            <div className="grid gap-1.5">
              <label htmlFor="server_url" className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                Server URL
              </label>
              <input
                id="server_url"
                placeholder="http://100.66.47.40:9875"
                value={form.server_url}
                onChange={(e) => setForm({ ...form, server_url: e.target.value })}
                className="h-9 w-full border-0 border-b border-border bg-transparent px-0 font-mono text-sm text-foreground placeholder:text-muted-foreground/60 outline-none focus:border-foreground transition-colors"
              />
            </div>
            <div className="grid gap-1.5">
              <label htmlFor="token" className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                Token
              </label>
              <input
                id="token"
                type="password"
                placeholder="Clip Token"
                value={form.token}
                onChange={(e) => setForm({ ...form, token: e.target.value })}
                className="h-9 w-full border-0 border-b border-border bg-transparent px-0 text-sm text-foreground placeholder:text-muted-foreground/60 outline-none focus:border-foreground transition-colors"
              />
            </div>
          </div>
          <DialogFooter className="gap-4 sm:gap-4">
            <button
              onClick={() => setDialogOpen(false)}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors underline underline-offset-4 decoration-border"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="text-sm font-medium text-foreground hover:text-muted-foreground transition-colors underline underline-offset-4"
            >
              Save
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import Dialog */}
      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent className="sm:max-w-md rounded-sm border-border bg-background shadow-none">
          <DialogHeader>
            <DialogTitle
              className="text-xl font-normal"
              style={{ fontFamily: "'Playfair Display', Georgia, serif" }}
            >
              Import Bookmark
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-1.5">
              <label className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                JSON
              </label>
              <textarea
                placeholder={'{"name": "...", "server_url": "...", "token": "..."}'}
                value={importJson}
                onChange={(e) => setImportJson(e.target.value)}
                className="min-h-[120px] w-full border-0 border-b border-border bg-transparent px-0 py-2 font-mono text-sm text-foreground placeholder:text-muted-foreground/60 outline-none focus:border-foreground transition-colors resize-none"
              />
            </div>

            {/* 预览区 */}
            <div className="min-h-[40px]">
              {importError ? (
                <div className="text-xs text-red-500">{importError}</div>
              ) : importParsed.length > 0 ? (
                <div className="space-y-2">
                  <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Preview ({importParsed.filter((p) => !clips.some((c) => c.name === p.name)).length} new)
                  </div>
                  {importParsed.map((item, i) => {
                    const exists = clips.some((c) => c.name === item.name);
                    return (
                      <div
                        key={i}
                        className="flex items-baseline justify-between gap-4 border-b border-border/50 pb-1 last:border-0"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs font-medium text-foreground">
                            {item.name}
                          </div>
                          <div className="truncate font-mono text-[10px] text-muted-foreground">
                            {displayUrl(item.server_url)}
                          </div>
                        </div>
                        {exists && (
                          <span className="shrink-0 text-[10px] italic text-muted-foreground">
                            already exists
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-xs text-muted-foreground italic">
                  Paste JSON to preview
                </div>
              )}
            </div>
          </div>
          <DialogFooter className="gap-4 sm:gap-4">
            <button
              onClick={() => setImportDialogOpen(false)}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors underline underline-offset-4 decoration-border"
            >
              Cancel
            </button>
            <button
              onClick={handleImport}
              disabled={importParsed.length === 0 || !!importError}
              className="text-sm font-medium text-foreground hover:text-muted-foreground transition-colors underline underline-offset-4 disabled:text-muted-foreground/40 disabled:no-underline disabled:cursor-not-allowed"
            >
              Import
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default App;
