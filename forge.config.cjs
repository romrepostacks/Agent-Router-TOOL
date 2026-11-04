const path = require("node:path");

module.exports = {
  outDir: process.env.AGENT_ROUTER_BUILD_DIR || "release",
  packagerConfig: {
    asar: true,
    executableName: "LocalAgentRouter",
    icon: path.join(__dirname, "assets", "icon.ico"),
    ignore: [/^\/out($|\/)/, /^\/release($|\/)/, /^\/node_modules($|\/)/, /^\/\.git($|\/)/],
  },
  makers: [
    {
      name: "@electron-forge/maker-squirrel",
      config: { name: "LocalAgentRouter", setupIcon: path.join(__dirname, "assets", "icon.ico") },
    },
  ],
};
