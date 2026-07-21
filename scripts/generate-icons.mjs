/**
 * Zrodlo: public/brand-logo-source.png (oryginalny ksztalt, jasne tlo ~#F0F0F0).
 * Generuje przezroczyste logo-light / logo (ciemny motyw) oraz ikony PWA.
 */
import sharp from "sharp";
import { resolve } from "node:path";

const root = resolve(process.cwd(), "public");
const sourcePath = resolve(root, "brand-logo-source.png");

function isBackground(r, g, b) {
  // Jasne, malo nasycone tlo (szare / biale)
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const sat = max === 0 ? 0 : (max - min) / max;
  return max >= 220 && sat < 0.08;
}

function isMarkPixel(r, g, b, a) {
  if (a < 8) return false;
  if (isBackground(r, g, b)) return false;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const sat = max === 0 ? 0 : (max - min) / max;
  return sat > 0.12 && max > 50;
}

function isDarkTextPixel(r, g, b, a) {
  if (a < 8) return false;
  if (isBackground(r, g, b)) return false;
  if (isMarkPixel(r, g, b, a)) return false;
  const max = Math.max(r, g, b);
  const sat = max === 0 ? 0 : (max - Math.min(r, g, b)) / max;
  return sat < 0.15 && max < 100;
}

function isContent(r, g, b, a) {
  return isMarkPixel(r, g, b, a) || isDarkTextPixel(r, g, b, a);
}

function boundsOf(data, width, height, pred) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (!pred(data[i], data[i + 1], data[i + 2], data[i + 3])) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

async function main() {
  const { data, info } = await sharp(sourcePath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height } = info;
  const content = boundsOf(data, width, height, isContent);
  if (!content) throw new Error("Brak tresci logo w brand-logo-source.png");

  const pad = 12;
  const crop = {
    left: Math.max(0, content.left - pad),
    top: Math.max(0, content.top - pad),
    width: Math.min(width - Math.max(0, content.left - pad), content.width + pad * 2),
    height: Math.min(height - Math.max(0, content.top - pad), content.height + pad * 2),
  };

  const cropped = await sharp(sourcePath).extract(crop).ensureAlpha().raw().toBuffer({
    resolveWithObject: true,
  });
  const w = cropped.info.width;
  const h = cropped.info.height;

  const light = Buffer.alloc(cropped.data.length);
  const dark = Buffer.alloc(cropped.data.length);

  for (let i = 0; i < cropped.data.length; i += 4) {
    const r = cropped.data[i];
    const g = cropped.data[i + 1];
    const b = cropped.data[i + 2];
    const a = cropped.data[i + 3];

    if (!isContent(r, g, b, a)) {
      light[i] = dark[i] = 0;
      light[i + 1] = dark[i + 1] = 0;
      light[i + 2] = dark[i + 2] = 0;
      light[i + 3] = dark[i + 3] = 0;
      continue;
    }

    if (isMarkPixel(r, g, b, a)) {
      light[i] = r;
      light[i + 1] = g;
      light[i + 2] = b;
      light[i + 3] = a;
      dark[i] = r;
      dark[i + 1] = g;
      dark[i + 2] = b;
      dark[i + 3] = a;
    } else {
      // Tekst: w light — prawie czarny; w dark — biel (z antialiasingiem)
      const max = Math.max(r, g, b);
      const cover = Math.round(a * (1 - max / 255));
      const textA = Math.min(255, Math.max(cover, isDarkTextPixel(r, g, b, a) ? a : cover));

      light[i] = 29;
      light[i + 1] = 28;
      light[i + 2] = 29;
      light[i + 3] = textA;

      dark[i] = 255;
      dark[i + 1] = 255;
      dark[i + 2] = 255;
      dark[i + 3] = textA;
    }
  }

  await sharp(light, { raw: { width: w, height: h, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toFile(resolve(root, "logo-on-light.png"));
  await sharp(dark, { raw: { width: w, height: h, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toFile(resolve(root, "logo-on-dark.png"));
  // Alias historyczny
  await sharp(light, { raw: { width: w, height: h, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toFile(resolve(root, "logo-light.png"));
  await sharp(dark, { raw: { width: w, height: h, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toFile(resolve(root, "logo.png"));
  console.log(`logo-on-light.png (ciemny tekst) / logo-on-dark.png (bialy tekst)  ${w}x${h}`);

  const markBounds = boundsOf(light, w, h, isMarkPixel);
  if (!markBounds) throw new Error("Nie znaleziono znaku");
  const textBounds = boundsOf(light, w, h, isDarkTextPixel);
  // Nie bierz kolorowego antialiasingu napisu do znaku — tnij przed tekstem.
  if (textBounds && textBounds.left > markBounds.left) {
    markBounds.width = Math.max(8, textBounds.left - markBounds.left - 8);
  }
  const markPad = 6;
  const markCrop = {
    left: Math.max(0, markBounds.left - markPad),
    top: Math.max(0, markBounds.top - markPad),
    width: Math.min(w - Math.max(0, markBounds.left - markPad), markBounds.width + markPad * 2),
    height: Math.min(h - Math.max(0, markBounds.top - markPad), markBounds.height + markPad * 2),
  };

  const markPng = await sharp(light, { raw: { width: w, height: h, channels: 4 } })
    .extract(markCrop)
    .png()
    .toBuffer();

  await sharp(markPng)
    .resize(512, 512, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(resolve(root, "logo-mark.png"));
  console.log("logo-mark.png 512x512");

  async function appIcon(name, size) {
    const inner = Math.round(size * 0.72);
    const mark = await sharp(markPng)
      .resize(inner, inner, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    await sharp({
      create: {
        width: size,
        height: size,
        channels: 4,
        background: { r: 16, g: 14, b: 22, alpha: 1 },
      },
    })
      .composite([{ input: mark, gravity: "centre" }])
      .png({ compressionLevel: 9 })
      .toFile(resolve(root, name));
    console.log(`${name} ${size}x${size}`);
  }

  await appIcon("icon-512.png", 512);
  await appIcon("icon-192.png", 192);
  await appIcon("icon.png", 256);
  await appIcon("favicon.png", 64);
  console.log(`ASPECT ${w}/${h}`);
}

await main();
