import { describe, expect, test } from "bun:test"
import { POLICIES, effectOf, sessionRulesOf, type Example } from "./ruleset.testing"

const READ_ONLY: readonly Example[] = [
  ["edit", "src/a.ts", "deny"],
  ["edit", "/tmp/x", "deny"],
  ["shell", "git commit -m x", "deny"],
  ["shell", "git add .", "deny"],
  ["shell", "git checkout main", "deny"],
  ["shell", "git stash", "deny"],
  ["shell", "git merge main", "deny"],
  ["shell", "git merge", "deny"],
  ["shell", "git merge --no-ff main", "deny"],
  ["shell", "git --no-pager merge main", "deny"],
  ["shell", "git branch -D old", "deny"],
  ["shell", "git branch --delete old", "deny"],
  ["shell", "git tag -a v1", "deny"],
  ["shell", "git worktree add ../x", "deny"],
  ["shell", "git branch --show-current", "allow"],
  ["shell", "git tag --list", "allow"],
  ["shell", "git show HEAD", "allow"],
  ["shell", "git fetch", "allow"],
  ["shell", "git merge-base main HEAD", "allow"],
  ["shell", "pnpm test", "allow"],
  ["shell", "npx cowsay hi", "allow"],
  ["shell", "pnpm exec vitest", "allow"],
  ["read", "src/a.ts", "allow"],
]

const WRITE: readonly Example[] = [
  ["edit", "src/a.ts", "allow"],
  ["edit", "/abs/elsewhere/a.ts", "deny"],
  ["edit", "../other/a.ts", "deny"],
  ["shell", "git commit -m x", "allow"],
  ["shell", "git add .", "allow"],
  ["shell", "git merge main", "allow"],
  ["shell", "git rebase main", "ask"],
  ["shell", "git commit --amend", "ask"],
  ["shell", "git checkout main", "ask"],
  ["shell", "git switch main", "ask"],
  ["shell", "git reset HEAD~1", "ask"],
  ["shell", "git branch -m new", "ask"],
  ["shell", "git filter-branch --all", "ask"],
  ["shell", "npx cowsay hi", "ask"],
  ["shell", "pnpm dlx x", "ask"],
  ["shell", "uvx ruff", "ask"],
  // The deny of what every run is denied comes after the ask.
  ["shell", "git reset --hard", "deny"],
  ["shell", "git checkout --force main", "deny"],
  ["shell", "pnpm test", "allow"],
  // A runner is looked for as a word of its own: `npm exec` asks, `pnpm exec` runs what the project installed.
  ["shell", "npm exec cowsay hi", "ask"],
  ["shell", "FOO=1 npm exec cowsay hi", "ask"],
  ["shell", "bash -c 'npx cowsay hi'", "ask"],
  ["shell", "pnpm exec vitest", "allow"],
]

describe("a read-only run", () => {
  const rules = sessionRulesOf({ policy: "read-only" })

  test.each(READ_ONLY)("%s %p is %s", (action, resource, effect) => {
    expect(effectOf(rules, action, resource)).toBe(effect)
  })
})

describe("a write run", () => {
  const rules = sessionRulesOf({ policy: "write" })

  test.each(WRITE)("%s %p is %s", (action, resource, effect) => {
    expect(effectOf(rules, action, resource)).toBe(effect)
  })
})

describe("outside the worktree", () => {
  const scratch = ["/var/scratch", "/private/var/scratch"]
  const readRoots = ["/srv/docs"]

  test("a directory nobody named asks, for both policies", () => {
    for (const policy of POLICIES) {
      const rules = sessionRulesOf({ policy, scratch, readRoots })
      expect(effectOf(rules, "external_directory", "/somewhere/*")).toBe("ask")
    }
  })

  test("a scratch directory and what is deeper in it are allowed, for both policies", () => {
    for (const policy of POLICIES) {
      const rules = sessionRulesOf({ policy, scratch, readRoots })
      for (const directory of scratch) {
        expect(effectOf(rules, "external_directory", `${directory}/*`)).toBe("allow")
        expect(effectOf(rules, "external_directory", `${directory}/out/deep/*`)).toBe("allow")
      }
      expect(effectOf(rules, "external_directory", "/var/scratcher/*")).toBe("ask")
    }
  })

  test("a read root is allowed for a read-only run", () => {
    const rules = sessionRulesOf({ policy: "read-only", scratch, readRoots })
    expect(effectOf(rules, "external_directory", "/srv/docs/*")).toBe("allow")
    expect(effectOf(rules, "external_directory", "/srv/docs/a/*")).toBe("allow")
  })

  test("a read root asks for a write run", () => {
    const rules = sessionRulesOf({ policy: "write", scratch, readRoots })
    expect(effectOf(rules, "external_directory", "/srv/docs/*")).toBe("ask")
  })
})
