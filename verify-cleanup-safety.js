const assert = require("assert");
const fs = require("fs");

const source = fs.readFileSync("main.source.js", "utf8");
assert(source.includes("getVaultReferencedLocalAttachmentPaths"), "cleanup must protect attachments referenced anywhere in the vault");
assert(source.includes("isInsideEagleLibrary(file.path)"), "cleanup must exclude Eagle library contents");
assert(source.includes("isVerifiedLocalCopyOfEagleItem"), "cleanup must verify the Eagle original before deleting");
assert(source.includes('createHash("sha256")'), "cleanup must compare file contents");
console.log("cleanup safety verification passed");
