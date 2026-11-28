import { describe, expect, test } from "bun:test"
import { ClientError, OpenCode, isLocationNotFoundError, type OpenCodeClient } from "@opencode/client"
import { FAKE_ENDPOINT, createFakeService, fakeRuntime, type FakeService } from "./testing"
import { MIN_SERVICE_VERSION } from "./version"

function clientOf(service: FakeService): OpenCodeClient {
  return OpenCode.make({ baseUrl: FAKE_ENDPOINT.url, headers: FAKE_ENDPOINT.headers, fetch: service.fetch })
}

const DEFAULT_DIRECTORY = "/work/acme"
const OTHER_DIRECTORY = "/work/other"

describe("the fake service's routes", () => {
  test("info reports the minimum version by default", async () => {
    const service = createFakeService()
    expect((await clientOf(service).server.info()).version).toBe(MIN_SERVICE_VERSION)
    service.state.info = { ...service.state.info, version: "9.9.9" }
    expect((await clientOf(service).server.info()).version).toBe("9.9.9")
  })

  test("agents, models and providers are what the state holds", async () => {
    const service = createFakeService()
    const client = clientOf(service)
    const agents = await client.agent.list()
    expect(agents.data.map((agent) => [agent.id, agent.mode])).toEqual([
      ["plan", "primary"],
      ["build", "primary"],
      ["scout", "subagent"],
    ])
    const models = await client.model.list()
    expect(models.data.map((model) => model.id)).toEqual(["model-1", "model-2"])
    expect(models.data[1]!.variants.map((variant) => variant.id)).toEqual(["low", "high"])
    expect((await client.model.default()).data).toEqual(service.state.defaultModel)
    expect((await client.provider.list()).data.map((provider) => provider.id)).toEqual(["acme"])

    service.state.agents = service.state.agents.slice(0, 1)
    service.state.defaultModel = null
    service.state.providers = []
    expect((await client.agent.list()).data).toHaveLength(1)
    expect((await client.model.default()).data).toBeNull()
    expect((await client.provider.list()).data).toEqual([])
  })

  test("a list reply echoes the location asked for, else a fixed one", async () => {
    const client = clientOf(createFakeService())
    expect((await client.agent.list()).location).toEqual({ directory: DEFAULT_DIRECTORY })
    expect((await client.agent.list({ location: { directory: OTHER_DIRECTORY } })).location).toEqual({
      directory: OTHER_DIRECTORY,
    })
    expect((await client.model.list({ location: { directory: OTHER_DIRECTORY } })).location.directory).toBe(
      OTHER_DIRECTORY,
    )
    expect((await client.model.default({ location: { directory: OTHER_DIRECTORY } })).location.directory).toBe(
      OTHER_DIRECTORY,
    )
    expect((await client.provider.list({ location: { directory: OTHER_DIRECTORY } })).location.directory).toBe(
      OTHER_DIRECTORY,
    )
  })

  test("a directory is not a repository unless the state says so", async () => {
    const service = createFakeService({
      coldReads: 0,
      vcsLagReads: 0,
      repositories: {
        [OTHER_DIRECTORY]: {
          vcs: { provider: "git", branch: { current: "main", default: "main" } },
          status: [{ file: "a.txt", additions: 1, deletions: 0, status: "added" }],
        },
      },
    })
    const client = clientOf(service)
    const plain = { location: { directory: DEFAULT_DIRECTORY } }
    expect((await client.vcs.get(plain)).data).toEqual({ branch: {} })
    expect((await client.vcs.status(plain)).data).toEqual([])
    const repository = { location: { directory: OTHER_DIRECTORY } }
    expect((await client.vcs.get(repository)).data.branch.current).toBe("main")
    expect((await client.vcs.status(repository)).data.map((file) => file.file)).toEqual(["a.txt"])
  })

  test("a directory the state lists as missing answers with a LocationNotFoundError", async () => {
    const service = createFakeService({ missing: [OTHER_DIRECTORY], coldReads: 0 })
    const client = clientOf(service)
    const error = await client.agent.list({ location: { directory: OTHER_DIRECTORY } }).catch((e: unknown) => e)
    expect(isLocationNotFoundError(error)).toBe(true)
    expect((error as Error).message).toBe(`Location not found: ${OTHER_DIRECTORY}`)
    expect((error as { location: unknown }).location).toEqual({ directory: OTHER_DIRECTORY })
    expect(await client.vcs.get({ location: { directory: OTHER_DIRECTORY } }).catch((e: unknown) => e)).toBeInstanceOf(
      Error,
    )
    expect((await client.agent.list({ location: { directory: DEFAULT_DIRECTORY } })).data).toHaveLength(3)
    expect((await client.server.info()).version).toBe(MIN_SERVICE_VERSION)
  })

  test("a default model can be null, or absent through a reply of the test's own", async () => {
    const service = createFakeService({ defaultModel: null })
    const client = clientOf(service)
    expect((await client.model.default()).data).toBeNull()
    const body = JSON.stringify({ location: { directory: DEFAULT_DIRECTORY } })
    service.failNext("/api/model/default", new Response(body, { headers: { "content-type": "application/json" } }))
    expect((await client.model.default()).data).toBeUndefined()
  })

  test("an unknown path is an unexpected status", async () => {
    const error = await clientOf(createFakeService())
      .server.pair()
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ClientError)
    expect((error as ClientError).reason).toBe("UnexpectedStatus")
    expect((error as ClientError).cause).toEqual({ status: 404 })
  })

  test("requests record method, path, query and whether they were authorized", async () => {
    const service = createFakeService()
    await clientOf(service).agent.list({ location: { directory: OTHER_DIRECTORY } })
    await OpenCode.make({ baseUrl: FAKE_ENDPOINT.url, fetch: service.fetch })
      .server.info()
      .catch(() => {})
    expect(service.requests).toEqual([
      { method: "GET", path: "/api/agent", query: { "location[directory]": OTHER_DIRECTORY }, authorized: true },
      { method: "GET", path: "/api/info", query: {}, authorized: false },
    ])
  })
})

