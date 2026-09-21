// Rasterises public/icons/icon.svg into the PNG sizes the PWA manifest needs.
//   npm run icons
// Provenance: generated from icon.svg (authored in this repo); no external imagery.
import sharp from 'sharp';
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const dir = path.resolve('public/icons');
mkdirSync(dir, { recursive: true });
const svg = readFileSync(path.join(dir, 'icon.svg'));
const maskable = readFileSync(path.join(dir, 'icon-maskable.svg'));

await sharp(svg).resize(192, 192).png().toFile(path.join(dir, 'icon-192.png'));
await sharp(svg).resize(512, 512).png().toFile(path.join(dir, 'icon-512.png'));
await sharp(svg).resize(180, 180).png().toFile(path.join(dir, 'apple-touch-icon.png'));
await sharp(maskable).resize(512, 512).png().toFile(path.join(dir, 'icon-512-maskable.png'));
console.log('icons written to', dir);
