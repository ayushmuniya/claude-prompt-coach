# claude-prompt-coach

> Real-time prompt efficiency coach for Claude Code — catch waste **before** you spend the tokens.

```bash
npx claude-prompt-coach
```

Zero install. Zero signup. Reads your local Claude Code data — **nothing leaves your machine.**

---

## The problem

You're deep in a large Claude Code session and type:

```
what is chmod
```

Claude answers. But you just spent **$0.0152** on a question that costs **$0.0001** in a fresh session.
That's **152x more expensive** — because you dragged 50,000 tokens of codebase context along for the ride.

claude-prompt-coach fixes this in two ways:

---

## Two modes

### 1. Real-time hook — warns you BEFORE you send

Install once, works forever inside Claude Code:

```bash
npx claude-prompt-coach
# then:
node node_modules/claude-prompt-coach/install.js
```

Or if you cloned the repo:

```bash
node install.js
```

Now every prompt gets analysed instantly (~2ms, 100% local). When waste is detected:

```
╭────────────────────────────────────────────────────────────╮
│ ⚠ claude-coach — heads up                                  │
├────────────────────────────────────────────────────────────┤
│ ● "simple lookup" query dragging 50,596 cached tokens      │
│    → Start a fresh Claude Code session for this.           │
│                                                            │
│ ● simple lookup — Sonnet is overkill                       │
│    → Haiku handles this 5-10x cheaper.                     │
├────────────────────────────────────────────────────────────┤
│   Cost here: $0.0152  (fresh session: ~$0.0001)            │
│   That's 152x more than a new session                      │
│                                                            │
│   Quick fix: Open a new terminal tab, run claude           │
├────────────────────────────────────────────────────────────┤
│   Sending anyway… (this is just a heads up, not a block)   │
╰────────────────────────────────────────────────────────────╯
```

The prompt is **never blocked** — this is coaching, not gatekeeping.

To uninstall the hook:
```bash
node install.js --uninstall
```

---

### 2. Post-session dashboard — full analysis in browser

```bash
npx claude-prompt-coach
```

Opens a local dashboard at `http://localhost:3847` with:

- **Efficiency score** — overall session health
- **Top issues** — flagged prompts with specific tips
- **Most expensive calls** — ranked by cost
- **Token distribution** — cache write vs read vs input vs output
- **Monthly saving estimate** — if all issues were fixed
- **AI-powered analysis** (optional) — paste your Anthropic API key to get Haiku-generated rewrites for flagged prompts

### CLI mode (no browser)

```bash
npx claude-prompt-coach cli
```

### Filters

```bash
npx claude-prompt-coach --days 7          # last 7 days only
npx claude-prompt-coach --project myapp   # filter by project name
```

---

## What it detects

| Issue | What it means | Fix |
|---|---|---|
| **Session drag** | Tiny query carrying massive context | Open fresh session |
| **Cache bloat** | Context grown too large | Run `/compact` |
| **Model overkill** | Sonnet/Opus for simple questions | Switch to Haiku |
| **Context unnecessary** | Self-contained question in a code session | Ask in claude.ai |
| **Verbose prompt** | Long prompt, short answer | Be more direct |
| **Repetitive prompt** | Same question asked recently | Try `/clear` and rephrase |

---

## How it works

1. Reads `~/.claude/projects/**/*.jsonl` — Claude Code's local session logs
2. Pairs user prompts with assistant responses + token counts
3. Runs local heuristics (intent classification, complexity scoring, context detection)
4. Estimates monthly saving if issues are fixed
5. Optionally sends **flagged prompts only** to Anthropic Haiku for AI-powered rewrite suggestions

## Privacy

100% local by default. No data is sent anywhere without explicit opt-in.
Source is readable JS — check for yourself.

The only exception: the optional "AI analysis" feature in the dashboard, which sends flagged prompts to Anthropic Haiku using **your own API key**. You control this — it's off by default.

---

## Commands

| Command | What it does |
|---|---|
| `npx claude-prompt-coach` | Open dashboard in browser |
| `npx claude-prompt-coach cli` | Print report in terminal |
| `node install.js` | Install real-time Claude Code hook |
| `node install.js --uninstall` | Remove the hook |
| `npx claude-prompt-coach --days 7` | Analyse last 7 days only |
| `npx claude-prompt-coach --project name` | Filter by project |

---

## Real numbers from real usage

```
Sessions analysed : 6 across 5 projects
Total spend       : $0.55
Efficiency score  : 13/100
Issues found      : 13/15 calls flagged
Saving potential  : ~$14.81/month

Most expensive call: $0.1242
"what is # used for in claude" — asked inside a 43k token session
Same question in fresh session: $0.0001 — 1,242x cheaper
```

---

Built by [Ayush Muniya](https://github.com/ayushmuniya) · MIT License