describe("failNext", () => {
  test("a response replaces the reply, once", async () => {
    const service = createFakeService()
    const client = clientOf(service)
    service.failNext("/api/info", new Response("{}", { status: 503, headers: { "content-type": "application/json" } }))
    const error = (await client.server.info().catch((e: unknown) => e)) as ClientError
    expect(error.reason).toBe("UnexpectedStatus")
    expect(error.cause).toEqual({ status: 503 })
    expect((await client.server.info()).version).toBe(MIN_SERVICE_VERSION)
    expect(service.requests).toHaveLength(2)
  })

  test("an error is what the fetch rejects with, which the client reports as a transport failure", async () => {
    const service = createFakeService()
    const client = clientOf(service)
    const refused = new TypeError("fetch failed")
    service.failNext(/^\/api\/agent$/, refused)
    const error = (await client.agent.list().catch((e: unknown) => e)) as ClientError
    expect(error.reason).toBe("Transport")
    expect(error.cause).toBe(refused)
    expect((await client.agent.list()).data).toHaveLength(3)
  })

  test("a function is called when the request comes", async () => {
    const service = createFakeService()
    let calls = 0
    service.failNext("/api/info", async () => {
      calls += 1
      return new Response("not json", { status: 200, headers: { "content-type": "application/json" } })
    })
    expect(calls).toBe(0)
    const error = (await clientOf(service)
      .server.info()
      .catch((e: unknown) => e)) as ClientError
    expect(error.reason).toBe("MalformedResponse")
    expect(calls).toBe(1)
  })

  test("only a request whose path matches is affected, and the first match only", async () => {
    const service = createFakeService()
    const client = clientOf(service)
    service.failNext("/api/model", new TypeError("one"))
    service.failNext("/api/model", new TypeError("two"))
    expect((await client.agent.list()).data).toHaveLength(3)
    expect(((await client.model.list().catch((e: unknown) => e)) as ClientError).cause).toHaveProperty("message", "one")
    expect(((await client.model.list().catch((e: unknown) => e)) as ClientError).cause).toHaveProperty("message", "two")
    expect((await client.model.list()).data).toHaveLength(2)
  })

  test("a request that never answers ends with the signal's reason", async () => {
    const service = createFakeService()
    service.failNext("/api/info", () => new Promise<Response>(() => {}))
    const error = (await clientOf(service)
      .server.info({ signal: AbortSignal.timeout(20) })
      .catch((e: unknown) => e)) as ClientError
    expect(error.reason).toBe("Transport")
    expect((error.cause as Error).name).toBe("TimeoutError")
  })
})

describe("fakeRuntime", () => {
  test("finds the service when it is running", async () => {
    const runtime = fakeRuntime(createFakeService())
    expect(await runtime.discover()).toEqual(FAKE_ENDPOINT)
    expect(runtime.env).toEqual({})
  })

  test("finds nothing until a start has brought the service up after the given polls", async () => {
    const runtime = fakeRuntime(createFakeService(), { running: false, startsAfterPolls: 2 })
    expect(await runtime.discover()).toBeUndefined()
    expect(await runtime.discover()).toBeUndefined()
    await runtime.start(["opencode"], { env: { PATH: "/bin" } })
    expect(runtime.started).toEqual([{ argv: ["opencode"], env: { PATH: "/bin" } }])
    expect(await runtime.discover()).toBeUndefined()
    expect(await runtime.discover()).toBeUndefined()
    expect(await runtime.discover()).toEqual(FAKE_ENDPOINT)
    expect(await runtime.discover()).toEqual(FAKE_ENDPOINT)
  })

  test("a start that fails brings nothing up and is still recorded", async () => {
    const failure = new Error("spawn opencode ENOENT")
    const runtime = fakeRuntime(createFakeService(), { running: false, startError: failure })
    await expect(runtime.start(["opencode"], { env: {} })).rejects.toBe(failure)
    expect(runtime.started).toHaveLength(1)
    expect(await runtime.discover()).toBeUndefined()
  })

  test("a start that never brings the service up", async () => {
    const runtime = fakeRuntime(createFakeService(), { running: false, startsAfterPolls: Infinity })
    await runtime.start(["opencode"], { env: {} })
    for (let poll = 0; poll < 5; poll++) expect(await runtime.discover()).toBeUndefined()
  })

  test("sleep advances the virtual clock at once and honours the signal", async () => {
    const runtime = fakeRuntime(createFakeService())
    const before = runtime.now()
    await runtime.sleep(250)
    expect(runtime.now() - before).toBe(250)
    expect(runtime.clock.now).toBe(runtime.now())
    const aborted = await runtime.sleep(250, AbortSignal.abort()).catch((e: unknown) => e)
    expect((aborted as Error).name).toBe("AbortError")
    expect(runtime.now() - before).toBe(250)
  })
})
