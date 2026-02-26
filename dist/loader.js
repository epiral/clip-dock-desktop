export function loadClip(win, clipId) {
    const safeClipId = encodeURIComponent(clipId);
    win.loadURL(`pinix-web://${safeClipId}/index.html`);
}
