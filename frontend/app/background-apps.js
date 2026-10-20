// Best-effort check for apps that are not allowed during the exam.
// It reads process NAMES only (no window titles or content), and only
// reports matches from the list below. Students can rename or hide apps,
// so this is a warning aid, not enforcement.
import { execFile } from "node:child_process";

export const DISALLOWED_APPS = [
  { name: "Zoom", match: ["zoom.us", "zoom"] },
  { name: "Microsoft Teams", match: ["teams", "msteams", "microsoft teams"] },
  { name: "Discord", match: ["discord"] },
  { name: "Slack", match: ["slack"] },
  { name: "WhatsApp", match: ["whatsapp"] },
  { name: "Telegram", match: ["telegram"] },
  { name: "TeamViewer", match: ["teamviewer"] },
  { name: "AnyDesk", match: ["anydesk"] },
  { name: "OBS Studio", match: ["obs", "obs64"] },
  { name: "ChatGPT", match: ["chatgpt"] },
];

// Pure matcher so it can be unit tested. Exact (case-insensitive) match on
// the executable name, ignoring a trailing ".exe".
export function findDisallowed(processNames, list = DISALLOWED_APPS) {
  const names = new Set(processNames.map((name) => name.trim().toLowerCase().replace(/\.exe$/, "")));
  return list.filter((app) => app.match.some((candidate) => names.has(candidate))).map((app) => app.name);
}

export function parseProcessList(output, platform) {
  if (platform === "win32") {
    // tasklist /fo csv /nh  ->  "name.exe","1234",...
    return output.split(/\r?\n/).map((line) => line.split('","')[0]?.replace(/^"/, "")).filter(Boolean);
  }
  return output.split("\n").map((line) => line.trim()).filter(Boolean);
}

export function listProcessNames(platform = process.platform) {
  const [command, args] = platform === "win32" ? ["tasklist", ["/fo", "csv", "/nh"]] : ["ps", ["-axco", "comm="]];
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: 5000, maxBuffer: 2 * 1024 * 1024 }, (error, stdout) => {
      if (error) reject(error);
      else resolve(parseProcessList(stdout, platform));
    });
  });
}
