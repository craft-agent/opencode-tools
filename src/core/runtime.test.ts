import { describe, expect, test } from "bun:test"
import { defaultRuntime, localUrl, runtimeOf, type ToolRuntime } from "./runtime"

const SHORT_MS = 5

describe("runtimeOf", () => {
  test("returns the runtime of the context", () => {
    const runtime = { name: "own" } as unknown as ToolRuntime
    expect(runtimeOf({ runtime })).toBe(runtime)
  })

  test("falls back to the default runtime", () => {
    const runtime = runtimeOf({})
    expect(runtime.env).toBe(process.env)
    expect(runtime.now()).toBeGreaterThan(0)
    expect(typeof runtime.fetch).toBe("function")
  })
})

describe("the default fetch", () => {
  test("looks the global fetch up when it is called", async () => {
    const original = globalThis.fetch
    globalThis.fetch = (async () => new Response("answered")) as unknown as typeof globalThis.fetch
    try {
      const response = await defaultRuntime().fetch("http://service.test")
      expect(await response.text()).toBe("answered")
    } finally {
      globalThis.fetch = original
    }
  })
})

describe("the default sleep", () => {
  test("resolves after the time", async () => {
    const before = Date.now()
    await defaultRuntime().sleep(SHORT_MS)
    expect(Date.now() - before).toBeGreaterThanOrEqual(SHORT_MS - 1)
  })

  test("rejects with an AbortError for a signal that is aborted already", async () => {
    const error = await defaultRuntime()
      .sleep(SHORT_MS, AbortSignal.abort())
      .catch((e: unknown) => e)
    expect((error as Error).name).toBe("AbortError")
  })

  test("rejects with an AbortError when the signal aborts while waiting, and does not wait on", async () => {
    const controller = new AbortController()
    const pending = defaultRuntime().sleep(60_000, controller.signal)
    setTimeout(() => controller.abort(), SHORT_MS)
    const error = await pending.catch((e: unknown) => e)
    expect((error as Error).name).toBe("AbortError")
  })

  test("takes no part in a later abort of a signal it has finished with", async () => {
    const controller = new AbortController()
    await defaultRuntime().sleep(SHORT_MS, controller.signal)
    expect(() => controller.abort()).not.toThrow()
  })
})

describe("localUrl", () => {
  test.each([
    ["http://0.0.0.0:4096", "http://127.0.0.1:4096"],
    ["http://[::]:4096", "http://[::1]:4096"],
    ["http://127.0.0.1:4096/", "http://127.0.0.1:4096"],
    ["http://localhost:4096", "http://localhost:4096"],
    ["http://192.0.2.7:4096", "http://192.0.2.7:4096"],
    ["https://service.test", "https://service.test"],
    ["http://0.0.0.0:4096/base/", "http://127.0.0.1:4096/base"],
  ])("%s -> %s", (url, expected) => {
    expect(localUrl(url)).toBe(expected)
  })

  test("throws for text that is not a URL", () => {
    expect(() => localUrl("not a url")).toThrow()
  })
})
