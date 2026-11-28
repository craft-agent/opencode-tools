import { cut } from "../describe"
import type { ServiceConnection } from "./connect"
import { MAX_ID, MAX_NAME, type CallOf, type ServiceReadOutput } from "./schemas"

/** Method `status`: the service's version, as the connection found it, and the configured roles. It asks the service for nothing more. */
export async function readStatus(checked: CallOf<"status">, service: ServiceConnection): Promise<ServiceReadOutput> {
  const roles = Object.entries(checked.roles).map(([name, role]) => ({
    name,
    agent: cut(role.agent, MAX_NAME),
    policy: role.policy,
    model: role.model === undefined ? null : cut(role.model, 2 * MAX_ID),
  }))
  return { method: "status", service_started: service.started, version: cut(service.version, MAX_NAME), roles }
}
