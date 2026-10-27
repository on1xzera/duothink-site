import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
let documents = 0;
let resources = 0;
function fail(message) {
  failures += 1;
  console.error(message);
}
async function walk(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.git'].includes(entry.name)) continue;
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await walk(filename)));
    else result.push(filename);
  }
  return result;
}
async function checkLocal(reference, owner) {
  if (!reference.startsWith('/') || reference.startsWith('//')) return;
  const pathname = decodeURIComponent(reference.split(/[?#]/u)[0]);
  if (pathname === '/api/contact') return;
  let filename = path.join(root, pathname);
  try {
    if ((await stat(filename)).isDirectory()) filename = path.join(filename, 'index.html');
    await stat(filename);
    resources += 1;
  } catch {
    fail(`Missing resource in ${path.relative(root, owner)}: ${reference}`);
  }
}
const files = await walk(root);
for (const filename of files) {
  if (/\.(js|mjs)$/u.test(filename)) {
    const result = spawnSync(process.execPath, ['--check', filename], { encoding: 'utf8' });
    if (result.status !== 0) fail(result.stderr);
  }
  if (!/\.(html|css|js|glsl)$/u.test(filename)) continue;
  const contents = await readFile(filename, 'utf8');
  if (filename.endsWith('.html')) {
    documents += 1;
    for (const match of contents.matchAll(/(?:src|href|action|poster)="([^"]+)"/gu))
      await checkLocal(match[1], filename);
    for (const match of contents.matchAll(/srcset="([^"]+)"/gu))
      for (const candidate of match[1].split(','))
        await checkLocal(candidate.trim().split(/\s+/u)[0], filename);
    if (!/<title>[^<]+<\/title>/u.test(contents)) fail(`Missing title: ${filename}`);
    if (!/<html[^>]+lang="pt-BR"/u.test(contents)) fail(`Missing page language: ${filename}`);
  }
  if (filename.endsWith('.css')) {
    for (const match of contents.matchAll(/url\(["']?([^"')]+)["']?\)/gu))
      await checkLocal(match[1], filename);
  }
  if (filename.endsWith('.js')) {
    for (const match of contents.matchAll(/(?:from\s*|import\()\s*['"](\.[^'"]+)['"]/gu)) {
      try {
        await stat(path.resolve(path.dirname(filename), match[1].split(/[?#]/u)[0]));
      } catch {
        fail(`Missing JavaScript module: ${filename} → ${match[1]}`);
      }
    }
  }
}
console.log(`Checked ${documents} pages and ${resources} local references.`);
if (failures) process.exitCode = 1;
else console.log('All static resources and JavaScript syntax checks passed.');
