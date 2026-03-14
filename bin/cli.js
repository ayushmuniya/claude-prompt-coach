#!/usr/bin/env node
'use strict';

const args    = process.argv.slice(2);
const command = args[0];

if (command === '--help' || command === '-h') {
  console.log(`
  claude-coach — prompt efficiency coach for Claude Code

  USAGE
    npx claude-prompt-coach            Open dashboard in browser (default)
    npx claude-prompt-coach cli        Print report in terminal
    npx claude-prompt-coach --help     Show this help

  OPTIONS
    --days <n>      Analyse last N days only
    --project <p>   Filter to a specific project name

  EXAMPLES
    npx claude-prompt-coach
    npx claude-prompt-coach --days 7
    npx claude-prompt-coach cli --project myapp
`);
  process.exit(0);
}

require('../index.js').run({ command, args });
