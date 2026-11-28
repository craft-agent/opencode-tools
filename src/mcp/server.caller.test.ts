import { afterEach, describe, expect, test } from "bun:test"
import { call, connect, runCleanups, settings, tool, type Call } from "./testing"

afterEach(runCleanups)

const READ = "demo_thing_read"

async function callerOf(entry: ReturnType<typeof settings>, clientName?: string): Promise<string> {
  const calls: Call[] = []
  const { client } = await connect([tool(READ, "alpha", "read", calls)], entry, { name: clientName })
  await call(client, READ)
  return calls[0]!.ctx.caller
}

describe("the caller of a call", () => {
  test("is the setting when one is set", async () => {
    expect(await callerOf(settings({ caller: "from setting" }))).toBe("from setting")
  })

  test("is the connected client's name without a setting", async () => {
    expect(await callerOf(settings())).toBe("test")
    expect(await callerOf(settings(), "  other client  ")).toBe("other client")
  })

  test("is mcp when the client's name is blank", async () => {
    expect(await callerOf(settings(), "   ")).toBe("mcp")
  })

  test("is the same for every call of one connection", async () => {
    const calls: Call[] = []
    const { client } = await connect([tool(READ, "alpha", "read", calls)], settings())
    await call(client, READ)
    await call(client, READ)
    expect(calls.map((entry) => entry.ctx.caller)).toEqual(["test", "test"])
  })
})
