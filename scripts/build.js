// Builds index.html (a standalone page for GitHub Pages or opening locally) from src/counterpick.html.
// The source is a page fragment: head tags (<title>, fonts, <style>) followed by body content.
//   node scripts/build.js           write index.html
//   node scripts/build.js --check   exit 1 if index.html is out of date (used in CI)
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'src', 'counterpick.html'), 'utf8');
const split = src.indexOf('<canvas');
if (split < 0) throw new Error('src/counterpick.html: expected the game <canvas> to mark the start of the body');

const out = `<!doctype html>
<!-- Generated from src/counterpick.html by scripts/build.js. Edit the source, then run: node scripts/build.js -->
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
${src.slice(0, split).trim()}
</head>
<body>
${src.slice(split).trim()}
</body>
</html>
`;

const target = path.join(root, 'index.html');
if (process.argv.includes('--check')) {
  const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
  if (current !== out) {
    console.error('index.html is out of date. Run: node scripts/build.js');
    process.exit(1);
  }
  console.log('index.html is up to date');
} else {
  fs.writeFileSync(target, out);
  console.log(`wrote index.html (${(out.length / 1024).toFixed(1)} KB)`);
}
