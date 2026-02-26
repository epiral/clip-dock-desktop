import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function App() {
  const [clips, setClips] = useState<ClipConfig[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editIndex, setEditIndex] = useState(-1);
  const [form, setForm] = useState({ alias: "", host: "", port: "", token: "" });

  useEffect(() => {
    if (window.LauncherBridge) {
      window.LauncherBridge.getClips().then(setClips);
    } else {
      // Dev mode mock
      setClips([{ alias: 'Notes', host: '100.66.47.40', port: 9875, token: 'demo' }]);
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

  async function handleOpen(index: number) {
    if (window.LauncherBridge) await window.LauncherBridge.openClip(clips[index]);
  }

  return (
    <div className="min-h-screen bg-[#FAFAFA] p-8 font-[system-ui,'-apple-system','Segoe_UI',Roboto,sans-serif]">
      <div className="mx-auto max-w-lg">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-semibold tracking-tight text-[#1d1d1f]">
            Pinix Clips
          </h1>
          <Button
            onClick={openAdd}
            className="bg-[#0066FF] hover:bg-[#0052CC] text-white"
            size="sm"
          >
            <Plus className="size-4" />
            添加 Clip
          </Button>
        </div>

        {clips.length === 0 ? (
          <div className="py-16 text-center text-sm text-muted-foreground">
            没有 Clip，点击上方按钮添加
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {clips.map((clip, i) => (
              <div
                key={i}
                className="flex items-center justify-between rounded-lg border border-[#e5e5e5] bg-white px-5 py-4 transition-shadow hover:shadow-sm"
              >
                <div className="min-w-0">
                  <div className="truncate text-[15px] font-medium text-[#1d1d1f]">
                    {clip.alias}
                  </div>
                  <div className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                    {clip.host}:{clip.port}
                  </div>
                </div>
                <div className="ml-4 flex shrink-0 gap-1.5">
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => handleOpen(i)}
                    title="打开"
                    className="text-[#0066FF] hover:bg-[#0066FF]/10"
                  >
                    <ExternalLink />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => openEdit(i)}
                    title="编辑"
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <Pencil />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => handleDelete(i)}
                    title="删除"
                    className="text-[#FF3B30] hover:bg-[#FF3B30]/10"
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editIndex >= 0 ? "编辑 Clip" : "添加 Clip"}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="alias">别名 (Alias)</Label>
              <Input
                id="alias"
                placeholder="Notes"
                value={form.alias}
                onChange={(e) => setForm({ ...form, alias: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="host">主机 (Host)</Label>
              <Input
                id="host"
                placeholder="100.66.47.40"
                value={form.host}
                onChange={(e) => setForm({ ...form, host: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="port">端口 (Port)</Label>
              <Input
                id="port"
                type="number"
                placeholder="9875"
                value={form.port}
                onChange={(e) => setForm({ ...form, port: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="token">Token</Label>
              <Input
                id="token"
                type="password"
                placeholder="鉴权 token"
                value={form.token}
                onChange={(e) => setForm({ ...form, token: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
            >
              取消
            </Button>
            <Button
              onClick={handleSave}
              className="bg-[#0066FF] hover:bg-[#0052CC] text-white"
            >
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default App;
