#!/usr/bin/env node
'use strict';

// One-command installer: node install.js
// Sets up ~/.claude/hooks/ and registers in ~/.claude/settings.json

const fs   = require('fs');
const path = require('path');
const os   = require('os');

const HOOK_SRC  = path.join(__dirname, 'hook.js');
const HOOK_DEPS = ['heuristics.js'];

const CLAUDE_DIR    = path.join(os.homedir(), '.claude');
const HOOKS_DIR     = path.join(CLAUDE_DIR, 'hooks', 'claude-coach');
const SETTINGS_PATH = path.join(CLAUDE_DIR, 'settings.json');
const HOOK_DEST     = path.join(HOOKS_DIR, 'hook.js');

// Colors
const R   = '\x1b[0m';
const B   = '\x1b[1m';
const GRN = '\x1b[32m';
const CYN = '\x1b[36m';
const YLW = '\x1b[33m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';

const ok   = s => console.log(GRN + '  ✓' + R + ' ' + s);
const info = s => console.log(CYN + '  →' + R + ' ' + s);
const warn = s => console.log(YLW + '  !' + R + ' ' + s);
const err  = s => console.log(RED + '  ✗' + R + ' ' + s);

function install() {
  console.log('\n' + B + '  claude-coach · hook installer' + R + '\n');

  // 1. Check ~/.claude exists
  if (!fs.existsSync(CLAUDE_DIR)) {
    err('~/.claude directory not found. Is Claude Code installed?');
    process.exit(1);
  }
  ok('Claude Code installation found');

  // 2. Create hooks dir
  fs.mkdirSync(HOOKS_DIR, { recursive: true });
  ok('Created ' + HOOKS_DIR.replace(os.homedir(), '~'));

  // 3. Copy hook.js + heuristics.js
  fs.copyFileSync(HOOK_SRC, HOOK_DEST);
  fs.chmodSync(HOOK_DEST, '755');
  ok('Copied hook.js');

  for (const dep of HOOK_DEPS) {
    const src  = path.join(__dirname, dep);
    const dest = path.join(HOOKS_DIR, dep);
    fs.copyFileSync(src, dest);
    ok('Copied ' + dep);
  }

  // 4. Read existing settings.json
  let settings = {};
  if (fs.existsSync(SETTINGS_PATH)) {
    try {
      settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
      ok('Read existing settings.json');
    } catch (_) {
      warn('settings.json malformed — creating fresh');
    }
  } else {
    info('Creating new settings.json');
  }

  // 5. Back up settings
  if (fs.existsSync(SETTINGS_PATH)) {
    const backup = SETTINGS_PATH + '.bak';
    fs.copyFileSync(SETTINGS_PATH, backup);
    info('Backed up to settings.json.bak');
  }

  // 6. Inject hook — preserve existing hooks
  if (!settings.hooks) settings.hooks = {};
  if (!settings.hooks.UserPromptSubmit) settings.hooks.UserPromptSubmit = [];

  // Remove any existing claude-coach entry first
  settings.hooks.UserPromptSubmit = settings.hooks.UserPromptSubmit.filter(
    h => !h.hooks?.some(hh => hh.command?.includes('claude-coach'))
  );

  // Add new entry
  settings.hooks.UserPromptSubmit.push({
    hooks: [{
      type: 'command',
      command: `node ${HOOK_DEST}`
    }]
  });

  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
  ok('Registered hook in settings.json');

  // 7. Done
  console.log('\n' + B + GRN + '  Installation complete!' + R + '\n');
  console.log(DIM + '  claude-coach will now analyse every prompt in real-time.');
  console.log('  When an issue is detected, you\'ll see a warning before Claude responds.' + R);
  console.log('\n  To uninstall:  ' + CYN + 'node ' + __filename + ' --uninstall' + R);
  console.log('  To test:       ' + CYN + 'echo \'{"prompt":"ls -la","transcript_path":""}\' | node ' + HOOK_DEST + R);
  console.log();
}

function uninstall() {
  console.log('\n' + B + '  claude-coach · uninstaller' + R + '\n');

  // Remove hooks dir
  if (fs.existsSync(HOOKS_DIR)) {
    fs.rmSync(HOOKS_DIR, { recursive: true });
    ok('Removed ' + HOOKS_DIR.replace(os.homedir(), '~'));
  }

  // Remove from settings.json
  if (fs.existsSync(SETTINGS_PATH)) {
    try {
      const settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
      if (settings.hooks?.UserPromptSubmit) {
        settings.hooks.UserPromptSubmit = settings.hooks.UserPromptSubmit.filter(
          h => !h.hooks?.some(hh => hh.command?.includes('claude-coach'))
        );
        fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
        ok('Removed hook from settings.json');
      }
    } catch (_) {
      warn('Could not parse settings.json');
    }
  }

  console.log('\n' + GRN + '  Uninstalled.' + R + '\n');
}

if (process.argv[2] === '--uninstall') {
  uninstall();
} else {
  install();
}
