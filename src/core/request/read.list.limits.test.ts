import { describe, expect, test } from "bun:test"
import { MAX_LIST_CHARS } from "../service/schemas"
import { fakeAsk, fakeQuestion, fakeSession, fakeToolAsk } from "../service/testing"
import {
  MAX_FIELDS_LISTED,
  MAX_FILES_LISTED,
  MAX_LISTED_TEXT,
  MAX_LONG_LINE,
  MAX_OPTIONS_LISTED,
  MAX_REQUESTS_LISTED,
  MAX_RESOURCES_LISTED,
  MAX_SHORT_LINE,
} from "./read.schemas"
import { listRequests, listed } from "./read.testing"
import { RUN, requestSetup } from "./request.testing"
import { MAX_APPROVAL_TEXT } from "./text"

const codePoints = (text: string | undefined) => [...(text ?? "")].length

describe("list: the text of a request", () => {
  test("is whole for every request an approval can show, and is never cut below MAX_LISTED_TEXT", async () => {
    const { service, ctx } = requestSetup()
    const command = `echo ${"a".repeat(MAX_APPROVAL_TEXT - 5)}`
    fakeToolAsk(service, RUN, { tool: "shell", input: { command }, action: "shell", resources: ["echo"] })
    const [request] = await listed(ctx)
    expect(request!.text).toBe(command)
    expect(request).not.toHaveProperty("text_truncated")
    expect(request).not.toHaveProperty("reject_only")
  })

  test("is cut at MAX_LISTED_TEXT code points, with text_truncated, for a request that can only be rejected", async () => {
    const { service, ctx } = requestSetup()
    const command = `echo ${"é".repeat(MAX_LISTED_TEXT + 10)}`
    fakeToolAsk(service, RUN, { tool: "shell", input: { command }, action: "shell", resources: ["echo"] })
    const [request] = await listed(ctx)
    expect(codePoints(request!.text)).toBe(MAX_LISTED_TEXT)
    expect(request).toMatchObject({
      text_truncated: true,
      reject_only: "Its text is over 2000 characters, more than an approval can show.",
    })
  })

  test("is not marked as cut at exactly MAX_LISTED_TEXT", async () => {
    const { service, ctx } = requestSetup()
    fakeAsk(service, RUN, { action: "shell", resources: ["a".repeat(MAX_LISTED_TEXT)] })
    const [request] = await listed(ctx)
    expect(codePoints(request!.text)).toBe(MAX_LISTED_TEXT)
    expect(request).not.toHaveProperty("text_truncated")
  })
})

