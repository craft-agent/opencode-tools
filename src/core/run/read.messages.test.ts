import { describe, expect, test } from "bun:test"
import { MAX_LISTED, MAX_LIST_CHARS } from "../service/schemas"
import { failure } from "../service/read.testing"
import { fakeEnd, fakeReply, fakeSession, type FakeService } from "../service/testing"
import { DEFAULT_MESSAGES, MAX_MESSAGES, MAX_MESSAGE_TEXT, MAX_MESSAGE_TOOLS } from "./read.schemas"
import { boundRun, readRun, requestsTo, runSetup } from "./read.testing"

const ID = "ses_run"

const messages = (ctx: Parameters<typeof readRun>[1], extra: Record<string, unknown> = {}) =>
  readRun({ method: "messages", session: ID, ...extra }, ctx)

function userMessage(service: FakeService, text: string) {
  fakeSession(service, ID).messages.push({
    id: `msg_${fakeSession(service, ID).messages.length}`,
    time: { created: service.clock.now },
    type: "user",
    text,
  })
}

describe("messages: what is asked", () => {
  test("is the newest DEFAULT_MESSAGES, newest first, unless a limit is given", async () => {
    const { service, ctx } = runSetup()
    boundRun(service, ID)
    await messages(ctx)
    await messages(ctx, { limit: 7 })
    const queries = requestsTo(service, `/session/${ID}/message`).map((request) => request.query)
    expect(queries).toEqual([
      { limit: String(DEFAULT_MESSAGES), order: "desc" },
      { limit: "7", order: "desc" },
    ])
  })

  test("refuses a limit outside 1 to MAX_MESSAGES before any service is contacted", async () => {
    const { service, runtime, ctx } = runSetup({ runtime: { running: false } })
    for (const limit of [0, MAX_MESSAGES + 1, 1.5, -1]) {
      expect((await failure(messages(ctx, { limit }))).code).toBe("invalid_argument")
    }
    expect(service.requests).toEqual([])
    expect(runtime.started).toEqual([])
  })

  test("accepts the whole range, at both ends", async () => {
    const { service, ctx } = runSetup()
    boundRun(service, ID)
    for (const limit of [1, MAX_MESSAGES]) expect(await messages(ctx, { limit })).toMatchObject({ total: 0 })
  })

  test("is checked as the caller's before the messages are read", async () => {
    const { service, ctx } = runSetup()
    boundRun(service, ID, { caller: "someone-else" })
    expect((await failure(messages(ctx))).code).toBe("not_found")
    expect(requestsTo(service, `/session/${ID}/message`)).toEqual([])
  })
})

describe("messages: what each carries", () => {
  test("a user, synthetic or system message gives its text; a message of another type, its type and time", async () => {
    const { service, ctx } = runSetup()
    const session = boundRun(service, ID)
    service.clock.now += 1
    session.messages.push(
      { id: "m1", time: { created: 10 }, type: "user", text: "Review this." },
      { id: "m2", time: { created: 20 }, type: "synthetic", text: "Reminder." },
      { id: "m3", time: { created: 30 }, type: "system", text: "Context." },
      { id: "m4", time: { created: 40 }, type: "agent-switched", agent: "build" },
    )
    expect((await messages(ctx)).messages).toEqual([
      { type: "agent-switched", time: 40 },
      { type: "system", time: 30, text: "Context." },
      { type: "synthetic", time: 20, text: "Reminder." },
      { type: "user", time: 10, text: "Review this." },
    ])
  })

  test("an assistant message gives its agent, its text parts joined by a blank line and its tool parts", async () => {
    const { service, ctx } = runSetup()
    boundRun(service, ID)
    const reply = fakeReply(service, ID, "Looking.")
    reply.content.push(
      { type: "reasoning", text: "thinking" },
      {
        type: "tool",
        id: "t1",
        name: "read",
        state: { status: "running", input: {}, metadata: {} },
        time: { created: 1 },
      },
      { type: "text", text: "Found it." },
    )
    reply.error = { type: "provider.error", message: "half\u0000way" }
    const [message] = (await messages(ctx)).messages!
    expect(message).toEqual({
      type: "assistant",
      time: reply.time.created,
      text: "Looking.\n\nFound it.",
      tools: [{ name: "read", status: "running" }],
      error: { type: "provider.error", message: "half way" },
      agent: "plan",
    })
  })

  test("an assistant message with no text part has none, and one with no tool has no tools", async () => {
    const { service, ctx } = runSetup()
    boundRun(service, ID)
    fakeReply(service, ID, "x").content.length = 0
    const [message] = (await messages(ctx)).messages!
    expect(message).not.toHaveProperty("text")
    expect(message).not.toHaveProperty("tools")
  })

  test("an idle message gives its outcome and its error", async () => {
    const { service, ctx } = runSetup()
    boundRun(service, ID, { busy: service.clock.now, active: true })
    fakeEnd(service, ID, "failed", { type: "provider.error", message: "no" })
    const [message] = (await messages(ctx)).messages!
    expect(message).toEqual({
      type: "idle",
      time: service.clock.now,
      outcome: "failed",
      error: { type: "provider.error", message: "no" },
    })
  })

  test("lists at most MAX_MESSAGE_TOOLS tool parts", async () => {
    const { service, ctx } = runSetup()
    boundRun(service, ID)
    const reply = fakeReply(service, ID, "x")
    for (let index = 0; index < MAX_MESSAGE_TOOLS + 5; index += 1) {
      reply.content.push({
        type: "tool",
        id: `t${index}`,
        name: `tool${index}`,
        state: { status: "streaming", input: "" },
        time: { created: 1 },
      })
    }
    expect((await messages(ctx)).messages![0]!.tools).toHaveLength(MAX_MESSAGE_TOOLS)
  })
})

