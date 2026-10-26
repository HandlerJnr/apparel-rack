import { readFile, access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PRODUCTS, GARMENT_META } from '../src/scripts/catalogue.js';
const root=fileURLToPath(new URL('../',import.meta.url));
for (const f of ['app.js','catalogue.js','drop-motion.js','fitting-room.js']) execFileSync(process.execPath,['--check',`${root}src/scripts/${f}`]);
const html=await readFile(`${root}src/index.html`,'utf8');
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
if(new Set(ids).size!==ids.length)throw new Error('Duplicate element IDs');
if(PRODUCTS.length!==10)throw new Error('Expected ten rail products');
for(const p of PRODUCTS){if(!GARMENT_META[p.id])throw new Error(`Missing cloth metadata: ${p.id}`);for(const view of ['front','side'])await access(`${root}public/img/garments/${p.id}-${view}.webp`);}
for(const match of html.matchAll(/(?:src|href)="(\/(?:scripts|styles)\/[^"#]+)"/g))await access(`${root}src${match[1]}`);
if(/(?:whop\.com|whop\.tw|assets-2-prod\.whop)/.test(html))throw new Error('Unexpected third-party tracking');
console.log('Checked JavaScript, catalogue, cloth metadata, all 20 images, IDs and local entrypoints.');
