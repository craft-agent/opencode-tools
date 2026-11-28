import { describe, expect, test } from "bun:test"
import type { Rule } from "../run/rule"
import { fakeAsk, fakeChild, fakeQuestion, fakeQuestions, fakeToolAsk } from "../service/testing"
import { listRequests, listed } from "./read.testing"
import { RUN, SWITCH, requestSetup } from "./request.testing"

describe("list: a permission request", () => {
  test("of a shell call gives the whole command as its text, although the resources are split", async () => {
    const { service, ctx } = requestSetup()
    const command = "cd src && echo hi |  npx cowsay hi"
    const request = fakeToolAsk(service, RUN, {
      tool: "shell",
      input: { command, workdir: "/work/acme" },
      action: "shell",
      resources: ["cd src", "echo hi", "npx cowsay hi"],
    })
    expect(await listRequests(ctx)).toEqual({
      method: "list",
      service_started: false,
      session: RUN,
      requests: [
        {
          kind: "permission",
          id: request.id,
          session: RUN,
          agent: "plan",
          action: "shell",
          resources: ["cd src", "echo hi", "npx cowsay hi"],
          tool: "shell",
          step: request.source!.messageID,
          text: command,
        },
      ],
      total: 1,
      truncated: false,
    })
  })

  test("of an edit lists its files with their status and counts, and no patch", async () => {
    const { service, ctx } = requestSetup()
    const files = [
      { file: "src/a.ts", patch: "@@ -1 +1 @@\n-a\n+b", status: "modified", additions: 1, deletions: 1 },
      { file: "src/new.ts", patch: "@@ -0,0 +1 @@\n+c", status: "added", additions: 1, deletions: 0 },
    ]
    fakeToolAsk(service, RUN, {
      tool: "edit",
      input: { file: "src/a.ts", old: "a", new: "b" },
      action: "edit",
      resources: ["src/a.ts"],
      metadata: { files },
    })
    const [request] = await listed(ctx)
    expect(request).toMatchObject({ action: "edit", tool: "edit", text: '{"file":"src/a.ts","old":"a","new":"b"}' })
    expect(request!.files).toEqual([
      { file: "src/a.ts", status: "modified", additions: 1, deletions: 1 },
      { file: "src/new.ts", status: "added", additions: 1, deletions: 0 },
    ])
    expect(request).not.toHaveProperty("files_total")
  })

  test("with no call to read gives its resources as its text, one to a line, and the service's message", async () => {
    const { service, ctx } = requestSetup()
    fakeAsk(service, RUN, { action: "shell", resources: ["echo hi", "echo ho"], message: "Run two commands" })
    const [request] = await listed(ctx)
    expect(request).toMatchObject({ text: "echo hi\necho ho", message: "Run two commands" })
    expect(request).not.toHaveProperty("tool")
    expect(request).not.toHaveProperty("step")
  })

  test("of a subagent says so, with its agent, and is told apart as reject_only where the run's rules ask", async () => {
    const rules: Rule[] = [{ action: "shell", resource: "git switch *", effect: "ask" }]
    const { service, ctx } = requestSetup({}, { permissions: rules })
    const child = fakeChild(service, RUN)
    child.agent = "scout"
    fakeToolAsk(service, RUN, { tool: "shell", input: SWITCH, action: "shell", resources: ["git switch -c topic"] })
    fakeToolAsk(service, child.id, {
      tool: "shell",
      input: SWITCH,
      action: "shell",
      resources: ["git switch -c topic"],
    })
    const [own, theirs] = await listed(ctx)
    expect(own).not.toHaveProperty("subagent")
    expect(own).not.toHaveProperty("reject_only")
    expect(theirs).toMatchObject({
      session: child.id,
      subagent: true,
      agent: "scout",
      reject_only: "A subagent asked for what the run's own rules ask about.",
    })
  })

  test("held by the never_approve setting says so", async () => {
    const { service, ctx } = requestSetup()
    fakeAsk(service, RUN, { action: "edit", resources: ["a.ts"] })
    const held = { ...ctx, options: { never_approve: ["edit"] } }
    expect((await listed(held))[0]).toMatchObject({ reject_only: "The `never_approve` setting holds its action." })
  })

  test("whose text cannot be shown is listed cleaned, and can only be rejected", async () => {
    const { service, ctx } = requestSetup()
    fakeToolAsk(service, RUN, {
      tool: "shell",
      input: { command: "echo hi\u202e\r\necho\u0000ho" },
      action: "shell",
      resources: ["echo hi"],
    })
    const [request] = await listed(ctx)
    expect(request).toMatchObject({
      text: "echo hi \necho ho",
      reject_only: "Its text holds characters that cannot be shown as they are.",
    })
  })

  test("cleans every text of a request to one line, and leaves out a blank one", async () => {
    const { service, ctx } = requestSetup()
    const child = fakeChild(service, RUN)
    child.agent = "sc\u0000out\nx"
    fakeAsk(service, child.id, {
      action: "sh\u202eell\n",
      resources: ["echo\u0000hi\nnext", "\n"],
      message: "  Run it\u2028now  ",
    })
    fakeAsk(service, child.id, { action: "shell", resources: [], message: "\u0000 \n" })
    const [first, second] = await listed(ctx)
    expect(first).toMatchObject({
      agent: "sc out x",
      action: "sh ell",
      resources: ["echo hi next", ""],
      message: "Run it now",
    })
    expect(second).not.toHaveProperty("message")
  })
})

