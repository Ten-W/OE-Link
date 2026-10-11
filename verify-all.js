const { readdirSync } = require("fs");
const { spawnSync } = require("node:child_process");
const { join } = require("node:path");
for (const file of readdirSync(__dirname).filter(name => /^verify-.*\.js$/.test(name)).sort()) {
  if (file === "verify-all.js") continue;
  const result = spawnSync(process.execPath, [join(__dirname, file)], { cwd: __dirname, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
