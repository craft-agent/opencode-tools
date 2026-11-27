import { describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { exec, startDetached } from "./exec"

const ENV = { PATH: process.env.PATH ?? "" }
const POLL_MS = 20
const WAIT_MS = 10_000

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function readWhenWritten(file: string): Promise<string> {
  const deadline = Date.now() + WAIT_MS
  while (Date.now() < deadline) {
    // The child may have created the file and not written all of it yet.
    if (existsSync(file) && readFileSync(file, "utf8").endsWith("\n")) return readFileSync(file, "utf8")
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
  }
  throw new Error(`${file} was not written`)
}

describe("startDetached", () => {
  test("resolves while the child is still running", async () => {
    const { pid } = await startDetached(["node", "-e", "setTimeout(() => {}, 10000)"], { env: ENV })
    try {
      expect(pid).toBeGreaterThan(0)
      expect(isAlive(pid!)).toBe(true)
    } finally {
      if (pid !== undefined) process.kill(pid, "SIGKILL")
    }
  })

  test("gives the child exactly the given environment", async () => {
    const dir = mkdtempSync(join(tmpdir(), "exec-start-"))
    const file = join(dir, "env.json")
    process.env.EXEC_START_TEST_LEAK = "leaked"
    let started: { pid: number | undefined } | undefined
    try {
      const script = `require("fs").writeFileSync(${JSON.stringify(file)}, JSON.stringify(process.env) + "\\n"); setTimeout(() => {}, 10000)`
      started = await startDetached(["node", "-e", script], { env: { ...ENV, ONLY: "this" } })
      const seen = JSON.parse(await readWhenWritten(file)) as Record<string, string>
      expect(seen.PATH).toBe(ENV.PATH)
      expect(seen.ONLY).toBe("this")
      expect(seen.EXEC_START_TEST_LEAK).toBeUndefined()
    } finally {
      delete process.env.EXEC_START_TEST_LEAK
      if (started?.pid !== undefined) process.kill(started.pid, "SIGKILL")
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("a parent that started a program ends on its own while the program keeps running", async () => {
    const dir = mkdtempSync(join(tmpdir(), "exec-parent-"))
    const script = join(dir, "parent.mjs")
    const execFile = fileURLToPath(new URL("./exec.ts", import.meta.url))
    // No process.exit: the parent ends only if nothing of the child's keeps it alive.
    writeFileSync(
      script,
      `import { startDetached } from ${JSON.stringify(execFile)}
const { pid } = await startDetached(["node", "-e", "setTimeout(() => {}, 30000)"], { env: { PATH: process.env.PATH ?? "" } })
console.log(JSON.stringify({ pid }))
`,
    )
    let pid: number | undefined
    try {
      const result = await exec([process.execPath, script], { env: ENV, timeoutMs: 5000 })
      expect(result.stderr).toBe("")
      expect(result.timedOut).toBeUndefined()
      expect(result.code).toBe(0)
      pid = (JSON.parse(result.stdout) as { pid: number }).pid
      expect(isAlive(pid)).toBe(true)
    } finally {
      if (pid !== undefined && isAlive(pid)) process.kill(pid, "SIGKILL")
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("rejects with ENOENT for a program that does not exist", async () => {
    const error = await startDetached(["definitely-not-a-program"], { env: ENV }).catch((e: unknown) => e)
    expect((error as NodeJS.ErrnoException).code).toBe("ENOENT")
  })

  test("rejects when there is no program to start", async () => {
    await expect(startDetached([], { env: ENV })).rejects.toThrow("needs a program")
  })
})