describe("list: a question", () => {
  test("of the agent's question tool gives its title, its fields and their options", async () => {
    const { service, ctx } = requestSetup()
    const form = fakeQuestions(service, RUN, [
      { header: "Branch", question: "Which branch?", options: ["main", "dev"] },
      { header: "Checks", question: "Which checks?", options: ["lint", "test"], multiple: true },
    ])
    const [question] = await listed(ctx)
    expect(question).toEqual({
      kind: "question",
      id: form.id,
      session: RUN,
      agent: "plan",
      title: "Questions",
      fields: [
        {
          key: "q0",
          kind: "string",
          title: "Branch",
          description: "Which branch?",
          custom: true,
          options: [
            { value: "main", label: "main", description: "Choose main" },
            { value: "dev", label: "dev", description: "Choose dev" },
          ],
        },
        {
          key: "q1",
          kind: "multiselect",
          title: "Checks",
          description: "Which checks?",
          custom: true,
          options: [
            { value: "lint", label: "lint", description: "Choose lint" },
            { value: "test", label: "test", description: "Choose test" },
          ],
        },
      ],
    })
  })

  test("gives every property of a field, as snake_case, and leaves out a blank title", async () => {
    const { service, ctx } = requestSetup()
    fakeQuestion(service, RUN, " \n", [
      {
        key: "s",
        type: "string",
        required: true,
        format: "email",
        minLength: 1,
        maxLength: 9,
        pattern: "^a\nb",
        default: "x\ty",
      },
      { key: "n", type: "number", minimum: 0, maximum: "Infinity", default: 3 },
      {
        key: "m",
        type: "multiselect",
        options: [{ value: "a", label: "A" }],
        minItems: 1,
        maxItems: 2,
        default: ["a"],
      },
    ])
    const [question] = await listed(ctx)
    expect(question).not.toHaveProperty("title")
    expect(question!.fields).toEqual([
      {
        key: "s",
        kind: "string",
        required: true,
        format: "email",
        min_length: 1,
        max_length: 9,
        pattern: "^a b",
        default: "x y",
      },
      { key: "n", kind: "number", minimum: 0, maximum: "Infinity", default: 3 },
      {
        key: "m",
        kind: "multiselect",
        options: [{ value: "a", label: "A" }],
        min_items: 1,
        max_items: 2,
        default: ["a"],
      },
    ])
  })

  test("with a link to visit can only be declined, and shows the link", async () => {
    const { service, ctx } = requestSetup()
    fakeQuestion(service, RUN, "Visit", [{ key: "l", type: "external", url: "https://example.test/go\u0000" }])
    const [question] = await listed(ctx)
    expect(question).toMatchObject({
      decline_only: "It has a link to visit, which no tool has visited.",
      fields: [{ key: "l", kind: "external", url: "https://example.test/go" }],
    })
  })
})

describe("list: what there is", () => {
  test("is no request for a run that is paused on nothing", async () => {
    const { ctx } = requestSetup()
    expect(await listRequests(ctx)).toMatchObject({ requests: [], total: 0, truncated: false })
  })
})
