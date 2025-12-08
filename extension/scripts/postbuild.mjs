import { copyFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

async function main() {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const distDir = path.resolve(__dirname, '../dist');
  const manifestPath = path.join(distDir, '.vite/manifest.json');

  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch (error) {
    console.warn('[postbuild] Unable to read Vite manifest; skipping loader copy.', error);
    return;
  }

  const loaders = Object.entries(manifest).filter(([key]) => key.endsWith('-loader.js'));
  await Promise.all(
    loaders.map(async ([relativePath, entry]) => {
      const outputPath = path.join(distDir, entry.file ?? '');
      const targetPath = path.join(distDir, relativePath);

      try {
        await mkdir(path.dirname(targetPath), { recursive: true });
        await copyFile(outputPath, targetPath);
      } catch (error) {
        console.warn(`[postbuild] Failed to materialize loader ${relativePath}`, error);
      }
    })
  );
}

await main();
