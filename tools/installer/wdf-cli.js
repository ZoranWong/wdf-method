#!/usr/bin/env node
// wdf-method CLI V3.6 — npx wdf-method install [options]
// Flags can be before or after command. Uses only Node.js stdlib.

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const C = { BLUE:'\x1b[34m', GREEN:'\x1b[32m', YELLOW:'\x1b[33m', RED:'\x1b[31m', GRAY:'\x1b[37m', BOLD:'\x1b[1m', NC:'\x1b[0m' };
const PKG_ROOT = path.resolve(__dirname, '..', '..');
const CMDS = ['install','status','uninstall','help'];

// Parse: find command + flags (order-independent)
const args = process.argv.slice(2);
let cmd = null;
const f = { project:null, yes:false, tools:[], config:{} };
for (let i=0; i<args.length; i++) {
  const a = args[i];
  if (CMDS.includes(a)) { cmd = a; }
  else if (a==='--project' && args[i+1]) f.project = args[++i];
  else if (a.startsWith('--project=')) f.project = a.split('=')[1];
  else if (a==='--yes'||a==='-y') f.yes = true;
  else if (a==='--tools' && args[i+1]) f.tools = args[++i].split(',').map(t=>t.trim());
  else if (a.startsWith('--tools=')) f.tools = a.split('=')[1].split(',').map(t=>t.trim());
  else if (a==='--set' && args[i+1]) { const m = args[++i].match(/^(\w+)\.(.+)=(.+)$/); if (m) f.config[m[2]]=m[3]; }
  else if (a.startsWith('--set=')) { const m = a.split('=').slice(1).join('=').match(/^(\w+)\.(.+)=(.+)$/); if (m) f.config[m[2]]=m[3]; }
}

// Resolve paths
const PROJECT = f.project ? path.resolve(f.project) : null;
const SKILLS_DIR = PROJECT ? path.join(PROJECT, '.claude', 'skills') : path.join(os.homedir(), '.claude', 'skills');
const SETTINGS_DIR = PROJECT ? path.join(PROJECT, '.claude') : path.join(PKG_ROOT, '.claude');
const config = { language: f.config.language||'zh', output_dir: f.config.output_dir||'_bmad-output', dev_mode: f.config.dev_mode||'separated', frontend: f.config.frontend||'react', backend: f.config.backend||'express' };
const OUTPUT_DIR = PROJECT ? path.join(PROJECT, config.output_dir) : path.join(PKG_ROOT, config.output_dir);
const MODE = PROJECT ? `Project → ${PROJECT}` : 'Global → ~/.claude/skills/';

// ── Help ──
if (!cmd || cmd==='help') {
  console.log(`\n${C.BLUE}${C.BOLD}wdf-method${C.NC} — Web Dev Flow V3.6\n`);
  console.log(`Usage:`);
  console.log(`  ${C.YELLOW}npx wdf-method install ${C.NC}                        Global install`);
  console.log(`  ${C.YELLOW}npx wdf-method install --project .${C.NC}              Project install`);
  console.log(`  ${C.YELLOW}npx wdf-method install --project . --yes \\${C.NC}`);
  console.log(`      ${C.YELLOW}--tools claude-code \\${C.NC}`);
  console.log(`      ${C.YELLOW}--set wdf.language=zh \\${C.NC}`);
  console.log(`      ${C.YELLOW}--set wdf.output_dir=_bmad-output \\${C.NC}`);
  console.log(`      ${C.YELLOW}--set wdf.frontend=react${C.NC}`);
  console.log(`  ${C.YELLOW}npx wdf-method status${C.NC}                        Check installation`);
  console.log(`  ${C.YELLOW}npx wdf-method --project . status${C.NC}            Project status`);
  console.log(`  ${C.YELLOW}npx wdf-method uninstall${C.NC}                     Remove skill\n`);
  console.log(`Config (--set wdf.<key>=<value>):`);
  console.log(`  ${C.GRAY}language${C.NC}       zh|en — Agent language`);
  console.log(`  ${C.GRAY}output_dir${C.NC}    Output path (default: _bmad-output)`);
  console.log(`  ${C.GRAY}dev_mode${C.NC}      separated|full_stack`);
  console.log(`  ${C.GRAY}frontend${C.NC}     react|vue|svelte|next`);
  console.log(`  ${C.GRAY}backend${C.NC}      express|nest|fastify|none`);
  console.log(`\nTools (--tools):  ${C.GRAY}claude-code${C.NC}\n`);
  process.exit(0);
}

