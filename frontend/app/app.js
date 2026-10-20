/* global process */

import {
    app,
    BrowserWindow,
    ipcMain,
    dialog,
    desktopCapturer
} from "electron";

import path from "path";
import fs from "fs";
import http from "http";
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";

let electronWindow = null;
let backendProcess = null;

let startTimestamp = null;
let timerInterval = null;
let cameraInterval = null;
let screenInterval = null;


// ============================================================
// BACKEND
// ============================================================

function getBackendPaths() {
    if (app.isPackaged) {
        return {
            backendEntry: path.join(
                process.resourcesPath,
                "backend",
                "server.js"
            ),

            questionsPath: path.join(
                process.resourcesPath,
                "backend",
                "data",
                "questions.json"
            ),

            initialSessionsPath: path.join(
                process.resourcesPath,
                "backend",
                "data",
                "sessions.json"
            ),

            sessionsPath: path.join(
                app.getPath("userData"),
                "data",
                "sessions.json"
            )
        };
    }

    // Development paths
    return {
        backendEntry: path.join(
            import.meta.dirname,
            "../../backend/server.js"
        ),

        questionsPath: path.join(
            import.meta.dirname,
            "../../backend/data/questions.json"
        ),

        initialSessionsPath: path.join(
            import.meta.dirname,
            "../../backend/data/sessions.json"
        ),

        sessionsPath: path.join(
            import.meta.dirname,
            "../../backend/data/sessions.json"
        )
    };
}


function prepareSessionFile(paths) {
    if (!app.isPackaged) {
        return;
    }

    const sessionsDirectory = path.dirname(paths.sessionsPath);

    fs.mkdirSync(sessionsDirectory, {
        recursive: true
    });

    // Create the writable sessions file on first launch.
    if (!fs.existsSync(paths.sessionsPath)) {
        fs.copyFileSync(
            paths.initialSessionsPath,
            paths.sessionsPath
        );
    }
}


function startBackend() {
    const paths = getBackendPaths();

    prepareSessionFile(paths);

    console.log("Starting backend:");
    console.log(paths.backendEntry);

    backendProcess = spawn(
        process.execPath,
        [paths.backendEntry],
        {
            cwd: path.dirname(paths.backendEntry),

            env: {
                ...process.env,

                // Electron executable runs as normal Node
                ELECTRON_RUN_AS_NODE: "1",

                ATHENA_QUESTIONS_PATH:
                    paths.questionsPath,

                ATHENA_SESSIONS_PATH:
                    paths.sessionsPath,

                NODE_PATH: path.join(
                    process.resourcesPath,
                    "app.asar",
                    "node_modules"
                )
            },

            stdio: ["ignore", "pipe", "pipe"]
        }
    );

    backendProcess.stdout.on("data", (data) => {
        console.log(`[Backend] ${data.toString().trim()}`);
    });

    backendProcess.stderr.on("data", (data) => {
        console.error(`[Backend] ${data.toString().trim()}`);
    });

    backendProcess.on("error", (error) => {
        console.error(
            "Failed to start backend:",
            error
        );
    });

    backendProcess.on("exit", (code, signal) => {
        console.log(
            `Backend exited. code=${code}, signal=${signal}`
        );

        backendProcess = null;
    });
}


// ============================================================
// WAIT FOR BACKEND
// ============================================================

function waitForBackend(
    url = "http://127.0.0.1:3000/",
    retries = 30
) {
    return new Promise((resolve, reject) => {

        let attempts = 0;

        const check = () => {

            const request = http.get(
                url,
                (response) => {

                    response.resume();

                    if (
                        response.statusCode >= 200 &&
                        response.statusCode < 500
                    ) {
                        console.log(
                            "Backend is ready."
                        );

                        resolve();
                    } else {
                        retry();
                    }
                }
            );

            request.on("error", retry);

            request.setTimeout(1000, () => {
                request.destroy();
                retry();
            });
        };


        const retry = () => {

            attempts++;

            if (attempts >= retries) {
                reject(
                    new Error(
                        "Backend did not become ready."
                    )
                );

                return;
            }

            setTimeout(check, 500);
        };


        check();
    });
}


// ============================================================
// ELECTRON WINDOW
// ============================================================

