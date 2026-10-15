#!/usr/bin/env node
// No dependencies: installation needs Node; installed shortcuts only need Chrome.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apps = [
  { id: 'todo-daylight', name: 'Todo', route: '/', size: '1200,850' },
  { id: 'todo-mini', name: 'Todo Mini Today', route: '/mini', size: '380,600' },
];
const shellQuote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
const xml = (value) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const desktopValue = (value) => value.replaceAll('\\', '\\\\').replaceAll('\n', '\\n');
// Exec has both desktop-entry escaping and command argument escaping, but no shell.
const desktopExec = (value) => '"' + value.replace(/[\\"`$]/g, (c) => '\\' + c).replaceAll('\\', '\\\\').replaceAll('%', '%%') + '"';

export function parseOptions(argv) {
  const result = { platform: process.platform, desktop: true };
  const values = new Map([
    ['--url', 'url'], ['--chrome', 'chrome'], ['--profile', 'profile'],
    ['--platform', 'platform'], ['--output-dir', 'outputDir'],
  ]);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (values.has(arg)) {
      if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(`Missing value for ${arg}.`);
      result[values.get(arg)] = argv[++i];
    } else if (arg === '--dry-run') result.dryRun = true;
    else if (arg === '--no-desktop') result.desktop = false;
    else if (arg === '--help' || arg === '-h') result.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (!['linux', 'darwin', 'win32'].includes(result.platform)) throw new Error('Supported platforms: linux, darwin, win32.');
  if (result.platform !== process.platform && !result.dryRun)
    throw new Error('--platform is only for --dry-run previews. Install on the destination OS.');
  if (result.profile && /[\x00-\x1f"/\\]/.test(result.profile)) throw new Error('Use a Chrome profile folder name such as Default or Profile 1.');
  return result;
}

export function validateOrigin(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Use an HTTP(S) server origin, such as http://localhost:4310.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/')
    throw new Error('Use only the HTTP(S) server origin: no credentials, path, query or fragment.');
  return url.origin;
}

async function isExecutable(file, platform) {
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile()) return false;
    await fs.access(file, platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK);
    return true;
  } catch { return false; }
}

export async function findChrome(platform, env, home, override) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const candidates = override ? [override] : platform === 'darwin' ? [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    p.join(home, 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ] : platform === 'win32' ? [
    ...[env.LOCALAPPDATA, env.PROGRAMFILES, env['PROGRAMFILES(X86)']]
      .filter(Boolean).map((dir) => p.join(dir, 'Google/Chrome/Application/chrome.exe')),
    ...[env.LOCALAPPDATA, env.PROGRAMFILES].filter(Boolean).map((dir) => p.join(dir, 'Chromium/Application/chrome.exe')),
  ] : ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'].flatMap((name) =>
    (env.PATH || '').split(path.delimiter).filter(Boolean).map((dir) => p.join(dir, name)));
  for (const candidate of candidates) {
    if (!p.isAbsolute(candidate) || /[\x00-\x1f]/.test(candidate)) continue;
    if (await isExecutable(candidate, platform)) return candidate;
  }
  throw new Error('Chrome/Chromium was not found. Install a native browser for your OS/CPU, or pass --chrome with its absolute executable path.');
}

function desktopFolder(platform, env, home) {
  if (platform === 'linux') {
    try {
      const dir = execFileSync('xdg-user-dir', ['DESKTOP'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      if (path.isAbsolute(dir)) return dir;
    } catch { /* A minimal desktop may not ship xdg-user-dir. */ }
  }
  if (platform === 'win32') return undefined; // Resolve redirected/OneDrive Desktop through Windows itself.
  return path.join(home, 'Desktop');
}

export function createPlan({ platform, origin, chrome, profile, home, env = {}, desktop = true, desktopDir, outputDir }) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const output = outputDir && p.resolve(outputDir);
  const dataDir = output ? p.join(output, 'assets') : platform === 'linux'
    ? p.join(env.XDG_DATA_HOME || p.join(home, '.local/share'), 'todo-launchers')
    : platform === 'win32' ? p.join(env.LOCALAPPDATA || p.join(home, 'AppData/Local'), 'Todo Launchers')
    : p.join(home, 'Library/Application Support/Todo Launchers');
  const files = [];
  const shortcuts = [];
  const add = (file, text, mode = 0o644) => files.push({ path: file, text, mode });
  for (const app of apps) {
    const args = [`--app=${origin}${app.route}`, `--window-size=${app.size}`];
    if (profile) args.push(`--profile-directory=${profile}`);
    if (platform === 'linux') args.push(`--class=${app.id}`);
    if (platform === 'linux') {
      const launcher = p.join(dataDir, app.id);
      add(launcher, `#!/bin/sh\nexec ${[chrome, ...args].map(shellQuote).join(' ')} "$@"\n`, 0o755);
      const entry = `[Desktop Entry]\nType=Application\nVersion=1.0\nName=${app.name}\nComment=Open ${app.name} in a Chrome app window\nExec=${desktopExec(launcher)}\nIcon=${desktopValue(p.join(dataDir, 'todo.png'))}\nTerminal=false\nCategories=Office;\nStartupWMClass=${app.id}\n`;
      const menu = output ? p.join(output, 'applications') : p.join(env.XDG_DATA_HOME || p.join(home, '.local/share'), 'applications');
      add(p.join(menu, `${app.id}.desktop`), entry, 0o755);
      if (desktop) add(p.join(output ? p.join(output, 'Desktop') : desktopDir || p.join(home, 'Desktop'), `${app.id}.desktop`), entry, 0o755);
    } else if (platform === 'darwin') {
      const bundle = p.join(output || p.join(home, 'Applications'), `${app.name}.app`);
      add(p.join(bundle, 'Contents/MacOS/launch'), `#!/bin/sh\nexec ${[chrome, ...args].map(shellQuote).join(' ')}\n`, 0o755);
      add(p.join(bundle, 'Contents/Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n<key>CFBundleName</key><string>${xml(app.name)}</string>\n<key>CFBundleDisplayName</key><string>${xml(app.name)}</string>\n<key>CFBundleIdentifier</key><string>local.todo.${app.id}</string>\n<key>CFBundlePackageType</key><string>APPL</string>\n<key>CFBundleExecutable</key><string>launch</string>\n<key>CFBundleIconFile</key><string>todo.icns</string>\n<key>CFBundleVersion</key><string>1</string>\n<key>LSUIElement</key><true/>\n</dict></plist>\n`);
      shortcuts.push({ bundle, desktopLink: desktop ? p.join(output ? p.join(output, 'Desktop') : desktopDir || p.join(home, 'Desktop'), `${app.name}.app`) : undefined });
    } else {
      shortcuts.push({ name: app.name, chrome, args, icon: p.join(dataDir, 'todo.ico'),
        menu: output ? p.join(output, 'Start Menu') : p.join(env.APPDATA || p.join(home, 'AppData/Roaming'), 'Microsoft/Windows/Start Menu/Programs/Todo'),
        desktop: desktop ? (output ? p.join(output, 'Desktop') : desktopDir || null) : false });
    }
  }
  return { platform, origin, chrome, dataDir, files, shortcuts };
}

export function windowsScript(shortcuts) {
  const records = shortcuts.map((s) => ({ ...s, args: s.args.map((arg) => `"${arg}"`).join(' ') }));
  // Base64 JSON avoids PowerShell source interpolation, including quotes and Unicode.
  const encoded = Buffer.from(JSON.stringify(records), 'utf8').toString('base64');
  return `$ErrorActionPreference = 'Stop'\n$items = ConvertFrom-Json ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')))\n$wsh = New-Object -ComObject WScript.Shell\nforeach ($item in $items) {\n  $folders = @($item.menu)\n  if ($item.desktop -ne $false) {\n    if ($null -eq $item.desktop) { $folders += [Environment]::GetFolderPath('Desktop') } else { $folders += $item.desktop }\n  }\n  foreach ($folder in $folders) {\n    if (-not $folder) { throw 'Windows Desktop folder could not be resolved.' }\n    [IO.Directory]::CreateDirectory($folder) | Out-Null\n    $link = $wsh.CreateShortcut((Join-Path $folder ($item.name + '.lnk')))\n    $link.TargetPath = $item.chrome\n    $link.Arguments = $item.args\n    $link.IconLocation = $item.icon + ',0'\n    $link.Description = 'Open ' + $item.name + ' in a Chrome app window'\n    $link.Save()\n  }\n}\n`;
}

function icns(png) {
  const header = Buffer.alloc(16);
  header.write('icns'); header.writeUInt32BE(png.length + 16, 4);
  header.write('ic09', 8); header.writeUInt32BE(png.length + 8, 12);
  return Buffer.concat([header, png]);
}
function ico(png) {
  const header = Buffer.alloc(22);
  header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4);
  header[6] = 192; header[7] = 192;
  header.writeUInt16LE(1, 10); header.writeUInt16LE(32, 12);
  header.writeUInt32LE(png.length, 14); header.writeUInt32LE(22, 18);
  return Buffer.concat([header, png]);
}

export async function installPlan(plan) {
  for (const file of plan.files) {
    await fs.mkdir(path.dirname(file.path), { recursive: true });
    await fs.writeFile(file.path, file.text, { mode: file.mode });
    await fs.chmod(file.path, file.mode);
  }
  await fs.mkdir(plan.dataDir, { recursive: true });
  if (plan.platform === 'linux') {
    await fs.copyFile(path.join(root, 'app/public/todo-512.png'), path.join(plan.dataDir, 'todo.png'));
  } else if (plan.platform === 'darwin') {
    const icon = icns(await fs.readFile(path.join(root, 'app/public/todo-512.png')));
    for (const shortcut of plan.shortcuts) {
      await fs.mkdir(path.join(shortcut.bundle, 'Contents/Resources'), { recursive: true });
      await fs.writeFile(path.join(shortcut.bundle, 'Contents/Resources/todo.icns'), icon);
      if (shortcut.desktopLink) {
        await fs.mkdir(path.dirname(shortcut.desktopLink), { recursive: true });
        try { await fs.symlink(shortcut.bundle, shortcut.desktopLink); }
        catch (error) {
          if (error.code !== 'EEXIST' || await fs.readlink(shortcut.desktopLink).catch(() => '') !== shortcut.bundle) throw error;
        }
      }
    }
  } else {
    await fs.writeFile(path.join(plan.dataDir, 'todo.ico'), ico(await fs.readFile(path.join(root, 'app/public/todo-192.png'))));
    const source = windowsScript(plan.shortcuts);
    // Windows PowerShell is supplied by Windows; no execution-policy changes required.
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(source, 'utf16le').toString('base64')], { stdio: 'inherit' });
  }
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseOptions(argv);
  if (options.help) {
    console.log(`Install Todo and Mini Today as Chrome app shortcuts.\n\nnode launchers/install.mjs [--url ORIGIN] [--chrome ABSOLUTE_PATH]\n  [--profile "Profile 1"] [--no-desktop] [--dry-run] [--output-dir DIR]\n\n--url defaults to PUBLIC_ORIGIN in the environment or root .env, then http://localhost:4310.\n--platform linux|darwin|win32 previews another OS with --dry-run and --chrome.\nThe server must already be running. No server, browser or login is installed or changed.`);
    return;
  }
  // Read only the origin. Do not load or print unrelated private server settings.
  let configured;
  if (!options.url && !process.env.PUBLIC_ORIGIN) {
    try {
      const { parseEnv } = await import('node:util');
      configured = parseEnv(await fs.readFile(path.join(root, '.env'), 'utf8')).PUBLIC_ORIGIN;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const origin = validateOrigin(options.url || process.env.PUBLIC_ORIGIN || configured || 'http://localhost:4310');
  const preview = options.dryRun && options.platform !== process.platform;
  if (preview && !options.chrome) throw new Error('Cross-platform previews need --chrome with a target OS executable path.');
  const p = options.platform === 'win32' ? path.win32 : path.posix;
  const chrome = preview ? options.chrome : await findChrome(options.platform, process.env, os.homedir(), options.chrome);
  if (!p.isAbsolute(chrome) || /[\x00-\x1f"]/.test(chrome)) throw new Error('Chrome must be an absolute executable path without control characters or double quotes.');
  const home = preview ? (options.platform === 'win32' ? 'C:\\Users\\you' : '/Users/you') : os.homedir();
  const plan = createPlan({ ...options, origin, chrome, home, env: preview ? {} : process.env,
    desktopDir: preview ? undefined : desktopFolder(options.platform, process.env, os.homedir()) });
  if (options.dryRun) { console.log(JSON.stringify(plan, null, 2)); return; }
  await installPlan(plan);
  if (options.platform === 'linux') {
    const menu = path.dirname(plan.files.find((file) => file.path.endsWith('.desktop')).path);
    try { execFileSync('update-desktop-database', [menu], { stdio: 'ignore' }); } catch { /* Optional desktop cache. */ }
    if (options.desktop) console.log('If your desktop asks, right-click each icon and choose Allow Launching.');
  }
  console.log(`Installed Todo and Todo Mini Today for ${process.platform}/${process.arch}.\nServer: ${origin}\nKeep the Todo server available. Shortcuts reuse Chrome's existing profile and sign-in.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  main().catch((error) => { console.error(`Todo launchers: ${error.message}`); process.exitCode = 1; });