// ── Status ──
if (cmd === 'status') {
  console.log(`\n${C.BOLD}wdf-method V3.6 — Status${C.NC}\n`);
  const target = path.join(SKILLS_DIR, 'web-dev-flow');
  const ok = fs.existsSync(target);
  console.log(`  Install:    ${ok ? `${C.GREEN}✓${C.NC} ${target}` : `${C.RED}✗${C.NC} not installed`}`);
  if (ok) console.log(`  Agents:     ${fs.readdirSync(path.join(target,'skills')).filter(d=>fs.existsSync(path.join(target,'skills',d,'SKILL.md'))).length} agents`);
  console.log(`  Signals:    ${fs.existsSync('/tmp/web-dev-flow/signals') ? `${C.GREEN}✓${C.NC} ready` : `${C.RED}✗${C.NC} missing`}`);
  console.log(`  Permissions:${fs.existsSync(path.join(SETTINGS_DIR,'settings.json')) ? `${C.GREEN}✓${C.NC} configured` : `${C.YELLOW}⚠${C.NC} not configured`}`);
  const cfgFile = path.join(OUTPUT_DIR, 'web-dev-flow', 'project-config.json');
  if (fs.existsSync(cfgFile)) {
    const c = JSON.parse(fs.readFileSync(cfgFile,'utf8'));
    console.log(`  Config:     language=${c.language||'zh'} output_dir=${c.output_dir||'_bmad-output'} dev_mode=${c.dev_mode||'separated'} frontend=${c.frontend||'react'} backend=${c.backend||'express'}`);
  }
  console.log('');
  process.exit(0);
}

// ── Uninstall ──
if (cmd === 'uninstall') {
  console.log(`\n${C.RED}${C.BOLD}╔══════════════════════════════════════╗${C.NC}`);
  console.log(`${C.RED}${C.BOLD}║   wdf-method — Uninstall             ║${C.NC}`);
  console.log(`${C.RED}${C.BOLD}╚══════════════════════════════════════╝${C.NC}\n`);
  const target = path.join(SKILLS_DIR, 'web-dev-flow');
  if (fs.existsSync(target)) { fs.unlinkSync(target); console.log(`  ${C.GREEN}✓${C.NC} Removed: ${target}\n`); }
  else { console.log(`  ${C.GRAY}Not installed${C.NC}\n`); }
  process.exit(0);
}

