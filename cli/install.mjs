#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const usage = `Install gsc-hub clients without installing or running the server.

Usage: node cli/install.mjs [--cli] [--skills] [options]
Without component flags, install both CLI and skills.

  --cli                 Install only the CLI
  --skills              Install only skills
  --skill NAME          Select a skill; repeat for several (implies --skills)
  --agent codex|claude   Skill destination (default codex)
  --skills-dir PATH     Custom skill directory, instead of --agent
  --prefix PATH         CLI prefix (macOS: ~/.local; Windows: LocalAppData/gsc-hub)
  --check               Check prerequisites without installing
  --force               Replace existing selected skill directories
  -h, --help            Print help

The CLI is installed from a packed archive, so you can delete the checkout.
No API key is needed until you use the CLI to connect to a server.
`;

/**
 * Resolve npm's JavaScript entrypoint rather than executing npm.cmd through a
 * shell on Windows. This also preserves paths containing spaces.
 * @param {boolean} wantCli
 * @param {{nodeVersion?: string, nodePath?: string, env?: Record<string, string | undefined>}} [runtime]
 */
export function prerequisites(wantCli, {
  nodeVersion = process.versions.node, nodePath = process.execPath, env = process.env
} = {}) {
  const [major, minor] = nodeVersion.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 18)) {
    throw new Error('Node.js 22.18+ is required. Install current Node.js LTS; see docs/CLIENT-INSTALL.md.');
  }
  if (!wantCli) return { nodeVersion, npmPath: null };
  const candidates = [
    join(dirname(nodePath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(dirname(nodePath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')
  ];
  for (const directory of (env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean)) {
    for (const name of ['npm', 'npm.cmd']) {
      const command = join(directory, name);
      if (!existsSync(command)) continue;
      const actual = realpathSync(command);
      if (actual.endsWith('npm-cli.js')) candidates.push(actual);
      candidates.push(join(dirname(actual), 'node_modules', 'npm', 'bin', 'npm-cli.js'));
    }
  }
  const npmPath = candidates.find((candidate) => existsSync(candidate));
  if (!npmPath) throw new Error('npm is missing. Reinstall Node.js with npm; see docs/CLIENT-INSTALL.md. Skill-only installation does not require npm.');
  return { nodeVersion, npmPath };
}

/**
 * @param {string[]} argv
 * @param {{write?: (message: string) => void}} [io]
 */
export function install(argv, { write = (message) => process.stdout.write(message) } = {}) {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, strict: true, options: {
    cli: { type: 'boolean' }, skills: { type: 'boolean' },
    skill: { type: 'string', multiple: true }, agent: { type: 'string' },
    'skills-dir': { type: 'string' }, prefix: { type: 'string' },
    force: { type: 'boolean' }, check: { type: 'boolean' }, help: { type: 'boolean', short: 'h' }
  } });
  if (values.help) { write(usage); return; }
  if (positionals.length) throw new Error('Unexpected positional argument. Use --help.');
  if (values.agent && !['codex', 'claude'].includes(values.agent)) throw new Error('--agent must be codex or claude.');
  if (values.agent && values['skills-dir']) throw new Error('Choose --agent or --skills-dir, not both.');
  for (const key of /** @type {('prefix' | 'skills-dir')[]} */ (['prefix', 'skills-dir'])) {
    if (values[key] !== undefined && !String(values[key]).trim()) throw new Error(`--${key} must not be empty.`);
  }
  const defaults = !values.cli && !values.skills && !values.skill?.length;
  const wantCli = Boolean(values.cli || defaults);
  const wantSkills = Boolean(values.skills || values.skill?.length || defaults);
  const runtime = prerequisites(wantCli);
  if (values.check) {
    write(`Node.js ${runtime.nodeVersion}: OK\n${runtime.npmPath ? `npm: ${runtime.npmPath}\n` : 'npm: not needed for skills\n'}Prerequisites ready; nothing installed.\n`);
    return;
  }
  const source = fileURLToPath(new URL('.', import.meta.url));
  const skillSource = fileURLToPath(new URL('../.agents/skills/', import.meta.url));
  const prefix = resolve(values.prefix ?? (process.platform === 'win32'
    ? join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'gsc-hub')
    : join(homedir(), '.local')));
  let destination = resolve(values['skills-dir'] ?? (values.agent === 'claude'
    ? join(homedir(), '.claude', 'skills')
    : join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'skills')));
  if (existsSync(destination)) destination = realpathSync(destination);
  /** @type {string[]} */
  let names = [];
  if (wantSkills) {
    if (!existsSync(skillSource)) throw new Error('Skills are missing. Include .agents/skills in the repository checkout.');
    const available = readdirSync(skillSource, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && existsSync(join(skillSource, entry.name, 'SKILL.md')))
      .map((entry) => entry.name).sort();
    names = [...new Set(values.skill ?? available)];
    if (!names.length) throw new Error('No skills found in the checkout.');
    for (const name of names) {
      if (!available.includes(name)) throw new Error(`Unknown skill: ${name}. Available: ${available.join(', ')}`);
      const target = join(destination, name);
      const origin = join(skillSource, name);
      if (target === origin || target.startsWith(origin + sep) || origin.startsWith(target + sep)) {
        throw new Error('Skill destination must be separate from the source checkout.');
      }
      if (existsSync(join(destination, name)) && !values.force) {
        throw new Error(`Skill already exists: ${join(destination, name)}. Use --force to replace selected skills.`);
      }
    }
  }
  if (wantCli) {
    if (!runtime.npmPath) throw new Error('npm is required for CLI installation.');
    const temp = mkdtempSync(join(tmpdir(), 'gsc-hub-cli-install-'));
    try {
      const packed = JSON.parse(execFileSync(process.execPath, [runtime.npmPath, 'pack', source, '--pack-destination', temp, '--ignore-scripts', '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
      const archive = join(temp, packed[0].filename);
      execFileSync(process.execPath, [runtime.npmPath, 'install', '--global', '--prefix', prefix, '--ignore-scripts', '--no-audit', '--no-fund', archive], { stdio: ['ignore', 'pipe', 'pipe'] });
      const binDir = process.platform === 'win32' ? prefix : join(prefix, 'bin');
      write(`CLI installed: ${join(binDir, process.platform === 'win32' ? 'gsc-hub.cmd' : 'gsc-hub')}\nAdd ${binDir} to PATH if needed.\n`);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  }
  if (wantSkills) {
    mkdirSync(destination, { recursive: true });
    for (const name of names) {
      const target = join(destination, name);
      if (values.force) rmSync(target, { recursive: true, force: true });
      cpSync(join(skillSource, name), target, { recursive: true, errorOnExist: true, force: false });
      write(`Skill installed: ${target}\n`);
    }
  }
}

if (process.argv[1] && existsSync(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { install(process.argv.slice(2)); }
  catch (error) {
    process.stderr.write(`gsc-hub install: ${error instanceof Error ? error.message : 'Installation failed'}\n`);
    process.exitCode = 1;
  }
}
