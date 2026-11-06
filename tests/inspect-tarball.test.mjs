import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const repo = resolve(import.meta.dirname, '..');
const script = join(repo, 'skills/npm-release/scripts/inspect-tarball.mjs');
let work, source, artifact;
const run = (bin,args,options={}) => spawnSync(bin,args,{encoding:'utf8',...options});
const write = (file,text) => { mkdirSync(join(file,'..'),{recursive:true});writeFileSync(file,text); };
const asJson = (file,value) => write(file,JSON.stringify(value,null,2)+'\n');
const baseManifest = {
  name:'@example/nifty-tool',version:'1.2.3',
  description:'A synthetic npm package for release inspection tests',
  files:['dist','bin','types','server.json','README.md','LICENSE'],
  main:'./dist/index.js',types:'./types/index.d.ts',
  bin:{nifty:'./bin/nifty.mjs'},
  exports:{'.':'./dist/index.js','./util':'./dist/util.js'},
  mcpName:'io.github.example/nifty-tool',
};
const baseMcp = {
  name:'io.github.example/nifty-tool',version:'1.2.3',
  packages:[{registryType:'npm',identifier:'@example/nifty-tool',version:'1.2.3',
    transport:{type:'streamable-http',url:'http://127.0.0.1:18893/mcp'}}]
};
function invoke(bundle=artifact,...flags) { return run(process.execPath,[script,bundle,...flags]); }
function mustPass(p) { assert.equal(p.status,0,p.stderr);return JSON.parse(p.stdout); }
function mustFail(p,re) {assert.notEqual(p.status,0,'unexpected success: '+p.stdout); assert.match(p.stderr,re);}
function mutate(name,rel,change) {
  const dir = join(work,'mutate-'+name);
  mkdirSync(dir,{recursive:true});
  const ext = run('tar',['-xzf',artifact,'-C',dir]);assert.equal(ext.status,0,ext.stderr);
  const file = join(dir,'package',rel);
  change(file);
  const result = join(work,'broken-'+name+'.tgz');
  const pack = run('tar',['-czf',result,'-C',dir,'package']);assert.equal(pack.status,0,pack.stderr);
  return result;
}
before(()=>{
  work=mkdtempSync(join(tmpdir(),'npm-release-test-'));
  source=join(work,'source');mkdirSync(source,{recursive:true});
  asJson(join(source,'package.json'),baseManifest);
  asJson(join(source,'server.json'),baseMcp);
  write(join(source,'dist/index.js'),'export const value=1;\n');
  write(join(source,'dist/util.js'),'export const util=1;\n');
  write(join(source,'bin/nifty.mjs'),'#!/usr/bin/env node\nconsole.log("hi");\n');
  write(join(source,'types/index.d.ts'),'export declare const value: number;\n');
  write(join(source,'README.md'),'# Nifty\n');
  write(join(source,'LICENSE'),'MIT\n');
  const packed=run('npm',['pack','--ignore-scripts','--json'],{cwd:source,env:{...process.env,npm_config_audit:'false',npm_config_fund:'false'}});
  assert.equal(packed.status,0,packed.stderr);
  const info=JSON.parse(packed.stdout);
  artifact=join(source,info[0].filename);
});
after(()=>{ if (work) rmSync(work,{recursive:true,force:true}); });

test('scoped package: packed tarball passes without MCP requirements',()=>{
  const out=mustPass(invoke(artifact,'--name','@example/nifty-tool','--version','1.2.3','--source-dir',source,'--require','dist/index.js'));
  assert.equal(out.name,'@example/nifty-tool');assert.equal(out.version,'1.2.3');assert.match(out.sha256,/^[a-f0-9]{64}$/);assert.equal(out.mcp,null);
});
test('optional MCP metadata passes independently',()=>{
  const out=mustPass(invoke(artifact,'--mcp','--source-dir',source));
  assert.equal(out.mcp.name,'io.github.example/nifty-tool');
});
test('wrong expected name fails',()=> mustFail(invoke(artifact,'--name','other-package'),/name mismatch/));
test('wrong expected version fails',()=> mustFail(invoke(artifact,'--version','1.2.4'),/version mismatch/));
test('missing required file fails',()=> mustFail(invoke(artifact,'--require','dist/nonexistent.js'),/Missing required file/));
test('missing main runtime fails',()=>{
  const file=mutate('missing-main','dist/index.js',p=>rmSync(p));
  mustFail(invoke(file),/Missing main/);
});
test('missing CLI bin entry fails',()=>{
  const file=mutate('missing-bin','bin/nifty.mjs',p=>rmSync(p));
  mustFail(invoke(file),/Missing bin nifty/);
});
test('private:true package is blocked',()=>{
  const file=mutate('private','package.json',p=>{const x=JSON.parse(readFileSync(p));x.private=true;asJson(p,x);});
  mustFail(invoke(file),/private:true/);
});
test('ordinary npm package never needs MCP fields',()=>{
  const file=mutate('no-mcp','package.json',p=>{const x=JSON.parse(readFileSync(p));delete x.mcpName;asJson(p,x);});
  mustPass(invoke(file));
  mustFail(invoke(file,'--mcp'),/requires package.json mcpName/);
});
test('MCP version mismatch is blocked',()=>{
  const file=mutate('mcp-version','server.json',p=>{const x=JSON.parse(readFileSync(p));x.version='9.9.9';asJson(p,x);});
  mustFail(invoke(file,'--mcp'),/MCP top-level version mismatch/);
});
test('MCP package listing mismatch is blocked',()=>{
  const file=mutate('mcp-npm-version','server.json',p=>{const x=JSON.parse(readFileSync(p));x.packages[0].version='0.0.0';asJson(p,x);});
  mustFail(invoke(file,'--mcp'),/MCP npm package version mismatch/);
});
test('source directory drift blocked',()=>{
  const other=join(work,'changed-source');mkdirSync(other);
  asJson(join(other,'package.json'),{...baseManifest,version:'2.0.0'});
  mustFail(invoke(artifact,'--source-dir',other),/artifact vs source version mismatch/);
});
test('source MCP server drift blocked',()=>{
  const other=join(work,'changed-mcp');mkdirSync(other);
  asJson(join(other,'package.json'),baseManifest);
  asJson(join(other,'server.json'),{...baseMcp,title:'changed'});
  mustFail(invoke(artifact,'--mcp','--source-dir',other),/differs from frozen artifact/);
});
test('sensitive .env file in artifact is blocked',()=>{
  const file=mutate('env','package',p=>write(join(p,'.env'),'TOKEN=not-a-real-token\n'));
  mustFail(invoke(file),/Potential secret files/);
});
test('unscoped name also supported',()=>{
  const file=mutate('unscoped','package.json',p=>{const x=JSON.parse(readFileSync(p));x.name='nifty-tool';asJson(p,x);});
  const out=mustPass(invoke(file,'--name','nifty-tool'));assert.equal(out.name,'nifty-tool');
});
test('unresolved export target is blocked',()=>{
  const file=mutate('exports-missing','package.json',p=>{const x=JSON.parse(readFileSync(p));x.exports['./missing']='./dist/missing.js';asJson(p,x);});
  mustFail(invoke(file),/Missing exports target/);
});
