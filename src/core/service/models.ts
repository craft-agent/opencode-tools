import { cut } from "../describe"
import { ToolError } from "../errors"
import { shown } from "../text"
import type { ServiceConnection } from "./connect"
import { cleaned } from "./errors"
import { idFits, listed } from "./listing"
import { modelsOf, providersOf } from "./reply"
import { MAX_NAME, MAX_VARIANTS, type CallOf, type ServiceReadOutput } from "./schemas"

/** What the service can use in a directory: its providers and their models. */
async function providersAndModels(service: ServiceConnection, directory: string) {
  const location = { location: { directory } }
  const [providers, models] = await Promise.all([
    service.client.provider.list(location),
    service.client.model.list(location),
  ])
  return { providers: providersOf(providers), models: modelsOf(models) }
}

/** Method `providers`: the providers the service can use in the directory, each with the number of its models that can be used there. */
export async function readProviders(
  checked: CallOf<"providers">,
  service: ServiceConnection,
): Promise<ServiceReadOutput> {
  const { directory } = checked
  const { providers, models } = await providersAndModels(service, directory)
  const counts = new Map<string, number>()
  for (const model of models) counts.set(model.providerID, (counts.get(model.providerID) ?? 0) + 1)
  const usable = providers.filter((provider) => idFits(provider.id))
  const { kept, truncated } = listed(
    usable.map((provider) => ({
      id: provider.id,
      name: cut(provider.name, MAX_NAME),
      models: counts.get(provider.id) ?? 0,
    })),
  )
  return {
    method: "providers",
    service_started: service.started,
    directory,
    providers: kept,
    total: providers.length,
    truncated: truncated || usable.length < providers.length,
  }
}

/** Method `models`: the models of one provider the service can use in the directory, in the service's order, those that match `match` when it is given. */
export async function readModels(checked: CallOf<"models">, service: ServiceConnection): Promise<ServiceReadOutput> {
  const { directory, provider } = checked
  const { providers, models } = await providersAndModels(service, directory)
  if (!providers.some((candidate) => candidate.id === provider)) {
    throw new ToolError(
      "not_found",
      `No provider ${shown(provider)} can be used in ${cleaned(directory)}; method providers lists those that can.`,
    )
  }
  const needle = checked.match?.toLowerCase()
  const matching = models.filter(
    (model) =>
      model.providerID === provider &&
      (needle === undefined || model.id.toLowerCase().includes(needle) || model.name.toLowerCase().includes(needle)),
  )
  const usable = matching.filter((model) => idFits(model.id))
  let variantsCut = false
  const { kept, truncated } = listed(
    usable.map((model) => {
      const ids = model.variants.map((variant) => variant.id)
      const variants = ids.filter(idFits).slice(0, MAX_VARIANTS)
      if (variants.length < ids.length) variantsCut = true
      return { id: model.id, name: cut(model.name, MAX_NAME), status: cut(model.status, MAX_NAME), variants }
    }),
  )
  return {
    method: "models",
    service_started: service.started,
    directory,
    provider,
    models: kept,
    total: matching.length,
    truncated: truncated || usable.length < matching.length || variantsCut,
  }
}
