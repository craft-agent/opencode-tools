import { describe, expect, test } from "bun:test"
import type { FileDiffInfo } from "@opencode/client"
import { failure } from "../service/read.testing"
import { fakeSession, type FakeService } from "../service/testing"
import { MAX_CHANGED_FILES, MAX_FILE_NAME, MAX_PATCH_CHARACTERS } from "./read.schemas"
import { boundRun, readRun, requestsTo, runSetup } from "./read.testing"

const ID = "ses_run"

const changes = (ctx: Parameters<typeof readRun>[1], extra: Record<string, unknown> = {}) =>
  readRun({ method: "changes", session: ID, ...extra }, ctx)

function changed(service: FakeService, ...files: Partial<FileDiffInfo>[]) {
  fakeSession(service, ID).diff.push(
    ...files.map((file, index): FileDiffInfo => ({
      file: `src/file${index}.ts`,
      patch: `@@ -1 +1 @@\n-old${index}\n+new${index}`,
      additions: 1,
      deletions: 1,
      status: "modified",
      ...file,
    })),
  )
}

describe("changes: the files", () => {
  test("lists each file with its status and its counts, and no patch, asking for no context", async () => {
    const { service, ctx } = runSetup()
    boundRun(service, ID)
    changed(service, { file: "a.ts", status: "added", additions: 4, deletions: 0 }, { file: "b.ts", status: "deleted" })
    expect(await changes(ctx)).toEqual({
      method: "changes",
      service_started: false,
      files: [
        { file: "a.ts", status: "added", additions: 4, deletions: 0 },
        { file: "b.ts", status: "deleted", additions: 1, deletions: 1 },
      ],
      total: 2,
      truncated: false,
    })
    expect(requestsTo(service, `/session/${ID}/diff`).map((request) => request.query)).toEqual([{ context: "0" }])
  })

  test("is empty for a turn that changed nothing", async () => {
    const { service, ctx } = runSetup()
    boundRun(service, ID)
    expect(await changes(ctx, { patches: true })).toMatchObject({ files: [], total: 0, truncated: false })
  })

  test("gives each file's patch when asked, with three lines of context", async () => {
    const { service, ctx } = runSetup()
    boundRun(service, ID)
    changed(service, {}, {})
    const result = await changes(ctx, { patches: true })
    expect(result.files!.map((file) => file.patch)).toEqual(["@@ -1 +1 @@\n-old0\n+new0", "@@ -1 +1 @@\n-old1\n+new1"])
    expect(requestsTo(service, `/session/${ID}/diff`).map((request) => request.query)).toEqual([{ context: "3" }])
  })

  test("asks for no context when patches is false, and gives none", async () => {
    const { service, ctx } = runSetup()
    boundRun(service, ID)
    changed(service, {})
    expect((await changes(ctx, { patches: false })).files![0]).not.toHaveProperty("patch")
    expect(requestsTo(service, `/session/${ID}/diff`)[0]!.query).toEqual({ context: "0" })
  })

  test("keeps the first MAX_CHANGED_FILES and counts them all", async () => {
    const { service, ctx } = runSetup()
    boundRun(service, ID)
    changed(service, ...Array.from({ length: MAX_CHANGED_FILES + 5 }, () => ({})))
    const result = await changes(ctx)
    expect(result.files).toHaveLength(MAX_CHANGED_FILES)
    expect(result).toMatchObject({ total: MAX_CHANGED_FILES + 5, truncated: true })
  })

  test("takes a file's name as data: one clean line, cut, never a path", async () => {
    const { service, ctx } = runSetup()
    boundRun(service, ID)
    changed(service, { file: `../etc/pass\u0000wd\n${"d/".repeat(MAX_FILE_NAME)}` })
    const [file] = (await changes(ctx)).files!
    expect(file!.file).toStartWith("../etc/pass wd d/d/")
    expect([...file!.file]).toHaveLength(MAX_FILE_NAME)
    expect(file!.file).toEndWith("…")
  })
})

describe("changes: the budget for patches", () => {
  const patchOf = (length: number) => "p".repeat(length)

  test("lasts for the whole result: what fits is given, the rest is left out and says so", async () => {
    const { service, ctx } = runSetup()
    boundRun(service, ID)
    changed(service, { patch: patchOf(25_000) }, { patch: patchOf(25_000) }, { patch: patchOf(25_000) })
    const result = await changes(ctx, { patches: true })
    expect(result.files!.map((file) => file.patch?.length)).toEqual([25_000, 25_000, undefined])
    expect(result.files![2]).toMatchObject({ patch_omitted: true })
    expect(result.files![0]).not.toHaveProperty("patch_omitted")
    expect(result.truncated).toBe(true)
  })

  test("is MAX_PATCH_CHARACTERS exactly", async () => {
    const { service, ctx } = runSetup()
    boundRun(service, ID)
    const half = MAX_PATCH_CHARACTERS / 2
    changed(service, { patch: patchOf(half) }, { patch: patchOf(half) }, { patch: "x" })
    const result = await changes(ctx, { patches: true })
    expect(result.files!.map((file) => file.patch !== undefined)).toEqual([true, true, false])
    expect(result.files![2]).toMatchObject({ patch_omitted: true })
  })

  test("leaves out every patch after the first that does not fit, so what is given is a prefix", async () => {
    const { service, ctx } = runSetup()
    boundRun(service, ID)
    changed(service, { patch: patchOf(MAX_PATCH_CHARACTERS + 1) }, { patch: "small" })
    const result = await changes(ctx, { patches: true })
    expect(result.files!.map((file) => file.patch_omitted)).toEqual([true, true])
    expect(result.files![1]).not.toHaveProperty("patch")
  })

  test("is not truncated, and omits nothing, when every patch fits", async () => {
    const { service, ctx } = runSetup()
    boundRun(service, ID)
    changed(service, { patch: patchOf(MAX_PATCH_CHARACTERS) })
    const result = await changes(ctx, { patches: true })
    expect(result.truncated).toBe(false)
    expect(result.files![0]).not.toHaveProperty("patch_omitted")
  })

  test("does not count the patches when none are asked for", async () => {
    const { service, ctx } = runSetup()
    boundRun(service, ID)
    changed(service, { patch: patchOf(MAX_PATCH_CHARACTERS + 1) })
    const result = await changes(ctx)
    expect(result.truncated).toBe(false)
    expect(result.files![0]).not.toHaveProperty("patch_omitted")
  })

  test("is data: a patch keeps its lines and loses what moves or reorders text", async () => {
    const { service, ctx } = runSetup()
    boundRun(service, ID)
    changed(service, { patch: "@@\r\n-a\u0000b\n+c\u202ed" })
    expect((await changes(ctx, { patches: true })).files![0]!.patch).toBe("@@\n-a b\n+c d")
  })
})

describe("changes: a reply that is not what the service sends", () => {
  test("is upstream_error", async () => {
    const { service, ctx } = runSetup()
    boundRun(service, ID)
    const body = { data: [{ file: "a.ts", patch: "p", additions: 1, deletions: 0, status: "renamed" }] }
    service.failNext(
      /\/diff$/,
      new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }),
    )
    expect((await failure(changes(ctx))).code).toBe("upstream_error")
  })
})
