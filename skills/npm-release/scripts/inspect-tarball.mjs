#!/usr/bin/env node
// Generic read-only inspector for an exact npm tarball. Requires Node and 'tar'.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, join, posix } from 'node:path';

function fail(s) { throw new Error(s); }
const help = 'Usage: node inspect-tarball.mjs <artifact.tgz> [--name PKG] [--version VER] [--source-dir DIR] [--require PATH (repeatable)] [--mcp]';
function argsOf(xs) {
  const x = { required: [], mcp: false };
  for (let i = 0; i < xs.length; i++) {
    const s = xs[i];
    if (s === '--help') { console.log(help); process.exit(0); }
    if (s === '--mcp') { x.mcp = true; continue; }
    if (s === '--require') {
      if (!xs[i+1]) fail('Missing --require value');
      x.required.push(xs[++i]); continue;
    }
    const k = {'--name':'name','--version':'version','--source-dir':'sourceDir'}[s];
    if (k) { if (!xs[i+1]) fail('Missing '+s+' value'); x[k] = xs[++i]; continue; }
    if (s.startsWith('-')) fail('Unknown option '+s);
    if (x.tarball) fail('Pass exactly one tarball');
    x.tarball = s;
  }
  if (!x.tarball) fail(help);
  return x;
}
function tar(xs) {
  const p = spawnSync('tar', xs, { encoding:'utf8', maxBuffer:64*1024*1024 });
  if (p.error || p.status !== 0) fail('tar failed: '+(p.stderr || p.error?.message || 'unknown').trim());
  return p.stdout;
}
function json(s,label) { try { return JSON.parse(s); } catch(e) { fail('Invalid '+label+': '+e.message); } }
function equal(a,b,label) { if (a!==b) fail(label+' mismatch: expected '+JSON.stringify(b)+', got '+JSON.stringify(a)); }
function pathOf(p) {
  if (typeof p !== 'string' || !p.trim()) fail('Invalid empty package path');
  p=p.replace(/\\/g,'/').replace(/^\.\//,'');
  if (p==='.'||p.startsWith('/')||p.includes('\0')||p.split('/').includes('..')) fail('Unsafe package path: '+p);
  return posix.normalize(p);
}
function main() {
  const args = argsOf(process.argv.slice(2));
  const bundle = resolve(args.tarball);
  const members = tar(['-tzf',bundle]).trim().split(/\r?\n/);
  const entries = new Set();
  for (const p of members) {
    if (!p.startsWith('package/')||p.includes('\\')||p.split('/').includes('..')) fail('Unsafe archive member: '+p);
    if (entries.has(p)) fail('Duplicate archive member: '+p);
    entries.add(p);
  }
  if (!entries.has('package/package.json')) fail('Missing package/package.json');
  const manifest = json(tar(['-xOzf',bundle,'package/package.json']),'packed package.json');
  if (typeof manifest.name !== 'string' || !/^(?:@[a-z0-9][\w.~-]*\/)?[a-z0-9][\w.~-]*$/.test(manifest.name)) fail('Invalid npm name: '+manifest.name);
  if (typeof manifest.version !== 'string'||!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(manifest.version)) fail('Invalid npm semver: '+manifest.version);
  if (manifest.private===true) fail('private:true package must not be published');
  if (args.name) equal(manifest.name,args.name,'name');
  if (args.version) equal(manifest.version,args.version,'version');
  const requireFile = (p,label) => { const path='package/'+pathOf(p); if (!entries.has(path)) fail('Missing '+label+': '+path); };
  const warnings = [];
  for (const file of args.required) requireFile(file,'required file');
  if (typeof manifest.bin==='string') requireFile(manifest.bin,'bin');
  else if (manifest.bin && typeof manifest.bin==='object' && !Array.isArray(manifest.bin)) {
    for (const [name,p] of Object.entries(manifest.bin)) requireFile(p,'bin '+name);
  }
  for (const key of ['main','module','types','typings']) {
    if (typeof manifest[key]==='string' && !manifest[key].includes('*')) requireFile(manifest[key],key);
  }
  function checkExports(v) {
    if (typeof v==='string') {
      if (v.startsWith('./') && !v.includes('*')) requireFile(v,'exports target');
      if (v.includes('*')) warnings.push('Wildcard export not statically verified: '+v);
    } else if (Array.isArray(v)) v.forEach(checkExports);
    else if (v && typeof v==='object') Object.values(v).forEach(checkExports);
  }
  if (manifest.exports !== undefined) checkExports(manifest.exports);
  if (![...entries].some(p=>/^package\/README(?:[._-]|$)/i.test(p))) warnings.push('README not in artifact');
  if (![...entries].some(p=>/^package\/LICEN[SC]E(?:[._-]|$)/i.test(p))) warnings.push('LICENSE not in artifact');
  const secrets = [...entries].filter(p=>/(^|\/)(\.npmrc|\.env)$/.test(p));
  if (secrets.length) fail('Potential secret files in archive: '+secrets.join(', '));
  let mcp = null;
  if (args.mcp) {
    if (!entries.has('package/server.json')) fail('--mcp requires packaged server.json');
    const server = json(tar(['-xOzf',bundle,'package/server.json']),'packed server.json');
    if (typeof manifest.mcpName !== 'string'||!manifest.mcpName.trim()) fail('--mcp requires package.json mcpName');
    equal(server.name,manifest.mcpName,'MCP name');
    equal(server.version,manifest.version,'MCP top-level version');
    const pkgs=Array.isArray(server.packages) ? server.packages.filter(p=>p.registryType==='npm'&&p.identifier===manifest.name) : [];
    if (pkgs.length!==1) fail('MCP server.json must contain exactly one matching npm package');
    equal(pkgs[0].version,manifest.version,'MCP npm package version');
    mcp={name:server.name,version:server.version};
  }
  if (args.sourceDir) {
    const root=resolve(args.sourceDir);
    const file=join(root,'package.json');
    if (!existsSync(file)) fail('Source package.json missing: '+file);
    const src=json(readFileSync(file,'utf8'),'source package.json');
    equal(manifest.name,src.name,'artifact vs source name');
    equal(manifest.version,src.version,'artifact vs source version');
    if (args.mcp) {
      equal(manifest.mcpName,src.mcpName,'artifact vs source mcpName');
      const sf=join(root,'server.json');
      if (!existsSync(sf)) fail('Source server.json missing');
      const s1=json(readFileSync(sf,'utf8'),'source server.json');
      const s2=json(tar(['-xOzf',bundle,'package/server.json']),'packed server.json');
      if (JSON.stringify(s1)!==JSON.stringify(s2)) fail('Source server.json differs from frozen artifact; do not silently repack');
    }
  }
  const sha256=createHash('sha256').update(readFileSync(bundle)).digest('hex');
  console.log(JSON.stringify({status:'PASS',name:manifest.name,version:manifest.version,files:entries.size,sha256,tarball:bundle,mcp,warnings},null,2));
}
try { main(); } catch(e) { console.error('Artifact inspection FAILED: '+e.message); process.exitCode=1; }
