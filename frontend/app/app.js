// Electron main process for Athena.
import { app, BrowserWindow, ipcMain, desktopCapturer, session, systemPreferences } from "electron";
import path from "node:path";
import fs from "node:fs";
import http from "node:http";
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { isTrustedUrl, toSnapshotBytes } from "./ipc-validation.js";
import { findDisallowed, listProcessNames } from "./background-apps.js";

const DEV_URL = "http://localhost:5173";
const BACKEND_URL = "http://127.0.0.1:3000/";
const SNAPSHOT_INTERVAL_MS = 30000;

// Same name and data folder in dev and packaged builds (dev would
// otherwise use "Electron").
app.setName("Athena");
app.setPath("userData", path.join(app.getPath("appData"), "Athena"));

let mainWindow = null;
let backendProcess = null;
let snapshotTimer = null;
let lastScreenOk = null;

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

function evidenceDir(kind) {
  const directory = path.join(app.getPath("userData"), "evidence", kind);
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function sendToRenderer(channel, value) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, value);
}

async function captureScreen() {
  let ok = false;
  try {
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: { width: 1280, height: 720 },
    });
    const thumbnail = sources[0]?.thumbnail;
    // macOS returns an empty image when Screen Recording permission is missing.
    if (thumbnail && !thumbnail.isEmpty()) {
      fs.writeFileSync(path.join(evidenceDir("screen"), `${Date.now()}.jpg`), thumbnail.toJPEG(70));
      ok = true;
    }
  } catch (error) {
    console.error("Screen capture failed:", error);
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

handle("proctoring:start", () => {
  startProctoring();
  return { intervalMs: SNAPSHOT_INTERVAL_MS };
});

handle("proctoring:check-screen", () => checkScreenCapture());

// Returns only the names of disallowed apps that are running.
handle("proctoring:check-apps", async () => {
  try {
    return { supported: true, found: findDisallowed(await listProcessNames()) };
  } catch (error) {
    console.error("Background app check failed:", error);
    return { supported: false, found: [] };
  }
});

handle("proctoring:stop", () => {
  stopProctoring();
  return true;
});

handle("proctoring:save-camera-snap", (bytes) => {
  const valid = toSnapshotBytes(bytes);
  if (!valid) throw new Error("Invalid camera snapshot");
  const data = Buffer.from(valid.buffer, valid.byteOffset, valid.byteLength);
  fs.writeFileSync(path.join(evidenceDir("camera"), `${Date.now()}.jpg`), data);
  return true;
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

  // Best-effort shortcut blocking inside this window only. OS-level shortcuts
  // (Cmd+Tab, Alt+Tab, Mission Control, etc.) cannot be blocked by Electron;
  // the renderer detects leaving via blur/fullscreen events instead.
  if (app.isPackaged) {
    mainWindow.webContents.on("before-input-event", (event, input) => {
      const mod = input.control || input.meta;
      const key = input.key.toLowerCase();
      if ((mod && key === "r") || key === "f5" || key === "f12" || (mod && input.shift && key === "i")) {
        event.preventDefault();
      }
    });
  }

  mainWindow.on("closed", () => {
    stopProctoring();
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
  if (!(await isBackendUp())) {
    startBackend();
    if (!(await waitForBackend())) console.error("Backend did not become ready.");
  }
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", () => {
  stopProctoring();
  if (backendProcess) backendProcess.kill();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
