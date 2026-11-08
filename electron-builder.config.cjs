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
    "!{out,release,build,test,skills,mobile,.agent-router}{,/**}",
    "!skills.md",
    "!**/*.exe",
    "!*.cmd",
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