function createWindow() {

    electronWindow = new BrowserWindow({
        height: 1000,
        width: 1000,

        webPreferences: {
            devTools: true,

            preload: path.join(
                import.meta.dirname,
                "preload.js"
            )
        }
    });


    if (app.isPackaged) {

        const rendererPath = path.join(
            import.meta.dirname,
            "../index.html"
        );

        console.log(
            "Loading production renderer:",
            rendererPath
        );

        electronWindow.loadFile(rendererPath);

    } else {

        const rendererUrl =
            "http://localhost:5173";

        console.log(
            "Loading development renderer:",
            rendererUrl
        );

        electronWindow.loadURL(rendererUrl);
    }
}


// ============================================================
// TIMER
// ============================================================

ipcMain.handle("start-timer", () => {

    startTimestamp = Date.now();

    clearInterval(timerInterval);
    clearInterval(cameraInterval);
    clearInterval(screenInterval);


    timerInterval = setInterval(() => {

        if (
            electronWindow &&
            !electronWindow.isDestroyed()
        ) {

            electronWindow.webContents.send(
                "timer",
                (Date.now() - startTimestamp) / 1000
            );
        }

    }, 1000);


    cameraInterval = setInterval(() => {

        if (
            electronWindow &&
            !electronWindow.isDestroyed()
        ) {

            electronWindow.webContents.send(
                "camera-shot"
            );
        }

    }, 5000);


    screenInterval = setInterval(() => {

        captureScreenSnap().catch((error) => {

            console.error(
                "Failed to capture screen snapshot:",
                error
            );

        });

    }, 5000);


    return {
        startedAt: startTimestamp
    };
});


// ============================================================
// CAMERA SNAP
// ============================================================

ipcMain.handle(
    "store-camera-snap-image-on-disk",
    (_event, data) => {

        const directory = path.join(
            app.getPath("userData"),
            "user-camera-snap"
        );

        fs.mkdirSync(
            directory,
            {
                recursive: true
            }
        );


        const filePath = path.join(
            directory,
            `${Date.now()}.jpg`
        );


        fs.writeFileSync(
            filePath,
            Buffer.from(data)
        );


        console.log(
            "Camera snapshot saved:",
            filePath
        );


        return filePath;
    }
);


// ============================================================
// SCREEN SNAP
// ============================================================

async function captureScreenSnap() {

    const sources =
        await desktopCapturer.getSources({

            types: ["screen"],

            thumbnailSize: {
                width: 1920,
                height: 1080
            }
        });


    const currentWindow =
        sources.find(
            (source) =>
                source.id.startsWith(
                    `window:${electronWindow.id}:`
                )
        );


    const source =
        currentWindow || sources[0];


    if (
        !source ||
        source.thumbnail.isEmpty()
    ) {
        return;
    }


    const directory = path.join(
        app.getPath("userData"),
        "user-screen-snap"
    );


    fs.mkdirSync(
        directory,
        {
            recursive: true
        }
    );


    const filePath = path.join(
        directory,
        `${Date.now()}.jpg`
    );


    fs.writeFileSync(
        filePath,
        source.thumbnail.toJPEG(90)
    );


    console.log(
        "Screen snapshot saved:",
        filePath
    );


    return filePath;
}


ipcMain.handle(
    "capture-screen-snap",
    captureScreenSnap
);


// ============================================================
// RULES
// ============================================================

ipcMain.on("show-rules", () => {

    dialog.showMessageBox(
        electronWindow,
        {
            type: "info",

            title: "Athena Exam Rules",

            message: "Exam Rules",

            detail:
                "1. Stay on the exam screen.\n" +
                "2. Camera must remain enabled.\n" +
                "3. Do not leave the exam.\n" +
                "4. Do not use external assistance.\n" +
                "5. Click Exit Exam when finished."
        }
    );
});


// ============================================================
// APP START
// ============================================================

app.whenReady().then(async () => {

    try {

        // Only the packaged app needs
        // to automatically launch the backend.
        if (app.isPackaged) {

            startBackend();

            await waitForBackend();
        }

    } catch (error) {

        console.error(
            "Backend startup failed:",
            error
        );

    }


    createWindow();


    app.on("activate", () => {

        if (
            BrowserWindow.getAllWindows().length === 0
        ) {

            createWindow();
        }
    });
});


// ============================================================
// APP QUIT
// ============================================================

app.on("before-quit", () => {

    clearInterval(timerInterval);
    clearInterval(cameraInterval);
    clearInterval(screenInterval);


    if (
        backendProcess &&
        !backendProcess.killed
    ) {

        console.log(
            "Stopping backend..."
        );

        backendProcess.kill();
    }
});


app.on("window-all-closed", () => {

    if (process.platform !== "darwin") {
        app.quit();
    }
});