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

// --portal: also package CUUED for a game website (see PORTAL.md): dist/portal/cuued/ holds the game page, its card art,
// icons, a thumbnail and game.json, ready to copy into the site's games folder (and dist/portal/cuued.zip for upload forms)
if (process.argv.includes('--portal')) {
  const { execSync } = require('child_process');
  const dist = path.join(root, 'dist', 'portal'), dir = path.join(dist, 'cuued');
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(path.join(dir, 'cards'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), out);
  for (const f of fs.readdirSync(path.join(root, 'cards'))) fs.copyFileSync(path.join(root, 'cards', f), path.join(dir, 'cards', f));
  for (const f of ['logo.webp', 'favicon.svg', 'favicon.ico', 'icon-192.png', 'icon-512.png', 'manifest.webmanifest', 'PORTAL.md', 'LICENSE']) if (fs.existsSync(path.join(root, f))) fs.copyFileSync(path.join(root, f), path.join(dir, f));
  fs.copyFileSync(path.join(root, 'og-card.jpg'), path.join(dir, 'thumb-wide.jpg'));   // 1200 x 630
  try { execSync(`sips -s format jpeg -c 630 840 "${path.join(root, 'og-card.jpg')}" --out "${path.join(dir, 'thumb.jpg')}"`, { stdio: 'ignore' }); execSync(`sips -Z 480 "${path.join(dir, 'thumb.jpg')}"`, { stdio: 'ignore' }) } catch (e) { fs.copyFileSync(path.join(root, 'og-card.jpg'), path.join(dir, 'thumb.jpg')) }   // a 4:3 tile picture
  const build = (/const BUILD='([^']+)'/.exec(out) || [])[1] || '';
  fs.writeFileSync(path.join(dir, 'game.json'), JSON.stringify({
    slug: 'cuued', title: 'CUUED', build,
    description: 'A fast 1v1 arena shooter: lose a round, draft a power-up card, come back stronger. Duel a friend online, team up 2v2, play on one big screen with phones as controllers, or survive waves of enemies.',
    entry: 'index.html', thumb: 'thumb.jpg', thumbWide: 'thumb-wide.jpg', icon: 'icon-512.png',
    tags: ['action', 'shooter', 'multiplayer', '2-player', 'online', 'platformer'],
    orientation: 'landscape', touch: true, keyboard: true, gamepad: false, multiplayer: true, minPlayers: 1, maxPlayers: 4,
    iframe: { allow: 'fullscreen; autoplay; clipboard-write; web-share; screen-wake-lock', sandbox: 'allow-scripts allow-same-origin allow-popups allow-forms allow-pointer-lock' },
    params: { share: "your page's address, so invite links and QR codes bring friends back to your site", join: 'a 4-letter room code to join on load', mute: '1 to start muted' },
    events: ['ready', 'gameplayStart', 'gameplayStop', 'gameOver'], commands: ['pause', 'resume', 'mute', 'unmute', 'config'],
  }, null, 2) + '\n');
  fs.rmSync(path.join(dist, 'cuued.zip'), { force: true });
  try { execSync('zip -qr cuued.zip cuued', { cwd: dist }) } catch (e) { console.error('zip failed:', e.message) }
  const size = (p) => fs.statSync(p).size;
  console.log(`packaged dist/portal/cuued/ (${fs.readdirSync(dir).length} files) and dist/portal/cuued.zip (${(size(path.join(dist, 'cuued.zip')) / 1024).toFixed(0)} KB)`);
}
