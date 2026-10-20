import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareRelease, verifyVersions, shouldMakeLatest } from './prepare-release.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'virushelper-release-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [name, bundle] of [
    ['Windows-x64', 'app-setup.exe'],
    ['macOS-arm64', 'app.app.tar.gz'],
    ['macOS-x64', 'app.app.tar.gz'],
  ]) {
    const dir = join(root, 'input', `virushelper-release-${name}`);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, bundle), `binary-${name}`);
    await writeFile(
      join(dir, bundle + '.sig'),
      Buffer.from(`signature-${name}`).toString('base64'),
    );
    if (name.startsWith('macOS')) await writeFile(join(dir, 'app.dmg'), `dmg-${name}`);
  }
  return {
    artifactRoot: join(root, 'input'),
    output: join(root, 'out'),
    repository: 'breaking153/virushelper',
    tag: 'v0.2.0',
  };
}

test('assembles all platform signatures and unique tagged download URLs', async (t) => {
  const options = await fixture(t);
  await prepareRelease(options);
  const manifest = JSON.parse(await readFile(join(options.output, 'latest.json'), 'utf8'));
  assert.equal(manifest.version, '0.2.0');
  assert.deepEqual(Object.keys(manifest.platforms).sort(), [
    'darwin-aarch64',
    'darwin-x86_64',
    'windows-x86_64',
  ]);
  const urls = Object.values(manifest.platforms).map((p) => p.url);
  assert.equal(new Set(urls).size, 3);
  for (const [platform, entry] of Object.entries(manifest.platforms)) {
    assert.match(
      entry.url,
      /^https:\/\/github.com\/breaking153\/virushelper\/releases\/download\/v0.2.0\//,
    );
    assert.equal(
      Buffer.from(entry.signature, 'base64').toString(),
      'signature-' +
        {
          'windows-x86_64': 'Windows-x64',
          'darwin-aarch64': 'macOS-arm64',
          'darwin-x86_64': 'macOS-x64',
        }[platform],
    );
  }
  assert.match(
    await readFile(join(options.output, 'SHA256SUMS.txt'), 'utf8'),
    /VirusHelper_0.2.0_macOS-arm64.dmg/,
  );
});

test('refuses an incomplete release instead of publishing a partial update manifest', async (t) => {
  const options = await fixture(t);
  await rm(join(options.artifactRoot, 'virushelper-release-macOS-x64'), { recursive: true });
  await assert.rejects(prepareRelease(options), /macOS-x64/);
  await assert.rejects(readFile(join(options.output, 'latest.json')), { code: 'ENOENT' });
});

test('rejects empty signatures and mismatched version tags', async (t) => {
  const options = await fixture(t);
  await writeFile(
    join(options.artifactRoot, 'virushelper-release-Windows-x64', 'app-setup.exe.sig'),
    '',
  );
  await assert.rejects(prepareRelease(options), /signature/i);
  assert.throws(() => verifyVersions('v0.3.0', ['0.2.0', '0.2.0', '0.2.0']), /version/i);
  assert.throws(() => verifyVersions('v0.2.0', ['0.2.0', '0.1.0', '0.2.0']), /version/i);
  assert.equal(verifyVersions('v0.2.0', ['0.2.0', '0.2.0', '0.2.0']), '0.2.0');
});

test('a slower older build cannot replace a newer Latest release', () => {
  assert.equal(shouldMakeLatest('v0.2.0', 'v0.3.0'), false);
  assert.equal(shouldMakeLatest('v0.10.0', 'v0.9.9'), true);
  assert.equal(shouldMakeLatest('v0.2.0', ''), true);
  assert.equal(shouldMakeLatest('v0.2.0', 'v0.2.0'), false);
  assert.throws(() => shouldMakeLatest('v0.2.0', 'unknown'), /version/i);
});
