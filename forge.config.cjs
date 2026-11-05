const path = require("node:path");

module.exports = {
  outDir: process.env.AGENT_ROUTER_BUILD_DIR || "release",
  packagerConfig: {
    asar: true,
    executableName: "LocalAgentRouter",
    icon: path.join(__dirname, "assets", "icon.ico"),
    ignore: [/^\/out($|\/)/, /^\/release($|\/)/, /^\/node_modules($|\/)/, /^\/\.git($|\/)/, /^\/skills($|\/)/, /^\/skills\.md$/],
  },
  makers: [
    {
      name: "@electron-forge/maker-squirrel",
      config: {
        name: "LocalAgentRouter",
        setupIcon: path.join(__dirname, "assets", "icon.ico"),
        // Code signing removes the Windows SmartScreen warning. Set these two variables before `npm run make` once you have a certificate.
        ...(process.env.WINDOWS_CERTIFICATE_FILE ? { certificateFile: process.env.WINDOWS_CERTIFICATE_FILE, certificatePassword: process.env.WINDOWS_CERTIFICATE_PASSWORD } : {}),
      },
    },
  ],
};
