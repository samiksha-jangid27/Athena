// Electron main process for Athena.
import { app, BrowserWindow, ipcMain, desktopCapturer, session, systemPreferences, shell } from "electron";
import path from "node:path";
import fs from "node:fs";
import http from "node:http";
import crypto from "node:crypto";
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { isTrustedUrl, toSnapshotBytes, isProhibitedShortcut } from "./ipc-validation.js";
import { scanBackgroundApps } from "./background-apps.js";

const DEV_URL = "http://localhost:5173";
const BACKEND_URL = "http://127.0.0.1:3000/";
const SNAPSHOT_INTERVAL_MS = 10000;

// Same name and data folder in dev and packaged builds (dev would
// otherwise use "Electron").
app.setName("Athena");
app.setPath("userData", path.join(app.getPath("appData"), "Athena"));

let mainWindow = null;
let backendProcess = null;
let snapshotTimer = null;
let lastScreenOk = null;
let closeAfterSubmission = false;
let screenCaptureInFlight = false;

// ---------------- Backend ----------------

function backendPaths() {
  if (app.isPackaged) {
    const root = path.join(process.resourcesPath, "backend");
    return {
      entry: path.join(root, "server.js"),
      questions: path.join(root, "data", "questions.json"),
      // Packaged resources are read-only, so attempts live in userData.
      sessions: path.join(app.getPath("userData"), "data", "sessions.json"),
    };
  }
  const root = path.join(import.meta.dirname, "../../backend");
  return {
    entry: path.join(root, "server.js"),
    questions: path.join(root, "data", "questions.json"),
    sessions: path.join(root, "data", "sessions.json"),
  };
}

function isBackendUp() {
  return new Promise((resolve) => {
    const request = http.get(BACKEND_URL, (response) => {
      response.resume();
      resolve(response.statusCode === 200);
    });
    request.on("error", () => resolve(false));
    request.setTimeout(1000, () => {
      request.destroy();
      resolve(false);
    });
  });
}

