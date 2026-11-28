import { describe, expect, test } from "bun:test"
import { MAX_TEXT_LENGTH } from "../describe"
import { MAX_APPROVAL_TEXT, approvalTextOf, isRepeatable, isShowable } from "./text"

describe("approvalTextOf", () => {
  test("is the whole command of a shell call, as it is, although the resources are its simple commands", () => {
    const command = "cd src && echo hi |  npx cowsay hi\n# kept"
    const text = approvalTextOf({
      action: "shell",
      resources: ["cd src", "echo hi", "npx cowsay hi"],
      call: { tool: "shell", input: { command, workdir: "/work/acme" } },
    })
    expect(text).toBe(command)
  })

  test("is the call's arguments as JSON for another tool", () => {
    const input = { file: "a.ts", content: "x\ny" }
    expect(approvalTextOf({ action: "edit", resources: ["a.ts"], call: { tool: "write", input } })).toBe(
      JSON.stringify(input),
    )
  })

  test("is the arguments as JSON for a shell call that has no command", () => {
    const input = { workdir: "/work/acme" }
    expect(approvalTextOf({ action: "shell", resources: ["echo hi"], call: { tool: "shell", input } })).toBe(
      JSON.stringify(input),
    )
    const odd = { command: 4 }
    expect(approvalTextOf({ action: "shell", resources: [], call: { tool: "shell", input: odd } })).toBe(
      '{"command":4}',
    )
  })

  test("is the command only for the shell action: another action's `command` argument is JSON", () => {
    const input = { command: "echo hi" }
    expect(approvalTextOf({ action: "mcp_run", resources: ["*"], call: { tool: "run", input } })).toBe(
      JSON.stringify(input),
    )
  })

  test("is the resources, one to a line, where the call is not known or has no arguments to read", () => {
    const resources = ["echo hi", "git switch -c topic"]
    expect(approvalTextOf({ action: "shell", resources })).toBe("echo hi\ngit switch -c topic")
    expect(approvalTextOf({ action: "shell", resources, call: { tool: "shell" } })).toBe("echo hi\ngit switch -c topic")
    expect(approvalTextOf({ action: "shell", resources: [] })).toBe("")
  })
})

describe("MAX_APPROVAL_TEXT", () => {
  test("is the most text an approval prompt shows", () => {
    expect(MAX_APPROVAL_TEXT).toBe(MAX_TEXT_LENGTH)
    expect(MAX_APPROVAL_TEXT).toBe(2000)
  })
})

describe("isShowable", () => {
  test("accepts text with line breaks and tabs, and the empty text", () => {
    expect(isShowable("echo hi\n\tnpx cowsay hi\n")).toBe(true)
    expect(isShowable("")).toBe(true)
    expect(isShowable("日本語 and emoji 🙂")).toBe(true)
  })

  test("refuses what moves or reorders text: a control character, a bidi override, a separator, a carriage return", () => {
    for (const character of ["\u0000", "\u001b", "\u007f", "\u0085", "\u202e", "\u2066", "\u2028", "\ufeff", "\r"]) {
      expect(isShowable(`echo${character}hi`)).toBe(false)
    }
  })
})

describe("isRepeatable", () => {
  test("is a text that fits an id and can be shown", () => {
    expect(isRepeatable("main")).toBe(true)
    expect(isRepeatable("a".repeat(200))).toBe(true)
    expect(isRepeatable("a".repeat(201))).toBe(false)
    expect(isRepeatable("a\u202eb")).toBe(false)
  })
})
