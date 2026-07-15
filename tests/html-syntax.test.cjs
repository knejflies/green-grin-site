const fs = require("fs");

for (const file of ["index.html", "work/index.html"]) {
  const html = fs.readFileSync(file, "utf8");
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1])
    .filter((code) => code.trim());
  for (const code of scripts) new Function(code);

  const markup = html.slice(0, html.indexOf("<script"));
  const ids = [...markup.matchAll(/id="([^"]+)"/g)].map((match) => match[1]);
  assertUnique(ids, file);
  console.log(`${file}: scripts and ${ids.length} static IDs passed validation.`);
}

function assertUnique(ids, file) {
  const seen = new Set();
  for (const id of ids) {
    if (seen.has(id)) throw new Error(`${file} contains duplicate id ${id}.`);
    seen.add(id);
  }
}
