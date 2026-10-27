import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, gzipSync, constants } from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const destination = path.join(root, 'dist');
await import('./version-assets.mjs');
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
for (const entry of [
  'index.html',
  '404.html',
  '404',
  'about',
  'contact',
  'projects',
  'legal',
  'assets',
])
  await cp(path.join(root, entry), path.join(destination, entry), { recursive: true });

async function compress(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await compress(filename);
      continue;
    }
    if (!/\.(html|css|js|glsl|svg)$/u.test(entry.name)) continue;
    const contents = await readFile(filename);
    await writeFile(
      filename + '.br',
      brotliCompressSync(contents, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }),
    );
    await writeFile(filename + '.gz', gzipSync(contents, { level: 9 }));
  }
}
await compress(destination);
console.log('Production files are ready in dist/.');
