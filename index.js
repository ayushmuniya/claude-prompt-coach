'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { runHeuristics } = require('./heuristics');

// ─── FILE DISCOVERY ───────────────────────────────────────────────────────────
function findJSONLFiles(opts = {}) {
  const claudeDir = path.join(os.homedir(), '.claude', 'projects');
  if (!fs.existsSync(claudeDir)) {
    console.error(`\n  Claude Code data not found at ${claudeDir}\n`);
    process.exit(1);
  }
  const files = [];
  for (const project of fs.readdirSync(claudeDir)) {
    if (opts.project && !project.toLowerCase().includes(opts.project.toLowerCase())) continue;
    const pp = path.join(claudeDir, project);
    if (!fs.statSync(pp).isDirectory()) continue;
    for (const entry of fs.readdirSync(pp)) {
      if (!entry.endsWith('.jsonl')) continue;
      const fp = path.join(pp, entry);
      if (opts.days) {
        if (fs.statSync(fp).mtimeMs < Date.now() - opts.days * 86400000) continue;
      }
      files.push({ project, filePath: fp, sessionId: entry.replace('.jsonl', '') });
    }
  }
  return files;
}

// ─── PARSER ───────────────────────────────────────────────────────────────────
function parseFile(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n');
  const messages = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      if (['file-history-snapshot', 'progress', 'summary'].includes(e.type)) continue;

      if (e.type === 'user' && e.message?.role === 'user') {
        const raw = e.message.content;
        let text = typeof raw === 'string' ? raw
          : Array.isArray(raw) ? raw.filter(c => c.type === 'text').map(c => c.text).join(' ')
          : '';
        text = text.trim();
        const isTrivial = text.length < 4 || text === '...' || text.startsWith('<') || /^`{3}/.test(text);
        messages.push({
          role: 'user', uuid: e.uuid, sessionId: e.sessionId,
          timestamp: e.timestamp, promptText: text, isTrivial
        });
      }

      if (e.type === 'assistant' && e.message?.usage) {
        const u = e.message.usage;
        messages.push({
          role: 'assistant', uuid: e.uuid, parentUuid: e.parentUuid,
          sessionId: e.sessionId, timestamp: e.timestamp, model: e.message.model,
          tokens: {
            input:       u.input_tokens || 0,
            output:      u.output_tokens || 0,
            cacheCreate: u.cache_creation_input_tokens || 0,
            cacheRead:   u.cache_read_input_tokens || 0,
          },
          costUSD: calcCost(e.message.model, u)
        });
      }
    } catch (_) {}
  }
  return messages;
}

function calcCost(model, u) {
  const p = model?.includes('opus')  ? { i:15,   o:75, cw:18.75, cr:1.50 }
          : model?.includes('haiku') ? { i:0.80, o:4,  cw:1.00,  cr:0.08 }
          :                            { i:3,    o:15, cw:3.75,  cr:0.30 };
  const M = 1_000_000;
  return +(((u.input_tokens||0)/M)*p.i + ((u.output_tokens||0)/M)*p.o +
           ((u.cache_creation_input_tokens||0)/M)*p.cw + ((u.cache_read_input_tokens||0)/M)*p.cr).toFixed(6);
}

// ─── PAIR + HEURISTICS ────────────────────────────────────────────────────────
function buildPairs(messages, project) {
  const byUuid = {};
  messages.forEach(m => byUuid[m.uuid] = m);

  // Build per-session recent prompts for repetition detection
  const sessionPrompts = {};

  const pairs = [];
  for (const msg of messages) {
    if (msg.role !== 'assistant' || !msg.parentUuid) continue;
    const user = byUuid[msg.parentUuid];
    if (!user || user.role !== 'user' || user.isTrivial) continue;

    const sid = msg.sessionId;
    if (!sessionPrompts[sid]) sessionPrompts[sid] = [];
    const recentPrompts = sessionPrompts[sid];

    const flags = runHeuristics(user.promptText, msg.tokens, msg.model, recentPrompts);
    sessionPrompts[sid].push(user.promptText);

    pairs.push({
      project, sessionId: sid, timestamp: user.timestamp,
      prompt: user.promptText, model: msg.model,
      tokens: msg.tokens, costUSD: msg.costUSD, flags
    });
  }
  return pairs;
}

// ─── COLLECT ALL DATA ─────────────────────────────────────────────────────────
function collectData(opts = {}) {
  const files = findJSONLFiles(opts);
  let allPairs = [];
  for (const file of files) {
    const msgs  = parseFile(file.filePath);
    const pairs = buildPairs(msgs, file.project);
    allPairs = allPairs.concat(pairs);
  }
  allPairs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  const flagged   = allPairs.filter(p => p.flags.length > 0);
  const totalCost = allPairs.reduce((s, p) => s + p.costUSD, 0);
  const totalCC   = allPairs.reduce((s, p) => s + (p.tokens?.cacheCreate || 0), 0);
  const totalCR   = allPairs.reduce((s, p) => s + (p.tokens?.cacheRead || 0), 0);
  const totalOut  = allPairs.reduce((s, p) => s + (p.tokens?.output || 0), 0);
  const totalIn   = allPairs.reduce((s, p) => s + (p.tokens?.input || 0), 0);
  const potSaving = flagged.reduce((s, p) => s + p.flags.reduce((fs, f) => fs + (f.saving || 0), 0), 0);
  const score     = Math.max(0, 100 - Math.round((flagged.length / Math.max(allPairs.length, 1)) * 100));
  const projects  = new Set(allPairs.map(p => p.project)).size;

  return {
    files, pairs: allPairs,
    summary: {
      projects, totalCalls: allPairs.length, flaggedCalls: flagged.length,
      totalCost, totalCacheCreate: totalCC, totalCacheRead: totalCR,
      totalOutput: totalOut, totalInput: totalIn, potentialSaving: potSaving, score
    }
  };
}

// ─── CLI TEXT OUTPUT ──────────────────────────────────────────────────────────
function printCLI(data) {
  const { pairs, files, summary } = data;
  const { score, totalCost, totalCalls, flaggedCalls, potentialSaving } = summary;
  const projects = new Set(pairs.map(p => p.project)).size;
  const SEV = { high: '🔴', medium: '🟡', low: '🔵' };

  console.log('\n  claude-coach · v0.1.0\n');
  console.log(`  Sessions : ${files.length} across ${projects} project(s)`);
  console.log(`  Calls    : ${totalCalls}`);
  console.log(`  Spend    : $${totalCost.toFixed(4)}`);
  console.log(`  Score    : ${score}/100`);
  console.log(`  Issues   : ${flaggedCalls}/${totalCalls} calls flagged`);
  if (potentialSaving > 0) console.log(`  Saving   : ~$${potentialSaving.toFixed(2)}/month potential`);
  console.log();

  const flagged = pairs.filter(p => p.flags.length > 0).slice(0, 6);
  for (const p of flagged) {
    const date = new Date(p.timestamp).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
    console.log(`  [${date}] "${p.prompt.slice(0, 65)}${p.prompt.length > 65 ? '…' : ''}"`);
    console.log(`  Cost: $${p.costUSD.toFixed(4)} | Intent: ${p.flags[0]?.meta?.intent || '?'} | Complexity: ${p.flags[0]?.meta?.complexity || '?'}/10`);
    for (const f of p.flags) {
      console.log(`  ${SEV[f.sev]} ${f.message}`);
      console.log(`     → ${f.tip}`);
      if (f.example) console.log(`     e.g. ${f.example}`);
    }
    console.log();
  }
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
function run({ command, args } = {}) {
  const opts = {};
  for (let i = 0; i < (args || []).length; i++) {
    if (args[i] === '--days'    && args[i+1]) opts.days    = parseInt(args[i+1]);
    if (args[i] === '--project' && args[i+1]) opts.project = args[i+1];
  }

  const data = collectData(opts);

  if (!data.pairs.length) {
    console.log('\n  No sessions found. Run some Claude Code sessions first!\n');
    process.exit(0);
  }

  if (command === 'cli') {
    printCLI(data);
    return;
  }

  // Default: launch dashboard
  const { startDashboard } = require('./dashboard/server');
  startDashboard(data);
}

module.exports = { run, collectData };
