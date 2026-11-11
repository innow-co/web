// Renders richmenu.html to richmenu.png (2500 x 1686) with a locally installed
// headless Chrome/Edge, then checks the PNG header and the 1 MB LINE limit.
//   node richmenu/render.mjs
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const html = fileURLToPath(new URL('./richmenu.html', import.meta.url));
const png = fileURLToPath(new URL('./richmenu.png', import.meta.url));
const BROWSERS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
];
const browser = BROWSERS.find((p) => existsSync(p));
if (!browser) { console.error('No Chrome or Edge found in /Applications'); process.exit(1); }

const r = spawnSync(browser, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
  '--window-size=2500,1686', '--virtual-time-budget=5000', `--screenshot=${png}`, pathToFileURL(html).href,
], { encoding: 'utf8', timeout: 60000 });
if (r.status !== 0) { console.error(r.stderr); process.exit(1); }

const buf = readFileSync(png);
const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20), size = statSync(png).size;
if (w !== 2500 || h !== 1686) { console.error(`Wrong size ${w}x${h}`); process.exit(1); }
if (size >= 1024 * 1024) { console.error(`PNG is ${size} bytes, over LINE's 1 MB limit`); process.exit(1); }
console.log(`richmenu.png ${w}x${h}, ${size} bytes`);
