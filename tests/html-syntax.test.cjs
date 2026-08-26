const fs = require("fs");

const pages = [
  "index.html",
  "lawn-care/index.html",
  "landscaping/index.html",
  "work/index.html",
  "thank-you/index.html"
];

for (const file of pages) {
  const html = fs.readFileSync(file, "utf8");
  let executableScripts = 0;
  let structuredDataBlocks = 0;

  for (const match of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attributes = match[1];
    const code = match[2].trim();
    if (/\bsrc\s*=/.test(attributes) || !code) continue;
    if (/\btype\s*=\s*["']application\/ld\+json["']/i.test(attributes)) {
      JSON.parse(code);
      structuredDataBlocks += 1;
      continue;
    }
    new Function(code);
    executableScripts += 1;
  }

  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assertUnique(ids, file);
  console.log(`${file}: ${executableScripts} scripts, ${structuredDataBlocks} schema blocks, and ${ids.length} unique IDs passed validation.`);
}

function assertUnique(ids, file) {
  const seen = new Set();
  for (const id of ids) {
    if (seen.has(id)) throw new Error(`${file} contains duplicate id ${id}.`);
    seen.add(id);
  }
}
