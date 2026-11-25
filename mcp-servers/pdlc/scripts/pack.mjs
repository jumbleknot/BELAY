#!/usr/bin/env node
// pdlc:pack (research R12; ADR-0005). Builds the two files the operator installs in Claude Desktop:
//   target/pdlc/pdlc-<version>.mcpb      the Desktop Extension
//   target/pdlc/proposal-intake.zip      the master skill, for Settings → Skills
//
// THE BUNDLE NEEDS A REAL, FLAT node_modules. pnpm's default layout is symlinks into a store, which a zip
// does not carry, so the package is staged with a hoisted `pnpm deploy --prod` first. Development-only
// files are then removed from the stage, and the result is checked for symlinks before it is packed.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync } from 'node:zlib';

const project = join(dirname(fileURLToPath(import.meta.url)), '..');
const workspace = join(project, '..', '..');
const out = join(workspace, 'target', 'pdlc');
const stage = join(out, 'stage');
const { version } = JSON.parse(readFileSync(join(project, 'package.json'), 'utf8'));

/** What the bundle carries; everything else the deploy copied is development-only. */
const KEEP = new Set(['src', 'contract', 'skill', 'manifest.json', 'package.json', 'node_modules']);

const run = (cmd, args, cwd) => {
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: false });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} exited ${r.status ?? r.error}`);
};

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    yield full;
    if (entry.isDirectory()) yield* walk(full);
  }
}

const DOS_DATE_1980_01_01 = 0x21;   // a fixed, valid date: the zip is reproducible

/** A minimal zip writer (deflate, no zip64): enough for one skill folder. */
export function zipFiles(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of files) {
    const nameBuf = Buffer.from(name, 'utf8');
    const deflated = deflateRawSync(data);
    const crc = crc32(data);
    const record = (signature, size) => {
      const b = Buffer.alloc(size);
      b.writeUInt32LE(signature, 0);
      return b;
    };
    const local = record(0x04034b50, 30);
    local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8); local.writeUInt16LE(DOS_DATE_1980_01_01, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(deflated.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = record(0x02014b50, 46);
    central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(8, 10);
    central.writeUInt16LE(DOS_DATE_1980_01_01, 14);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(deflated.length, 20); central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, deflated);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + deflated.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

function pack() {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  // 1. A real, flat node_modules with production dependencies only.
  run('pnpm', ['--filter', '@belay/pdlc', 'deploy', '--prod', '--config.node-linker=hoisted', stage], workspace);

  // 2. The master contract, skill and manifest, exactly as committed; then drop development-only files.
  for (const name of ['contract', 'skill', 'manifest.json']) cpSync(join(project, name), join(stage, name), { recursive: true });
  for (const name of readdirSync(stage)) if (!KEEP.has(name)) rmSync(join(stage, name), { recursive: true, force: true });
  for (const name of ['.bin', '.pnpm', '.modules.yaml']) rmSync(join(stage, 'node_modules', name), { recursive: true, force: true });
  const links = [...walk(stage)].filter((p) => lstatSync(p).isSymbolicLink());
  if (links.length) throw new Error(`the stage still has symlinks, which a bundle cannot carry: ${links.slice(0, 5).map((p) => relative(stage, p)).join(', ')}`);

  // 3. The extension.
  const mcpb = join(out, `pdlc-${version}.mcpb`);
  run('pnpm', ['exec', 'mcpb', 'pack', stage, mcpb], project);

  // 4. The skill, as a folder at the zip's root.
  const skillDir = join(project, 'skill', 'proposal-intake');
  const files = [...walk(skillDir)].filter((p) => lstatSync(p).isFile())
    .map((p) => ({ name: `proposal-intake/${relative(skillDir, p).replace(/\\/g, '/')}`, data: readFileSync(p) }));
  writeFileSync(join(out, 'proposal-intake.zip'), zipFiles(files));

  for (const f of [mcpb, join(out, 'proposal-intake.zip')]) if (!existsSync(f)) throw new Error(`${f} was not written`);
  console.log(`✓ pdlc pack: ${relative(workspace, mcpb)} and target/pdlc/proposal-intake.zip`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) pack();
