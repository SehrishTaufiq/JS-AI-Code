// Mutants: one deliberate bug each. The runner plants each one in a throwaway copy of the repo
// and runs the listed suites; a good test suite fails ("kills" the mutant). A mutant that
// survives points at a missing test.
//
// from: exact text that must occur once in the file; to: its buggy replacement.
// suites: keys of SUITES in run.mjs. covers: the requirement ids (requirements.json) it breaks.
const r = String.raw;

export const MUTANTS = [
  // --- todo/tasks.js: task logic (tickets #3, #4, #5) ---
  { id: 'T01', file: 'todo/tasks.js', bug: 'tags keep their capitals', from: `.trim().replace(/^#+/, '').trim().toLowerCase())`, to: `.trim().replace(/^#+/, '').trim())`, suites: ['unit'], covers: ['R4.4'] },
  { id: 'T02', file: 'todo/tasks.js', bug: 'duplicate tags kept', from: 'return [...new Set(tags)];', to: 'return tags;', suites: ['unit'], covers: ['R4.4'] },
  { id: 'T03', file: 'todo/tasks.js', bug: 'leading # kept on tags', from: `.replace(/^#+/, '')`, to: '', suites: ['unit'], covers: ['R4.4'] },
  { id: 'T04', file: 'todo/tasks.js', bug: 'impossible dates (2026-02-30) accepted', from: 'return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? s : null;', to: 'return s;', suites: ['unit'], covers: ['R4.2'] },
  { id: 'T05', file: 'todo/tasks.js', bug: 'empty titles accepted', from: 'if (!trimmed) throw', to: 'if (false) throw', suites: ['unit'], covers: ['R3.1'] },
  { id: 'T06', file: 'todo/tasks.js', bug: 'repeating task without a date gets no date', from: 'const due = parseDueDate(dueDate) ?? (rep ? today : null);', to: 'const due = parseDueDate(dueDate) ?? null;', suites: ['unit'], covers: ['R5.2'] },
  { id: 'T07', file: 'todo/tasks.js', bug: 'monthly repeat not clamped to short months', from: 'Math.min(day, lastDay)', to: 'day', suites: ['unit'], covers: ['R5.4'] },
  { id: 'T08', file: 'todo/tasks.js', bug: 'weekly repeat is 6 days', from: 'addDays(s, 7)', to: 'addDays(s, 6)', suites: ['unit'], covers: ['R5.1'] },
  { id: 'T09', file: 'todo/tasks.js', bug: 'overdue catch-up skips today', from: 'while (next < today)', to: 'while (next <= today)', suites: ['unit'], covers: ['R5.3'] },
  { id: 'T10', file: 'todo/tasks.js', bug: 'no catch-up: next copy of an overdue task is already overdue', from: 'while (next < today) next = step(task, next);', to: '', suites: ['unit'], covers: ['R5.3'] },
  { id: 'T11', file: 'todo/tasks.js', bug: 're-ticking spawns a duplicate occurrence', from: 'if (!task.repeat || task.nextId) return', to: 'if (!task.repeat) return', suites: ['unit'], covers: ['R5.5'] },
  { id: 'T12', file: 'todo/tasks.js', bug: 'next occurrence forgets its day of month', from: 'repeatDay: task.repeatDay,', to: '', suites: ['unit'], covers: ['R5.4'] },
  { id: 'T13', file: 'todo/tasks.js', bug: 'list sorted newest first', from: 'a.createdAt - b.createdAt', to: 'b.createdAt - a.createdAt', suites: ['unit'], covers: ['R3.5'] },
  { id: 'T14', file: 'todo/tasks.js', bug: 'Completed filter shows incomplete tasks', from: "if (status === 'completed' && !t.done)", to: "if (status === 'completed' && t.done)", suites: ['unit'], covers: ['R4.1'] },
  { id: 'T15', file: 'todo/tasks.js', bug: 'tag filter ignored', from: 'if (tag && !(t.tags || []).includes(tag)) return false;', to: '', suites: ['unit'], covers: ['R4.5'] },
  { id: 'T16', file: 'todo/tasks.js', bug: 'tag dropdown unsorted', from: ')].sort();', to: ')];', suites: ['unit'], covers: ['R4.5'] },
  { id: 'T17', file: 'todo/tasks.js', bug: 'done tasks shown as overdue', from: 'return !task.done && !!task.dueDate', to: 'return !!task.dueDate', suites: ['unit'], covers: ['R4.3'] },
  { id: 'T18', file: 'todo/tasks.js', bug: 'task due today shown as overdue', from: 'task.dueDate < today;', to: 'task.dueDate <= today;', suites: ['unit'], covers: ['R4.3'] },
  { id: 'T19', file: 'todo/tasks.js', bug: 'old record with repeat but no date keeps repeating', from: 'const repeat = dueDate ? parseRepeat(task.repeat) : null;', to: 'const repeat = parseRepeat(task.repeat);', suites: ['unit'], covers: ['R3.6'] },
  { id: 'T20', file: 'todo/tasks.js', bug: '"today" computed in UTC, not the local date', from: 'date.getDate()', to: 'date.getUTCDate()', suites: ['unit', 'e2e-dates'], covers: ['R4.3'] },
  { id: 'T21', file: 'todo/tasks.js', bug: '"N left" counts done tasks too', from: 'return tasks.filter((t) => !t.done).length;', to: 'return tasks.length;', suites: ['unit'], covers: ['R3.2'] },
  { id: 'T22', file: 'todo/tasks.js', bug: 'monthly task does not remember its day', from: "repeatDay: rep === 'monthly' ? Number(due.slice(8, 10)) : null,", to: 'repeatDay: null,', suites: ['unit'], covers: ['R5.4'] },

  // --- todo/app.js + index.html: the page (browser tests) ---
  { id: 'A01', file: 'todo/app.js', bug: 'titles rendered as HTML (XSS)', from: 'label.textContent = task.title;', to: 'label.innerHTML = task.title;', suites: ['e2e'], covers: ['S8'] },
  { id: 'A02', file: 'todo/app.js', bug: 'form not cleared after adding', from: 'form.reset();', to: '', suites: ['e2e'], covers: ['R3.1'] },
  { id: 'A03', file: 'todo/app.js', bug: 'pending save wipes a fast second entry (race)', from: 'form.reset();\n    titleInput.focus();\n    if (await persist(() => store.put(task))) {', to: 'titleInput.focus();\n    if (await persist(() => store.put(task))) {\n      form.reset();', suites: ['e2e'], covers: ['R3.1'] },
  { id: 'A04', file: 'todo/app.js', bug: 'keyboard focus lost on re-render', from: 'restoreFocus(focus);', to: '', suites: ['e2e'], covers: ['R3.7'] },
  { id: 'A05', file: 'todo/app.js', bug: 'other tabs not told about changes', from: "if (channel) channel.postMessage('changed');", to: '', suites: ['e2e'], covers: ['R3.8'] },
  { id: 'A06', file: 'todo/app.js', bug: 'broken storage does not disable the form', from: "form.querySelectorAll('input, select, button').forEach((el) => (el.disabled = true));", to: '', suites: ['e2e'], covers: ['R3.9'] },
  { id: 'A07', file: 'todo/app.js', bug: 'tag chip does not filter', from: 'filter.tag = chip.dataset.tag;', to: "filter.tag = '';", suites: ['e2e'], covers: ['R4.5'] },
  { id: 'A08', file: 'todo/app.js', bug: 'delete not saved (task back after reload)', from: 'if (await persist(() => store.remove(id))) {', to: 'if (true) {', suites: ['e2e'], covers: ['R3.3'] },
  { id: 'A09', file: 'todo/app.js', bug: 'overdue tasks not marked', from: "due.className = overdue ? 'due overdue' : 'due';", to: "due.className = 'due';", suites: ['e2e-dates'], covers: ['R4.3'] },
  { id: 'A10', file: 'todo/index.html', bug: 'Content-Security-Policy removed', from: '<meta http-equiv="Content-Security-Policy"', to: '<meta data-removed="Content-Security-Policy"', suites: ['e2e'], covers: ['S8'] },

  // --- guard-rules.mjs: blocking destructive commands ---
  { id: 'G01', file: '.claude/hooks/guard-rules.mjs', bug: '--force-with-lease allowed', from: '--force(-with-lease|-if-includes)?(=', to: '--force(=', suites: ['guard'], covers: ['S1'] },
  { id: 'G02', file: '.claude/hooks/guard-rules.mjs', bug: 'short -f / -uf force flags allowed', from: r` || /\s-[a-zA-Z]*f[a-zA-Z]*\s/.test(r))`, to: ')', suites: ['guard'], covers: ['S1'] },
  { id: 'G03', file: '.claude/hooks/guard-rules.mjs', bug: '+refspec force push allowed', from: r`test: git('push', (r) => /\s\+\S+/.test(r))`, to: 'test: () => false', suites: ['guard'], covers: ['S1'] },
  { id: 'G04', file: '.claude/hooks/guard-rules.mjs', bug: 'bare `git push` on main allowed', from: 'return args.length <= 1 && DEFAULT_BRANCHES.includes(ctx.currentBranch);', to: 'return false;', suites: ['guard'], covers: ['S2'] },
  { id: 'G05', file: '.claude/hooks/guard-rules.mjs', bug: '`git -C . push -f` hides the subcommand', from: '? 2 : 1;', to: '? 1 : 1;', suites: ['guard'], covers: ['S1'] },
  { id: 'G06', file: '.claude/hooks/guard-rules.mjs', bug: 'rm -rf allowed', from: r`/(^|\s)rm\s+(?:-[a-zA-Z]*\s+)*-[a-zA-Z]*[rR]/.test(s) || `, to: '', suites: ['guard'], covers: ['S3'] },
  { id: 'G07', file: '.claude/hooks/guard-rules.mjs', bug: 'find -delete allowed', from: r`/\bfind\b.*(\s-delete\b|-exec\s+rm\b|-execdir\s+rm\b)/.test(s)`, to: 'false', suites: ['guard'], covers: ['S3'] },
  { id: 'G08', file: '.claude/hooks/guard-rules.mjs', bug: 'gh pr merge allowed', from: r`/\bgh\b.*\bpr\b\s+merge\b/.test(s)`, to: 'false', suites: ['guard'], covers: ['S4'] },
  { id: 'G09', file: '.claude/hooks/guard-rules.mjs', bug: 'node -e fs.rmSync allowed', from: 'rmSync|rmdirSync', to: 'noSuchCall|rmdirSync', suites: ['guard'], covers: ['S3'] },
  { id: 'G10', file: '.claude/hooks/guard-rules.mjs', bug: 'shell redirect into settings.json allowed', from: '  if (target) return target;\n', to: '', suites: ['guard'], covers: ['S5'] },
  { id: 'G11', file: '.claude/hooks/guard-rules.mjs', bug: '.gitignore no longer protected', from: "  '.gitignore',\n", to: '', suites: ['guard'], covers: ['S5'] },
  { id: 'G12', file: '.claude/hooks/guard-rules.mjs', bug: 'git merge runs without asking', from: "git(['rebase', 'merge'], () => true)", to: "git(['rebase'], () => true)", suites: ['guard'], covers: ['S6'] },
  { id: 'G13', file: '.claude/hooks/guard-rules.mjs', bug: 'commands on a second line not checked', from: r`|\r?\n/)`, to: '/)', suites: ['guard'], covers: ['S3'] },
  { id: 'G14', file: '.claude/hooks/guard-rules.mjs', bug: 'git reset --hard allowed', from: r`test: git('reset', (r) => /\s--hard\s/.test(r))`, to: 'test: () => false', suites: ['guard'], covers: ['S3'] },
  { id: 'G15', file: '.claude/hooks/guard-rules.mjs', bug: '`git push origin :branch` (remote delete) allowed', from: r` || /\s:\S+/.test(r)`, to: '', suites: ['guard'], covers: ['S1'] },
  { id: 'G16', file: '.claude/hooks/guard-rules.mjs', bug: 'Remove-Item -Recurse allowed', from: r`/\b(remove-item|ri|rm|rmdir|del)\b.*\s-(r|recurse)\b/i.test(s)`, to: 'false', suites: ['guard'], covers: ['S3'] },
  { id: 'G17', file: '.claude/hooks/guard-rules.mjs', bug: 'gh api -X DELETE allowed', from: r`/(-X|--method|--request)\s*=?\s*['"]?DELETE/i.test(s)`, to: 'false', suites: ['guard'], covers: ['S4'] },
  { id: 'G18', file: '.claude/hooks/guard-rules.mjs', bug: '`tee` into a guardrail file allowed', from: '|tee|cp|', to: '|cp|', suites: ['guard'], covers: ['S5'] },

  // --- secrets.mjs: secret detection and masking ---
  { id: 'S01', file: '.claude/hooks/secrets.mjs', bug: 'GitHub fine-grained tokens missed', from: r`/\bgithub_pat_`, to: r`/\bNOPE_github_pat_`, suites: ['secrets'], covers: ['S7'] },
  { id: 'S02', file: '.claude/hooks/secrets.mjs', bug: 'AWS keys missed', from: r`/\bAKIA`, to: r`/\bNOPEAKIA`, suites: ['secrets'], covers: ['S7'] },
  { id: 'S03', file: '.claude/hooks/secrets.mjs', bug: 'private keys missed', from: '/-----BEGIN [A-Z ]*PRIVATE', to: '/-----NOPE [A-Z ]*PRIVATE', suites: ['secrets'], covers: ['S7'] },
  { id: 'S04', file: '.claude/hooks/secrets.mjs', bug: 'user:pass@host URLs missed', from: r`/\b[a-z][a-z0-9+.-]*:\/\/`, to: r`/\bNOPE[a-z][a-z0-9+.-]*:\/\/`, suites: ['secrets'], covers: ['S7'] },
  { id: 'S05', file: '.claude/hooks/secrets.mjs', bug: 'password=... not masked', from: 'for (const re of GENERIC) out', to: 'for (const re of []) out', suites: ['secrets'], covers: ['S7'] },
  { id: 'S06', file: '.claude/hooks/secrets.mjs', bug: 'findSecrets finds nothing', from: 'return STRONG.flatMap(', to: 'return [].flatMap(', suites: ['secrets'], covers: ['S7'] },
  { id: 'S07', file: '.claude/hooks/secrets.mjs', bug: 'JWTs missed', from: r`/\beyJ`, to: r`/\bNOPEeyJ`, suites: ['secrets'], covers: ['S7'] },
  { id: 'S08', file: '.claude/hooks/secrets.mjs', bug: 'Slack tokens missed', from: r`/\bxox`, to: r`/\bNOPExox`, suites: ['secrets'], covers: ['S7'] },
  { id: 'S09', file: '.claude/hooks/secrets.mjs', bug: 'Anthropic/OpenAI keys missed', from: r`/\bsk-`, to: r`/\bNOPEsk-`, suites: ['secrets'], covers: ['S7'] },

  // --- Stop hooks ---
  { id: 'C01', file: '.claude/hooks/auto-commit.mjs', bug: 'auto-commit commits and pushes on main', from: 'if (branch.out === defaultBranch || branch.out === LOG_BRANCH) {', to: 'if (branch.out === LOG_BRANCH) {', suites: ['autocommit'], covers: ['S2'] },
  { id: 'C02', file: '.claude/hooks/auto-commit.mjs', bug: 'files with secrets inside get committed', from: 'SECRET.test(f) || hasSecretContent(f)', to: 'SECRET.test(f)', suites: ['autocommit'], covers: ['S7'] },
  { id: 'C03', file: '.claude/hooks/auto-commit.mjs', bug: '.env files get committed', from: 'SECRET.test(f) || hasSecretContent(f)', to: 'hasSecretContent(f)', suites: ['autocommit'], covers: ['S7'] },
  { id: 'C04', file: '.claude/hooks/auto-commit.mjs', bug: 'commits in the middle of a merge', from: "for (const marker of ['MERGE_HEAD', ", to: 'for (const marker of [', suites: ['autocommit'], covers: ['S3'] },
  { id: 'L01', file: '.claude/hooks/log-prompts.mjs', bug: 'prompt log not masked before going public', from: 'prompt: redact(p.text),', to: 'prompt: p.text,', suites: ['logprompts'], covers: ['S7'] },
  { id: 'L02', file: '.claude/hooks/log-prompts.mjs', bug: 'subagent prompts logged as yours', from: 'if (entry.isSidechain) return null;', to: '', suites: ['logprompts'], covers: ['F4'] },
  { id: 'L03', file: '.claude/hooks/log-prompts.mjs', bug: 'system/skill text logged as your prompts', from: '!entry.isMeta && ', to: '', suites: ['logprompts'], covers: ['F4'] },

  // --- factory-loop scripts ---
  { id: 'F01', file: '.claude/skills/factory-loop/scripts/fetch-tickets.mjs', bug: 'tickets from strangers get built', from: "if (issue.state === 'open' && !allowedAuthors.includes(String(issue.user?.login).toLowerCase())) {", to: 'if (false) {', suites: ['fetch'], covers: ['S9'] },
  { id: 'F02', file: '.claude/skills/factory-loop/scripts/fetch-tickets.mjs', bug: "the loop's own replies counted as review feedback", from: 'const human = all.filter((i) => !i.body.includes(MARKER) && ', to: 'const human = all.filter((i) => ', suites: ['fetch'], covers: ['F2'] },
  { id: 'F03', file: '.claude/skills/factory-loop/scripts/github.mjs', bug: 'marker added twice on PR updates', from: 'return text.includes(MARKER) ? text :', to: 'return false ? text :', suites: ['github'], covers: ['F3'] },
  { id: 'F04', file: '.claude/skills/factory-loop/scripts/github.mjs', bug: "pr-feedback returns the loop's own posts", from: "].filter((i) => !(i.body || '').includes(MARKER))", to: '].filter((i) => true)', suites: ['github'], covers: ['F2'] },
];
