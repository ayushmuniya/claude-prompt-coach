'use strict';

// ─── INTENT CLASSIFIER ────────────────────────────────────────────────────────
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

  if (/\b(write|create|build|implement|add|generate|make|scaffold|develop)\b/i.test(p))
    return 'build_task';

  if (/\b(refactor|rewrite|improve|optimise|optimize|clean up|simplify|restructure)\b/i.test(p))
    return 'refactor_task';

  if (/\b(review|check|analyse|analyze|audit|look at|read through|what do you think)\b/i.test(p))
    return 'review_task';

  if (/\b(test|spec|unit test|jest|mocha|pytest|coverage)\b/i.test(p))
    return 'test_task';

  return 'general';
}

// ─── COMPLEXITY SCORER (0–10) ─────────────────────────────────────────────────
function complexityScore(prompt) {
  let score = 0;
  const words = prompt.trim().split(/\s+/).length;
  if (words > 5)   score += 1;
  if (words > 15)  score += 1;
  if (words > 40)  score += 1;
  if (words > 100) score += 1;
  if (/```[\s\S]+```/.test(prompt))          score += 2;
  if (/\b(function|class|const |import |=>|async|await)\b/.test(prompt)) score += 1;
  const questionMarks = (prompt.match(/\?/g) || []).length;
  if (questionMarks > 1) score += 1;
  if (/\b(and also|additionally|furthermore|also,|secondly|thirdly)\b/i.test(prompt)) score += 1;
  if (/\b(architecture|system design|trade.?off|approach|strategy|pattern|best practice)\b/i.test(prompt)) score += 1;
  return Math.min(10, score);
}

