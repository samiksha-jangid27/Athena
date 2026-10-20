import test from "node:test";
import assert from "node:assert/strict";
import { findDisallowed, parseProcessList } from "./background-apps.js";

test("findDisallowed matches exact executable names only", () => {
  assert.deepEqual(findDisallowed(["Finder", "zoom.us", "Discord", "Code"]), ["Zoom", "Discord"]);
  assert.deepEqual(findDisallowed(["Slack.exe", "explorer.exe"]), ["Slack"]);
  // Substrings must not match: "obsidian" is not OBS, "zoomit" is not Zoom.
  assert.deepEqual(findDisallowed(["Obsidian", "ZoomIt"]), []);
});

test("parseProcessList reads ps and tasklist output", () => {
  assert.deepEqual(parseProcessList("Finder\n  Dock \n\n", "darwin"), ["Finder", "Dock"]);
  const csv = '"Slack.exe","1234","Console","1","50,000 K"\r\n"explorer.exe","88","Console","1","10 K"';
  assert.deepEqual(parseProcessList(csv, "win32"), ["Slack.exe", "explorer.exe"]);
});
