#!/usr/bin/env node
'use strict';

const { runHeuristics } = require('./heuristics');

const R = '\x1b[0m';
const B = '\x1b[1m';
const DIM = '\x1b[2m';
const RED = '\x1b[31m';
const YLW = '\x1b[33m';
const GRN = '\x1b[32m';
const CYN = '\x1b[36m';
const MGN = '\x1b[35m';

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => raw += d);
process.stdin.on('end', () => {
  try {
    const input = JSON.parse(raw);
    main(input);
  } catch (e) {
    process.exit(0);
  }
});

function main(input) {
  const prompt = input.prompt || input.message || '';
  if (!prompt || prompt.trim().length < 5) process.exit(0);

  const sessionPrompts  = getRecentPrompts(input.transcript_path);
  const estimatedCacheRead = getActualCacheTokens(input.transcript_path);

  const tokens = {
    input:       Math.ceil(prompt.split(/\s+/).length * 1.3),
    output:      0,
    cacheCreate: 0,
    cacheRead:   estimatedCacheRead,
  };

  const flags = runHeuristics(prompt, tokens, 'claude-sonnet-4-6', sessionPrompts);
  const relevant = flags.filter(f =>
    ['session_drag', 'model_overkill', 'context_unnecessary', 'verbose_prompt', 'repetitive_prompt'].includes(f.id)
  );

  if (!relevant.length) process.exit(0);

  printWarning(prompt, relevant, estimatedCacheRead);

  const highSeverity = relevant.filter(f => f.sev === 'high');
  if (highSeverity.length > 0) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: `[claude-coach]\n${relevant.map(f=>`- ${f.message}. ${f.tip}`).join('\n')}\n\nKeep response focused and concise.`
      }
    }));
  }

  process.exit(0);
}

function printWarning(prompt, flags, cacheRead) {
  const hasHigh  = flags.some(f => f.sev === 'high');
  const hasModel = flags.some(f => f.id === 'model_overkill');
  const hasDrag  = flags.some(f => f.id === 'session_drag');
  const hasCU    = flags.some(f => f.id === 'context_unnecessary');

  const bc    = hasHigh ? RED : YLW;
  const icon  = hasHigh ? '⚠' : '◆';
  const title = hasHigh ? 'claude-coach — heads up' : 'claude-coach — tip';
  const W     = 62;

  const line = (s = '') => process.stderr.write(bc + '│' + R + ' ' + s + '\n');
  const top  = () => process.stderr.write(bc + '╭' + '─'.repeat(W-2) + '╮' + R + '\n');
  const bot  = () => process.stderr.write(bc + '╰' + '─'.repeat(W-2) + '╯' + R + '\n');
  const sep  = () => process.stderr.write(bc + '├' + '─'.repeat(W-2) + '┤' + R + '\n');

  process.stderr.write('\n');
  top();
  line(B + bc + icon + ' ' + title + R);
  sep();

  for (const f of flags) {
    const dot = f.sev === 'high' ? RED+'●'+R : YLW+'●'+R;
    line(dot + '  ' + B + f.message + R);
    line('   ' + DIM + '→ ' + f.tip + R);
    if (f.example) line('   ' + DIM + f.example + R);
    if (f !== flags[flags.length-1]) line();
  }

  sep();

  if (hasDrag && cacheRead > 0) {
    const sonnetCost = ((cacheRead / 1_000_000) * 0.30).toFixed(4);
    const haikuCost  = ((cacheRead / 1_000_000) * 0.08).toFixed(4);
    line(CYN + '  Sonnet cost: ' + B + '$' + sonnetCost + R + CYN + '  →  Haiku cost: ' + B + '$' + haikuCost + R);
    line();
    line(B + '  Quick fix:' + R + ' Type ' + CYN + '/model claude-haiku-4-5-20251001' + R + ' then ask again');
    line(DIM + '  Or: /compact to shrink context before continuing' + R);
  }

  if (hasModel && !hasDrag) {
    line(GRN + '  Switch:' + R + ' Type ' + CYN + '/model claude-haiku-4-5-20251001' + R);
    line(DIM + '  Same answer, 5-10x cheaper for this type of question' + R);
  }

  if (hasCU && !hasDrag && !hasModel) {
    line(MGN + '  Run ' + CYN + '/compact' + MGN + ' to reduce context' + R);
  }

  sep();
  line(DIM + '  Sending anyway — just a heads up, not a block' + R);
  bot();
  process.stderr.write('\n');
}

// ── KEY FIX: Read actual token counts from previous assistant responses ──────
// UserPromptSubmit fires BEFORE Claude responds — so we read the LAST
// assistant response's cache tokens as proxy for current context size
function getActualCacheTokens(transcriptPath) {
  if (!transcriptPath) return 0;
  try {
    const fs    = require('fs');
    const lines = fs.readFileSync(transcriptPath, 'utf8').trim().split('\n');
    let lastCacheRead    = 0;
    let lastCacheCreate  = 0;
    for (const line of lines) {
      try {
        const e = JSON.parse(line);
        if (e.type === 'assistant' && e.message?.usage) {
          lastCacheRead   = e.message.usage.cache_read_input_tokens   || 0;
          lastCacheCreate = e.message.usage.cache_creation_input_tokens || 0;
        }
      } catch(_) {}
    }
    return lastCacheRead + lastCacheCreate;
  } catch (_) {
    return 0;
  }
}

function getRecentPrompts(transcriptPath, n = 5) {
  if (!transcriptPath) return [];
  try {
    const fs    = require('fs');
    const lines = fs.readFileSync(transcriptPath, 'utf8').trim().split('\n').slice(-50);
    const prompts = [];
    for (const line of lines) {
      try {
        const e = JSON.parse(line);
        if (e.type === 'user' && e.message?.role === 'user') {
          const c = e.message.content;
          const t = typeof c === 'string' ? c
            : Array.isArray(c) ? c.filter(x => x.type === 'text').map(x => x.text).join(' ')
            : '';
          if (t.trim().length > 4) prompts.push(t.trim());
        }
      } catch (_) {}
    }
    return prompts.slice(-n);
  } catch (_) {
    return [];
  }
}
