'use strict';

// ─── HAIKU CLOUD ANALYSIS LAYER ──────────────────────────────────────────────
// Opt-in only. User must provide their own Anthropic API key.
// Prompt text is sent to Anthropic — user must explicitly consent.

const ANALYSIS_PROMPT = (prompt, tokens, model, intent, complexity) => `You are a prompt efficiency expert for Claude Code users. Analyse this prompt and respond ONLY with valid JSON.

PROMPT: ${JSON.stringify(prompt)}
TOKENS: input=${tokens.input}, cache_read=${tokens.cacheRead}, cache_create=${tokens.cacheCreate}, output=${tokens.output}
MODEL_USED: ${model}
LOCAL_INTENT: ${intent}
LOCAL_COMPLEXITY: ${complexity}/10

Respond with this exact JSON structure (no markdown, no backticks, raw JSON only):
{
  "waste_reason": "one sentence why this was inefficient, or null if it was fine",
  "model_recommendation": "haiku" or "sonnet" or "opus" or "current_is_fine",
  "context_needed": true or false,
  "rewritten_prompt": "a more token-efficient rewrite of the prompt, or null if not needed",
  "saving_tip": "one specific, actionable saving tip for this exact prompt",
  "quality_score": number from 1-10 (10 = perfectly efficient prompt)
}`;

async function analyseWithHaiku(apiKey, prompt, tokens, model, intent, complexity) {
  const body = {
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 400,
    messages: [{
      role: 'user',
      content: ANALYSIS_PROMPT(prompt, tokens, model, intent, complexity)
    }]
  };

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  const raw  = data.content?.[0]?.text || '{}';

  try {
    return JSON.parse(raw);
  } catch (_) {
    // Try to extract JSON from response if wrapped in text
    const match = raw.match(/\{[\s\S]+\}/);
    return match ? JSON.parse(match[0]) : null;
  }
}

// Batch analyse — top N flagged prompts only (cost control)
async function batchAnalyse(apiKey, pairs, { maxPrompts = 10, onProgress } = {}) {
  // Only send flagged prompts — and skip very short ones
  const candidates = pairs
    .filter(p => p.flags.length > 0 && p.prompt.split(' ').length > 5)
    .slice(0, maxPrompts);

  const results = [];
  let done = 0;

  for (const pair of candidates) {
    try {
      const intent     = pair.flags[0]?.meta?.intent || 'general';
      const complexity = pair.flags[0]?.meta?.complexity || 5;

      const analysis = await analyseWithHaiku(
        apiKey, pair.prompt, pair.tokens, pair.model, intent, complexity
      );

      results.push({ ...pair, aiAnalysis: analysis });
    } catch (e) {
      results.push({ ...pair, aiAnalysis: null, aiError: e.message });
    }

    done++;
    if (onProgress) onProgress(done, candidates.length);
    // Small delay to avoid rate limit
    if (done < candidates.length) await sleep(200);
  }

  // Pairs without AI analysis — return as-is
  const analysedUuids = new Set(candidates.map((_,i) => i));
  const rest = pairs.filter((_,i) => !analysedUuids.has(i));

  return [...results, ...rest.map(p => ({ ...p, aiAnalysis: null }))];
}

// Estimate cost before running (show user before they confirm)
function estimateBatchCost(pairs, maxPrompts = 10) {
  const candidates = pairs.filter(p => p.flags.length > 0 && p.prompt.split(' ').length > 5).slice(0, maxPrompts);
  // ~300 tokens prompt + ~100 tokens input + ~100 tokens output per analysis
  const tokensEach = 500;
  const totalTokens = candidates.length * tokensEach;
  const costUSD = (totalTokens / 1_000_000) * 0.80; // Haiku input price
  return { candidates: candidates.length, estimatedCost: +costUSD.toFixed(4) };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = { analyseWithHaiku, batchAnalyse, estimateBatchCost };
