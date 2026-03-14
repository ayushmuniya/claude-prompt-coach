'use strict';

// ─── INTENT CLASSIFIER ────────────────────────────────────────────────────────
// Reads actual prompt text — zero cost, zero API
function classifyIntent(prompt) {
  const p = prompt.toLowerCase().trim();

  if (/^(ls|cd|cat|pwd|cp|mv|rm|mkdir|touch|grep|find|curl|wget|git |npm |node |python |pip |brew |apt |yarn |docker |kubectl )/i.test(p))
    return 'shell_command';

  if (/^(what is|what are|who is|who was|define |meaning of|explain what|tell me what)/i.test(p))
    return 'simple_lookup';

  if (/^(how (do|does|did|can|should|to)|why (does|do|is|are)|explain |walk me through|help me understand|can you explain)/i.test(p))
    return 'complex_explain';

  if (/\b(fix|debug|resolve|solve|error|bug|failing|broken|issue|problem|exception|crash)\b/i.test(p))
    return 'debug_task';

  if (/\b(write|create|build|implement|add|generate|make me a|scaffold|develop)\b/i.test(p))
    return 'build_task';

  if (/\b(refactor|rewrite|improve|optimise|optimize|clean up|simplify|restructure)\b/i.test(p))
    return 'refactor_task';

  if (/\b(review|check|analyse|analyze|audit|look at|read (through|this)|what do you think)\b/i.test(p))
    return 'review_task';

  if (/\b(test|spec|unit test|jest|mocha|pytest|coverage)\b/i.test(p))
    return 'test_task';

  return 'general';
}

// ─── COMPLEXITY SCORER (0–10) ─────────────────────────────────────────────────
function complexityScore(prompt) {
  let score = 0;
  const words = prompt.trim().split(/\s+/).length;

  // Length signal
  if (words > 5)   score += 1;
  if (words > 15)  score += 1;
  if (words > 40)  score += 1;
  if (words > 100) score += 1;

  // Code presence → complex
  if (/```[\s\S]+```/.test(prompt))          score += 2; // code block
  if (/\b(function|class|const |import |=>|async|await)\b/.test(prompt)) score += 1;

  // Multi-part question
  const questionMarks = (prompt.match(/\?/g) || []).length;
  if (questionMarks > 1) score += 1;
  if (/\b(and also|additionally|furthermore|also,|secondly|thirdly)\b/i.test(prompt)) score += 1;

  // Architecture / design thinking
  if (/\b(architecture|system design|trade.?off|approach|strategy|pattern|best practice)\b/i.test(prompt)) score += 1;

  return Math.min(10, score);
}

// ─── CONTEXT NECESSITY CHECK ──────────────────────────────────────────────────
// Does this prompt actually need the full codebase context?
function needsContext(prompt) {
  const p = prompt.toLowerCase();
  // References to existing code
  if (/\b(this|our|the|my|existing|current|above|below|that)\b.{0,20}\b(code|function|class|file|method|component|module|service|api|endpoint|route|schema|model|config)\b/i.test(p))
    return true;
  // Refers to something already discussed
  if (/\b(it|this|that|those|these|the above|the error|the issue|the bug)\b/i.test(p) && prompt.split(' ').length < 20)
    return true;
  // Explicit file references
  if (/\.(js|ts|py|java|go|rb|rs|cpp|cs|jsx|tsx|json|yaml|yml|env)\b/i.test(p))
    return true;
  return false;
}

// ─── REPETITION DETECTOR ──────────────────────────────────────────────────────
// Detect if user is asking roughly the same thing again in this session
function isRepetitive(prompt, recentPrompts = []) {
  if (!recentPrompts.length) return false;
  const words = new Set(prompt.toLowerCase().split(/\W+/).filter(w => w.length > 4));
  for (const prev of recentPrompts.slice(-4)) {
    const prevWords = new Set(prev.toLowerCase().split(/\W+/).filter(w => w.length > 4));
    const intersection = [...words].filter(w => prevWords.has(w)).length;
    const union = new Set([...words, ...prevWords]).size;
    if (union > 0 && intersection / union > 0.55) return true; // >55% word overlap
  }
  return false;
}

// ─── MODEL RECOMMENDATION ─────────────────────────────────────────────────────
function recommendedModel(intent, complexity, tokens) {
  // Shell commands and simple lookups — always Haiku
  if (intent === 'shell_command') return 'haiku';
  if (intent === 'simple_lookup' && complexity <= 3) return 'haiku';

  // Complex reasoning tasks — Sonnet is right
  if (['complex_explain', 'architecture', 'review_task'].includes(intent) && complexity >= 5) return 'sonnet';
  if (intent === 'build_task' && complexity >= 6) return 'sonnet';

  // Debugging simple errors — Haiku often enough
  if (intent === 'debug_task' && complexity <= 3) return 'haiku';

  // General low complexity — Haiku
  if (complexity <= 2) return 'haiku';

  return 'sonnet'; // default
}

