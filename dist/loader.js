export function loadClip(win, config) {
    const safeAlias = encodeURIComponent(config.alias);
    win.loadURL(`pinix-web://${safeAlias}/index.html`);
}
