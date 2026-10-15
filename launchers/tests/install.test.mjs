import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createPlan, findChrome, installPlan, parseOptions, validateOrigin, windowsScript } from '../install.mjs';
import { npmInvocation, run } from '../../app/scripts/lifecycle.mjs';

const script = fileURLToPath(new URL('../install.mjs', import.meta.url));
const quote = (s) => "'" + s.replaceAll("'", "'\\''") + "'";
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'todo-launchers-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

test('server setup can invoke the installed npm without spawning a Windows cmd file', async () => {
  const npm = await npmInvocation();
  if (process.platform === 'win32') {
    assert.equal(npm.command, process.execPath);
    assert.ok(npm.args[0].endsWith('.js'));
  }
  await run(npm.command, [...npm.args, '--version'], { stdio: 'ignore' });
});

test('origins keep launchers on the exact configured server without credentials or extra routes', () => {
  assert.equal(validateOrigin('https://todo.example:444/'), 'https://todo.example:444');
  assert.equal(validateOrigin('http://[::1]:4310'), 'http://[::1]:4310');
  for (const value of ['javascript:alert(1)', 'file:///tmp/test', 'https://user:secret@todo.example', 'https://todo.example/mini', 'https://todo.example/?token=secret', 'https://todo.example/#x', '--app=evil'])
    assert.throws(() => validateOrigin(value), /HTTP\(S\)/);
});

test('CLI refuses typos, missing arguments, invalid profiles and installation for another OS', () => {
  assert.throws(() => parseOptions(['--urll', 'http://localhost:4310']), /Unknown option/);
  assert.throws(() => parseOptions(['--url', '--dry-run']), /Missing value/);
  assert.throws(() => parseOptions(['--profile', 'a" --user-data-dir=other']), /profile/);
  const other = process.platform === 'win32' ? 'linux' : 'win32';
  assert.throws(() => parseOptions(['--platform', other]), /only for --dry-run/);
  assert.equal(parseOptions(['--platform', other, '--dry-run']).platform, other);
});

test('browser detection accepts an installed executable and fails before creating files', async (t) => {
  const dir = await fixture(t);
  assert.equal(await findChrome(process.platform, {}, dir, process.execPath), process.execPath);
  await assert.rejects(findChrome(process.platform, { PATH: dir }, dir, path.join(dir, 'missing')), /not found/);
  await assert.rejects(findChrome(process.platform, { PATH: dir }, dir, dir), /not found/);
  assert.deepEqual(await fs.readdir(dir), []);
});

for (const platform of ['linux', 'darwin', 'win32']) {
  test(`${platform} plan has separate Todo/Mini targets using one chosen Chrome profile`, () => {
    const home = platform === 'win32' ? 'C:\\Users\\A User' : '/home/a user';
    const chrome = platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : '/opt/Google Chrome/chrome';
    const plan = createPlan({ platform, home, chrome, origin: 'https://todo.example', profile: 'Profile 1' });
    const source = platform === 'win32' ? JSON.stringify(plan.shortcuts) : plan.files.map((f) => f.text).join('\n');
    assert.ok(source.includes('--app=https://todo.example/'));
    assert.ok(source.includes('--app=https://todo.example/mini'));
    assert.ok(source.includes('--profile-directory=Profile 1'));
    assert.ok(!source.includes('--user-data-dir'));
    assert.ok(!source.includes('--no-sandbox'));
    assert.equal(platform === 'win32' ? plan.shortcuts.length : plan.files.filter((f) => f.mode === 0o755 && !f.path.endsWith('.desktop')).length, 2);
    if (platform === 'win32') {
      assert.equal(plan.shortcuts[0].desktop, null); // Windows Known Folder, including OneDrive.
      assert.ok(windowsScript(plan.shortcuts).includes("GetFolderPath('Desktop')"));
    }
  });
}

test('dry-run writes nothing and honors explicit URL ahead of environment settings', async (t) => {
  const dir = await fixture(t);
  const out = execFileSync(process.execPath, [script, '--dry-run', '--url', 'https://todo.example', '--chrome', process.execPath, '--output-dir', dir],
    { encoding: 'utf8', env: { ...process.env, PUBLIC_ORIGIN: 'https://other.example' } });
  assert.equal(JSON.parse(out).origin, 'https://todo.example');
  assert.deepEqual(await fs.readdir(dir), []);
});