// ─── MAIN HEURISTICS ENGINE ───────────────────────────────────────────────────
function runHeuristics(prompt, tokens, model, recentPrompts = []) {
  const flags = [];
  if (!tokens || !prompt) return flags;

  const { input, output, cacheCreate, cacheRead } = tokens;
  const ctx        = input + cacheCreate + cacheRead;
  const intent     = classifyIntent(prompt);
  const complexity = complexityScore(prompt);
  const ctxNeeded  = needsContext(prompt);
  const repetitive = isRepetitive(prompt, recentPrompts);
  const recommended = recommendedModel(intent, complexity, tokens);
  const isHaiku    = model?.includes('haiku');
  const isOpus     = model?.includes('opus');

  // ── 1. SESSION DRAG ──────────────────────────────────────────────────────
  // Tiny query pulling massive context — but only if context not actually needed
  if (cacheRead > 15000 && input < 20 && output < 100 && !ctxNeeded) {
    flags.push({
      id: 'session_drag',
      sev: cacheRead > 35000 ? 'high' : 'medium',
      message: `"${intent.replace('_',' ')}" query dragging ${fmtN(cacheRead)} cached tokens it doesn't need`,
      tip: 'Start a fresh Claude Code session for this — context not required here.',
      example: `Instead of continuing this session, open new terminal → claude → ask again`,
      saving: +((cacheRead / 1_000_000) * 0.30 * 0.85 * 22).toFixed(2)
    });
  }

  // ── 2. CACHE BLOAT ───────────────────────────────────────────────────────
  if (cacheCreate > 20000) {
    flags.push({
      id: 'cache_bloat',
      sev: 'high',
      message: `Context cache hit ${fmtN(cacheCreate)} tokens — very large session`,
      tip: 'Run /compact in Claude Code to summarise context before continuing.',
      example: 'Type: /compact  — Claude will summarise and shrink the context',
      saving: +((cacheCreate / 1_000_000) * 3.75 * 0.55 * 10).toFixed(2)
    });
  } else if (cacheCreate > 8000 && !ctxNeeded) {
    flags.push({
      id: 'cache_bloat',
      sev: 'medium',
      message: `Context growing — ${fmtN(cacheCreate)} tokens cached for a prompt that may not need it`,
      tip: 'Consider /compact or a new session if you\'ve switched topics.',
      example: null,
      saving: +((cacheCreate / 1_000_000) * 3.75 * 0.3 * 10).toFixed(2)
    });
  }

  // ── 3. MODEL MISMATCH ────────────────────────────────────────────────────
  // Only flag if we're confident about the intent AND model is wrong
  const wordCount2 = prompt.split(/\s+/).length;
  const isComplexIntent = (['build_task','review_task','refactor_task','test_task','debug_task'].includes(intent)) || (intent === 'complex_explain' && (complexity >= 2 || wordCount2 > 5)) || ctxNeeded;
  if (!isHaiku && recommended === 'haiku' && ctx > 2000 && !isComplexIntent) {
    const currentModel = isOpus ? 'Opus' : 'Sonnet';
    flags.push({
      id: 'model_overkill',
      sev: isOpus ? 'high' : 'medium',
      message: `${intent.replace('_',' ')} (complexity ${complexity}/10) — ${currentModel} is overkill`,
      tip: `Haiku handles "${intent.replace('_',' ')}" tasks well — 5-10x cheaper.`,
      example: intent === 'shell_command'
        ? 'Shell commands don\'t need Sonnet\'s reasoning — use Haiku by default'
        : `Rephrase as a simple question and use Haiku`,
      saving: +((ctx / 1_000_000) * (isOpus ? 13 : 2.2) * 8).toFixed(2)
    });
  }

  // ── 4. CONTEXT NOT NEEDED ────────────────────────────────────────────────
  // High context read but prompt shows no reference to existing code
  if (cacheRead > 10000 && !ctxNeeded && complexity <= 3 && intent !== 'build_task') {
    flags.push({
      id: 'context_unnecessary',
      sev: 'medium',
      message: `Prompt doesn't reference existing code but carries ${fmtN(cacheRead)} token context`,
      tip: 'This question is self-contained — ask it in a new session or claude.ai chat.',
      example: `"${prompt.slice(0, 50)}${prompt.length > 50 ? '...' : ''}" → ask this in claude.ai, not Claude Code`,
      saving: +((cacheRead / 1_000_000) * 0.30 * 0.9 * 15).toFixed(2)
    });
  }

  // ── 5. REPETITION ────────────────────────────────────────────────────────
  if (repetitive) {
    flags.push({
      id: 'repetitive_prompt',
      sev: 'low',
      message: 'Similar question asked recently in this session',
      tip: 'You may be re-asking due to an unclear previous response — try /clear and rephrase.',
      example: null,
      saving: 0
    });
  }

  // ── 6. VERBOSE LOW-ROI ───────────────────────────────────────────────────
  const wordCount = prompt.split(/\s+/).length;
  if (wordCount > 100 && output < 150 && complexity <= 4) {
    flags.push({
      id: 'verbose_prompt',
      sev: 'low',
      message: `${wordCount}-word prompt produced only ${output} output tokens (low ROI)`,
      tip: 'Over-specified prompts often produce shorter answers. Be more direct.',
      example: 'Remove background context Claude doesn\'t need — it already has the codebase',
      saving: 0
    });
  }

  // Attach metadata — useful for dashboard and Haiku layer
  return flags.map(f => ({
    ...f,
    meta: { intent, complexity, ctxNeeded, recommended, repetitive }
  }));
}

function fmtN(n) { return n.toLocaleString(); }

module.exports = { runHeuristics, classifyIntent, complexityScore, needsContext, recommendedModel };
