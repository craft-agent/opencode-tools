import { describe, expect, test } from "bun:test"
import { ToolError } from "../errors"
import { UNREADABLE_REPLY } from "./errors"
import { changedFilesOf, formDetailsOf, permissionRequestsOf, toolCallOf } from "./reply.request"

function unreadable(read: () => unknown): void {
  const error = (() => {
    try {
      read()
    } catch (thrown) {
      return thrown
    }
  })()
  expect(error).toBeInstanceOf(ToolError)
  expect(error).toMatchObject({ code: "upstream_error", message: UNREADABLE_REPLY })
}

describe("permissionRequestsOf", () => {
  test("reads the id, the action, the resources, the source, the message and the metadata, and drops the rest", () => {
    const row = {
      id: "p1",
      sessionID: "s",
      action: "edit",
      resources: ["a.ts"],
      save: ["*"],
      source: { type: "tool", messageID: "m1", id: "c1" },
      message: "Edit a file",
      metadata: { files: [] },
    }
    expect(permissionRequestsOf([row])).toEqual([
      {
        id: "p1",
        action: "edit",
        resources: ["a.ts"],
        source: { messageID: "m1", id: "c1" },
        message: "Edit a file",
        metadata: { files: [] },
      },
    ])
  })

  test("leaves out what is absent", () => {
    const [request] = permissionRequestsOf([{ id: "p1", action: "shell", resources: [] }])
    expect(request).toEqual({ id: "p1", action: "shell", resources: [] })
    expect(request).not.toHaveProperty("source")
    expect(request).not.toHaveProperty("metadata")
  })

  test("reads a source without both ids as absent", () => {
    const rows = [
      { id: "a", action: "x", resources: [], source: { type: "tool", messageID: "m" } },
      { id: "b", action: "x", resources: [], source: { type: "tool", id: "c" } },
      { id: "c", action: "x", resources: [], source: "m" },
    ]
    for (const request of permissionRequestsOf(rows)) expect(request).not.toHaveProperty("source")
  })

  test("reads a message or metadata of another type as absent, and does not fail the reply for it", () => {
    const [request] = permissionRequestsOf([{ id: "p", action: "x", resources: [], message: 4, metadata: [1] }])
    expect(request).toEqual({ id: "p", action: "x", resources: [] })
  })

  test("is upstream_error for a request without an id, an action or resources", () => {
    unreadable(() => permissionRequestsOf([{ id: "", action: "x", resources: [] }]))
    unreadable(() => permissionRequestsOf([{ id: "p", resources: [] }]))
    unreadable(() => permissionRequestsOf([{ id: "p", action: "x", resources: "a" }]))
    unreadable(() => permissionRequestsOf({ data: [] }))
  })
})

describe("formDetailsOf", () => {
  test("reads a form with its fields, keeping the properties of every kind and dropping unknown ones", () => {
    const options = [
      { value: "a", label: "A", description: "The first", extra: 1 },
      { value: "b", label: "B" },
    ]
    const form = {
      id: "f1",
      sessionID: "s",
      title: "Questions",
      metadata: { kind: "question" },
      fields: [
        {
          key: "q0",
          type: "multiselect",
          title: "Pick",
          description: "Pick some",
          required: true,
          hidden: false,
          custom: true,
          options,
          default: ["a"],
          minItems: 1,
          maxItems: 2,
        },
        { key: "n", type: "number", minimum: 0, maximum: "Infinity", default: 3 },
        {
          key: "s",
          type: "string",
          format: "email",
          minLength: 1,
          maxLength: 9,
          pattern: "^a",
          default: "x",
          placeholder: "p",
        },
        { key: "l", type: "external", url: "https://example.test/go" },
      ],
    }
    expect(formDetailsOf([form])).toEqual([
      {
        id: "f1",
        title: "Questions",
        fields: [
          {
            key: "q0",
            type: "multiselect",
            title: "Pick",
            description: "Pick some",
            required: true,
            custom: true,
            options: [
              { value: "a", label: "A", description: "The first" },
              { value: "b", label: "B" },
            ],
            default: ["a"],
            minItems: 1,
            maxItems: 2,
          },
          { key: "n", type: "number", minimum: 0, maximum: "Infinity", default: 3 },
          { key: "s", type: "string", format: "email", minLength: 1, maxLength: 9, pattern: "^a", default: "x" },
          { key: "l", type: "external", url: "https://example.test/go" },
        ],
      },
    ])
  })

  test("keeps a field of a kind it does not know, with its type as a string", () => {
    const [form] = formDetailsOf([{ id: "f", title: "T", fields: [{ key: "k", type: "date" }] }])
    expect(form!.fields).toEqual([{ key: "k", type: "date" }])
  })

  test("reads a property of another type as absent and does not fail the reply", () => {
    const field = {
      key: "k",
      type: "string",
      title: 5,
      description: {},
      required: "yes",
      custom: 1,
      options: "a",
      default: null,
      minLength: "1",
      pattern: 4,
      url: false,
    }
    const [form] = formDetailsOf([{ id: "f", title: "T", fields: [field] }])
    expect(form!.fields).toEqual([{ key: "k", type: "string" }])
  })

  test("drops the options that have no value, and keeps the rest", () => {
    const [form] = formDetailsOf([
      { id: "f", title: "T", fields: [{ key: "k", type: "string", options: [{ label: "x" }, { value: "a" }, null] }] },
    ])
    expect(form!.fields[0]!.options).toEqual([{ value: "a" }])
  })

  test("is upstream_error when a field has no key or no type, or a form no title or fields", () => {
    unreadable(() => formDetailsOf([{ id: "f", title: "T", fields: [{ type: "string" }] }]))
    unreadable(() => formDetailsOf([{ id: "f", title: "T", fields: [{ key: "k" }] }]))
    unreadable(() => formDetailsOf([{ id: "f", fields: [] }]))
    unreadable(() => formDetailsOf([{ id: "f", title: "T" }]))
  })
})

