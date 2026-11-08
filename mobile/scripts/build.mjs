#!/usr/bin/env node
// Builds the phone app. Run from mobile/ after `npm install`:
//   node scripts/build.mjs android   -> dist/AgentRouter-<version>-debug.apk (debug-signed, installs by sideloading)
//   node scripts/build.mjs ios       -> dist/AgentRouter-<version>.ipa (macOS + Xcode + an Apple signing team only)
// Creates the native project the first time (cap add), applies the two native settings the app needs, syncs www/,
// then builds. Every missing prerequisite stops the build with what to install; nothing is installed for you.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const platform = process.argv[2];
const version = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version;
const win = process.platform === "win32";

function fail(message) {
  console.error(`\nCan't build: ${message}\n`);
  process.exit(1);
}
function run(command, args, cwd = root) {
  console.log(`> ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, { cwd, stdio: "inherit", shell: win });
  if (result.status !== 0) fail(`${command} ${args[0] || ""} failed (exit ${result.status ?? result.error?.message}).`);
}
const has = (command, args = ["--version"]) => spawnSync(command, args, { stdio: "ignore", shell: win }).status === 0;

if (!["android", "ios"].includes(platform)) fail("say which phone: node scripts/build.mjs android  (or ios)");
if (!existsSync(path.join(root, "node_modules", "@capacitor", "cli"))) fail("run `npm install` in the mobile folder first.");

// The app has no bundler, so the Capacitor runtime (registerPlugin, native HTTP) is loaded as a plain script.
mkdirSync(path.join(root, "www", "vendor"), { recursive: true });
copyFileSync(path.join(root, "node_modules", "@capacitor", "core", "dist", "capacitor.js"), path.join(root, "www", "vendor", "capacitor.js"));

if (platform === "android") {
  if (!has("java", ["-version"])) fail("install a JDK 21 (for example Microsoft OpenJDK or Temurin) so `java` is on PATH. Android Studio includes one.");
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT
    || [path.join(process.env.LOCALAPPDATA || "", "Android", "Sdk"), path.join(process.env.HOME || "", "Library", "Android", "sdk"), path.join(process.env.HOME || "", "Android", "Sdk")].find((dir) => dir && existsSync(dir));
  if (!sdk) fail("install the Android SDK (Android Studio → SDK Manager: Android 15 / API 35 platform and build tools), or set ANDROID_HOME.");
  if (!existsSync(path.join(root, "android"))) run("npx", ["cap", "add", "android"]);
  writeFileSync(path.join(root, "android", "local.properties"), `sdk.dir=${sdk.replace(/\\/g, "\\\\")}\n`);
  // The server listens on plain http on its Tailscale address (WireGuard-encrypted underneath). Android blocks
  // cleartext by default; the app itself only accepts 100.64.0.0/10 and *.ts.net addresses (serverUrlProblem in www/app.js).
  const manifest = path.join(root, "android", "app", "src", "main", "AndroidManifest.xml");
  const xml = readFileSync(manifest, "utf8");
  if (!xml.includes("usesCleartextTraffic")) writeFileSync(manifest, xml.replace("<application", '<application android:usesCleartextTraffic="true"'));
  // The app shows its own version in Settings; keep it equal to package.json.
  const gradle = path.join(root, "android", "app", "build.gradle");
  writeFileSync(gradle, readFileSync(gradle, "utf8").replace(/versionName "[^"]*"/, `versionName "${version}"`));
  run("npx", ["cap", "sync", "android"]);
  // Full path: cmd.exe skips the current folder when NoDefaultCurrentDirectoryInExePath is set, so a bare "gradlew.bat" fails.
  run(win ? `"${path.join(root, "android", "gradlew.bat")}"` : "./gradlew", ["assembleDebug"], path.join(root, "android"));
  const apk = path.join(root, "android", "app", "build", "outputs", "apk", "debug", "app-debug.apk");
  if (!existsSync(apk)) fail(`Gradle finished but ${apk} is missing.`);
  mkdirSync(path.join(root, "dist"), { recursive: true });
  const out = path.join(root, "dist", `AgentRouter-${version}-debug.apk`);
  copyFileSync(apk, out);
  console.log(`\nBuilt ${out}\nCopy it to the phone and open it (allow "Install unknown apps" for your file manager).`);
}

if (platform === "ios") {
  if (process.platform !== "darwin") fail("an iOS .ipa can only be built on a Mac with Xcode. Copy the mobile folder to a Mac and run this there.");
  if (!has("xcodebuild", ["-version"])) fail("install Xcode 16 or later from the App Store, then run `sudo xcode-select -s /Applications/Xcode.app`.");
  if (!has("pod")) fail("install CocoaPods (`brew install cocoapods`); Capacitor 7's iOS project uses it.");
  // AR_IOS_UNSIGNED=1 builds an unsigned IPA (no Apple team needed). AltStore or Sideloadly signs it with your Apple ID
  // when it installs it. The GitHub Actions workflow (.github/workflows/ios-unsigned.yml) uses this.
  const unsigned = process.env.AR_IOS_UNSIGNED === "1";
  const team = process.env.AR_IOS_TEAM;
  if (!team && !unsigned) fail("set AR_IOS_TEAM to your Apple Developer Team ID (Xcode → Settings → Accounts). A free Apple ID team works for your own devices; the app then expires after 7 days.");
  if (!existsSync(path.join(root, "ios"))) run("npx", ["cap", "add", "ios"]);
  // Same reason as Android's cleartext flag: http to the server's Tailscale address. The app limits the hosts itself.
  const plist = path.join(root, "ios", "App", "App", "Info.plist");
  const text = readFileSync(plist, "utf8");
  if (!text.includes("NSAppTransportSecurity")) {
    const at = text.lastIndexOf("</dict>");
    writeFileSync(plist, `${text.slice(0, at)}\t<key>NSAppTransportSecurity</key>\n\t<dict>\n\t\t<key>NSAllowsArbitraryLoads</key>\n\t\t<true/>\n\t</dict>\n${text.slice(at)}`);
  }
  const pbx = path.join(root, "ios", "App", "App.xcodeproj", "project.pbxproj");
  writeFileSync(pbx, readFileSync(pbx, "utf8").replace(/MARKETING_VERSION = [^;]*;/g, `MARKETING_VERSION = ${version};`));
  run("npx", ["cap", "sync", "ios"]);
  const build = path.join(root, "dist", "ios");
  mkdirSync(build, { recursive: true });
  if (unsigned) {
    const archive = path.join(build, "App.xcarchive");
    run("xcodebuild", ["-workspace", "ios/App/App.xcworkspace", "-scheme", "App", "-configuration", "Release", "-destination", "generic/platform=iOS",
      "-archivePath", archive, "CODE_SIGNING_ALLOWED=NO", "CODE_SIGNING_REQUIRED=NO", "CODE_SIGN_IDENTITY=", "archive"]);
    const app = path.join(archive, "Products", "Applications", "App.app");
    if (!existsSync(app)) fail(`xcodebuild finished but ${app} is missing.`);
    // An .ipa is a zip with the app under Payload/.
    run("rm", ["-rf", path.join(build, "Payload")]);
    run("mkdir", ["-p", path.join(build, "Payload")]);
    run("cp", ["-R", app, path.join(build, "Payload")]);
    const out = path.join(root, "dist", `AgentRouter-${version}-unsigned.ipa`);
    run("zip", ["-qry", out, "Payload"], build);
    console.log(`\nBuilt ${out}\nInstall it with AltStore (or Sideloadly), which signs it with your Apple ID.`);
    process.exit(0);
  }
  const options = path.join(build, "ExportOptions.plist");
  writeFileSync(options, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>${process.env.AR_IOS_METHOD || "development"}</string>
  <key>teamID</key><string>${team}</string>
  <key>signingStyle</key><string>automatic</string>
</dict></plist>
`);
  const archive = path.join(build, "App.xcarchive");
  run("xcodebuild", ["-workspace", "ios/App/App.xcworkspace", "-scheme", "App", "-configuration", "Release", "-destination", "generic/platform=iOS",
    "-archivePath", archive, "-allowProvisioningUpdates", `DEVELOPMENT_TEAM=${team}`, "archive"]);
  run("xcodebuild", ["-exportArchive", "-archivePath", archive, "-exportPath", build, "-exportOptionsPlist", options, "-allowProvisioningUpdates"]);
  const ipa = readdirSync(build).find((name) => name.endsWith(".ipa"));
  if (!ipa) fail(`xcodebuild finished but no .ipa is in ${build}.`);
  const out = path.join(root, "dist", `AgentRouter-${version}.ipa`);
  copyFileSync(path.join(build, ipa), out);
  console.log(`\nBuilt ${out}\nInstall it with Xcode (Window → Devices and Simulators → drag the .ipa onto your iPhone) or Apple Configurator.`);
}
