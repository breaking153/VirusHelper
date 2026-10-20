import { createHash } from 'node:crypto';
import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const targets = [
  { name: 'Windows-x64', key: 'windows-x86_64', extension: '.exe', outputExtension: '-setup.exe' },
  {
    name: 'macOS-arm64',
    key: 'darwin-aarch64',
    extension: '.app.tar.gz',
    outputExtension: '.app.tar.gz',
  },
  {
    name: 'macOS-x64',
    key: 'darwin-x86_64',
    extension: '.app.tar.gz',
    outputExtension: '.app.tar.gz',
  },
];

export function verifyVersions(tag, versions) {
  if (
    !/^v\d+\.\d+\.\d+$/.test(tag) ||
    versions.length !== 3 ||
    versions.some((v) => `v${v}` !== tag)
  ) {
    throw new Error(`Release tag and package/Cargo/Tauri versions must match: ${tag}`);
  }
  return tag.slice(1);
}

export function shouldMakeLatest(tag, currentTag) {
  const parse = (value) => {
    if (!/^v\d+\.\d+\.\d+$/.test(value)) throw new Error(`Invalid release version: ${value}`);
    return value.slice(1).split('.').map(BigInt);
  };
  const candidate = parse(tag);
  if (!currentTag) return true;
  const current = parse(currentTag);
  for (let i = 0; i < 3; i++) {
    if (candidate[i] !== current[i]) return candidate[i] > current[i];
  }
  return false;
}

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) =>
      entry.isDirectory() ? filesBelow(join(directory, entry.name)) : [join(directory, entry.name)],
    ),
  );
  return files.flat();
}

function exactlyOne(files, extension, name) {
  const matching = files.filter((file) => file.endsWith(extension));
  if (matching.length !== 1)
    throw new Error(`${name}: expected one ${extension} file, received ${matching.length}`);
  return matching[0];
}

export async function prepareRelease({ artifactRoot, output, repository, tag }) {
  const version = verifyVersions(tag, [tag.slice(1), tag.slice(1), tag.slice(1)]);
  if (!/^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+$/.test(repository))
    throw new Error('Invalid GitHub repository');
  const platforms = {};
  const copies = [];
  for (const target of targets) {
    const files = await filesBelow(join(artifactRoot, `virushelper-release-${target.name}`));
    const bundle = exactlyOne(files, target.extension, target.name);
    const signature = (await readFile(bundle + '.sig', 'utf8')).trim();
    if (!signature || !/^[A-Za-z0-9+/=]+$/.test(signature))
      throw new Error(`${target.name}: invalid update signature`);
    const name = `VirusHelper_${version}_${target.name}${target.outputExtension}`;
    platforms[target.key] = {
      signature,
      url: `https://github.com/${repository}/releases/download/${tag}/${name}`,
    };
    copies.push([bundle, name], [bundle + '.sig', name + '.sig']);
    if (target.key.startsWith('darwin')) {
      copies.push([
        exactlyOne(files, '.dmg', target.name),
        `VirusHelper_${version}_${target.name}.dmg`,
      ]);
    }
  }
  // Validate every architecture before writing a manifest that could be published.
  await mkdir(output, { recursive: true });
  for (const [source, name] of copies) await copyFile(source, join(output, name));
  await writeFile(
    join(output, 'latest.json'),
    JSON.stringify(
      {
        version,
        notes: `VirusHelper ${tag}: 详见 GitHub Release 更新说明。`,
        pub_date: new Date().toISOString(),
        platforms,
      },
      null,
      2,
    ) + '\n',
  );
  const sums = [];
  for (const name of [...copies.map(([, name]) => name), 'latest.json']) {
    const hash = createHash('sha256')
      .update(await readFile(join(output, name)))
      .digest('hex');
    sums.push(`${hash}  ${name}`);
  }
  await writeFile(join(output, 'SHA256SUMS.txt'), sums.join('\n') + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [command, tag, artifactRoot, output] = process.argv.slice(2);
  if (command === 'verify') {
    const pkg = JSON.parse(await readFile('package.json', 'utf8'));
    const config = JSON.parse(await readFile('src-tauri/tauri.conf.json', 'utf8'));
    const cargo = await readFile('Cargo.toml', 'utf8');
    verifyVersions(tag, [
      pkg.version,
      config.version,
      cargo.match(/^version\s*=\s*"([^"]+)"/m)?.[1],
    ]);
    console.log(`Verified release version ${tag}`);
  } else if (command === 'latest') {
    console.log(shouldMakeLatest(tag, artifactRoot ?? ''));
  } else if (command === 'prepare' && artifactRoot && output) {
    await prepareRelease({ tag, artifactRoot, output, repository: process.env.GITHUB_REPOSITORY });
    console.log(`Prepared ${basename(output)} for ${tag}`);
  } else {
    throw new Error('Usage: prepare-release.mjs verify <tag> | prepare <tag> <artifacts> <output>');
  }
}
