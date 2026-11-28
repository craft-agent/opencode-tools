import { describe, expect, test } from "bun:test"
import type { MessageEntry } from "../service/reply.run"
import { readTurn } from "./read.turn"

const user = (): MessageEntry => ({ type: "user", created: 1, text: "go" })
const idle = (error?: { type: string; message: string }): MessageEntry => ({
  type: "idle",
  created: 1,
  outcome: error ? "failed" : "succeeded",
  ...(error && { error }),
})
const reply = (text: string, over: Partial<MessageEntry> = {}): MessageEntry => ({
  type: "assistant",
  created: 1,
  completed: 2,
  agent: "plan",
  text,
  ...over,
})

describe("readTurn", () => {
  test("of a turn that ended is the newest reply after the idle message before it", () => {
    const messages = [idle(), reply("new"), user(), idle(), reply("old"), user()]
    expect(readTurn(messages, true)).toEqual({ reply: "new" })
  })

  test("of a turn that has not ended stops at the first idle message, which is the turn before's", () => {
    expect(readTurn([reply("so far"), user(), idle(), reply("old")], false)).toEqual({ reply: "so far" })
    expect(readTurn([idle(), reply("old"), user()], false)).toEqual({})
  })

  test("takes the newest reply that was completed and has no error, whatever came after", () => {
    const messages = [
      idle({ type: "e", message: "m" }),
      reply("unfinished", { completed: undefined }),
      reply("failed", { error: { type: "e", message: "m" } }),
      reply("good"),
      reply("older"),
      user(),
    ]
    expect(readTurn(messages, true)).toEqual({ reply: "good", endError: { type: "e", message: "m" } })
  })

  test("has no reply when the one it takes has no text", () => {
    const { text: _text, ...silent } = reply("x")
    expect(readTurn([idle(), silent, reply("older"), user()], true)).toEqual({})
  })

  test("reads a turn longer than its page as far as the page goes", () => {
    expect(readTurn([idle(), reply("only"), user()], true)).toEqual({ reply: "only" })
    expect(readTurn([reply("a"), reply("b")], false)).toEqual({ reply: "a" })
  })

  test("is empty for no messages", () => {
    expect(readTurn([], true)).toEqual({})
    expect(readTurn([], false)).toEqual({})
  })
})
