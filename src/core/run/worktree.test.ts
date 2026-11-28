import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, symlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { callOf, checkout, cleanup, git, runtimeWith, tempDir } from "./git.testing"
import { readWorktree, refuseProtected } from "./worktree"

afterEach(cleanup)

const worktreeOf = (directory: string) => ({ directory, repository: join(directory, ".git"), branch: "main" })

const read = (directory: string, runtime = runtimeWith()) => {
  const { ctx, deadline } = callOf(runtime)
  return readWorktree(directory, ctx, deadline)
}

describe("readWorktree", () => {
  test("reads a checkout", async () => {
    const directory = await checkout()
    expect(await read(directory)).toEqual(worktreeOf(directory))
  })

  test("reads a linked worktree, which shares the checkout's repository", async () => {
    const main = await checkout()
    const linked = join(await tempDir(), "linked")
    git(main, "worktree", "add", "-b", "side", linked)
    const worktree = await read(linked)
    expect(worktree.branch).toBe("side")
    expect(worktree.directory).toBe(linked)
    expect(worktree.repository).toBe((await read(main)).repository)
  })

  test("a detached HEAD has no branch", async () => {
    const directory = await checkout()
    git(directory, "checkout", "--detach")
    expect((await read(directory)).branch).toBeNull()
  })

  test("refuses a subdirectory, naming the top level", async () => {
    const directory = await checkout()
    const sub = join(directory, "sub")
    await mkdir(sub)
    await expect(read(sub)).rejects.toMatchObject({
      code: "invalid_argument",
      message: expect.stringContaining(`the top level is "${directory}"`),
    })
  })

  test("refuses a directory outside any repository", async () => {
    const directory = await tempDir()
    await expect(read(directory)).rejects.toMatchObject({
      code: "invalid_argument",
      message: expect.stringContaining("is not in a Git worktree"),
    })
  })

  test("refuses a directory that does not exist, and a file", async () => {
    const directory = await tempDir()
    await expect(read(join(directory, "missing"))).rejects.toMatchObject({
      code: "not_found",
      message: expect.stringContaining("does not exist"),
    })
    const file = join(directory, "file")
    await writeFile(file, "x")
    await expect(read(file)).rejects.toMatchObject({
      code: "not_found",
      message: expect.stringContaining("is not a directory"),
    })
  })

  test("accepts a path through a symlink, and returns real paths", async () => {
    const directory = await checkout()
    const link = join(await tempDir(), "link")
    await symlink(directory, link)
    expect(await read(link)).toEqual(worktreeOf(directory))
  })

  test("refuses a bare repository", async () => {
    const directory = await tempDir()
    git(directory, "init", "--bare", "-b", "main")
    await expect(read(directory)).rejects.toMatchObject({
      code: "invalid_argument",
      message: expect.stringContaining("is not in a Git worktree"),
    })
  })

  test("says when git is missing", async () => {
    const directory = await checkout()
    const empty = await tempDir()
    await expect(read(directory, runtimeWith({ PATH: empty }))).rejects.toMatchObject({
      code: "upstream_error",
      message: expect.stringContaining("git is not installed"),
    })
  })
})

describe("refuseProtected", () => {
  test("refuses the directory itself and a parent", async () => {
    const parent = await tempDir()
    const directory = join(parent, "work")
    await mkdir(directory)
    for (const protectedDir of [directory, parent]) {
      await expect(refuseProtected(worktreeOf(directory), [protectedDir])).rejects.toMatchObject({
        code: "forbidden",
        message: expect.stringContaining("protected directory"),
      })
    }
  })

  test("allows a sibling and an empty list", async () => {
    const parent = await tempDir()
    const directory = join(parent, "work")
    const sibling = join(parent, "work-two")
    await mkdir(directory)
    await mkdir(sibling)
    await refuseProtected(worktreeOf(directory), [sibling])
    await refuseProtected(worktreeOf(directory), [])
  })
})
