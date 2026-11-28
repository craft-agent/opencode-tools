/**
 * Test support for the tests of `opencode_request_read`: a caller of the tool
 * and the reads the tests make of the run in `request.testing.ts`. Imported by
 * tests only; it uses no test runner's API.
 */
import { invoke, type ToolContext } from "../tool"
import type { RequestOut, RequestReadOutput } from "./read.schemas"
import { opencodeRequestRead } from "./read.tool"
import { RUN } from "./request.testing"

/** Calls `opencode_request_read` as the entry points do. */
export function readRequests(args: Record<string, unknown>, ctx: ToolContext): Promise<RequestReadOutput> {
  return invoke(opencodeRequestRead, args, ctx)
}

/** `list` of the run. */
export function listRequests(ctx: ToolContext): Promise<RequestReadOutput> {
  return readRequests({ method: "list", session: RUN }, ctx)
}

/** `get` of one request of the run. */
export async function getRequest(ctx: ToolContext, request: string): Promise<RequestOut> {
  const result = await readRequests({ method: "get", session: RUN, request }, ctx)
  return result.request!
}

/** The requests `list` gave, which a test knows it has. */
export async function listed(ctx: ToolContext): Promise<RequestOut[]> {
  return (await listRequests(ctx)).requests!
}
