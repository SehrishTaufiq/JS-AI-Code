import test from 'node:test';
import assert from 'node:assert/strict';
import { check } from '../hooks/guard-rules.mjs';

const onTicket = { currentBranch: 'ticket/6-edit-tasks' };
const onMain = { currentBranch: 'main' };

const DENY = [
  // force pushes, including the variants prefix rules missed
  ['git push --force origin ticket/6-x', onTicket],
  ['git push -f origin ticket/6-x', onTicket],
  ['git push --force-with-lease origin ticket/6-x', onTicket],
  ['git push --force-with-lease=ticket/6-x origin ticket/6-x', onTicket],
  ['git push --force-if-includes origin x', onTicket],
  ['git push -uf origin ticket/6-x', onTicket],
  ['git push origin +ticket/6-x', onTicket],
  ['git -C . push -f origin x', onTicket],
  ['git -c core.x=y push --force origin x', onTicket],
  ['cd repo && git push --force origin x', onTicket],
  ['git push --force origin x\necho done', onTicket], // the dangerous line first, then more lines
  // deleting remote refs
  ['git push origin --delete ticket/6-x', onTicket],
  ['git push origin :ticket/6-x', onTicket],
  ['git push -d origin v1', onTicket],
  // pushing to main
  ['git push origin main', onTicket],
  ['git push -u origin main', onTicket],
  ['git push origin HEAD:main', onTicket],
  ['git push origin ticket/6-x:main', onTicket],
  ['git push origin HEAD:refs/heads/main', onTicket],
  ['git push', onMain],
  ['git push origin', onMain],
  // local destruction
  ['git reset --hard origin/main', onTicket],
  ['git clean -fd', onTicket],
  ['git clean -xdf', onTicket],
  ['git checkout -- .', onTicket],
  ['git checkout .', onTicket],
  ['git restore .', onTicket],
  ['git restore --worktree --staged app.js', onTicket],
  ['git rm -r todo', onTicket],
  ['git branch -D ticket/6-x', onTicket],
  ['git branch -d ticket/6-x', onTicket],
  ['git branch --delete --force x', onTicket],
  ['git tag -d v1', onTicket],
  ['git stash drop', onTicket],
  ['git stash clear', onTicket],
  ['git filter-branch --tree-filter x HEAD', onTicket],
  ['git update-ref -d refs/heads/x', onTicket],
  ['git reflog expire --expire=now --all', onTicket],
  // GitHub
  ['gh pr merge 7 --squash', onTicket],
  ['gh issue close 5', onTicket],
  ['gh pr close 7', onTicket],
  ['gh repo delete owner/repo --yes', onTicket],
  ['gh release delete v1', onTicket],
  ['gh api -X DELETE repos/o/r/git/refs/heads/x', onTicket],
  ['gh api repos/o/r/pulls/7/merge -X PUT', onTicket],
  ['gh api repos/o/r/issues/5 -X PATCH -f state=closed', onTicket],
  ['curl -X DELETE https://api.github.com/repos/o/r', onTicket],
  // deleting files
  ['rm -rf todo', onTicket],
  ['rm -fr ./x', onTicket],
  ['rm -r x', onTicket],
  ['rm -v -R x', onTicket],
  ['rm --recursive x', onTicket],
  ['find . -name "*.js" -delete', onTicket],
  ['find . -type f -exec rm {} +', onTicket],
  ['rd /s /q todo', onTicket],
  ['rmdir /s todo', onTicket],
  ['del /s /q *.js', onTicket],
  ['Remove-Item -Recurse -Force todo', onTicket],
  ['Remove-Item todo -Recurse', onTicket],
  ['ri todo -r', onTicket],
  ['node -e "require(\'fs\').rmSync(\'todo\', {recursive: true})"', onTicket],
  ['python -c "import shutil; shutil.rmtree(\'todo\')"', onTicket],
  // shell writes to guardrail files
  ['echo {} > .claude/settings.json', onTicket],
  ['echo x >> .gitignore', onTicket],
  ["sed -i 's/deny/allow/' .claude/settings.json", onTicket],
  ['cp evil.mjs .claude/hooks/guard.mjs', onTicket],
  ['mv x .claude/hooks/auto-commit.mjs', onTicket],
  ['tee .mcp.json < x', onTicket],
  ['rm .claude/hooks/guard.mjs', onTicket],
  ['git checkout HEAD~1 -- .claude/settings.json', onTicket],
  ['Set-Content .claude\\settings.json "{}"', onTicket],
  ['Out-File -FilePath .claude\\factory.json', onTicket],
  ['node -e "fs.writeFileSync(\'.claude/settings.json\', \'{}\')"', onTicket],
  ['echo x > .github/workflows/test.yml', onTicket],
  ['echo x > .claude/skills/factory-loop/scripts/lib.mjs', onTicket],
];

const ASK = [
  ['git rebase main', onTicket],
  ['git merge origin/main', onTicket],
  ['git commit --amend --no-edit', onTicket],
];

const ALLOW = [
  ['git status --short', onTicket],
  ['git push -u origin ticket/6-edit-tasks', onTicket],
  ['git push', onTicket],
  ['git push origin review/tickets-1-5', onTicket],
  ['git push origin maintenance-fix', onTicket],
  ['git commit -m "push to main is blocked; --force too"', onTicket],
  ['git log --oneline main..HEAD', onTicket],
  ['git merge-base --is-ancestor abc origin/main', onTicket],
  ['git restore --staged app.js', onTicket],
  ['git rm --cached .claude/logs/prompts.jsonl', onTicket],
  ['git branch --show-current', onTicket],
  ['git branch -a --contains abc', onTicket],
  ['git stash push -u -m "factory-loop: WIP #6"', onTicket],
  ['git switch -c ticket/6-edit-tasks review/tickets-1-5', onTicket],
  ['rm notes.tmp', onTicket],
  ['npm test 2>&1 | tail -5', onTicket],
  ['node .claude/skills/factory-loop/scripts/fetch-tickets.mjs 2>&1 | grep todo', onTicket],
  ['node .claude/hooks/log-prompts.mjs > /dev/null', onTicket],
  ['cat .claude/settings.json', onTicket],
  ['grep -n deny .claude/settings.json', onTicket],
  ['node --check .claude/hooks/guard.mjs', onTicket],
  ['gh pr view 7', onTicket],
  ['gh pr create --title x --body y', onTicket],
  ['gh issue comment 5 --body "ready for review"', onTicket],
  ['find . -name "*.png"', onTicket],
  ['Get-ChildItem -Recurse todo', onTicket],
  ['echo hi > notes.txt', onTicket],
  ['node -e "console.log(1)"', onTicket],
];

for (const [cmd, ctx] of DENY) {
  test(`deny: ${cmd}`, () => assert.equal(check(cmd, ctx).decision, 'deny', check(cmd, ctx).reason));
}
for (const [cmd, ctx] of ASK) {
  test(`ask: ${cmd}`, () => assert.equal(check(cmd, ctx).decision, 'ask'));
}
for (const [cmd, ctx] of ALLOW) {
  test(`allow: ${cmd}`, () => assert.equal(check(cmd, ctx).decision, 'allow', check(cmd, ctx).reason));
}

test('the most severe verdict wins across segments', () => {
  assert.equal(check('git rebase main && git push --force', onTicket).decision, 'deny');
});
