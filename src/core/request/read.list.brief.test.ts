import { describe, expect, test } from "bun:test"
import { fakeAsk, fakeChild, fakeQuestion, fakeToolAsk } from "../service/testing"
import { MAX_ENTRY_CHARS, MAX_LONG_LINE, MAX_RESOURCES_LISTED } from "./read.schemas"
import { getRequest, listRequests, listed } from "./read.testing"
import { RUN, requestSetup } from "./request.testing"
import { MAX_APPROVAL_TEXT } from "./text"

const keysOf = (entry: object) => Object.keys(entry).sort()

/** The one entry `list` gives for a shell call whose command is `length` characters (not over what an approval shows) and whose resources take most of the entry. */
async function entryOfSize(length: number) {
  const { service, ctx } = requestSetup()
  fakeToolAsk(service, RUN, {
    tool: "shell",
    input: { command: "a".repeat(length) },
    action: "shell",
    resources: Array.from({ length: 8 }, () => "r".repeat(MAX_LONG_LINE)),
  })
  const [entry] = await listed(ctx)
  return entry!
}

describe("list: an entry that takes too much", () => {
  test("is listed whole at MAX_ENTRY_CHARS characters of JSON, and in brief one character over", async () => {
    const probe = JSON.stringify(await entryOfSize(1)).length
    const fits = 1 + MAX_ENTRY_CHARS - probe
    const whole = await entryOfSize(fits)
    expect(JSON.stringify(whole)).toHaveLength(MAX_ENTRY_CHARS)
    expect(whole).not.toHaveProperty("brief")
    expect(whole.text).toHaveLength(fits)

    const brief = await entryOfSize(fits + 1)
    expect(fits).toBeLessThan(MAX_APPROVAL_TEXT)
    expect(brief.brief).toBe(true)
    expect(keysOf(brief)).toEqual(["action", "agent", "brief", "id", "kind", "session", "step", "tool"])
    expect(brief).toMatchObject({ kind: "permission", session: RUN, agent: "plan", action: "shell", tool: "shell" })
  })

  test("keeps who asked and why it can only be rejected, for a permission request, and nothing of its text", async () => {
    const { service, ctx } = requestSetup()
    const child = fakeChild(service, RUN)
    child.agent = "scout"
    const manyFiles = Array.from({ length: 20 }, (_, index) => ({
      file: `${index}${"f".repeat(MAX_LONG_LINE)}`,
      patch: "p",
      status: "added" as const,
      additions: 1,
      deletions: 0,
    }))
    const asked = fakeToolAsk(service, child.id, {
      tool: "shell",
      input: { command: "a".repeat(MAX_ENTRY_CHARS) },
      action: "shell",
      resources: ["a"],
      metadata: { files: manyFiles },
    })
    const [entry] = await listed(ctx)
    expect(entry).toEqual({
      kind: "permission",
      id: asked.id,
      session: child.id,
      subagent: true,
      agent: "scout",
      action: "shell",
      tool: "shell",
      step: asked.source!.messageID,
      reject_only: expect.stringContaining("over 2000 characters"),
      brief: true,
    })
  })

  test("keeps the title and why it can only be declined, for a question, and none of its fields", async () => {
    const { service, ctx } = requestSetup()
    const fields = Array.from({ length: 20 }, (_, index) => ({
      key: `k${index}`,
      type: "string" as const,
      description: "d".repeat(MAX_LONG_LINE),
    }))
    const form = fakeQuestion(service, RUN, "Visit and answer", [
      { key: "l", type: "external", url: "https://example.test/go" },
      ...fields,
    ])
    const [entry] = await listed(ctx)
    expect(entry).toEqual({
      kind: "question",
      id: form.id,
      session: RUN,
      agent: "plan",
      title: "Visit and answer",
      decline_only: "It has a link to visit, which no tool has visited.",
      brief: true,
    })
  })

  test("is listed in brief where the list used to hold nothing: fifty long resources a request", async () => {
    const { service, ctx } = requestSetup()
    const resources = Array.from(
      { length: MAX_RESOURCES_LISTED },
      (_, index) => `echo ${index} ${"r".repeat(MAX_LONG_LINE)}`,
    )
    const asked = [1, 2, 3].map(() => fakeAsk(service, RUN, { action: "shell", resources }))
    const result = await listRequests(ctx)
    expect(result.requests!.map((entry) => entry.id)).toEqual(asked.map((request) => request.id))
    expect(result.requests!.every((entry) => entry.brief === true && !("resources" in entry))).toBe(true)
    expect(result).toMatchObject({ total: 3, truncated: false })
  })

  test("is read whole by get, which is never brief", async () => {
    const { service, ctx } = requestSetup()
    const resources = Array.from(
      { length: MAX_RESOURCES_LISTED },
      (_, index) => `echo ${index} ${"r".repeat(MAX_LONG_LINE)}`,
    )
    const asked = fakeAsk(service, RUN, { action: "shell", resources })
    const request = await getRequest(ctx, asked.id)
    expect(request).not.toHaveProperty("brief")
    expect(request.resources).toHaveLength(MAX_RESOURCES_LISTED)
    expect(request.text).toStartWith("echo 0 r")
    expect(JSON.stringify(request).length).toBeGreaterThan(MAX_ENTRY_CHARS)
  })

  test("leaves the entries under the limit whole, beside a brief one", async () => {
    const { service, ctx } = requestSetup()
    fakeAsk(service, RUN, { action: "shell", resources: Array.from({ length: 12 }, () => "a".repeat(MAX_LONG_LINE)) })
    fakeAsk(service, RUN, { action: "shell", resources: ["echo hi"] })
    const [big, small] = await listed(ctx)
    expect(big).toMatchObject({ brief: true })
    expect(small).toMatchObject({ text: "echo hi", resources: ["echo hi"] })
    expect(small).not.toHaveProperty("brief")
  })
})
