import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { isToolError } from "../errors"
import type { Grant } from "../grant/model"
import { addGrant, type GrantStoreOptions } from "../grant/store"
import { DIRECTORY } from "../run/read.testing"
import { fakeSession } from "../service/testing"
import type { ToolContext } from "../tool"
import { approve, askShell, reject, replySetup, replyTo, writesOf } from "./reply.testing"
import { opencodeRequestReply } from "./reply.tool"
import { RUN } from "./request.testing"

const KEY = Buffer.alloc(32, 7)
const NOW = new Date("2026-06-01T12:00:00Z")

let base: string
let store: GrantStoreOptions

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "reply-grant-"))
  store = { dir: join(base, "grants"), key: KEY }
})

afterEach(async () => {
  await rm(base, { recursive: true, force: true })
})

function grant(approvals: number): Grant {
  return {
    id: "g1",
    tool: opencodeRequestReply.id,
    targets: [DIRECTORY],
    bounds: { approvals },
    rate: null,
    created_at: "2026-05-31T12:00:00Z",
    expires_at: "2026-06-30T12:00:00Z",
    reason: "answering a run",
  }
}

/** A paused run and a context that is unattended, with the grant given. */
async function unattended(approvals: number) {
  const setup = replySetup()
  await addGrant(store, grant(approvals))
  const ctx: ToolContext = {
    ...setup.ctx,
    grants: { unattended: true, dir: store.dir, key: KEY, now: () => NOW },
  }
  return { ...setup, ctx }
}

describe("a grant that sets the approvals bound", () => {
  test("with 0 covers a call with no approvals, which rejects", async () => {
    const { service, ctx } = await unattended(0)
    const asked = askShell(service, "echo hi")
    const result = await replyTo([reject(asked.id)], ctx)
    expect(result.replies).toEqual([{ request: asked.id, decision: "reject", outcome: "sent" }])
    expect(fakeSession(service, RUN).answers).toHaveLength(1)
  })

  test("with 0 refuses a call with one approval, as past its approvals bound, and sends nothing", async () => {
    const { service, ctx } = await unattended(0)
    const asked = askShell(service, "echo hi")
    const error = await replyTo([approve(asked.id, "echo hi")], ctx).then(
      () => undefined,
      (thrown: unknown) => thrown,
    )
    expect(isToolError(error) && [error.code, error.details?.reason, error.details?.bound]).toEqual([
      "forbidden",
      "bound",
      "approvals",
    ])
    expect(writesOf(service)).toEqual([])
  })

  test("with 1 covers one approval and refuses two", async () => {
    const { service, ctx } = await unattended(1)
    const [a, b] = ["echo a", "echo b"].map((command) => askShell(service, command))
    const refused = await replyTo([approve(a!.id, "echo a"), approve(b!.id, "echo b")], ctx).then(
      () => undefined,
      (thrown: unknown) => thrown,
    )
    expect(isToolError(refused) && refused.details?.bound).toBe("approvals")
    expect(writesOf(service)).toEqual([])
    const result = await replyTo([approve(a!.id, "echo a")], ctx)
    expect(result.replies[0]!.outcome).toBe("sent")
  })
})