async function waitForBackend(retries = 30) {
  for (let attempt = 0; attempt < retries; attempt++) {
    if (await isBackendUp()) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

function startBackend() {
  const paths = backendPaths();
  fs.mkdirSync(path.dirname(paths.sessions), { recursive: true });
  if (!fs.existsSync(paths.sessions)) fs.writeFileSync(paths.sessions, "[]");

  backendProcess = spawn(process.execPath, [paths.entry], {
    cwd: path.dirname(paths.entry),
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      // Lets the backend exit on its own if Athena crashes or is killed.
      ATHENA_PARENT_PID: String(process.pid),
      ATHENA_QUESTIONS_PATH: paths.questions,
      ATHENA_SESSIONS_PATH: paths.sessions,
      NODE_PATH: path.join(process.resourcesPath, "app.asar", "node_modules"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  backendProcess.stdout.on("data", (data) => console.log(`[backend] ${data.toString().trim()}`));
  backendProcess.stderr.on("data", (data) => console.error(`[backend] ${data.toString().trim()}`));
  backendProcess.on("exit", (code) => {
    console.log(`[backend] exited with code ${code}`);
    backendProcess = null;
  });
}

// ---------------- Evidence capture ----------------

let currentSessionId = null;

function sanitizeSessionId(id) {
  if (typeof id === "string" && /^session-[\w-]+$/.test(id)) {
    return id.slice(0, 64);
  }
  return "general";
}

function evidenceDir(kind, sessionId = currentSessionId) {
  const sessionSubdir = sanitizeSessionId(sessionId);
  const directory = path.join(app.getPath("userData"), "evidence", sessionSubdir, kind);
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function sendToRenderer(channel, value) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, value);
}

async function captureScreen() {
  if (screenCaptureInFlight) return;
  screenCaptureInFlight = true;
  let ok = false;
  try {
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: { width: 960, height: 540 },
    });
    const thumbnail = sources[0]?.thumbnail;
    // macOS returns an empty image when Screen Recording permission is missing.
    if (thumbnail && !thumbnail.isEmpty()) {
      const jpegBuffer = thumbnail.toJPEG(58);
      const filename = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}.jpg`;
      fs.writeFileSync(path.join(evidenceDir("screen"), filename), jpegBuffer);
      sendToRenderer("proctoring:screen-snap-captured", jpegBuffer.toString("base64"));
      ok = true;
    }
  } catch (error) {
    console.error("Screen capture failed:", error);
  } finally {
    screenCaptureInFlight = false;
  }
  if (ok !== lastScreenOk) {
    lastScreenOk = ok;
    sendToRenderer("proctoring:screen-status", ok);
  }
}

// Readiness check: can we capture the screen right now? On macOS this needs
// the Screen Recording permission, which only the user can grant.
async function checkScreenCapture() {
  const permission = process.platform === "darwin"
    ? systemPreferences.getMediaAccessStatus("screen")
    : "granted";
  let canCapture = false;
  try {
    const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: 320, height: 180 } });
    canCapture = Boolean(sources[0] && !sources[0].thumbnail.isEmpty());
  } catch (error) {
    console.error("Screen capture check failed:", error);
  }
  return { permission, canCapture, platform: process.platform };
}

function stopProctoring() {
  clearInterval(snapshotTimer);
  snapshotTimer = null;
  lastScreenOk = null;
}

function startProctoring() {
  stopProctoring();
  const tick = () => {
    captureScreen();
    sendToRenderer("proctoring:camera-snap-request");
  };
  tick();
  snapshotTimer = setInterval(tick, SNAPSHOT_INTERVAL_MS);
}

// ---------------- IPC (validated) ----------------

function isTrustedSender(event) {
  return isTrustedUrl(event.senderFrame?.url, { isPackaged: app.isPackaged, devUrl: DEV_URL });
}

function handle(channel, handler) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!isTrustedSender(event)) throw new Error("Untrusted IPC sender");
    return handler(...args);
  });
}

handle("proctoring:start", (sessionId) => {
  currentSessionId = sanitizeSessionId(sessionId);
  startProctoring();
  return { intervalMs: SNAPSHOT_INTERVAL_MS, sessionId: currentSessionId };
});

handle("proctoring:check-screen", () => checkScreenCapture());

// Returns disallowed apps or scan errors honestly.
handle("proctoring:check-apps", async () => {
  return scanBackgroundApps();
});

handle("proctoring:stop", () => {
  stopProctoring();
  currentSessionId = null;
  return true;
});

handle("app:close-response", (submitted) => {
  if (!submitted) return false;
  closeAfterSubmission = true;
  mainWindow?.close();
  return true;
});

handle("app:set-exam-mode", (active) => {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  mainWindow.setKiosk(Boolean(active));
  return true;
});

handle("proctoring:save-camera-snap", (bytes, sessionId) => {
  const valid = toSnapshotBytes(bytes);
  if (!valid) throw new Error("Invalid camera snapshot");
  const data = Buffer.from(valid.buffer, valid.byteOffset, valid.byteLength);
  const targetDir = evidenceDir("camera", sessionId || currentSessionId);
  const filename = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}.jpg`;
  fs.writeFileSync(path.join(targetDir, filename), data);
  return true;
});

handle("proctoring:open-evidence", async (sessionId) => {
  const targetDir = sessionId
    ? path.join(app.getPath("userData"), "evidence", sanitizeSessionId(sessionId))
    : path.join(app.getPath("userData"), "evidence");
  fs.mkdirSync(targetDir, { recursive: true });
  const openError = await shell.openPath(targetDir);
  return { success: !openError, path: targetDir, error: openError || null };
});

// ---------------- Window ----------------

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 900,
    title: "Athena",
    webPreferences: {
      preload: path.join(import.meta.dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: !app.isPackaged,
    },
  });

  // Stay on the exam page: no navigation, no new windows.
  mainWindow.webContents.on("will-navigate", (event) => event.preventDefault());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  // Intercept prohibited in-app shortcuts (reload, DevTools, source, new windows).
  // OS-level shortcuts (Cmd+Tab, Alt+Tab, Mission Control) cannot be intercepted
  // by Electron; Athena monitors focus and fullscreen transitions instead.
  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (isProhibitedShortcut(input, { isPackaged: app.isPackaged })) {
      event.preventDefault();
      sendToRenderer("security:shortcut-blocked", input.key || "unknown");
    }
  });

  mainWindow.on("close", (event) => {
    if (closeAfterSubmission || !currentSessionId || mainWindow.isDestroyed()) return;
    event.preventDefault();
    sendToRenderer("app:close-request");
  });

  mainWindow.on("closed", () => {
    stopProctoring();
    closeAfterSubmission = false;
    mainWindow = null;
  });

  if (app.isPackaged) {
    mainWindow.loadFile(path.join(import.meta.dirname, "../dist/index.html"));
  } else {
    mainWindow.loadURL(DEV_URL);
  }
}

// Only the camera and fullscreen are ever granted to the renderer.
function setupPermissions() {
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    if (permission === "fullscreen") return callback(true);
    if (permission === "media") {
      const types = details.mediaTypes || [];
      return callback(types.length > 0 && types.every((type) => type === "video"));
    }
    callback(false);
  });
}

app.whenReady().then(async () => {
  setupPermissions();
  if (!app.isPackaged) {
    // Only in local development mode: start local backend if none is running
    if (!(await isBackendUp())) {
      startBackend();
      if (!(await waitForBackend())) console.error("Backend did not become ready.");
    }
  }
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", () => {
  stopProctoring();
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setKiosk(false);
  if (backendProcess) backendProcess.kill();
});

// Quit cleanly (and stop the backend) on Ctrl+C or a terminate signal.
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => app.quit());
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
