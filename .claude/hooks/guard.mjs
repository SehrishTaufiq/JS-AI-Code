#!/usr/bin/env node
// PreToolUse hook (Bash, PowerShell): blocks destructive commands and shell writes to the
// guardrail files, using the rules in guard-rules.mjs. Allowed commands produce no output, so the
// normal permission rules still apply to them.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { check } from './guard-rules.mjs';

let input = {};
try {
  input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
} catch {}

const command = input.tool_input?.command;
if (!command) process.exit(0);

let currentBranch = '';
try {
  currentBranch = execFileSync('git', ['symbolic-ref', '--short', 'HEAD'], {
    cwd: input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
} catch {}

const verdict = check(command, { currentBranch });
if (verdict.decision !== 'allow') {
  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: verdict.decision,
      permissionDecisionReason: `factory guard: ${verdict.reason}`,
    },
  }));
}
process.exit(0);
