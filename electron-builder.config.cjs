// Windows installer (NSIS). Run with `npm run make` or build-installer.cmd.
// Do not change appId: the installer finds earlier installs by it.
const cert = process.env.WINDOWS_CERTIFICATE_FILE;

module.exports = {
  appId: "com.localagentrouter.desktop",
  productName: "Local Agent Router",
  executableName: "LocalAgentRouter",
  directories: { output: process.env.AGENT_ROUTER_BUILD_DIR || "release", buildResources: "build" },
  files: [
    "**/*",
    // mobile/ holds the phone apps; they are built and installed separately.
    // .tools/ruflo ships as an extra resource below; obsolete/ and replica/ are local-only folders.
    "!{out,release,build,test,skills,mobile,feedback-relay,.agent-router,.tools,obsolete,replica,.claude-flow}{,/**}",
    "!skills.md",
    "!**/*.exe",
    "!*.cmd",
  ],
  extraResources: [
    // Run by the installer's AI tools page (build/installer.nsh).
    { from: "build/install-clis.ps1", to: "install-clis.ps1" },
    // Ruflo backend runtime (ruflo-runner.mjs). Outside app.asar because system Node runs it as an MCP server.
    // Fill it first with: npm install --prefix .tools/ruflo --no-save ruflo@3.77.1
    // The installer is Windows x64 only: macOS, Linux and Windows ARM binaries and source maps are left out (~400 MB).
    { from: ".tools/ruflo/node_modules", to: "ruflo/node_modules", filter: [
      "**/*", "!**/*.map",
      "!onnxruntime-node/bin/*/{darwin,linux}{,/**}", "!onnxruntime-node/bin/*/win32/arm64{,/**}",
      "!@anthropic-ai/claude-agent-sdk/vendor/ripgrep/*-{darwin,linux}{,/**}",
      "!**/prebuilds/{darwin,linux,android}-*{,/**}", "!@ruvector/*/npm/{darwin,linux}-*{,/**}",
    ] },
  ],
  win: {
    target: [{ target: "nsis", arch: ["x64"] }],
    icon: "assets/icon.ico",
    // Code signing removes the SmartScreen warning. Set both variables before `npm run make` once you have a certificate.
    ...(cert ? { signtoolOptions: { certificateFile: cert, certificatePassword: process.env.WINDOWS_CERTIFICATE_PASSWORD } } : {}),
  },
  nsis: {
    oneClick: false, // full wizard: Server or Client (build/installer.nsh), install for me or everyone, pick the folder
    perMachine: false,
    allowElevation: true,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: "Local Agent Router",
    uninstallDisplayName: "Local Agent Router",
    installerIcon: "assets/icon.ico",
    uninstallerIcon: "assets/icon.ico",
    runAfterFinish: true,
    deleteAppDataOnUninstall: false,
    artifactName: "LocalAgentRouter-Setup-${version}.${ext}",
    include: "build/installer.nsh",
  },
};