// ── Install ──
if (cmd === 'install') {
  console.log(`\n${C.BLUE}${C.BOLD}╔══════════════════════════════════════╗${C.NC}`);
  console.log(`${C.BLUE}${C.BOLD}║   wdf-method V3.6 — Install          ║${C.NC}`);
  console.log(`${C.BLUE}${C.BOLD}║   ${MODE.padEnd(34)}║${C.NC}`);
  console.log(`${C.BLUE}${C.BOLD}╚══════════════════════════════════════╝${C.NC}\n`);

  // Step 1: Skills
  console.log(`${C.BOLD}Step 1: Skills${C.NC}\n`);
  const target = path.join(SKILLS_DIR, 'web-dev-flow');
  if (!fs.existsSync(SKILLS_DIR)) fs.mkdirSync(SKILLS_DIR, { recursive: true });
  if (fs.existsSync(target)) {
    console.log(`  ${C.GREEN}✓${C.NC} Already installed: ${target}`);
  } else {
    fs.symlinkSync(PKG_ROOT, target);
    console.log(`  ${C.GREEN}✓${C.NC} Installed: ${target} → ${PKG_ROOT}`);
  }
  const cnt = fs.readdirSync(path.join(PKG_ROOT,'skills')).filter(d=>fs.existsSync(path.join(PKG_ROOT,'skills',d,'SKILL.md'))).length;
  console.log(`  ${C.GRAY}${cnt} skills (1 orchestrator + ${cnt-1} agents)${C.NC}\n`);

  // Step 2: Permissions
  console.log(`${C.BOLD}Step 2: Permissions${C.NC}\n`);
  if (!fs.existsSync(SETTINGS_DIR)) fs.mkdirSync(SETTINGS_DIR, { recursive: true });
  const sf = path.join(SETTINGS_DIR, 'settings.json');
  const perm = { permissions: { allow: ["Bash(git:*)","Bash(npm:*)","Bash(npx:*)","Bash(node:*)","Bash(ls:*)","Bash(mkdir:*)","Bash(rm:*)","Bash(find:*)","Bash(grep:*)","Bash(cat:*)","Bash(echo:*)","Write(*)","Read(*)","Edit(*)"] } };
  let out = perm;
  if (fs.existsSync(sf)) { const e = JSON.parse(fs.readFileSync(sf,'utf8')); e.permissions = e.permissions||{allow:[]}; for (const p of perm.permissions.allow) { if (!e.permissions.allow.includes(p)) e.permissions.allow.push(p); } out = e; }
  fs.writeFileSync(sf, JSON.stringify(out, null, 2));
  console.log(`  ${C.GREEN}✓${C.NC} ${sf}\n`);

  // Step 3: Signals
  console.log(`${C.BOLD}Step 3: Agent Communication${C.NC}\n`);
  const sig = '/tmp/web-dev-flow/signals';
  if (!fs.existsSync(sig)) { fs.mkdirSync(path.join(sig,'agents'),{recursive:true}); console.log(`  ${C.GREEN}✓${C.NC} Created: ${sig}`); }
  else console.log(`  ${C.GREEN}✓${C.NC} Exists: ${sig}`);
  console.log('');

  // Step 4: Output dirs
  if (PROJECT) {
    console.log(`${C.BOLD}Step 4: Output + Config${C.NC}\n`);
    ['_output/planning','_output/solutioning','_output/acceptance','status/merge-queue/items','status/stories'].forEach(d => fs.mkdirSync(path.join(OUTPUT_DIR,'web-dev-flow',d),{recursive:true}));
    console.log(`  ${C.GREEN}✓${C.NC} ${OUTPUT_DIR}/web-dev-flow/`);
    const cfg = { workflow:{version:'3.6.0',dev_mode:config.dev_mode,default_frontend_framework:config.frontend,default_backend_framework:config.backend}, output_dir:config.output_dir, language:config.language, tools:f.tools };
    const cfp = path.join(OUTPUT_DIR, 'web-dev-flow', 'project-config.json');
    fs.mkdirSync(path.dirname(cfp),{recursive:true});
    fs.writeFileSync(cfp, JSON.stringify(cfg,null,2));
    console.log(`  ${C.GREEN}✓${C.NC} Config: lang=${config.language} out=${config.output_dir} dev=${config.dev_mode} fe=${config.frontend} be=${config.backend}\n`);
  }

  // Done
  console.log(`${C.GREEN}${C.BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C.NC}`);
  console.log(`${C.GREEN}${C.BOLD}  Setup complete!${C.NC}\n`);
  console.log(`  ${C.YELLOW}/web-dev-flow init${C.NC}     — Initialize project`);
  console.log(`  ${C.YELLOW}/web-dev-flow status${C.NC}   — Show dashboard`);
  console.log(`  ${C.YELLOW}/web-dev-flow start${C.NC}    — Start/resume phase\n`);
}
