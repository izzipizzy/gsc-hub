import { afterEach, describe, expect, it, vi } from 'vitest';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { install, prerequisites } from '../cli/install.mjs';

const roots: string[] = [];
const silent = { write: () => {} };
const temp = () => { const root = mkdtempSync(join(tmpdir(), 'gsc-client-test-')); roots.push(root); return root; };
afterEach(() => { vi.unstubAllEnvs(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe('independent client installation', () => {
  it('explains missing npm and old Node, while skill installation works without npm', () => {
    const nodePath = join(temp(), 'node');
    const env = { PATH: '' };
    expect(() => prerequisites(true, { nodeVersion: '20.20.0', nodePath, env })).toThrow('Node.js 22.18+');
    expect(() => prerequisites(true, { nodeVersion: '22.17.0', nodePath, env })).toThrow('Node.js 22.18+');
    expect(() => prerequisites(true, { nodeVersion: '22.18.0', nodePath, env })).toThrow('npm is missing');
    expect(prerequisites(false, { nodeVersion: '22.18.0', nodePath, env }).npmPath).toBeNull();
  });

  it('checks prerequisites without writing installation files', () => {
    const root = temp();
    install(['--cli', '--check', '--prefix', join(root, 'prefix')], silent);
    expect(existsSync(join(root, 'prefix'))).toBe(false);
  });
  it('installs selected skills without a CLI, API key or npm dependencies', () => {
    const root = join(temp(), 'path with spaces');
    mkdirSync(root);
    const skills = join(root, 'skills');
    install(['--skills', '--skill', 'gsc-hub-cli', '--skills-dir', skills], silent);
    expect(readFileSync(join(skills, 'gsc-hub-cli', 'SKILL.md'), 'utf8')).toBe(readFileSync('.agents/skills/gsc-hub-cli/SKILL.md', 'utf8'));
    expect(existsSync(join(skills, 'gsc-striking-plan'))).toBe(false);
    expect(existsSync(join(root, 'bin'))).toBe(false);
  });

  it('respects CODEX_HOME, installs all skills and refuses to overwrite local changes without --force', () => {
    const root = temp();
    vi.stubEnv('CODEX_HOME', root);
    install(['--skills'], silent);
    const skill = join(root, 'skills', 'gsc-hub-cli', 'SKILL.md');
    writeFileSync(skill, 'user changes');
    expect(() => install(['--skills'], silent)).toThrow('already exists');
    expect(readFileSync(skill, 'utf8')).toBe('user changes');
    install(['--skills', '--skill', 'gsc-hub-cli', '--force'], silent);
    expect(readFileSync(skill, 'utf8')).toBe(readFileSync('.agents/skills/gsc-hub-cli/SKILL.md', 'utf8'));
    expect(existsSync(join(root, 'skills', 'gsc-decay-triage', 'SKILL.md'))).toBe(true);
  });

  it('rejects unknown names, incompatible destinations and source overwrites before installing anything', () => {
    const root = temp();
    expect(() => install(['--skills', '--skill', '../evil', '--skills-dir', root], silent)).toThrow('Unknown skill');
    expect(() => install(['--skills', '--agent', 'other'], silent)).toThrow('--agent');
    expect(() => install(['--skills', '--agent', 'claude', '--skills-dir', root], silent)).toThrow('Choose');
    expect(() => install(['--skills', '--skills-dir', resolve('.agents/skills'), '--force'], silent)).toThrow('separate');
    expect(() => install(['--cli', '--prefix', ''], silent)).toThrow('empty');
    expect(() => install(['extra'], silent)).toThrow('positional');
  });

  it('packs a standalone CLI that survives deletion of the sparse checkout', () => {
    const root = join(temp(), 'checkout and prefix with spaces');
    mkdirSync(root);
    const checkout = join(root, 'checkout');
    const prefix = join(root, 'installed');
    mkdirSync(checkout);
    cpSync('cli', join(checkout, 'cli'), { recursive: true });
    // No server package.json, node_modules or .agents directory in this checkout.
    execFileSync(process.execPath, [join(checkout, 'cli', 'install.mjs'), '--cli', '--prefix', prefix], { stdio: 'pipe' });
    rmSync(checkout, { recursive: true });
    const packageDir = join(prefix, ...(process.platform === 'win32' ? [] : ['lib']), 'node_modules', 'gsc-hub-cli');
    const entry = join(packageDir, 'bin', 'gsc-hub.mjs');
    const launcher = process.platform === 'win32' ? join(prefix, 'gsc-hub.cmd') : join(prefix, 'bin', 'gsc-hub');
    expect(existsSync(launcher)).toBe(true);
    if (process.platform !== 'win32') {
      expect(execFileSync(launcher, ['--version'], { encoding: 'utf8' }).trim()).toBe('0.1.0');
    }
    expect(execFileSync(process.execPath, [entry, '--version'], { encoding: 'utf8' }).trim()).toBe('0.1.0');
    expect(execFileSync(process.execPath, [entry, '--help'], { encoding: 'utf8' })).toContain('query-pages');
    expect(existsSync(join(packageDir, 'node_modules'))).toBe(false);
  });
});
