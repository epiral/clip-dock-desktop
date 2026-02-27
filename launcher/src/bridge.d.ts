interface ClipConfig {
  alias: string;
  host: string;
  port: number;
  token: string;
}

interface LauncherBridge {
  getClips(): Promise<ClipConfig[]>;
  openClip(config: ClipConfig): Promise<void>;
  saveClips(clips: ClipConfig[]): Promise<void>;
  clearCache(alias: string): Promise<void>;
}

interface Window {
  LauncherBridge: LauncherBridge;
}
