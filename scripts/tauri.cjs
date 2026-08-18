const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const goBinCandidates = [
  process.env.GOROOT ? path.join(process.env.GOROOT, 'bin') : null,
  'C:\\Program Files\\Go\\bin',
].filter(Boolean);
const goBinPath = goBinCandidates.find((candidate) => fs.existsSync(candidate));

function withGoPath(options = {}) {
  const currentPath = process.env.PATH || '';
  const pathValue = goBinPath
    ? `${goBinPath}${path.delimiter}${currentPath}`
    : currentPath;

  return {
    ...options,
    env: {
      ...process.env,
      ...options.env,
      PATH: pathValue,
    },
  };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: false,
    ...withGoPath(options),
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(typeof result.status === 'number' ? result.status : 1);
  }
}

function runFinal(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: false,
    ...withGoPath(options),
  });

  if (result.error) {
    throw result.error;
  }

  process.exit(typeof result.status === 'number' ? result.status : 1);
}

function runTauriDirect() {
  run('npm.cmd', ['run', 'sync-version'], { shell: process.platform === 'win32' });
  runFinal('npx.cmd', ['tauri', ...process.argv.slice(2)], { shell: process.platform === 'win32' });
}

if (process.platform !== 'win32') {
  run('npm', ['run', 'sync-version']);
  runFinal('npx', ['tauri', ...process.argv.slice(2)]);
}

const vcvars64Candidates = [
  process.env.GMD_VCVARS64_PATH,
  'C:\\GMD-Account-Manager-Build\\vs-buildtools\\VC\\Auxiliary\\Build\\vcvars64.bat',
  'C:\\Program Files (x86)\\Microsoft Visual Studio\\2022\\BuildTools\\VC\\Auxiliary\\Build\\vcvars64.bat',
].filter(Boolean);
const vcvars64Path = vcvars64Candidates.find((candidate) => fs.existsSync(candidate));

if (!vcvars64Path) {
  console.warn('vcvars64.bat not found, falling back to the existing shell environment.');
  runTauriDirect();
}

const tempScriptPath = path.join(os.tmpdir(), `gmd-account-manager-tauri-${process.pid}.cmd`);
const tauriCliPath = path.join(repoRoot, 'node_modules', '.bin', 'tauri.cmd');
const tauriArgs = process.argv.slice(2);

if (!fs.existsSync(tauriCliPath)) {
  console.warn('Local tauri CLI not found, falling back to the existing shell environment.');
  runTauriDirect();
}

const quotedArgs = tauriArgs.map((arg) => {
  if (/[\s"]/u.test(arg)) {
    return `"${arg.replace(/"/g, '""')}"`;
  }
  return arg;
});
const scriptBody = [
  '@echo off',
  ...(goBinPath ? [`set "PATH=${goBinPath};%PATH%"`] : []),
  `call "${vcvars64Path}"`,
  'if errorlevel 1 exit /b %errorlevel%',
  'call npm.cmd run sync-version',
  'if errorlevel 1 exit /b %errorlevel%',
  `call "${tauriCliPath}" ${quotedArgs.join(' ')}`.trim(),
].join('\r\n');

fs.writeFileSync(tempScriptPath, scriptBody);

try {
  runFinal('cmd.exe', ['/d', '/c', tempScriptPath]);
} finally {
  fs.rmSync(tempScriptPath, { force: true });
}
