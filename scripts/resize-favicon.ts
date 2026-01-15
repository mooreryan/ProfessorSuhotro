import { parseArgs } from "node:util";
import sharp from "sharp";
import fs from "fs";

async function main() {
  const { positionals } = parseArgs({
    allowPositionals: true,
    strict: true,
  });

  if (positionals.length !== 2) {
    console.error("usage: resize-favicon.ts <png> <outDir>");
    process.exitCode = 1;
    return;
  }

  const pngFilePath = positionals[0];
  const outDir = positionals[1];

  // If dir doesn't exist create it
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir);
  }

  const sizes = [
    { name: "favicon-16x16.png", size: 16 },
    { name: "favicon-32x32.png", size: 32 },
    { name: "little-suhotro.png", size: 70 },
    { name: "apple-touch-icon.png", size: 180 },
    { name: "android-chrome-192x192.png", size: 192 },
    { name: "android-chrome-512x512.png", size: 512 },
  ];

  for (const { name, size } of sizes) {
    const path = `${outDir}/${name}`;
    await sharp(pngFilePath).resize(size, size).png().toFile(path);
    console.log(`Created ${path}`);
  }
}

await main();
