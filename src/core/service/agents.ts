import { cut } from "../describe"
import { modelText } from "../role"
import type { ServiceConnection } from "./connect"
import { idFits, listed } from "./listing"
import { agentsOf, type AgentEntry } from "./reply"
import { MAX_DESCRIPTION, MAX_NAME, type CallOf, type ServiceReadOutput } from "./schemas"

/** An agent's own model as text; null when it has none, or one whose provider, id or variant is too long to be used in a later call, which `leftOut` says. */
function modelOf(agent: AgentEntry): { text: string | null; leftOut: boolean } {
  const model = agent.model
  if (!model) return { text: null, leftOut: false }
  const fits = [model.providerID, model.id, model.variant ?? ""].every(idFits)
  return { text: fits ? modelText(model) : null, leftOut: !fits }
}

/** Method `agents`: the agents of the directory as the service lists them, hidden ones and subagents included. */
export async function readAgents(checked: CallOf<"agents">, service: ServiceConnection): Promise<ServiceReadOutput> {
  const { directory } = checked
  const all = agentsOf(await service.client.agent.list({ location: { directory } }))
  const usable = all.filter((agent) => idFits(agent.id))
  let modelLeftOut = false
  const { kept, truncated } = listed(
    usable.map((agent) => {
      const model = modelOf(agent)
      if (model.leftOut) modelLeftOut = true
      return {
        id: agent.id,
        name: cut(agent.name, MAX_NAME),
        mode: cut(agent.mode, MAX_NAME),
        hidden: agent.hidden,
        model: model.text,
        description: agent.description?.trim() ? cut(agent.description, MAX_DESCRIPTION) : null,
      }
    }),
  )
  return {
    method: "agents",
    service_started: service.started,
    directory,
    agents: kept,
    total: all.length,
    truncated: truncated || usable.length < all.length || modelLeftOut,
  }
}
