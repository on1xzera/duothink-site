import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
function versioned(reference) {
  const [pathname, query = ''] = reference.split('?');
  const parameters = query
    .split('&')
    .filter((parameter) => parameter && !parameter.startsWith('v='));
  return `${pathname}?${[...parameters, `v=${version}`].join('&')}`;
}
async function update(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (['dist', 'node_modules', '.git'].includes(entry.name)) continue;
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await update(filename);
      continue;
    }
    if (!/\.(html|css|js)$/u.test(filename)) continue;
    let contents = await readFile(filename, 'utf8');
    if (filename.endsWith('.html')) {
      const versionTag = `<meta name="application-version" content="${version}" />`;
      if (/<meta[^>]*name="application-version"[^>]*>/u.test(contents))
        contents = contents.replace(/<meta[^>]*name="application-version"[^>]*>/u, versionTag);
      else contents = contents.replace('<title>', `${versionTag}\n    <title>`);
      contents = contents.replace(
        /((?:src|href|poster)=["'])(\/assets\/[^"']+)(["'])/gu,
        (match, prefix, reference, quote) => prefix + versioned(reference) + quote,
      );
      contents = contents.replace(
        /(srcset=["'])([^"']+)(["'])/gu,
        (match, prefix, references, quote) =>
          prefix +
          references
            .split(',')
            .map((reference) => {
              const [url, ...descriptor] = reference.trim().split(/\s+/u);
              return [url.startsWith('/assets/') ? versioned(url) : url, ...descriptor].join(' ');
            })
            .join(', ') +
          quote,
      );
    } else if (filename.endsWith('.css')) {
      contents = contents.replace(
        /url\((["']?)(\/assets\/[^"')]+)\1\)/gu,
        (match, quote, reference) => `url(${quote}${versioned(reference)}${quote})`,
      );
    } else if (filename.startsWith(path.join(root, 'assets', 'scripts') + path.sep)) {
      contents = contents.replace(
        /((?:from\s*|import\()\s*)(['"])(\.[^'"]+)\2/gu,
        (match, prefix, quote, reference) => prefix + quote + versioned(reference) + quote,
      );
      contents = contents.replace(
        /(['"`])(\/assets\/[^'"`]+)\1/gu,
        (match, quote, reference) => quote + versioned(reference) + quote,
      );
    }
    await writeFile(filename, contents);
  }
}
await update(root);
console.log(`Browser assets now use release ${version}.`);
