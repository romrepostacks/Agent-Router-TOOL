import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { buildRoutePrompt, parseRoute } from "./route-rules.mjs";

const root = import.meta.dirname;
const lessons = await readFile(path.join(root, "lessons.md"), "utf8");
const command = process.env.CODEX_CLI || "codex";
const examples = [
  ["What's next in this project?", "project"],
  ["Summarize this repository's architecture from its files.", "project"],
  ["What is a JavaScript closure?", "quick"],
  ["Suggest three simple weeknight dinners.", "quick"],
  ["How do I push my branch to GitHub?", "quick"],
  ["Add a search box to a JavaScript library.", "code"],
  ["The app crashes on startup. Find and fix the cause.", "code"],
  ["Make the settings screen easier to navigate.", "ui"],
  ["Create a set of icons for this application.", "art"],
  ["Plan milestones for the next six months of this project.", "longterm"],
  ["Review this pull request for regressions.", "review"],
  ["Create a GitHub issue for the login bug.", "github"],
  ["Audit this repository for security vulnerabilities without changing files.", "security"],
  ["Review the current code changes for security risks.", "security"],
  ["Push the already-committed current branch to GitHub now.", "push"],
];

function classify(question) {
  const prompt = buildRoutePrompt([{ role: "user", content: question }], lessons);
  return new Promise((resolve, reject) => {
    const child = spawn(command, ["exec", "--ephemeral", "--sandbox", "read-only", "--skip-git-repo-check", prompt], {
      cwd: root,
      env: process.env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill(), 90_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout = (stdout + chunk).slice(-8000); });
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-4000); });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error((stderr || `Codex exited ${code}`).slice(-1000)));
      try { resolve(parseRoute(stdout).route); } catch (error) { reject(error); }
    });
  });
}

let correct = 0;
console.log("Routing scorecard (synthetic prompts; no project files or provider actions)");
for (const [question, expected] of examples) {
  const actual = await classify(question);
  const pass = actual === expected;
  if (pass) correct += 1;
  console.log(`${pass ? "PASS" : "MISS"} | expected ${expected.padEnd(8)} got ${actual.padEnd(8)} | ${question}`);
}
console.log(`Score: ${correct}/${examples.length} (${Math.round(correct / examples.length * 100)}%)`);
if (correct !== examples.length) process.exitCode = 1;