// ─── CONTEXT NECESSITY CHECK ──────────────────────────────────────────────────
// Returns true if this prompt clearly needs the codebase context to be useful
function needsContext(prompt) {
  const p = prompt.toLowerCase();

  // "we/our/my" = talking about their own project
  // These are the most reliable signals — "how are WE handling", "OUR API", "MY service"
  if (/\b(we|our|we're|we are|where are we|how are we|are we|should we|do we|can we|have we|were we)\b/i.test(p))
    return true;

  // References to specific code entities that only make sense in context
  if (/\b(this|existing|current|above|the code|the function|the class|the service|the api|the endpoint|the route|the schema|the model|the component|the module|the handler|the middleware|the hook|the config)\b/i.test(p))
    return true;

  // CamelCase = code entity name (UserService, PaymentController, AuthMiddleware)
  if (/[A-Z][a-z]+[A-Z][a-zA-Z]+/.test(prompt))
    return true;

  // File extensions = they're talking about a specific file
  if (/\.(js|ts|py|java|go|rb|rs|cpp|cs|jsx|tsx|json|yaml|yml|env|sql|sh|md)\b/i.test(p))
    return true;

  // "the X" pattern before domain-specific terms = their specific thing
  // e.g. "the auth service", "the payment flow", "the database schema"
  if (/\bthe\s+(auth|payment|user|order|product|cart|checkout|login|signup|dashboard|admin|api|database|db|cache|queue|worker|job|cron|webhook|integration)\b/i.test(p))
    return true;

  // Task words WITH project references = definitely needs context
  // "fix the bug", "add pagination", "why is it slow" — "it" implies context
  if (/\b(it|they|them|those|these|that)\b/i.test(p) && prompt.split(' ').length < 15)
    return true;

  // Domain-specific action on implicit subject = needs codebase
  // "add pagination", "fix the 500 error", "why is login failing"
  if (/\b(add|fix|update|change|remove|delete|handle)\b.{0,30}\b(pagination|error|bug|issue|feature|endpoint|route|query|migration|validation|auth|login|signup)\b/i.test(p))
    return true;

  return false;
}

// ─── REPETITION DETECTOR ──────────────────────────────────────────────────────
function isRepetitive(prompt, recentPrompts = []) {
  if (!recentPrompts.length) return false;
  const words = new Set(prompt.toLowerCase().split(/\W+/).filter(w => w.length > 4));
  for (const prev of recentPrompts.slice(-4)) {
    const prevWords = new Set(prev.toLowerCase().split(/\W+/).filter(w => w.length > 4));
    const intersection = [...words].filter(w => prevWords.has(w)).length;
    const union = new Set([...words, ...prevWords]).size;
    if (union > 0 && intersection / union > 0.55) return true;
  }
  return false;
}

// ─── MODEL RECOMMENDATION ─────────────────────────────────────────────────────
function recommendedModel(intent, complexity, tokens) {
  if (intent === 'shell_command') return 'haiku';
  if (intent === 'simple_lookup' && complexity <= 3) return 'haiku';
  if (['complex_explain', 'review_task'].includes(intent) && complexity >= 5) return 'sonnet';
  if (intent === 'build_task' && complexity >= 6) return 'sonnet';
  if (intent === 'debug_task' && complexity <= 3) return 'haiku';
  if (complexity <= 2) return 'haiku';
  return 'sonnet';
}

// ─── MAIN HEURISTICS ENGINE ───────────────────────────────────────────────────
function runHeuristics(prompt, tokens, model, recentPrompts = []) {
  const flags = [];
  if (!tokens || !prompt) return flags;

  const { input, output, cacheCreate, cacheRead } = tokens;
  const ctx         = input + cacheCreate + cacheRead;
  const intent      = classifyIntent(prompt);
  const complexity  = complexityScore(prompt);
  const ctxNeeded   = needsContext(prompt);
  const repetitive  = isRepetitive(prompt, recentPrompts);
  const recommended = recommendedModel(intent, complexity, tokens);
  const isHaiku     = model?.includes('haiku');
  const isOpus      = model?.includes('opus');
  const wordCount   = prompt.split(/\s+/).length;

  // ── 1. SESSION DRAG ──────────────────────────────────────────────────────
  // Only flag if context is genuinely not needed for this prompt
  if (cacheRead > 15000 && input < 20 && output < 100 && !ctxNeeded) {
    flags.push({
      id: 'session_drag', sev: cacheRead > 35000 ? 'high' : 'medium',
      message: `"${intent.replace('_',' ')}" query dragging ${fmtN(cacheRead)} cached tokens it doesn't need`,
      tip: 'Switch to Haiku for simple questions — type: /model claude-haiku-4-5-20251001',
      example: 'Or run /compact first to shrink context, then continue here',
      saving: +((cacheRead / 1_000_000) * 0.30 * 0.85 * 22).toFixed(2),
      meta: { intent, complexity, ctxNeeded, recommended }
    });
  }

  // ── 2. CACHE BLOAT ───────────────────────────────────────────────────────
  // Only flag if context is probably not needed
  if (cacheCreate > 20000 && !ctxNeeded) {
    flags.push({
      id: 'cache_bloat', sev: 'high',
      message: `Context cache hit ${fmtN(cacheCreate)} tokens — very large session`,
      tip: 'Run /compact in Claude Code to summarise context before continuing.',
      example: 'Type: /compact',
      saving: +((cacheCreate / 1_000_000) * 3.75 * 0.55 * 10).toFixed(2),
      meta: { intent, complexity, ctxNeeded, recommended }
    });
  } else if (cacheCreate > 8000 && !ctxNeeded) {
    flags.push({
      id: 'cache_bloat', sev: 'medium',
      message: `Growing context — ${fmtN(cacheCreate)} tokens cached`,
      tip: "Consider /compact or a new session if you've switched topics.",
      example: null,
      saving: +((cacheCreate / 1_000_000) * 3.75 * 0.3 * 10).toFixed(2),
      meta: { intent, complexity, ctxNeeded, recommended }
    });
  }

  // ── 3. MODEL MISMATCH ────────────────────────────────────────────────────
  // Intent-aware — never flag project-specific prompts as model overkill
  const isHowTo       = /^how to /i.test(prompt.trim());
  const isConceptual  = /^(explain|how does|how do|why does|why do|what makes|walk me through)/i.test(prompt.trim());
  const isComplexIntent = (
    ['build_task','review_task','refactor_task','test_task','debug_task'].includes(intent)
    || (intent === 'complex_explain' && isConceptual && wordCount >= 3)
    || (intent === 'complex_explain' && !isHowTo && complexity >= 2)
    || ctxNeeded  // if context is needed, never call it overkill
  );

  if (!isHaiku && recommended === 'haiku' && ctx > 2000 && !isComplexIntent) {
    const currentModel = isOpus ? 'Opus' : 'Sonnet';
    flags.push({
      id: 'model_overkill', sev: isOpus ? 'high' : 'medium',
      message: `${intent.replace('_',' ')} (complexity ${complexity}/10) — ${currentModel} is overkill`,
      tip: `Haiku handles "${intent.replace('_',' ')}" tasks well — 5-10x cheaper.`,
      example: intent === 'shell_command'
        ? 'Shell commands don\'t need Sonnet\'s reasoning — use Haiku by default'
        : 'Rephrase as a simple question and use Haiku',
      saving: +((ctx / 1_000_000) * (isOpus ? 13 : 2.2) * 8).toFixed(2),
      meta: { intent, complexity, ctxNeeded, recommended }
    });
  }

  // ── 4. CONTEXT NOT NEEDED ────────────────────────────────────────────────
  // Only flag generic/educational questions inside Claude Code
  if (cacheRead > 10000 && !ctxNeeded && complexity <= 3
      && !['build_task','debug_task','refactor_task','review_task','test_task'].includes(intent)) {
    flags.push({
      id: 'context_unnecessary', sev: 'medium',
      message: `Generic question carrying ${fmtN(cacheRead)} token codebase context`,
      tip: 'Switch to Haiku for this — same answer, 10x cheaper. Type: /model claude-haiku-4-5-20251001',
      example: 'Or open a new Claude Code tab for quick questions to avoid carrying this context',
      saving: +((cacheRead / 1_000_000) * 0.30 * 0.9 * 15).toFixed(2),
      meta: { intent, complexity, ctxNeeded, recommended }
    });
  }

  // ── 5. REPETITION ────────────────────────────────────────────────────────
  if (repetitive) {
    flags.push({
      id: 'repetitive_prompt', sev: 'low',
      message: 'Similar question asked recently in this session',
      tip: 'Try /clear and rephrase — previous response may have been unclear.',
      example: null,
      saving: 0,
      meta: { intent, complexity, ctxNeeded, recommended }
    });
  }

  // ── 6. VERBOSE LOW-ROI ───────────────────────────────────────────────────
  if (wordCount > 100 && output < 150 && complexity <= 4 && !ctxNeeded) {
    flags.push({
      id: 'verbose_prompt', sev: 'low',
      message: `${wordCount}-word prompt produced only ${output} output tokens`,
      tip: 'Long setup + short answer — try smaller focused prompts.',
      example: 'Remove background context Claude already has via the codebase',
      saving: 0,
      meta: { intent, complexity, ctxNeeded, recommended }
    });
  }

  return flags;
}

function fmtN(n) { return n.toLocaleString(); }

module.exports = { runHeuristics, classifyIntent, complexityScore, needsContext, recommendedModel };
