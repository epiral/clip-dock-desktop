interface ClipBookmark {
  name: string;
  server_url: string;
  token: string;
}

interface LauncherBridge {
  getClips(): Promise<ClipBookmark[]>;
  openClip(config: ClipBookmark): Promise<void>;
  saveClips(clips: ClipBookmark[]): Promise<void>;
  clearCache(name: string): Promise<void>;
}

interface Window {
  LauncherBridge: LauncherBridge;
}
