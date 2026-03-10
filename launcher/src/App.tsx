import { useEffect, useState, useCallback } from "react";
import { Pencil, Trash2, RefreshCw, Check, Circle, Search, Plug, Play } from "lucide-react";
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

type View = "main" | "discover" | "remote";

function App() {
  const [clips, setClips] = useState<ClipBookmark[]>([]);
  const [env, setEnv] = useState<EnvStatus | null>(null);
  const [envChecking, setEnvChecking] = useState(true);
  const [view, setView] = useState<View>("main");

  // Edit dialog
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editIndex, setEditIndex] = useState(-1);
  const [form, setForm] = useState({ name: "", server_url: "", token: "" });
  const [clearedName, setClearedName] = useState<string | null>(null);

  // Import dialog
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importJson, setImportJson] = useState("");
  const [importParsed, setImportParsed] = useState<ClipBookmark[]>([]);
  const [importError, setImportError] = useState<string | null>(null);

  // Discover state
  const [discoveredClips, setDiscoveredClips] = useState<DiscoveredClip[]>([]);
  const [discoverLoading, setDiscoverLoading] = useState(false);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [addingClips, setAddingClips] = useState<Set<string>>(new Set());
  const [addedClips, setAddedClips] = useState<Set<string>>(new Set());
  // The server context used for the current discover session (local or remote)
  const [discoverServer, setDiscoverServer] = useState({ url: "", token: "" });

  // Remote server form
  const [remoteUrl, setRemoteUrl] = useState("");
  const [remoteToken, setRemoteToken] = useState("");
  const [remoteError, setRemoteError] = useState<string | null>(null);
  const [remoteConnecting, setRemoteConnecting] = useState(false);

  const loadClips = useCallback(async () => {
    if (window.LauncherBridge) {
      setClips(await window.LauncherBridge.getClips());
    }
  }, []);

  const checkEnv = useCallback(async () => {
    setEnvChecking(true);
    try {
      if (window.LauncherBridge) {
        const status = await window.LauncherBridge.detectEnvironment();
        setEnv(status);
      }
    } catch (err) {
      console.error("detectEnvironment failed:", err);
    } finally {
      setEnvChecking(false);
    }
  }, []);

  useEffect(() => {
    loadClips();
    checkEnv();
  }, [loadClips, checkEnv]);

  // Import JSON parse
  useEffect(() => {
    const trimmed = importJson.trim();
    if (!trimmed) { setImportParsed([]); setImportError(null); return; }
    try {
      const parsed = JSON.parse(trimmed);
      const items: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
      const valid = items.every(
        (item: unknown) =>
          item !== null && typeof item === "object" &&
          typeof (item as Record<string, unknown>).name === "string" &&
          typeof (item as Record<string, unknown>).server_url === "string" &&
          typeof (item as Record<string, unknown>).token === "string",
      );
      if (!valid) { setImportError("Each item must have name, server_url, and token"); setImportParsed([]); }
      else { setImportError(null); setImportParsed(items as ClipBookmark[]); }
    } catch { setImportError("Invalid JSON"); setImportParsed([]); }
  }, [importJson]);

  // --- Handlers ---

  function openAdd() { setEditIndex(-1); setForm({ name: "", server_url: "", token: "" }); setDialogOpen(true); }
  function openEdit(index: number) {
    const c = clips[index];
    setEditIndex(index);
    setForm({ name: c.name, server_url: c.server_url, token: c.token });
    setDialogOpen(true);
  }

  async function handleSave() {
    const name = form.name.trim(), server_url = form.server_url.trim(), token = form.token.trim();
    if (!name || !server_url || !token) return;
    const config: ClipBookmark = { name, server_url, token };
    const next = [...clips];
    if (editIndex >= 0) next[editIndex] = config; else next.push(config);
    if (window.LauncherBridge) await window.LauncherBridge.saveClips(next);
    setClips(next); setDialogOpen(false);
  }

  async function handleDelete(index: number) {
    if (!confirm(`Delete "${clips[index].name}"?`)) return;
    const next = clips.filter((_, i) => i !== index);
    if (window.LauncherBridge) await window.LauncherBridge.saveClips(next);
    setClips(next);
  }

  async function handleClearCache(name: string) {
    if (window.LauncherBridge?.clearCache) await window.LauncherBridge.clearCache(name);
    setClearedName(name); setTimeout(() => setClearedName(null), 1500);
  }

  async function handleOpen(index: number) {
    if (window.LauncherBridge) await window.LauncherBridge.openClip(clips[index]);
  }

  async function handleImport() {
    const existingNames = new Set(clips.map(c => c.name));
    const toAdd = importParsed.filter(item => !existingNames.has(item.name));
    if (toAdd.length === 0) { setImportDialogOpen(false); setImportJson(""); return; }
    const next = [...clips, ...toAdd];
    if (window.LauncherBridge) await window.LauncherBridge.saveClips(next);
    setClips(next); setImportDialogOpen(false); setImportJson("");
  }

  const [starting, setStarting] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);

  async function handleStartBoxLite() {
    if (!env?.boxlitePath) return;
    setStarting("boxlite");
    setStartError(null);
    try {
      const result = await window.LauncherBridge.startBoxLite(env.boxlitePath);
      if (!result.ok) setStartError(`BoxLite: ${result.error}`);
      await checkEnv();
    } catch (err: any) {
      setStartError(err.message);
    } finally {
      setStarting(null);
    }
  }

  async function handleStartPinix() {
    if (!env?.pinixPath) return;
    setStarting("pinix");
    setStartError(null);
    try {
      const result = await window.LauncherBridge.startPinix(env.pinixPath);
      if (!result.ok) setStartError(`Pinix: ${result.error}`);
      await checkEnv();
    } catch (err: any) {
      setStartError(err.message);
    } finally {
      setStarting(null);
    }
  }

  // Discover clips from local server
  async function handleDiscover() {
    if (!env?.superToken || !env.serverUrl) return;
    const server = { url: env.serverUrl, token: env.superToken };
    setDiscoverServer(server);
    setView("discover");
    setDiscoverLoading(true);
    setDiscoverError(null);
    setAddedClips(new Set());
    try {
      const found = await window.LauncherBridge.discoverClips(server.url, server.token);
      setDiscoveredClips(found);
    } catch (err: any) {
      setDiscoverError(err.message);
    } finally {
      setDiscoverLoading(false);
    }
  }

  // Discover from remote server
  async function handleRemoteConnect() {
    if (!remoteUrl.trim() || !remoteToken.trim()) return;
    const server = { url: remoteUrl.trim(), token: remoteToken.trim() };
    setRemoteConnecting(true);
    setRemoteError(null);
    try {
      const found = await window.LauncherBridge.discoverClips(server.url, server.token);
      setDiscoveredClips(found);
      setDiscoverServer(server);
      setAddedClips(new Set());
      setView("discover");
    } catch (err: any) {
      setRemoteError(err.message);
    } finally {
      setRemoteConnecting(false);
    }
  }

  async function handleAddClip(clip: DiscoveredClip) {
    if (!discoverServer.url || !discoverServer.token) return;
    setAddingClips(prev => new Set(prev).add(clip.clipId));
    try {
      await window.LauncherBridge.addClipBookmark(discoverServer.url, discoverServer.token, clip.clipId);
      setAddedClips(prev => new Set(prev).add(clip.clipId));
      await loadClips();
    } catch (err: any) {
      console.error("addClipBookmark failed:", err);
    } finally {
      setAddingClips(prev => { const next = new Set(prev); next.delete(clip.clipId); return next; });
    }
  }

  function displayUrl(url: string): string {
    try { return new URL(url).host; } catch { return url; }
  }

  // --- Status indicator ---
  function StatusDot({ status }: { status: "not_installed" | "installed" | "running" }) {
    if (status === "running") return <Circle className="size-2.5 fill-green-500 text-green-500" />;
    if (status === "installed") return <Circle className="size-2.5 fill-yellow-500 text-yellow-500" />;
    return <Circle className="size-2.5 fill-red-400 text-red-400" />;
  }

  function statusLabel(status: "not_installed" | "installed" | "running") {
    if (status === "running") return "running";
    if (status === "installed") return "installed (not running)";
    return "not installed";
  }

  // --- Render ---

  if (view === "discover") {
    return (
      <div className="min-h-screen bg-background px-8 pt-10 pb-8 font-sans">
        <div className="mx-auto max-w-lg">
          <header className="mb-6">
            <div className="flex items-baseline justify-between">
              <h1 className="text-[2rem] font-bold tracking-tight text-foreground leading-none" style={{ fontFamily: "'Playfair Display', Georgia, serif" }}>
                Discover
              </h1>
              <button onClick={() => setView("main")} className="text-sm text-muted-foreground hover:text-foreground transition-colors underline underline-offset-4 decoration-border">
                Back
              </button>
            </div>
            <div className="mt-3 h-[2px] bg-foreground" />
            <div className="mt-[2px] h-px bg-foreground" />
            <p className="mt-3 text-xs text-muted-foreground">
              {discoverServer.url ? displayUrl(discoverServer.url) : ""}
            </p>
          </header>

          {discoverLoading && <div className="py-16 text-center text-sm text-muted-foreground animate-pulse">Loading clips...</div>}
          {discoverError && <div className="py-4 text-sm text-red-500">{discoverError}</div>}

          {!discoverLoading && discoveredClips.length > 0 && (
            <div>
              {discoveredClips.map(clip => {
                const alreadyAdded = clips.some(c => c.name === clip.name) || addedClips.has(clip.clipId);
                const isAdding = addingClips.has(clip.clipId);
                return (
                  <div key={clip.clipId} className="group border-b border-border py-3 first:pt-0">
                    <div className="flex items-start justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="text-lg font-normal text-foreground leading-snug" style={{ fontFamily: "'Playfair Display', Georgia, serif" }}>
                          {clip.name}
                        </div>
                        {clip.desc && <div className="mt-0.5 text-[11px] text-muted-foreground">{clip.desc}</div>}
                        {clip.hasWeb && <span className="inline-block mt-1 text-[9px] font-medium tracking-wider uppercase text-muted-foreground border border-border rounded px-1.5 py-0.5">web</span>}
                      </div>
                      <div className="ml-4 shrink-0 pt-1">
                        {alreadyAdded ? (
                          <span className="text-xs text-green-500 flex items-center gap-1"><Check className="size-3" /> Added</span>
                        ) : isAdding ? (
                          <span className="text-xs text-muted-foreground animate-pulse">Adding...</span>
                        ) : (
                          <button onClick={() => handleAddClip(clip)} className="text-xs text-muted-foreground hover:text-foreground transition-colors underline underline-offset-4">
                            + Add
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {!discoverLoading && discoveredClips.length === 0 && !discoverError && (
            <div className="py-16 text-center text-sm text-muted-foreground italic">No clips found on this server</div>
          )}
        </div>
      </div>
    );
  }

  if (view === "remote") {
    return (
      <div className="min-h-screen bg-background px-8 pt-10 pb-8 font-sans">
        <div className="mx-auto max-w-lg">
          <header className="mb-6">
            <div className="flex items-baseline justify-between">
              <h1 className="text-[2rem] font-bold tracking-tight text-foreground leading-none" style={{ fontFamily: "'Playfair Display', Georgia, serif" }}>
                Connect
              </h1>
              <button onClick={() => setView("main")} className="text-sm text-muted-foreground hover:text-foreground transition-colors underline underline-offset-4 decoration-border">
                Back
              </button>
            </div>
            <div className="mt-3 h-[2px] bg-foreground" />
            <div className="mt-[2px] h-px bg-foreground" />
          </header>

          <div className="space-y-5 mt-6">
            <div className="grid gap-1.5">
              <label className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Server URL</label>
              <input
                placeholder="http://192.168.1.100:9875"
                value={remoteUrl}
                onChange={e => setRemoteUrl(e.target.value)}
                className="h-9 w-full border-0 border-b border-border bg-transparent px-0 font-mono text-sm text-foreground placeholder:text-muted-foreground/60 outline-none focus:border-foreground transition-colors"
              />
            </div>
            <div className="grid gap-1.5">
              <label className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Super Token</label>
              <input
                type="password"
                placeholder="cbb952..."
                value={remoteToken}
                onChange={e => setRemoteToken(e.target.value)}
                className="h-9 w-full border-0 border-b border-border bg-transparent px-0 font-mono text-sm text-foreground placeholder:text-muted-foreground/60 outline-none focus:border-foreground transition-colors"
              />
            </div>
            {remoteError && <div className="text-xs text-red-500">{remoteError}</div>}
            <button
              onClick={handleRemoteConnect}
              disabled={!remoteUrl.trim() || !remoteToken.trim() || remoteConnecting}
              className="text-sm font-medium text-foreground hover:text-muted-foreground transition-colors underline underline-offset-4 disabled:text-muted-foreground/40 disabled:no-underline"
            >
              {remoteConnecting ? "Connecting..." : "Connect & Discover →"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // --- Main view ---
  return (
    <div className="min-h-screen bg-background px-8 pt-10 pb-8 font-sans">
      <div className="mx-auto max-w-lg">
        {/* Header */}
        <header className="mb-6">
          <div className="flex items-baseline justify-between">
            <h1 className="text-[2rem] font-bold tracking-tight text-foreground leading-none" style={{ fontFamily: "'Playfair Display', Georgia, serif" }}>
              Clip Dock
            </h1>
            <div className="flex gap-4">
              <button onClick={() => { setImportJson(""); setImportDialogOpen(true); }} className="text-sm text-muted-foreground hover:text-foreground transition-colors underline underline-offset-4 decoration-border hover:decoration-foreground">
                Import
              </button>
              <button onClick={openAdd} className="text-sm text-muted-foreground hover:text-foreground transition-colors underline underline-offset-4 decoration-border hover:decoration-foreground">
                + New
              </button>
            </div>
          </div>
          <div className="mt-3 h-[2px] bg-foreground" />
          <div className="mt-[2px] h-px bg-foreground" />
        </header>

        {/* Environment Status */}
        {env && (
          <div className="mb-6 space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Environment</h2>
              <button onClick={checkEnv} disabled={envChecking} className="text-muted-foreground hover:text-foreground transition-colors">
                <RefreshCw className={`size-3 ${envChecking ? "animate-spin" : ""}`} />
              </button>
            </div>
            <div className="space-y-1.5 text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <StatusDot status={env.boxlite} />
                <span>BoxLite — {statusLabel(env.boxlite)}</span>
                {env.boxlite === "installed" && (
                  <button onClick={handleStartBoxLite} disabled={starting === "boxlite"}
                    className="ml-2 flex items-center gap-1 text-[10px] text-foreground hover:text-muted-foreground transition-colors underline underline-offset-2">
                    <Play className="size-2.5" /> {starting === "boxlite" ? "Starting..." : "Start"}
                  </button>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <StatusDot status={env.pinix} />
                <span>Pinix — {statusLabel(env.pinix)}</span>
                {env.pinix === "installed" && env.boxlite === "running" && (
                  <button onClick={handleStartPinix} disabled={starting === "pinix"}
                    className="ml-2 flex items-center gap-1 text-[10px] text-foreground hover:text-muted-foreground transition-colors underline underline-offset-2">
                    <Play className="size-2.5" /> {starting === "pinix" ? "Starting..." : "Start"}
                  </button>
                )}
              </div>
              {startError && <div className="text-[10px] text-red-500 mt-1">{startError}</div>}
            </div>

            {/* Action buttons based on state */}
            <div className="flex gap-3 pt-1">
              {env.pinix === "running" && env.superToken && (
                <button onClick={handleDiscover} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors underline underline-offset-4">
                  <Search className="size-3" /> Discover Clips
                </button>
              )}
              <button onClick={() => setView("remote")} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors underline underline-offset-4">
                <Plug className="size-3" /> Remote Server
              </button>
            </div>
          </div>
        )}

        {/* Clip List */}
        {clips.length === 0 ? (
          <div className="py-16 text-center text-sm text-muted-foreground italic">
            {env?.pinix === "running" ? "No clips yet — try Discover" : "No clips yet"}
          </div>
        ) : (
          <div>
            {clips.map((clip, i) => (
              <div key={i} className="group cursor-pointer border-b border-border py-3 first:pt-0 transition-colors hover:bg-accent/50" onClick={() => handleOpen(i)}>
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="text-lg font-normal text-foreground leading-snug" style={{ fontFamily: "'Playfair Display', Georgia, serif" }}>{clip.name}</div>
                    <div className="mt-0.5 font-mono text-[11px] tracking-wider text-muted-foreground">{displayUrl(clip.server_url)}</div>
                  </div>
                  <div className="ml-4 flex shrink-0 gap-2 opacity-0 group-hover:opacity-100 transition-opacity pt-1">
                    <button onClick={e => { e.stopPropagation(); handleClearCache(clip.name); }} title="Clear cache" className="text-muted-foreground hover:text-foreground transition-colors">
                      {clearedName === clip.name ? <span className="text-xs text-green-500">✓</span> : <RefreshCw className="size-3.5" />}
                    </button>
                    <button onClick={e => { e.stopPropagation(); openEdit(i); }} title="Edit" className="text-muted-foreground hover:text-foreground transition-colors">
                      <Pencil className="size-3.5" />
                    </button>
                    <button onClick={e => { e.stopPropagation(); handleDelete(i); }} title="Delete" className="text-muted-foreground hover:text-foreground transition-colors">
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
            <DialogTitle className="text-xl font-normal" style={{ fontFamily: "'Playfair Display', Georgia, serif" }}>
              {editIndex >= 0 ? "Edit Clip" : "New Clip"}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-5 py-2">
            <div className="grid gap-1.5">
              <label className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Name</label>
              <input placeholder="hello-world" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                className="h-9 w-full border-0 border-b border-border bg-transparent px-0 text-sm text-foreground placeholder:text-muted-foreground/60 outline-none focus:border-foreground transition-colors" />
            </div>
            <div className="grid gap-1.5">
              <label className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Server URL</label>
              <input placeholder="http://100.66.47.40:9875" value={form.server_url} onChange={e => setForm({ ...form, server_url: e.target.value })}
                className="h-9 w-full border-0 border-b border-border bg-transparent px-0 font-mono text-sm text-foreground placeholder:text-muted-foreground/60 outline-none focus:border-foreground transition-colors" />
            </div>
            <div className="grid gap-1.5">
              <label className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Token</label>
              <input type="password" placeholder="Clip Token" value={form.token} onChange={e => setForm({ ...form, token: e.target.value })}
                className="h-9 w-full border-0 border-b border-border bg-transparent px-0 text-sm text-foreground placeholder:text-muted-foreground/60 outline-none focus:border-foreground transition-colors" />
            </div>
          </div>
          <DialogFooter className="gap-4 sm:gap-4">
            <button onClick={() => setDialogOpen(false)} className="text-sm text-muted-foreground hover:text-foreground transition-colors underline underline-offset-4 decoration-border">Cancel</button>
            <button onClick={handleSave} className="text-sm font-medium text-foreground hover:text-muted-foreground transition-colors underline underline-offset-4">Save</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import Dialog */}
      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent className="sm:max-w-md rounded-sm border-border bg-background shadow-none">
          <DialogHeader>
            <DialogTitle className="text-xl font-normal" style={{ fontFamily: "'Playfair Display', Georgia, serif" }}>Import Bookmark</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-1.5">
              <label className="text-xs font-medium uppercase tracking-widest text-muted-foreground">JSON</label>
              <textarea placeholder={'{"name": "...", "server_url": "...", "token": "..."}'} value={importJson} onChange={e => setImportJson(e.target.value)}
                className="min-h-[120px] w-full border-0 border-b border-border bg-transparent px-0 py-2 font-mono text-sm text-foreground placeholder:text-muted-foreground/60 outline-none focus:border-foreground transition-colors resize-none" />
            </div>
            <div className="min-h-[40px]">
              {importError ? (
                <div className="text-xs text-red-500">{importError}</div>
              ) : importParsed.length > 0 ? (
                <div className="space-y-2">
                  <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Preview ({importParsed.filter(p => !clips.some(c => c.name === p.name)).length} new)
                  </div>
                  {importParsed.map((item, i) => {
                    const exists = clips.some(c => c.name === item.name);
                    return (
                      <div key={i} className="flex items-baseline justify-between gap-4 border-b border-border/50 pb-1 last:border-0">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs font-medium text-foreground">{item.name}</div>
                          <div className="truncate font-mono text-[10px] text-muted-foreground">{displayUrl(item.server_url)}</div>
                        </div>
                        {exists && <span className="shrink-0 text-[10px] italic text-muted-foreground">already exists</span>}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-xs text-muted-foreground italic">Paste JSON to preview</div>
              )}
            </div>
          </div>
          <DialogFooter className="gap-4 sm:gap-4">
            <button onClick={() => setImportDialogOpen(false)} className="text-sm text-muted-foreground hover:text-foreground transition-colors underline underline-offset-4 decoration-border">Cancel</button>
            <button onClick={handleImport} disabled={importParsed.length === 0 || !!importError}
              className="text-sm font-medium text-foreground hover:text-muted-foreground transition-colors underline underline-offset-4 disabled:text-muted-foreground/40 disabled:no-underline disabled:cursor-not-allowed">Import</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default App;
