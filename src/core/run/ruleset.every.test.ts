import { describe, expect, test } from "bun:test"
import { POLICIES, effectOf, sessionRulesOf, type Example } from "./ruleset.testing"

const DENIED: readonly Example[] = [
  ["shell", "git push", "deny"],
  ["shell", "git push origin main", "deny"],
  ["shell", "FOO=1 git push", "deny"],
  ["shell", "bash -c 'git push'", "deny"],
  ["shell", "git --no-pager push", "deny"],
  ["shell", "git -P push", "deny"],
  ["shell", "git send-pack /x", "deny"],
  ["shell", "git -C /x status", "deny"],
  ["shell", "git --git-dir=/x log", "deny"],
  ["shell", "git --work-tree=/x status", "deny"],
  ["shell", "git -c a=b log", "deny"],
  ["shell", "git config user.name x", "deny"],
  ["shell", "GIT_CONFIG_GLOBAL=/x git log", "deny"],
  ["shell", "git reset --hard HEAD~1", "deny"],
  ["shell", "git clean -fd", "deny"],
  ["shell", "git checkout --force main", "deny"],
  ["shell", "git switch -f main", "deny"],
  ["shell", "git stash drop", "deny"],
  ["shell", "git branch -D old", "deny"],
  ["shell", "npm publish", "deny"],
  ["shell", "yarn npm publish", "deny"],
  ["shell", "cargo publish --dry-run", "deny"],
  ["shell", "cat .env", "deny"],
  ["shell", "cat config/.env", "deny"],
  ["shell", "cat prod.env", "deny"],
  ["shell", "source .env.local", "deny"],
  ["read", ".env", "deny"],
  ["read", "config/.env.production", "deny"],
  ["read", "keys/server.pem", "deny"],
  ["read", "/home/x/.ssh/id_ed25519", "deny"],
  ["edit", ".env", "deny"],
  ["edit", ".env.example", "deny"],
  ["edit", ".git/hooks/pre-commit", "deny"],
  ["edit", ".git/config", "deny"],
  ["edit", "sub/.git/config", "deny"],
  ["edit", "/home/x/.gitconfig", "deny"],
  ["mine_opencode_run_start", "*", "deny"],
  ["a-b_opencode_service_read", "*", "deny"],
  ["x_opencode_history_read", "*", "deny"],
  ["opencode_session_move", "*", "deny"],
  ["opencode_session_move", "/anywhere", "deny"],
]

const NOT_DENIED: readonly Example[] = [
  ["shell", "git status --short", "allow"],
  ["shell", "git log --oneline -5", "allow"],
  ["shell", "git --no-pager diff", "allow"],
  // A redirect is no rule's business: the rules match the command's text.
  ["shell", "git diff > /tmp/x", "allow"],
  ["shell", "git merge-base main HEAD", "allow"],
  ["shell", "git log --grep push", "allow"],
  ["shell", "git --no-pager log --grep push", "allow"],
  ["shell", 'node -e "console.log(process.env.HOME)"', "allow"],
  ["shell", "ls -la", "allow"],
  ["shell", "pnpm test", "allow"],
  ["read", "src/a.ts", "allow"],
  ["read", ".env.example", "allow"],
  ["read", "config/.env.sample", "allow"],
  ["read", "deploy/.env.template", "allow"],
  ["opencode_worktree_create", "*", "allow"],
  ["other_tool_read", "*", "allow"],
]

/** The rules match text, so these forms get past them; they are asserted as they are, and the operating note says the rest. */
const KNOWN_GAPS: readonly Example[] = [
  // Extra spaces are not the text the pattern spells.
  ["shell", "git   push", "allow"],
  // A quote inside a word hides the subcommand from the pattern.
  ["shell", 'git "push"', "allow"],
]

describe.each(POLICIES)("what every run is denied: %s", (policy) => {
  const rules = sessionRulesOf({ policy })

  test.each(DENIED)("%s %p is %s", (action, resource, effect) => {
    expect(effectOf(rules, action, resource)).toBe(effect)
  })

  test.each(NOT_DENIED)("%s %p is %s", (action, resource, effect) => {
    expect(effectOf(rules, action, resource)).toBe(effect)
  })

  // A write run is asked about it: see ruleset.policy.test.ts.
  test("pnpm exec vitest is not denied", () => {
    expect(effectOf(rules, "shell", "pnpm exec vitest")).not.toBe("deny")
  })

  test.each(KNOWN_GAPS)("known gap: %s %p is %s", (action, resource, effect) => {
    expect(effectOf(rules, action, resource)).toBe(effect)
  })
})
