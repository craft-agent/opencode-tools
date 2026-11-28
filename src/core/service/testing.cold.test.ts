import { describe, expect, test } from "bun:test"
import { OpenCode, isLocationNotFoundError, type OpenCodeClient } from "@opencode/client"
import { FAKE_ENDPOINT, createFakeService, type FakeService } from "./testing"

const DIRECTORY = "/work/acme"
const OTHER = "/work/other"
const GIT = { provider: "git", branch: { current: "main" } }

function clientOf(service: FakeService): OpenCodeClient {
  return OpenCode.make({ baseUrl: FAKE_ENDPOINT.url, headers: FAKE_ENDPOINT.headers, fetch: service.fetch })
}

const at = (directory: string) => ({ location: { directory } })

/** What each route that depends on the directory being loaded answers, as its number of entries or a flag. */
async function answers(client: OpenCodeClient, directory: string) {
  const location = at(directory)
  return {
    agents: (await client.agent.list(location)).data.length,
    providers: (await client.provider.list(location)).data.length,
    models: (await client.model.list(location)).data.length,
    plugins: (await client.plugin.list(location)).data.length,
    defaultModel: (await client.model.default(location)).data !== null,
  }
}

const COLD = { agents: 0, providers: 0, models: 0, plugins: 0, defaultModel: false }
const LOADED = { agents: 3, providers: 1, models: 2, plugins: 2, defaultModel: true }

describe("a directory the fake has not loaded", () => {
  test("answers with nothing in it for the first two requests that name it, then in full", async () => {
    const client = clientOf(createFakeService())
    expect((await client.agent.list(at(DIRECTORY))).data).toEqual([])
    expect((await client.plugin.list(at(DIRECTORY))).data).toEqual([])
    expect((await client.plugin.list(at(DIRECTORY))).data).toHaveLength(2)
    expect((await client.agent.list(at(DIRECTORY))).data).toHaveLength(3)
  })

  test("answers every route that depends on it as for a directory with nothing in it", async () => {
    const service = createFakeService({ coldReads: Infinity, repositories: { [DIRECTORY]: { vcs: GIT, status: [] } } })
    const client = clientOf(service)
    expect(await answers(client, DIRECTORY)).toEqual(COLD)
    expect((await client.vcs.get(at(DIRECTORY))).data).toEqual({ branch: {} })
    expect((await client.vcs.status(at(DIRECTORY))).data).toEqual([])
    expect((await client.model.default(at(DIRECTORY))).data).toBeNull()
  })

  test("is loaded at once with coldReads 0, and never with Infinity", async () => {
    expect(await answers(clientOf(createFakeService({ coldReads: 0 })), DIRECTORY)).toEqual(LOADED)
    const never = clientOf(createFakeService({ coldReads: Infinity }))
    for (let round = 0; round < 5; round++) expect((await never.plugin.list(at(DIRECTORY))).data).toEqual([])
  })

  test("counts each directory on its own, and takes a request naming none as loaded", async () => {
    const client = clientOf(createFakeService({ coldReads: 1 }))
    expect((await client.agent.list(at(DIRECTORY))).data).toEqual([])
    expect((await client.agent.list(at(OTHER))).data).toEqual([])
    expect((await client.agent.list(at(DIRECTORY))).data).toHaveLength(3)
    expect((await client.agent.list(at(OTHER))).data).toHaveLength(3)
    expect((await client.agent.list()).data).toHaveLength(3)
    expect((await clientOf(createFakeService({ coldReads: Infinity })).agent.list()).data).toHaveLength(3)
  })

  test("follows the state as it is at each request", async () => {
    const service = createFakeService({ coldReads: Infinity })
    const client = clientOf(service)
    expect((await client.agent.list(at(DIRECTORY))).data).toEqual([])
    service.state.coldReads = 0
    expect((await client.agent.list(at(DIRECTORY))).data).toHaveLength(3)
  })

  test("still answers a directory the state lists as missing with not found", async () => {
    const client = clientOf(createFakeService({ missing: [DIRECTORY], coldReads: Infinity }))
    expect(isLocationNotFoundError(await client.plugin.list(at(DIRECTORY)).catch((e: unknown) => e))).toBe(true)
    expect(isLocationNotFoundError(await client.location.get(at(DIRECTORY)).catch((e: unknown) => e))).toBe(true)
  })
})

