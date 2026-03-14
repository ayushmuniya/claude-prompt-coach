#!/usr/bin/env node
'use strict';

// ─── claude-coach real-time hook ─────────────────────────────────────────────
// Installed at: ~/.claude/hooks/claude-coach-hook.js
// Registered in: ~/.claude/settings.json under UserPromptSubmit
//
// How it works:
//   1. Claude Code sends JSON on stdin before every prompt
//   2. We analyse the prompt locally (~2ms, no API calls)
//   3. If issues found:
//      - stderr  → pretty warning shown to user in terminal
//      - stdout  → JSON with additionalContext so Claude also knows
//   4. exit 0 always — we never block, we only advise

const { runHeuristics, classifyIntent, complexityScore, needsContext } = require('./heuristics');

// ─── ANSI colors (no deps) ───────────────────────────────────────────────────
const R = '\x1b[0m';
const B = '\x1b[1m';
const DIM = '\x1b[2m';
const RED = '\x1b[31m';
const YLW = '\x1b[33m';
const GRN = '\x1b[32m';
const CYN = '\x1b[36m';
const MGN = '\x1b[35m';

// ─── READ STDIN ──────────────────────────────────────────────────────────────
let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => raw += d);
process.stdin.on('end', () => {
  try {
    const input = JSON.parse(raw);
    main(input);
  } catch (e) {
    // Malformed input — exit silently, never block user
    process.exit(0);
  }
});

// ─── MAIN ─────────────────────────────────────────────────────────────────────
function main(input) {
  const prompt = input.prompt || input.message || '';
  if (!prompt || prompt.trim().length < 5) process.exit(0);

  // Get session context for repetition detection
  const sessionPrompts = getRecentPrompts(input.transcript_path);

  // Fake minimal token object for pre-send analysis
  // We don't have real token counts yet — estimate from context size
  const estimatedCacheRead = estimateContextSize(input.transcript_path);
  const tokens = {
    input:       Math.ceil(prompt.split(/\s+/).length * 1.3),
    output:      0,
    cacheCreate: 0,
    cacheRead:   estimatedCacheRead,
  };

  const flags = runHeuristics(prompt, tokens, 'claude-sonnet-4-6', sessionPrompts);

  // Filter to only pre-send relevant flags
  const relevant = flags.filter(f =>
    ['session_drag', 'model_overkill', 'context_unnecessary', 'verbose_prompt', 'repetitive_prompt'].includes(f.id)
  );

  if (!relevant.length) {
    // All good — exit silently
    process.exit(0);
  }

  // ── Print warning to stderr (shown in terminal to user) ─────────────────
  printWarning(prompt, relevant, estimatedCacheRead);

  // ── Print additionalContext to stdout (shown to Claude as context) ───────
  const highSeverity = relevant.filter(f => f.sev === 'high');
  if (highSeverity.length > 0) {
    const ctx = buildClaudeContext(relevant);
    process.stdout.write(JSON.stringify(ctx));
  }

  process.exit(0); // Always 0 — never block
}

// ─── PRETTY TERMINAL WARNING ──────────────────────────────────────────────────
function printWarning(prompt, flags, cacheRead) {
  const hasHigh   = flags.some(f => f.sev === 'high');
  const hasModel  = flags.some(f => f.id === 'model_overkill');
  const hasDrag   = flags.some(f => f.id === 'session_drag');
  const hasCU     = flags.some(f => f.id === 'context_unnecessary');

  const borderColor = hasHigh ? RED : YLW;
  const icon        = hasHigh ? '⚠' : '◆';
  const title       = hasHigh ? 'claude-coach — heads up' : 'claude-coach — tip';
  const width       = 62;

  const line = (s = '') => process.stderr.write(borderColor + '│' + R + ' ' + s + '\n');
  const top  = () => process.stderr.write(borderColor + '╭' + '─'.repeat(width-2) + '╮' + R + '\n');
  const bot  = () => process.stderr.write(borderColor + '╰' + '─'.repeat(width-2) + '╯' + R + '\n');
  const sep  = () => process.stderr.write(borderColor + '├' + '─'.repeat(width-2) + '┤' + R + '\n');
  const pad  = (s, max=width-4) => s.length > max ? s.slice(0,max-1)+'…' : s;

  process.stderr.write('\n');
  top();
  line(B + borderColor + icon + ' ' + title + R);
  sep();

  for (const f of flags) {
    const sevDot = f.sev === 'high' ? RED+'●'+R : YLW+'●'+R;
    line(sevDot + '  ' + B + f.message + R);
    line('   ' + DIM + '→ ' + f.tip + R);
    if (f.example) line('   ' + DIM + f.example + R);
    if (f !== flags[flags.length-1]) line();
  }

  // Specific actionable suggestion per flag type
  sep();

  if (hasDrag && cacheRead > 0) {
    const freshCost  = 0.0001;
    const hereCost   = ((cacheRead / 1_000_000) * 0.30).toFixed(4);
    const multiplier = Math.round(parseFloat(hereCost) / freshCost);
    line(CYN + '  Cost here:   ' + B + '$' + hereCost + R + CYN + '  (fresh session: ~$0.0001)' + R);
    if (multiplier > 5) line(CYN + '  That\'s ' + B + multiplier + 'x' + R + CYN + ' more than a new session' + R);
    line();
    line(B + '  Quick fix:' + R + ' Open a new terminal tab, run ' + CYN + 'claude' + R);
  }

  if (hasModel && !hasDrag) {
    line(GRN + '  Suggested:' + R + ' Use Haiku for this type of question');
    line(GRN + '  In Claude:' + R + ' /model claude-haiku-4-5-20251001');
  }

  if (hasCU && !hasDrag) {
    line(MGN + '  This prompt seems self-contained — try claude.ai chat instead' + R);
  }

  sep();
  line(DIM + '  Sending anyway… (this is just a heads up, not a block)' + R);
  bot();
  process.stderr.write('\n');
}

// ─── CONTEXT FOR CLAUDE ───────────────────────────────────────────────────────
// This gets injected as additionalContext — Claude sees it before responding
function buildClaudeContext(flags) {
  const tips = flags.map(f => `- ${f.message}. ${f.tip}`).join('\n');
  return {
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: `[claude-coach efficiency note]\n${tips}\n\nPlease keep your response focused and concise given the context size.`
    }
  };
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

// Estimate context size from transcript file size (rough but fast)
function estimateContextSize(transcriptPath) {
  if (!transcriptPath) return 0;
  try {
    const fs   = require('fs');
    const size = fs.statSync(transcriptPath).size;
    // JSONL files are ~4 bytes per token on average
    return Math.floor(size / 4);
  } catch (_) {
    return 0;
  }
}

// Read last N prompts from transcript for repetition detection
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