describe("toolCallOf", () => {
  const call = (id: string, state: unknown) => ({ type: "tool", id, name: "shell", state })
  const message = (...content: unknown[]) => ({ id: "m", type: "assistant", content })

  test("reads a running call: its tool and its arguments", () => {
    const reply = message(
      { type: "text", text: "Working" },
      call("c1", { status: "running", input: { command: "echo hi", workdir: "/work/acme" }, metadata: {} }),
    )
    expect(toolCallOf(reply, "c1")).toEqual({ tool: "shell", input: { command: "echo hi", workdir: "/work/acme" } })
  })

  test("takes the call with the id it is asked for", () => {
    const reply = message(call("c1", { status: "running", input: { n: 1 } }), {
      ...call("c2", { status: "running", input: { n: 2 } }),
      name: "edit",
    })
    expect(toolCallOf(reply, "c2")).toEqual({ tool: "edit", input: { n: 2 } })
  })

  test("gives the tool alone for a call still streaming, whose input is text", () => {
    expect(toolCallOf(message(call("c1", { status: "streaming", input: '{"command":"ec' })), "c1")).toEqual({
      tool: "shell",
    })
  })

  test("gives the tool alone when the state has no plain object as its input", () => {
    for (const state of [{ status: "running" }, { status: "running", input: [1] }, "running", null]) {
      expect(toolCallOf(message(call("c1", state)), "c1")).toEqual({ tool: "shell" })
    }
  })

  test("is undefined for an id the message lacks, a part that is not a tool, and a reply that is no assistant message", () => {
    expect(toolCallOf(message(call("c1", {})), "c9")).toBeUndefined()
    expect(toolCallOf(message({ type: "text", id: "c1", text: "x" }), "c1")).toBeUndefined()
    expect(toolCallOf(message({ type: "tool", id: "c1" }), "c1")).toBeUndefined()
    expect(toolCallOf({ id: "m", type: "user", text: "go" }, "c1")).toBeUndefined()
    expect(toolCallOf(undefined, "c1")).toBeUndefined()
    expect(toolCallOf("x", "c1")).toBeUndefined()
  })
})

describe("changedFilesOf", () => {
  const file = { file: "a.ts", status: "modified" as const, additions: 2, deletions: 1, patch: "@@" }

  test("reads the files of metadata.files, as the entry has them and no more", () => {
    expect(
      changedFilesOf({
        files: [
          { ...file, extra: true },
          { ...file, file: "b.ts", status: "added" },
        ],
      }),
    ).toEqual([file, { ...file, file: "b.ts", status: "added" }])
  })

  test("is undefined when there is no list, it is empty, or an entry is not a changed file", () => {
    expect(changedFilesOf(undefined)).toBeUndefined()
    expect(changedFilesOf({})).toBeUndefined()
    expect(changedFilesOf({ files: [] })).toBeUndefined()
    expect(changedFilesOf({ files: "a.ts" })).toBeUndefined()
    expect(changedFilesOf({ files: [file, { ...file, status: "renamed" }] })).toBeUndefined()
    expect(changedFilesOf({ files: [file, { file: "b.ts" }] })).toBeUndefined()
  })
})
