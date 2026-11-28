import { isToolError } from "../errors"
import type { ServiceConnection } from "../service/connect"
import { messagesOf, type RetryEntry } from "../service/reply.run"

/** The attempt at which a wait gives up on a run that keeps retrying its provider. */
export const RETRY_HANDBACK_ATTEMPT = 3

/** What an error of the provider names when more attempts will not cure it: a limit, or a login the provider refused. */
const UNCURABLE = /rate|limit|quota|auth/
const PROVIDER_ERROR_PREFIX = "provider."

/** Whether a wait hands back a run that is retrying like this: from the third attempt on, and at once for a limit or a refused login. */
export function handsBack(retry: RetryEntry): boolean {
  if (retry.attempt >= RETRY_HANDBACK_ATTEMPT) return true
  const type = retry.error.type.toLowerCase()
  return type.startsWith(PROVIDER_ERROR_PREFIX) && UNCURABLE.test(type)
}

/** The retry a result shows of those found: one a wait hands back, else the one the service will try again last. */
export function pickRetry(retries: readonly RetryEntry[]): RetryEntry | undefined {
  return retries.find(handsBack) ?? [...retries].sort((a, b) => b.at - a.at)[0]
}

/**
 * The retry the newest assistant message of each session carries, if any: one
 * read of one message per session. A subagent's session that has vanished
 * has none; the run's own, `rootID`, is `not_found`.
 */
export async function readRetries(
  service: ServiceConnection,
  rootID: string,
  sessionIDs: readonly string[],
): Promise<RetryEntry[]> {
  const found = await Promise.all(
    [...new Set([rootID, ...sessionIDs])].map(async (sessionID) => {
      try {
        const page = await service.client.message.list({ sessionID, limit: 1, order: "desc", type: "assistant" })
        return messagesOf(page)[0]?.retry
      } catch (error) {
        if (sessionID !== rootID && isToolError(error) && error.code === "not_found") return undefined
        throw error
      }
    }),
  )
  return found.filter((retry): retry is RetryEntry => retry !== undefined)
}
