const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.resolve(__dirname, "..");
execFileSync(process.execPath, [path.join(root, "scripts", "build-slides.cjs")], { cwd: root });
const slides = JSON.parse(fs.readFileSync(path.join(root, "assets", "slides-data.json"), "utf8"));

assert.ok(slides.work.length >= 8, "Expected the current project photos in the work slideshow.");
assert.ok(slides.reviews.length >= 3, "Expected the current service promises in the review slideshow.");
assert.equal(new Set(slides.work.map((slide) => slide.src)).size, slides.work.length, "Work slides must be unique.");
for (const slide of slides.work) {
  assert.ok(slide.src.startsWith("/"));
  assert.ok(slide.title);
  assert.ok(slide.alt);
}
for (const review of slides.reviews) assert.ok(review.text || review.src);

console.log(`${slides.work.length} work slides and ${slides.reviews.length} review slides passed validation.`);
