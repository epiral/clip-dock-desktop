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
  const [clips, setClips] = useState<ClipConfig[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editIndex, setEditIndex] = useState(-1);
  const [form, setForm] = useState({ alias: "", host: "", port: "", token: "" });
  const [clearedAlias, setClearedAlias] = useState<string | null>(null);

  useEffect(() => {
    if (window.LauncherBridge) {
      window.LauncherBridge.getClips().then(setClips);
    } else {
      setClips([
        { alias: "Notes", host: "100.66.47.40", port: 9875, token: "demo" },
        { alias: "Voice Inbox", host: "100.66.47.40", port: 9876, token: "demo" },
      ]);
    }
  }, []);

  function openAdd() {
    setEditIndex(-1);
    setForm({ alias: "", host: "", port: "", token: "" });
    setDialogOpen(true);
  }

  function openEdit(index: number) {
    const c = clips[index];
    setEditIndex(index);
    setForm({ alias: c.alias, host: c.host, port: String(c.port), token: c.token });
    setDialogOpen(true);
  }

  async function handleSave() {
    const alias = form.alias.trim();
    const host = form.host.trim();
    const port = parseInt(form.port, 10);
    const token = form.token.trim();
    if (!alias || !host || !port || !token) {
      alert("请填写所有字段");
      return;
    }
    const config: ClipConfig = { alias, host, port, token };
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
    if (!confirm(`确定删除 "${clips[index].alias}"？`)) return;
    const next = clips.filter((_, i) => i !== index);
    if (window.LauncherBridge) await window.LauncherBridge.saveClips(next);
    setClips(next);
  }

  async function handleClearCache(alias: string) {
    if (window.LauncherBridge?.clearCache) {
      await window.LauncherBridge.clearCache(alias);
    }
    setClearedAlias(alias);
    setTimeout(() => setClearedAlias(null), 1500);
  }

  async function handleOpen(index: number) {
    if (window.LauncherBridge) await window.LauncherBridge.openClip(clips[index]);
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
              Pinix
            </h1>
            <button
              onClick={openAdd}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors underline underline-offset-4 decoration-border hover:decoration-foreground"
            >
              + New Clip
            </button>
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
                      {clip.alias}
                    </div>
                    <div className="mt-0.5 font-mono text-[11px] tracking-wider text-muted-foreground">
                      {clip.host}:{clip.port}
                    </div>
                  </div>
                  <div className="ml-4 flex shrink-0 gap-2 opacity-0 group-hover:opacity-100 transition-opacity pt-1">
                    <button
                      onClick={(e) => { e.stopPropagation(); handleClearCache(clip.alias); }}
                      title="Clear cache"
                      className="text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {clearedAlias === clip.alias ? (
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

      {/* Dialog */}
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
              <label htmlFor="alias" className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                Alias
              </label>
              <input
                id="alias"
                placeholder="Notes"
                value={form.alias}
                onChange={(e) => setForm({ ...form, alias: e.target.value })}
                className="h-9 w-full border-0 border-b border-border bg-transparent px-0 text-sm text-foreground placeholder:text-muted-foreground/60 outline-none focus:border-foreground transition-colors"
              />
            </div>
            <div className="grid gap-1.5">
              <label htmlFor="host" className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                Host
              </label>
              <input
                id="host"
                placeholder="100.66.47.40"
                value={form.host}
                onChange={(e) => setForm({ ...form, host: e.target.value })}
                className="h-9 w-full border-0 border-b border-border bg-transparent px-0 font-mono text-sm text-foreground placeholder:text-muted-foreground/60 outline-none focus:border-foreground transition-colors"
              />
            </div>
            <div className="grid gap-1.5">
              <label htmlFor="port" className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                Port
              </label>
              <input
                id="port"
                type="number"
                placeholder="9875"
                value={form.port}
                onChange={(e) => setForm({ ...form, port: e.target.value })}
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
                placeholder="鉴权 token"
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
    </div>
  );
}

export default App;