describe("messages: text is data", () => {
  test("is cut at MAX_MESSAGE_TEXT code points, with truncated saying so", async () => {
    const { service, ctx } = runSetup()
    boundRun(service, ID)
    userMessage(service, "😀".repeat(MAX_MESSAGE_TEXT + 1))
    userMessage(service, "y".repeat(MAX_MESSAGE_TEXT))
    const [exact, cut] = (await messages(ctx)).messages!
    expect(exact!.text).toHaveLength(MAX_MESSAGE_TEXT)
    expect(exact).not.toHaveProperty("truncated")
    expect([...cut!.text!]).toHaveLength(MAX_MESSAGE_TEXT)
    expect(cut!.truncated).toBe(true)
  })

  test("keeps its lines and loses what moves or reorders it", async () => {
    const { service, ctx } = runSetup()
    boundRun(service, ID)
    userMessage(service, "a\r\nb\u0000c\u202ed\u200fe\tf")
    expect((await messages(ctx)).messages![0]!.text).toBe("a\nb c d e\tf")
  })
})

describe("messages: the size of the list", () => {
  test("keeps within MAX_LIST_CHARS as JSON, counts the messages the service gave, and says it left some out", async () => {
    const { service, ctx } = runSetup()
    boundRun(service, ID)
    for (let index = 0; index < 10; index += 1) userMessage(service, "m".repeat(MAX_MESSAGE_TEXT))
    const result = await messages(ctx, { limit: 10 })
    expect(result.total).toBe(10)
    expect(result.truncated).toBe(true)
    expect(result.messages!.length).toBeLessThan(10)
    expect(JSON.stringify(result.messages).length).toBeLessThanOrEqual(MAX_LIST_CHARS)
    expect(result.messages!.length).toBeLessThanOrEqual(MAX_LISTED)
  })

  test("is not truncated when everything fits", async () => {
    const { service, ctx } = runSetup()
    boundRun(service, ID)
    userMessage(service, "short")
    expect(await messages(ctx)).toMatchObject({ method: "messages", total: 1, truncated: false })
  })

  test("is empty for a session with no message", async () => {
    const { service, ctx } = runSetup()
    boundRun(service, ID)
    expect(await messages(ctx)).toEqual({
      method: "messages",
      service_started: false,
      messages: [],
      total: 0,
      truncated: false,
    })
  })
})

describe("messages: a reply that is not what the service sends", () => {
  test("is upstream_error, never a half-empty message", async () => {
    for (const bad of [
      { data: [{ type: "user", time: { created: 1 } }], cursor: {} },
      { data: [{ type: "assistant", time: { created: 1 }, agent: "a", content: [{ type: "text" }] }], cursor: {} },
      { data: [{ time: { created: 1 } }], cursor: {} },
      { data: "none" },
    ]) {
      const { service, ctx } = runSetup()
      boundRun(service, ID)
      service.failNext(
        /\/message$/,
        new Response(JSON.stringify(bad), { status: 200, headers: { "content-type": "application/json" } }),
      )
      expect((await failure(messages(ctx))).code).toBe("upstream_error")
    }
  })
})
