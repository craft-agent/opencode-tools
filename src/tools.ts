import type { ToolSpec } from "./core"
import { opencodeRunStart, opencodeRunStartWrite } from "./core/run/start.tool"
import { opencodeServiceRead } from "./core/service/read"

/** Every tool spec of the package; entry points register their tools from this list. */
export const ALL_TOOLS: ToolSpec[] = [opencodeServiceRead, opencodeRunStart, opencodeRunStartWrite]
