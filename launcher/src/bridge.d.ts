interface ClipBookmark {
  name: string;
  server_url: string;
  token: string;
}

interface EnvStatus {
  boxlite: "not_installed" | "installed" | "running";
  boxlitePath: string;
  pinix: "not_installed" | "installed" | "running";
  pinixPath: string;
  serverUrl: string;
  superToken: string;
}

interface DiscoveredClip {
  clipId: string;
  name: string;
  desc: string;
  commands: string[];
  hasWeb: boolean;
}

interface LauncherBridge {
  getClips(): Promise<ClipBookmark[]>;
  openClip(config: ClipBookmark): Promise<void>;
  saveClips(clips: ClipBookmark[]): Promise<void>;
  clearCache(name: string): Promise<void>;
  detectEnvironment(serverUrl?: string): Promise<EnvStatus>;
  discoverClips(serverUrl: string, superToken: string): Promise<DiscoveredClip[]>;
  addClipBookmark(serverUrl: string, superToken: string, clipId: string): Promise<ClipBookmark>;
  startBoxLite(binaryPath: string): Promise<{ ok: boolean; error?: string }>;
  startPinix(binaryPath: string): Promise<{ ok: boolean; error?: string }>;
}

interface Window {
  LauncherBridge: LauncherBridge;
}
