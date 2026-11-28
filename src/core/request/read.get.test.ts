import { describe, expect, test } from "bun:test"
import { MAX_PATCH_CHARACTERS, MAX_RESULT } from "../run/read.schemas"
import { boundRun } from "../run/read.testing"
import { SESSION_NOT_FOUND } from "../service/errors"
import { failure } from "../service/read.testing"
import { fakeAsk, fakeChild, fakeQuestions, fakeSession, fakeToolAsk } from "../service/testing"
import { REQUEST_NOT_PENDING } from "./pending"
import { getRequest, listed, readRequests } from "./read.testing"
import { RUN, requestSetup } from "./request.testing"

const file = (name: string, patch: string, status: "added" | "deleted" | "modified" = "modified") => ({
  file: name,
  patch,
  status,
  additions: 1,
  deletions: 1,
})

describe("get: one request", () => {
  test("is the request list gave, with its patches", async () => {
    const { service, ctx } = requestSetup()
    const files = [file("a.ts", "@@ -1 +1 @@\n-a\n+b"), file("b.ts", "@@ -0,0 +1 @@\n+c", "added")]
    const asked = fakeToolAsk(service, RUN, {
      tool: "edit",
      input: { file: "a.ts" },
      action: "edit",
      resources: ["a.ts", "b.ts"],
      metadata: { files },
    })
    const result = await readRequests({ method: "get", session: RUN, request: asked.id }, ctx)
    expect(result).toMatchObject({ method: "get", service_started: false, session: RUN })
    expect(result).not.toHaveProperty("requests")
    const [listing] = await listed(ctx)
    expect(result.request).toEqual({
      ...listing,
      files: [
        { file: "a.ts", status: "modified", additions: 1, deletions: 1, patch: "@@ -1 +1 @@\n-a\n+b" },
        { file: "b.ts", status: "added", additions: 1, deletions: 1, patch: "@@ -0,0 +1 @@\n+c" },
      ],
    })
  })

  test("cleans a patch as `changes` does: its lines stay, what moves or reorders text goes", async () => {
    const { service, ctx } = requestSetup()
    const asked = fakeAsk(service, RUN, {
      action: "edit",
      resources: ["a"],
      metadata: { files: [file("a", "@@\r\n-a\u0000b\n+c\u202ed")] },
    })
    expect((await getRequest(ctx, asked.id)).files![0]!.patch).toBe("@@\n-a b\n+c d")
  })

  test("shares one budget of MAX_PATCH_CHARACTERS among the patches: the first that does not fit goes, and every one after", async () => {
    const { service, ctx } = requestSetup()
    const half = MAX_PATCH_CHARACTERS / 2
    const files = [file("a", "p".repeat(half)), file("b", "p".repeat(half)), file("c", "x"), file("d", "")]
    const asked = fakeAsk(service, RUN, { action: "edit", resources: ["a"], metadata: { files } })
    const shown = (await getRequest(ctx, asked.id)).files!
    expect(shown.map((entry) => entry.patch?.length)).toEqual([half, half, undefined, undefined])
    expect(shown.map((entry) => entry.patch_omitted)).toEqual([undefined, undefined, true, true])
  })

  test("is not given a patch budget by list, which lists no patch", async () => {
    const { service, ctx } = requestSetup()
    fakeAsk(service, RUN, { action: "edit", resources: ["a"], metadata: { files: [file("a", "p")] } })
    expect((await listed(ctx))[0]!.files![0]).not.toHaveProperty("patch")
  })

  test("keeps a text up to MAX_RESULT code points where list keeps MAX_LISTED_TEXT, saying when it cut", async () => {
    const { service, ctx } = requestSetup()
    const asked = fakeToolAsk(service, RUN, {
      tool: "write",
      input: { content: "c".repeat(MAX_RESULT + 50) },
      action: "edit",
      resources: ["a"],
    })
    const request = await getRequest(ctx, asked.id)
    expect([...request.text!]).toHaveLength(MAX_RESULT)
    expect(request).toMatchObject({ text_truncated: true, reject_only: expect.stringContaining("over 2000") })

    const whole = fakeAsk(service, RUN, { action: "shell", resources: ["a".repeat(5000)] })
    const read = await getRequest(ctx, whole.id)
    expect(read.text).toHaveLength(5000)
    expect(read).not.toHaveProperty("text_truncated")
  })

  test("is a question with its fields", async () => {
    const { service, ctx } = requestSetup()
    const form = fakeQuestions(service, RUN, [{ header: "Branch", question: "Which?", options: ["main"] }])
    expect(await getRequest(ctx, form.id)).toEqual((await listed(ctx))[0]!)
  })

  test("is a subagent's request, found by its id in the subagent's session", async () => {
    const { service, ctx } = requestSetup()
    const child = fakeChild(service, RUN)
    const asked = fakeToolAsk(service, child.id, {
      tool: "shell",
      input: { command: "echo hi" },
      action: "shell",
      resources: ["echo hi"],
    })
    expect(await getRequest(ctx, asked.id)).toMatchObject({ session: child.id, subagent: true, text: "echo hi" })
  })
})

describe("get: a request that is not pending", () => {
  async function refused(promise: Promise<unknown>) {
    const error = await failure(promise)
    expect([error.code, error.message]).toEqual(["not_found", REQUEST_NOT_PENDING])
  }

  test("is not found in the same words, whether it never existed, was answered or is another run's", async () => {
    const { service, ctx } = requestSetup()
    const answered = fakeAsk(service, RUN, { action: "shell", resources: ["echo hi"] })
    fakeSession(service, RUN).pending = []
    boundRun(service, "ses_other", { active: true })
    const other = fakeAsk(service, "ses_other", { action: "shell", resources: ["echo ho"] })
    boundRun(service, "ses_theirs", { caller: "someone-else", active: true })
    const theirs = fakeAsk(service, "ses_theirs", { action: "shell", resources: ["echo ha"] })
    const person = boundRun(service, "ses_person", { active: true })
    person.metadata = undefined
    const persons = fakeAsk(service, "ses_person", { action: "shell", resources: ["echo hu"] })
    for (const request of ["never_was", answered.id, other.id, theirs.id, persons.id]) {
      await refused(readRequests({ method: "get", session: RUN, request }, ctx))
    }
  })

  test("is not found for a request of the run's idle session once it is answered", async () => {
    const { service, ctx } = requestSetup({}, { active: false })
    const asked = fakeAsk(service, RUN, { action: "shell", resources: ["echo hi"] })
    expect((await getRequest(ctx, asked.id)).id).toBe(asked.id)
    fakeSession(service, RUN).pending = []
    await refused(getRequest(ctx, asked.id))
  })
})

describe("get: the session", () => {
  test("is the caller's own run: another caller's, a person's own, a subagent's and a missing one are not found alike", async () => {
    const { service, ctx } = requestSetup()
    boundRun(service, "ses_theirs", { caller: "someone-else" })
    boundRun(service, "ses_person").metadata = undefined
    const child = fakeChild(service, RUN)
    const asked = fakeAsk(service, child.id, { action: "shell", resources: ["echo hi"] })
    for (const session of ["ses_theirs", "ses_person", child.id, "ses_none"]) {
      const error = await failure(readRequests({ method: "get", session, request: asked.id }, ctx))
      expect([error.code, error.message]).toEqual(["not_found", SESSION_NOT_FOUND])
    }
  })
})
