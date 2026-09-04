const { readdirSync } = require("fs");
for (const file of readdirSync(__dirname).filter(name => /^verify-.*\.js$/.test(name)).sort()) {
  if (file !== "verify-all.js") require(`./${file}`);
}
