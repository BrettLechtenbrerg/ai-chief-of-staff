#!/usr/bin/env node
/**
 * AI Chief of Staff — icon generator.
 *
 * Reads assets/branding/logo-transparent.png (the master source) and writes
 * every per-platform icon artifact the Electron build needs:
 *
 *   build/icon.icns           macOS app bundle icon (DMG + Applications + Dock)
 *   build/icon.ico            Windows .exe + NSIS installer icon
 *   assets/icon.png           1024px transparent PNG (used by Dock at runtime)
 *   assets/icon_macos.png     legacy alias kept in sync
 *   assets/icon_rounded_1024.png  legacy alias kept in sync
 *   assets/tray-icon.png      macOS menu-bar @1x (22×22, BLACK template)
 *   assets/tray-icon@2x.png   macOS menu-bar @2x (44×44, BLACK template)
 *   assets/menu-icon.png      misc 16×16 menu glyph (BLACK template)
 *
 * Re-run after the master logo changes:
 *
 *     node scripts/generate-icons.mjs
 *
 * Requirements:
 *   - macOS (uses sips + iconutil, both built-in)
 *   - sharp (npm devDependency, used for resampling + ico encoding)
 */

import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, mkdirSync, copyFileSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), "..");

const SOURCE = path.join(repoRoot, "assets/branding/logo-transparent.png");

if (!existsSync(SOURCE)) {
  console.error(`[icons] missing source: ${SOURCE}`);
  process.exit(1);
}

// sharp is dynamically required because it is a devDep; this script is only
// ever invoked by the maintainer (Brett) before a release, never at runtime.
let sharp;
try {
  sharp = (await import("sharp")).default;
} catch {
  console.error("[icons] sharp is not installed. Run: npm install --save-dev sharp");
  process.exit(1);
}

const COLOR_OUT = {
  appPng: path.join(repoRoot, "assets/icon.png"),
  appPngAlias1: path.join(repoRoot, "assets/icon_macos.png"),
  appPngAlias2: path.join(repoRoot, "assets/icon_rounded_1024.png"),
  icns: path.join(repoRoot, "build/icon.icns"),
  ico: path.join(repoRoot, "build/icon.ico"),
};
const TRAY_OUT = {
  menuIcon: path.join(repoRoot, "assets/menu-icon.png"), // 16×16 template
  tray1x: path.join(repoRoot, "assets/tray-icon.png"), // 22×22 template
  tray2x: path.join(repoRoot, "assets/tray-icon@2x.png"), // 44×44 template
};

// ---------------------------------------------------------------------------
// 1) Full-color app icons
// ---------------------------------------------------------------------------

async function makeAppPng() {
  console.log(`[icons] writing ${path.relative(repoRoot, COLOR_OUT.appPng)} (1024×1024 transparent)`);
  await sharp(SOURCE).resize(1024, 1024, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png({ compressionLevel: 9 }).toFile(COLOR_OUT.appPng);
  copyFileSync(COLOR_OUT.appPng, COLOR_OUT.appPngAlias1);
  copyFileSync(COLOR_OUT.appPng, COLOR_OUT.appPngAlias2);
}

async function makeIcns() {
  // Apple's required .iconset layout
  const iconset = [
    { name: "icon_16x16.png", size: 16 },
    { name: "icon_16x16@2x.png", size: 32 },
    { name: "icon_32x32.png", size: 32 },
    { name: "icon_32x32@2x.png", size: 64 },
    { name: "icon_128x128.png", size: 128 },
    { name: "icon_128x128@2x.png", size: 256 },
    { name: "icon_256x256.png", size: 256 },
    { name: "icon_256x256@2x.png", size: 512 },
    { name: "icon_512x512.png", size: 512 },
    { name: "icon_512x512@2x.png", size: 1024 },
  ];

  const tmp = mkdtempSync(path.join(tmpdir(), "acos-iconset-"));
  const iconsetDir = path.join(tmp, "icon.iconset");
  mkdirSync(iconsetDir);

  console.log(`[icons] building .iconset (10 sizes)`);
  for (const entry of iconset) {
    await sharp(SOURCE).resize(entry.size, entry.size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png({ compressionLevel: 9 }).toFile(path.join(iconsetDir, entry.name));
  }

  console.log(`[icons] writing ${path.relative(repoRoot, COLOR_OUT.icns)}`);
  execSync(`iconutil --convert icns "${iconsetDir}" --output "${COLOR_OUT.icns}"`, { stdio: "inherit" });

  rmSync(tmp, { recursive: true, force: true });
}

async function makeIco() {
  // Windows .ico packs multiple resolutions. We write a single high-res PNG
  // and let png-to-ico fan it out to the standard sizes; this is the
  // recommended path and pulls in zero ancient transitive deps.
  console.log(`[icons] writing ${path.relative(repoRoot, COLOR_OUT.ico)}`);
  const pngToIco = (await import("png-to-ico")).default;

  // png-to-ico accepts PNG buffers and produces the standard 16/24/32/48/64/
  // 128/256 multi-size .ico when given a 256×256 source.
  const sourcePng = await sharp(SOURCE)
    .resize(256, 256, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
  const icoBuffer = await pngToIco(sourcePng);
  writeFileSync(COLOR_OUT.ico, icoBuffer);
}

// ---------------------------------------------------------------------------
// 2) Monochrome tray (template) icons
// ---------------------------------------------------------------------------

/**
 * Convert the colored logo to a black-on-transparent silhouette. macOS treats
 * pure-black PNGs in the menu bar as template images: it auto-inverts them in
 * dark mode and tints them in selection states. Any other color is rendered
 * as-is and looks broken.
 *
 * We do this by replacing every non-transparent pixel with pure black while
 * preserving its existing alpha (so anti-aliased edges stay smooth).
 */
async function makeTrayTemplate(size, outPath) {
  // Read the source, resize, then walk pixels.
  const resized = await sharp(SOURCE).resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

  const { data, info } = resized;
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3];
    if (alpha === 0) continue;
    data[i] = 0;
    data[i + 1] = 0;
    data[i + 2] = 0;
  }

  await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png({ compressionLevel: 9 }).toFile(outPath);
  console.log(`[icons] writing ${path.relative(repoRoot, outPath)} (${size}×${size} black template)`);
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

await makeAppPng();
await makeIcns();
await makeIco();
await makeTrayTemplate(16, TRAY_OUT.menuIcon);
await makeTrayTemplate(22, TRAY_OUT.tray1x);
await makeTrayTemplate(44, TRAY_OUT.tray2x);

console.log("[icons] done");
