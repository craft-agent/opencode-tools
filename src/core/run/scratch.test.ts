import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { scratchDirectories, withResolved } from "./scratch"

describe("scratchDirectories", () => {
  test("the reported directory, then the service's output directories under XDG_DATA_HOME", () => {
    expect(scratchDirectories({ XDG_DATA_HOME: "/data", HOME: "/home/x" }, "/tmp/oc")).toEqual([
      "/tmp/oc",
      "/data/opencode/shell",
      "/data/opencode/tool-output",
    ])
  })

  test("under HOME when XDG_DATA_HOME is missing, empty or not absolute", () => {
    for (const XDG_DATA_HOME of [undefined, "", "relative/data"]) {
      expect(scratchDirectories({ XDG_DATA_HOME, HOME: "/home/x" }, "/tmp/oc")).toEqual([
        "/tmp/oc",
        "/home/x/.local/share/opencode/shell",
        "/home/x/.local/share/opencode/tool-output",
      ])
    }
  })

  test("only the reported directory with neither variable", () => {
    expect(scratchDirectories({}, "/tmp/oc")).toEqual(["/tmp/oc"])
    expect(scratchDirectories({ HOME: "" }, "/tmp/oc")).toEqual(["/tmp/oc"])
  })

  test("only the output directories when the service reports no scratch directory", () => {
    expect(scratchDirectories({ HOME: "/home/x" }, undefined)).toEqual([
      "/home/x/.local/share/opencode/shell",
      "/home/x/.local/share/opencode/tool-output",
    ])
    expect(scratchDirectories({}, undefined)).toEqual([])
  })
})

describe("withResolved", () => {
  test("keeps a directory that does not exist as given", async () => {
    expect(await withResolved(["/no/such/directory"])).toEqual(["/no/such/directory"])
  })

  test("adds the resolved spelling where it differs, and none where it does not", async () => {
    const tmp = tmpdir()
    const resolved = realpathSync(tmp)
    expect(await withResolved([tmp])).toEqual(resolved === tmp ? [tmp] : [tmp, resolved])
  })

  test("follows a link, keeps the order and drops a repeat", async () => {
    const root = mkdtempSync(join(tmpdir(), "scratch-"))
    try {
      const real = join(root, "real")
      const link = join(root, "link")
      mkdirSync(real)
      symlinkSync(real, link)
      const target = realpathSync(real)
      // Where the temporary directory is itself behind a link (macOS), `real` and its resolved spelling differ.
      const expected = [...new Set([link, target, real, "/no/such/directory"])]
      expect(await withResolved([link, real, link, "/no/such/directory"])).toEqual(expected)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("is empty for no directories", async () => {
    expect(await withResolved([])).toEqual([])
  })
})