describe("list: the lists inside a request", () => {
  test("lists MAX_RESOURCES_LISTED resources, each cut to one line, and counts them all", async () => {
    const { service, ctx } = requestSetup()
    const resources = Array.from({ length: MAX_RESOURCES_LISTED + 5 }, (_, index) => `echo ${index}`)
    resources[0] = `echo ${"r".repeat(MAX_LONG_LINE)}`
    fakeAsk(service, RUN, { action: "shell", resources })
    const [request] = await listed(ctx)
    expect(request!.resources).toHaveLength(MAX_RESOURCES_LISTED)
    expect(request!.resources_total).toBe(MAX_RESOURCES_LISTED + 5)
    expect(codePoints(request!.resources![0])).toBe(MAX_LONG_LINE)
    expect(request!.resources![0]).toEndWith("…")
  })

  test("leaves resources_total out when every resource is listed", async () => {
    const { service, ctx } = requestSetup()
    fakeAsk(service, RUN, { action: "shell", resources: Array.from({ length: MAX_RESOURCES_LISTED }, () => "echo") })
    expect((await listed(ctx))[0]).not.toHaveProperty("resources_total")
  })

  test("lists MAX_FILES_LISTED files, their names cut to one line, and counts them all", async () => {
    const { service, ctx } = requestSetup()
    const files = Array.from({ length: MAX_FILES_LISTED + 3 }, (_, index) => ({
      file: index === 0 ? `a/\n${"b".repeat(MAX_LONG_LINE)}` : `f${index}.ts`,
      patch: "@@",
      status: "modified" as const,
      additions: 1,
      deletions: 0,
    }))
    fakeAsk(service, RUN, { action: "edit", resources: ["a"], metadata: { files } })
    const [request] = await listed(ctx)
    expect(request!.files).toHaveLength(MAX_FILES_LISTED)
    expect(request!.files_total).toBe(MAX_FILES_LISTED + 3)
    expect(request!.files![0]!.file).toStartWith("a/ bbb")
    expect(codePoints(request!.files![0]!.file)).toBe(MAX_LONG_LINE)
  })

  test("lists MAX_FIELDS_LISTED fields of a question and counts them all", async () => {
    const { service, ctx } = requestSetup()
    const [first, ...rest] = Array.from({ length: MAX_FIELDS_LISTED + 2 }, (_, index) => ({
      key: `k${index}`,
      type: "string" as const,
    }))
    fakeQuestion(service, RUN, "Many", [first!, ...rest])
    const [question] = await listed(ctx)
    expect(question!.fields).toHaveLength(MAX_FIELDS_LISTED)
    expect(question!.fields_total).toBe(MAX_FIELDS_LISTED + 2)
  })

  test("lists the options a field's answer can repeat, at most MAX_OPTIONS_LISTED, and counts them all", async () => {
    const { service, ctx } = requestSetup()
    const options = Array.from({ length: MAX_OPTIONS_LISTED + 4 }, (_, index) => ({
      value: `v${index}`,
      label: `V${index}`,
    }))
    fakeQuestion(service, RUN, "Pick", [{ key: "k", type: "string", options }])
    const [question] = await listed(ctx)
    expect(question!.fields![0]!.options).toHaveLength(MAX_OPTIONS_LISTED)
    expect(question!.fields![0]!.options_total).toBe(MAX_OPTIONS_LISTED + 4)
  })

  test("leaves out an option whose value is over 200 characters or cannot be shown, and counts it", async () => {
    const { service, ctx } = requestSetup()
    const options = [
      { value: "a".repeat(201), label: "long" },
      { value: "fine", label: "Fine" },
      { value: "bi\u202ei", label: "bidi" },
      { value: "b".repeat(200), label: "edge" },
    ]
    fakeQuestion(service, RUN, "Pick", [{ key: "k", type: "string", options }])
    const [field] = (await listed(ctx))[0]!.fields!
    expect(field!.options!.map((option) => option.value)).toEqual(["fine", "b".repeat(200)])
    expect(field!.options_total).toBe(4)
  })

  test("never cuts an option's value or a field's key, and cuts a label, a description and a title to a line", async () => {
    const { service, ctx } = requestSetup()
    const value = `${"v".repeat(199)}é`
    fakeQuestion(service, RUN, "t".repeat(MAX_SHORT_LINE + 5), [
      {
        key: "k".repeat(200),
        type: "string",
        title: "T".repeat(MAX_SHORT_LINE + 5),
        description: "D".repeat(MAX_LONG_LINE + 5),
        options: [{ value, label: "L".repeat(MAX_SHORT_LINE + 5), description: "x".repeat(MAX_LONG_LINE + 5) }],
      },
    ])
    const [question] = await listed(ctx)
    const [field] = question!.fields!
    expect(codePoints(question!.title)).toBe(MAX_SHORT_LINE)
    expect(field!.key).toBe("k".repeat(200))
    expect(codePoints(field!.title)).toBe(MAX_SHORT_LINE)
    expect(codePoints(field!.description)).toBe(MAX_LONG_LINE)
    expect(field!.options![0]!.value).toBe(value)
    expect(codePoints(field!.options![0]!.label)).toBe(MAX_SHORT_LINE)
    expect(codePoints(field!.options![0]!.description)).toBe(MAX_LONG_LINE)
  })

  test("shows a key an answer could not repeat as a line, and the question as one that can only be declined", async () => {
    const { service, ctx } = requestSetup()
    fakeQuestion(service, RUN, "Odd", [{ key: `${"k".repeat(250)}\n`, type: "string" }])
    const [question] = await listed(ctx)
    expect(codePoints(question!.fields![0]!.key)).toBeLessThanOrEqual(200)
    expect(question!.decline_only).toBe("It has a field of a kind these tools do not know.")
  })
})

describe("list: the requests", () => {
  test("lists MAX_REQUESTS_LISTED and counts them all, saying that some were left out", async () => {
    const { service, ctx } = requestSetup()
    for (let index = 0; index < MAX_REQUESTS_LISTED + 5; index += 1) {
      fakeAsk(service, RUN, { action: "shell", resources: [`echo ${index}`] })
    }
    const result = await listRequests(ctx)
    expect(result.requests).toHaveLength(MAX_REQUESTS_LISTED)
    expect(result).toMatchObject({ total: MAX_REQUESTS_LISTED + 5, truncated: true })
    expect(result.requests![0]!.text).toBe("echo 0")
  })

  test("says nothing was left out when exactly MAX_REQUESTS_LISTED are listed", async () => {
    const { service, ctx } = requestSetup()
    for (let index = 0; index < MAX_REQUESTS_LISTED; index += 1)
      fakeAsk(service, RUN, { action: "shell", resources: ["echo"] })
    expect(await listRequests(ctx)).toMatchObject({ total: MAX_REQUESTS_LISTED, truncated: false })
  })

  test("keeps to the size of a list as JSON, whole requests only, and counts what was left out", async () => {
    const { service, ctx } = requestSetup()
    for (let index = 0; index < 8; index += 1) {
      fakeAsk(service, RUN, { action: "shell", resources: ["a".repeat(MAX_APPROVAL_TEXT)] })
    }
    const result = await listRequests(ctx)
    expect(JSON.stringify(result.requests).length).toBeLessThanOrEqual(MAX_LIST_CHARS + 2)
    expect(result.requests!.length).toBeLessThan(8)
    expect(result).toMatchObject({ total: 8, truncated: true })
  })

  test("leaves out a request whose id or session does not fit an id, and counts it", async () => {
    const { service, ctx } = requestSetup()
    fakeAsk(service, RUN, { action: "shell", resources: ["echo hi"] })
    fakeSession(service, RUN).pending.push({
      id: "x".repeat(201),
      sessionID: RUN,
      action: "shell",
      resources: ["echo ho"],
    })
    const result = await listRequests(ctx)
    expect(result.requests).toHaveLength(1)
    expect(result).toMatchObject({ total: 2, truncated: true })
  })
})
