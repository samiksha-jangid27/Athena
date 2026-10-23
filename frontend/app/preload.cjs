// Runs in a sandboxed preload. Exposes a small, explicit API to React;
// the renderer never gets direct access to ipcRenderer or Node.
const { contextBridge, ipcRenderer } = require("electron");

function subscribe(channel, callback) {
  const listener = (_event, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld("athena", {
  isDesktop: true,
  startProctoring: (sessionId) => ipcRenderer.invoke("proctoring:start", sessionId),
  stopProctoring: () => ipcRenderer.invoke("proctoring:stop"),
  checkScreenCapture: () => ipcRenderer.invoke("proctoring:check-screen"),
  checkBackgroundApps: () => ipcRenderer.invoke("proctoring:check-apps"),
  saveCameraSnapshot: (bytes, sessionId) => ipcRenderer.invoke("proctoring:save-camera-snap", bytes, sessionId),
  openEvidenceFolder: (sessionId) => ipcRenderer.invoke("proctoring:open-evidence", sessionId),
  onCameraSnapshotRequest: (callback) => subscribe("proctoring:camera-snap-request", callback),
  onScreenCaptureStatus: (callback) => subscribe("proctoring:screen-status", callback),
  onScreenSnapshotCaptured: (callback) => subscribe("proctoring:screen-snap-captured", callback),
});