describe("a loaded directory's version control", () => {
  const repository = { [DIRECTORY]: { vcs: GIT, status: [] } }
  const vcsOf = async (client: OpenCodeClient) => (await client.vcs.get(at(DIRECTORY))).data

  test("shows nothing for vcsLagReads requests after the load, then what the repository has", async () => {
    const client = clientOf(createFakeService({ coldReads: 0, vcsLagReads: 2, repositories: repository }))
    expect(await vcsOf(client)).toEqual({ branch: {} })
    expect(await vcsOf(client)).toEqual({ branch: {} })
    expect(await vcsOf(client)).toEqual(GIT)
    expect(await vcsOf(client)).toEqual(GIT)
  })

  test("is not spent while the directory is still loading, and is one lag read by default", async () => {
    const client = clientOf(createFakeService({ repositories: repository }))
    expect(await vcsOf(client)).toEqual({ branch: {} })
    expect(await vcsOf(client)).toEqual({ branch: {} })
    expect(await vcsOf(client)).toEqual({ branch: {} })
    expect(await vcsOf(client)).toEqual(GIT)
  })

  test("has no lag with vcsLagReads 0, and shows a directory that is no repository as one with no version control", async () => {
    expect(
      await vcsOf(clientOf(createFakeService({ coldReads: 0, vcsLagReads: 0, repositories: repository }))),
    ).toEqual(GIT)
    const plain = clientOf(createFakeService({ coldReads: 0, vcsLagReads: 0 }))
    expect(await vcsOf(plain)).toEqual({ branch: {} })
  })
})

describe("the plugin, location and project routes", () => {
  test("plugin.list gives the plugins of the state once the directory is loaded", async () => {
    const service = createFakeService({ coldReads: 0 })
    const { data } = await clientOf(service).plugin.list(at(DIRECTORY))
    expect(data.map((plugin) => [plugin.id, plugin.state.status])).toEqual([
      ["acme.one", "active"],
      ["acme.two", "active"],
    ])
    service.state.plugins = []
    expect((await clientOf(service).plugin.list(at(DIRECTORY))).data).toEqual([])
  })

  test("location.get answers in full from the first request and does not count as a read", async () => {
    const client = clientOf(createFakeService({ coldReads: 1 }))
    expect(await client.location.get(at(DIRECTORY))).toEqual({
      directory: DIRECTORY,
      project: { id: `project:${DIRECTORY}`, directory: DIRECTORY, canonical: DIRECTORY },
    })
    expect((await client.agent.list(at(DIRECTORY))).data).toEqual([])
  })

  test("project.list names a project for each repository, with vcs git, and for every other directory named so far, without", async () => {
    const client = clientOf(
      createFakeService({
        coldReads: 0,
        repositories: { [DIRECTORY]: { vcs: GIT, status: [] }, "/work/nogit": { vcs: { branch: {} }, status: [] } },
      }),
    )
    await client.agent.list(at(OTHER))
    const projects = await client.project.list()
    expect(projects.map((project) => [project.id, project.vcs])).toEqual([
      [`project:${DIRECTORY}`, "git"],
      ["project:/work/nogit", undefined],
      [`project:${OTHER}`, undefined],
    ])
    expect(projects.every((project) => project.canonical === project.id.slice("project:".length))).toBe(true)
  })

  test("project.list does not list a directory that was not found", async () => {
    const client = clientOf(createFakeService({ missing: [OTHER], coldReads: 0 }))
    await client.agent.list(at(OTHER)).catch(() => {})
    expect(await client.project.list()).toEqual([])
  })
})
