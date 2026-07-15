const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const imageExtensions = new Set([".jpg", ".jpeg", ".png", ".webp", ".avif"]);
const excludedAssetNames = new Set([
  "green-grin-logo.png",
  "green-grin-pwa-192.png",
  "green-grin-pwa-512.png",
  "green-grin-tab-icon.png"
]);

const legacyMetadata = {
  "green-grin-caldwell-golf-course-lawn-care.jpg": ["Golf Course Lawn Finish", "Striped residential lawn overlooking a Caldwell Idaho golf course maintained by Green Grin"],
  "green-grin-caldwell-idaho-striped-lawn-mowing.jpg": ["Caldwell Lawn Striping", "Fresh striped lawn mowing completed by Green Grin in Caldwell Idaho"],
  "green-grin-commercial-landscape-maintenance-flower-beds.jpg": ["Commercial Landscape Beds", "Commercial flowerbed and rock landscape maintenance by Green Grin"],
  "green-grin-concrete-curb-edging-lawn-care.jpg": ["Crisp Concrete Curb Edging", "Clean lawn edging along concrete landscape curbing by Green Grin"],
  "green-grin-fire-pit-landscape-project-caldwell.jpg": ["Backyard Fire Pit Project", "Finished fire pit and backyard landscape project in Caldwell Idaho"],
  "green-grin-residential-landscape-curbing-yard-maintenance.jpg": ["Residential Landscape Care", "Maintained residential lawn and landscape curbing in the Treasure Valley"],
  "green-grin-residential-lawn-mowing-caldwell-idaho.jpg": ["Neighborhood Lawn Mowing", "Fresh neighborhood lawn mowing lines in Caldwell Idaho by Green Grin"],
  "green-grin-treasure-valley-lawn-striping.jpg": ["Treasure Valley Lawn Striping", "Wide striped lawn maintained by Green Grin in the Treasure Valley"],
  "green-grin-caldwell-idaho-striped-lawn-mowing.jpg": ["Caldwell Lawn Striping", "Fresh striped lawn mowing completed by Green Grin in Caldwell Idaho"]
};

function listFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const absolute = path.join(directory, entry.name);
      return entry.isDirectory() ? listFiles(absolute) : [absolute];
    });
}

function publicPath(absolute) {
  return `/${path.relative(root, absolute).split(path.sep).join("/")}`;
}

function titleFromFilename(filename) {
  return path.basename(filename, path.extname(filename))
    .replace(/^green-grin-/, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .replace(/\bIdaho\b/g, "Idaho");
}

function workSlide(file) {
  const metadata = legacyMetadata[path.basename(file)];
  const title = metadata?.[0] || titleFromFilename(file);
  return {
    src: publicPath(file),
    title,
    alt: metadata?.[1] || `${title} completed by Green Grin Lawn & Landscape in the Treasure Valley`
  };
}

const legacyWork = listFiles(path.join(root, "assets"))
  .filter((file) => imageExtensions.has(path.extname(file).toLowerCase()))
  .filter((file) => !excludedAssetNames.has(path.basename(file)))
  .filter((file) => path.dirname(file) === path.join(root, "assets"));
const folderWork = listFiles(path.join(root, "content", "work"))
  .filter((file) => imageExtensions.has(path.extname(file).toLowerCase()));

const seenWork = new Set();
const work = [...legacyWork, ...folderWork]
  .map(workSlide)
  .filter((slide) => !seenWork.has(slide.src) && seenWork.add(slide.src));

const reviews = [];
for (const file of listFiles(path.join(root, "content", "reviews"))) {
  const extension = path.extname(file).toLowerCase();
  if (imageExtensions.has(extension)) {
    reviews.push({
      type: "image",
      src: publicPath(file),
      title: titleFromFilename(file),
      alt: `${titleFromFilename(file)} customer review for Green Grin Lawn & Landscape`
    });
    continue;
  }
  if (extension !== ".json") continue;
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const review of (Array.isArray(parsed) ? parsed : [parsed])) {
    if (!review || !String(review.text || "").trim()) continue;
    reviews.push({
      type: review.type === "promise" ? "promise" : "text",
      title: String(review.title || "Customer Review").trim(),
      text: String(review.text).trim(),
      author: String(review.author || "Green Grin customer").trim(),
      location: String(review.location || "").trim(),
      rating: Math.max(0, Math.min(5, Number(review.rating || 0)))
    });
  }
}

const data = {
  work,
  reviews
};
const assets = path.join(root, "assets");
fs.mkdirSync(assets, { recursive: true });
fs.writeFileSync(path.join(assets, "slides-data.json"), `${JSON.stringify(data, null, 2)}\n`);
fs.writeFileSync(path.join(assets, "slides-data.js"), `window.GREEN_GRIN_SLIDES = ${JSON.stringify(data)};\n`);
console.log(`Generated ${work.length} work slides and ${reviews.length} review slides.`);