test('native shortcut install is repeatable, self-contained and preserves unrelated files', async (t) => {
  const dir = await fixture(t);
  const outputDir = path.join(dir, "A User's $folder % path");
  await fs.mkdir(outputDir);
  await fs.writeFile(path.join(outputDir, 'unrelated.txt'), 'keep');
  const plan = createPlan({ platform: process.platform, home: dir, outputDir, chrome: process.execPath, origin: 'http://localhost:4310' });
  await installPlan(plan);
  await installPlan(plan);
  assert.equal(await fs.readFile(path.join(outputDir, 'unrelated.txt'), 'utf8'), 'keep');
  if (process.platform === 'linux') {
    const entries = plan.files.filter((f) => f.path.endsWith('.desktop'));
    assert.equal(entries.length, 4);
    // Use the native validator when present; CI may not install this desktop utility.
    let validator;
    try { validator = execFileSync('which', ['desktop-file-validate'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch {}
    if (validator) for (const entry of entries) execFileSync(validator, [entry.path]);
    assert.equal((await fs.stat(path.join(plan.dataDir, 'todo.png'))).isFile(), true);
  } else if (process.platform === 'darwin') {
    for (const s of plan.shortcuts) {
      execFileSync('/usr/bin/plutil', ['-lint', path.join(s.bundle, 'Contents/Info.plist')]);
      assert.equal(await fs.readlink(s.desktopLink), s.bundle);
      const icon = await fs.readFile(path.join(s.bundle, 'Contents/Resources/todo.icns'));
      assert.equal(icon.toString('ascii', 0, 4), 'icns');
      assert.equal(icon.readUInt32BE(4), icon.length);
    }
  } else {
    const shortcut = path.join(outputDir, 'Start Menu/Todo.lnk');
    assert.ok((await fs.stat(shortcut)).size > 0);
    const source = `$s = (New-Object -ComObject WScript.Shell).CreateShortcut('${shortcut.replaceAll("'", "''")}'); @{ target = $s.TargetPath; arguments = $s.Arguments; icon = $s.IconLocation } | ConvertTo-Json -Compress`;
    const actual = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(source, 'utf16le').toString('base64')], { encoding: 'utf8' }));
    assert.equal(actual.target.toLowerCase(), process.execPath.toLowerCase());
    assert.ok(actual.arguments.includes('--app=http://localhost:4310/'));
    assert.ok(actual.icon.endsWith('todo.ico,0'));
    const icon = await fs.readFile(path.join(plan.dataDir, 'todo.ico'));
    assert.equal(icon.readUInt16LE(2), 1);
    assert.equal(icon.readUInt32LE(14), icon.length - 22);
  }
});

test('POSIX launchers deliver exact arguments with spaces and shell metacharacters', { skip: process.platform === 'win32' }, async (t) => {
  const dir = await fixture(t);
  const capture = path.join(dir, 'captured arguments');
  const chrome = path.join(dir, "Chrome's $browser");
  await fs.writeFile(chrome, `#!/bin/sh\nprintf '%s\\n' "$@" > ${quote(capture)}\n`, { mode: 0o755 });
  for (const platform of ['linux', 'darwin']) {
    const plan = createPlan({ platform, home: dir, chrome, profile: 'Profile 1', origin: 'http://localhost:4310', outputDir: path.join(dir, platform), desktop: false });
    for (const f of plan.files.filter((f) => f.mode === 0o755 && !f.path.endsWith('.desktop'))) {
      await fs.mkdir(path.dirname(f.path), { recursive: true });
      await fs.writeFile(f.path, f.text, { mode: f.mode });
      execFileSync(f.path);
      const args = (await fs.readFile(capture, 'utf8')).trim().split('\n');
      assert.ok(args.includes('--profile-directory=Profile 1'));
      assert.ok(args.includes('--app=http://localhost:4310/') || args.includes('--app=http://localhost:4310/mini'));
      assert.equal(args.length, platform === 'linux' ? 4 : 3);
    }
  }
});
