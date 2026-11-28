import { describe, expect, test } from "bun:test"
import { OpenCode, type JobSubagent, type OpenCodeClient } from "@opencode/client"
import { FAKE_ENDPOINT, createFakeService, fakeChild, fakeEnd, fakeJob, fakeSession, type FakeService } from "./testing"

function clientOf(service: FakeService): OpenCodeClient {
  return OpenCode.make({ baseUrl: FAKE_ENDPOINT.url, headers: FAKE_ENDPOINT.headers, fetch: service.fetch })
}

async function started(client: OpenCodeClient, agent?: string) {
  const { id } = await client.session.create({ title: "Task", ...(agent !== undefined && { agent }) })
  await client.session.prompt({ sessionID: id, text: "go" })
  return id
}

function failure(call: Promise<unknown>): Promise<unknown> {
  return call.then(
    () => undefined,
    (error: unknown) => error,
  )
}

function reportText(kind: "subagent" | "shell", sessionID: string, description: string) {
  return `<background-result kind="${kind}" sessionID="${sessionID}" state="cancelled" description="${description}">\n${
    kind === "shell" ? "Shell" : "Subagent"
  } cancelled\n</background-result>`
}

const CHILD_DESCRIPTION = "Subagent task"

describe("the fake service's jobs", () => {
  test("a child is a running subagent job, which leaves the list when it ends or is interrupted", async () => {
    const service = createFakeService()
    const client = clientOf(service)
    const id = await started(client, "build")
    service.clock.now += 2
    const first = fakeChild(service, id)
    const second = fakeChild(service, id)
    const expected = (child: string): JobSubagent => ({
      kind: "subagent",
      id: child,
      sessionID: id,
      status: "running",
      time: { started: service.clock.now },
      childSessionID: child,
      agent: "build",
      description: CHILD_DESCRIPTION,
    })
    expect(await client.experimental.job.list()).toEqual([expected(first.id), expected(second.id)])
    fakeEnd(service, first.id, "succeeded")
    expect(await client.experimental.job.list()).toEqual([expected(second.id)])
    await client.session.interrupt({ sessionID: second.id })
    expect(await client.experimental.job.list()).toEqual([])
  })

  test("a child of a session with no agent names the default subagent", async () => {
    const service = createFakeService()
    const client = clientOf(service)
    const id = await started(client)
    fakeChild(service, id)
    expect(await client.experimental.job.list()).toMatchObject([{ agent: "scout" }])
  })

  test("fakeJob adds a running shell job numbered after the jobs of its session", async () => {
    const service = createFakeService()
    const { id } = await clientOf(service).session.create()
    service.clock.now += 1
    const first = fakeJob(service, id, "pnpm dev")
    expect(first).toEqual({
      kind: "shell",
      id: `${id}:job1`,
      sessionID: id,
      status: "running",
      title: "pnpm dev",
      time: { started: service.clock.now },
      shellID: `${id}:job1`,
      command: "pnpm dev",
    })
    expect(fakeJob(service, id, "sleep 60").id).toBe(`${id}:job2`)
    expect(service.state.jobs).toHaveLength(2)
    expect(() => fakeJob(service, "ses_none", "ls")).toThrow("The fake service holds no session ses_none")
  })

  test("are listed by session, with those below it, by kind and by status", async () => {
    const service = createFakeService()
    const client = clientOf(service)
    const id = await started(client)
    const other = await started(client)
    const child = fakeChild(service, id)
    const grandchild = fakeChild(service, child.id)
    const dev = fakeJob(service, id, "pnpm dev")
    const done = fakeJob(service, id, "pnpm build")
    done.status = "completed"
    const elsewhere = fakeJob(service, other, "sleep 60")
    const ids = async (input?: Parameters<OpenCodeClient["experimental"]["job"]["list"]>[0]) =>
      (await client.experimental.job.list(input)).map((job) => job.id)
    expect(await ids()).toEqual([child.id, grandchild.id, dev.id, done.id, elsewhere.id])
    expect(await ids({ sessionID: id })).toEqual([child.id, dev.id, done.id])
    expect(await ids({ sessionID: id, descendants: false })).toEqual([child.id, dev.id, done.id])
    expect(await ids({ sessionID: id, descendants: true })).toEqual([child.id, grandchild.id, dev.id, done.id])
    expect(await ids({ sessionID: child.id, descendants: true })).toEqual([grandchild.id])
    expect(await ids({ kind: "shell" })).toEqual([dev.id, done.id, elsewhere.id])
    expect(await ids({ kind: "subagent", sessionID: id, descendants: true })).toEqual([child.id, grandchild.id])
    expect(await ids({ status: "completed" })).toEqual([done.id])
    expect(await ids({ sessionID: id, kind: "shell", status: "running" })).toEqual([dev.id])
    expect(await ids({ sessionID: "ses_none" })).toEqual([])
  })

  test("cancelling a shell job removes it, reports to its session and wakes it when it had stopped", async () => {
    const service = createFakeService()
    const client = clientOf(service)
    const id = await started(client)
    const job = fakeJob(service, id, "pnpm dev")
    fakeEnd(service, id, "succeeded")
    service.clock.now += 8
    expect(await client.experimental.job.cancel({ id: job.id })).toBeUndefined()
    expect(await client.experimental.job.list()).toEqual([])
    expect(Object.keys(await client.session.active())).toEqual([id])
    expect(fakeSession(service, id).time.busy).toBe(service.clock.now)
    expect(fakeSession(service, id).inbox).toEqual([])
    expect((await client.message.list({ sessionID: id })).data[0]).toMatchObject({
      type: "synthetic",
      text: reportText("shell", id, "pnpm dev"),
      description: "pnpm dev",
      time: { created: service.clock.now },
    })
  })

  test("cancelling a shell job of a running session leaves the report in its inbox", async () => {
    const service = createFakeService()
    const client = clientOf(service)
    const id = await started(client)
    const job = fakeJob(service, id, "sleep 60")
    await client.experimental.job.cancel({ id: job.id })
    expect(await client.session.inbox.list({ sessionID: id })).toMatchObject([
      { type: "synthetic", delivery: "steer", payload: { text: reportText("shell", id, "sleep 60") } },
    ])
    expect((await client.message.list({ sessionID: id })).data).toHaveLength(1)
    expect(await client.experimental.job.list()).toEqual([])
  })

  test("cancelling a subagent job interrupts its child, which reports to its parent", async () => {
    const service = createFakeService()
    const client = clientOf(service)
    const id = await started(client)
    const child = fakeChild(service, id)
    await client.experimental.job.cancel({ id: child.id })
    expect(await client.experimental.job.list()).toEqual([])
    expect(Object.keys(await client.session.active())).toEqual([id])
    expect(fakeSession(service, child.id)).toMatchObject({ outcome: "interrupted" })
    expect(fakeSession(service, id).inbox).toMatchObject([
      { payload: { text: reportText("subagent", child.id, CHILD_DESCRIPTION) } },
    ])
  })

  test("cancelling a job that is not there answers 204 and changes nothing", async () => {
    const service = createFakeService()
    const client = clientOf(service)
    const id = await started(client)
    const job = fakeJob(service, id, "pnpm dev")
    expect(await client.experimental.job.cancel({ id: "job_none" })).toBeUndefined()
    await client.experimental.job.cancel({ id: job.id })
    expect(await client.experimental.job.cancel({ id: job.id })).toBeUndefined()
    expect(fakeSession(service, id).inbox).toHaveLength(1)
  })

  test("a service that refuses them answers 404 on both routes", async () => {
    const service = createFakeService({ jobsRefused: true })
    const client = clientOf(service)
    for (const call of [
      () => client.experimental.job.list(),
      () => client.experimental.job.cancel({ id: "job_any" }),
    ]) {
      const error = await failure(call())
      expect(error).toBeInstanceOf(Error)
      expect(error).not.toHaveProperty("_tag")
    }
  })
})
