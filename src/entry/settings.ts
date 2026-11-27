import { homedir } from "node:os"
import { isAbsolute, join, resolve as resolvePath, sep } from "node:path"
import {
  ToolError,
  type GrantContext,
  type JsonObject,
  type OptionSpec,
  type OptionType,
  type ToolOptions,
  type ToolOptionValue,
  type ToolSettings,
  type Toolsets,
} from "../core"
import { PROJECT } from "../project"
import { PROJECT_PROFILE, type EntryProfile } from "./profile"

/** Who asks the person before an administrative tool acts: the harness, or the tool through the client's form. */
export type ConfirmMode = "harness" | "elicitation"

/** The tool settings, the values of the package's own settings (`options`, possibly empty), the grants' context and the caller, when one is set. */
export type ToolEntrySettings = ToolSettings & { options: ToolOptions; grants: GrantContext; caller?: string }

/** The tool settings, who confirms, the values of the package's own settings and the grants' context. */
export type EntrySettings = ToolEntrySettings & { confirm: ConfirmMode }

const CONFIRM_MODES: readonly ConfirmMode[] = ["harness", "elicitation"]
const ALL_TOOLSETS = "all"
const TRUE_VALUES: readonly string[] = ["1", "true"]
const FALSE_VALUES: readonly string[] = ["0", "false"]
const GRANT_KEY_SUFFIX = "GRANT_KEY"
const MIN_GRANT_KEY_LENGTH = 32
const GRANTS_DIR_NAME = "grants"

/** The most characters a caller may have. */
export const MAX_CALLER_LENGTH = 200

type OptionName =
  "toolsets" | "read_only" | "tools" | "exclude_tools" | "confirm" | "unattended" | "grants_dir" | "caller"

const TARGET_OPTION_NAMES = ["unattended", "grants_dir", "caller"] as const satisfies readonly OptionName[]

/** A setting's command-line flag and the end of its environment variable, which follows the profile's prefix; a boolean flag takes no value. */
type Option = { flag: string; envSuffix: string; boolean?: true }

const OPTIONS: Record<OptionName, Option> = {
  toolsets: { flag: "--toolsets", envSuffix: "TOOLSETS" },
  read_only: { flag: "--read-only", envSuffix: "READ_ONLY", boolean: true },
  tools: { flag: "--tools", envSuffix: "TOOLS" },
  exclude_tools: { flag: "--exclude-tools", envSuffix: "EXCLUDE_TOOLS" },
  confirm: { flag: "--confirm", envSuffix: "CONFIRM" },
  unattended: { flag: "--unattended", envSuffix: "UNATTENDED", boolean: true },
  grants_dir: { flag: "--grants-dir", envSuffix: "GRANTS_DIR" },
  caller: { flag: "--caller", envSuffix: "CALLER" },
}

function profileOptions(profile: EntryProfile): NonNullable<EntryProfile["options"]> {
  return profile.options ?? {}
}

function settingOptions(profile: EntryProfile): Record<string, Option> {
  const toolOptions = Object.entries(profileOptions(profile)).map(([name, spec]): [string, Option] => [
    name,
    {
      flag: `--${name.replace(/_/g, "-")}`,
      envSuffix: name.toUpperCase(),
      ...(optionType(spec) === "boolean" && { boolean: true as const }),
    },
  ])
  return { ...OPTIONS, ...Object.fromEntries(toolOptions) }
}

function envName(name: string, profile: EntryProfile): string {
  return `${profile.envPrefix}_${settingOptions(profile)[name]!.envSuffix}`
}

/** The environment variables the settings are read from, in the order the settings are listed. */
export function settingVariables(profile: EntryProfile = PROJECT_PROFILE): string[] {
  return Object.keys(settingOptions(profile)).map((name) => envName(name, profile))
}

/** The environment variable of the grant key, which is never a flag: `<envPrefix>_GRANT_KEY`. */
export function grantKeyVariable(profile: EntryProfile = PROJECT_PROFILE): string {
  return `${profile.envPrefix}_${GRANT_KEY_SUFFIX}`
}

/** The environment variables a harness that forwards only named variables must pass the server: the settings' variables, the grant key's, then the package's `toolVariables`. */
export function forwardedVariables(
  profile: EntryProfile = PROJECT_PROFILE,
  toolVariables: readonly string[] = PROJECT.toolVariables,
): string[] {
  return [...settingVariables(profile), grantKeyVariable(profile), ...toolVariables]
}

function readFlags(argv: string[], profile: EntryProfile): Record<string, string> {
  const byFlag = new Map(
    Object.entries(settingOptions(profile)).map(([name, option]) => [option.flag, { name, ...option }]),
  )
  const given: Record<string, string> = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    const equals = arg.indexOf("=")
    const flag = equals === -1 ? arg : arg.slice(0, equals)
    const option = byFlag.get(flag)
    if (!arg.startsWith("--") || !option) throw new ToolError("invalid_argument", `Unknown option "${arg}".`)
    if (option.boolean) {
      if (equals !== -1) throw new ToolError("invalid_argument", `Option ${flag} takes no value.`)
      given[option.name] = "true"
      continue
    }
    const value = equals === -1 ? argv[++i] : arg.slice(equals + 1)
    if (value === undefined || (equals === -1 && value.startsWith("--"))) {
      throw new ToolError("invalid_argument", `Option ${flag} needs a value.`)
    }
    given[option.name] = value
  }
  return given
}

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "")
}

function checkToolsets(names: string[], source: string, toolsets: Toolsets): string[] | "all" | undefined {
  if (names.includes(ALL_TOOLSETS)) return ALL_TOOLSETS
  const unknown = names.find((name) => !toolsets.names.includes(name))
  if (unknown !== undefined) {
    const known =
      toolsets.names.length > 0
        ? `use one of ${toolsets.names.join(", ")} or "${ALL_TOOLSETS}"`
        : "no toolsets are defined"
    throw new ToolError("invalid_argument", `Unknown toolset "${unknown}" in ${source}; ${known}.`)
  }
  return names.length ? names : undefined
}

function parseBoolean(value: string, source: string): boolean {
  const text = value.trim().toLowerCase()
  if (TRUE_VALUES.includes(text)) return true
  if (FALSE_VALUES.includes(text)) return false
  throw new ToolError(
    "invalid_argument",
    `Unknown value "${value}" in ${source}; use one of ${[...TRUE_VALUES, ...FALSE_VALUES].join(", ")}.`,
  )
}

function parseConfirm(value: string, source: string): ConfirmMode {
  const mode = CONFIRM_MODES.find((candidate) => candidate === value)
  if (!mode) {
    throw new ToolError(
      "invalid_argument",
      `Unknown confirm mode "${value}" in ${source}; use one of ${CONFIRM_MODES.join(", ")}.`,
    )
  }
  return mode
}

function parseNumber(value: string, source: string): number {
  const trimmed = value.trim()
  const parsed = trimmed === "" ? Number.NaN : Number(trimmed)
  if (!Number.isFinite(parsed)) {
    throw new ToolError("invalid_argument", `Unknown number "${value}" in ${source}; use a finite number.`)
  }
  return parsed
}

/** A setting given as text, and where it came from, for error messages. */
type SettingText = { text: string; source: string }

type Environment = Record<string, string | undefined>

/** The home directory: `env.HOME` when absolute, else the user's. */
function homeOf(env: Environment): string {
  return env.HOME !== undefined && isAbsolute(env.HOME) ? env.HOME : homedir()
}

/** The path a `path` setting names: `~` stands for the home directory, the result must be absolute and is normalized. */
function absolutePath(text: string, source: string, env: Environment): string {
  const home = homeOf(env)
  const expanded =
    text === "~" || text.startsWith("~/") || text.startsWith(`~${sep}`) ? join(home, text.slice(1)) : text
  if (!isAbsolute(expanded)) throw new ToolError("invalid_argument", `${source} must be an absolute path.`)
  return resolvePath(expanded)
}

function absolutePaths(items: string[], source: string, env: Environment): string[] | undefined {
  return items.length > 0 ? items.map((item) => absolutePath(item, source, env)) : undefined
}

/** The path a setting given as text names; blank is unset. */
function pathText(given: SettingText, env: Environment): string | undefined {
  const text = nonBlank(given.text)
  return text === undefined ? undefined : absolutePath(text, given.source, env)
}

function envText(
  name: string,
  env: Record<string, string | undefined>,
  profile: EntryProfile,
): SettingText | undefined {
  const variable = envName(name, profile)
  const text = env[variable]
  return text === undefined || text.trim() === "" ? undefined : { text, source: variable }
}

type OptionBounds = { type: OptionType; integer?: true; min?: number; max?: number }

function optionType(spec: OptionSpec): OptionType {
  return typeof spec === "string" ? spec : spec.type
}

function itemCount(count: number): string {
  return count === 1 ? "1 item" : `${count} items`
}

function numberBoundsError({ integer, min, max }: OptionBounds, source: string): ToolError {
  const range =
    min !== undefined && max !== undefined
      ? ` from ${min} to ${max}`
      : min !== undefined
        ? ` of at least ${min}`
        : max !== undefined
          ? ` of at most ${max}`
          : ""
  return new ToolError("invalid_argument", `${source} must be ${integer ? "a whole number" : "a number"}${range}.`)
}

function countBoundsError({ min, max }: OptionBounds, source: string): ToolError {
  const range =
    min !== undefined && max !== undefined
      ? `from ${min} to ${max} items`
      : min !== undefined
        ? `at least ${itemCount(min)}`
        : `at most ${itemCount(max!)}`
  return new ToolError("invalid_argument", `${source} must list ${range}.`)
}

/** The value a setting given by `source` may take: one that is given must meet its declaration's bounds; an unset one is not checked. */
function withinBounds(
  spec: OptionSpec,
  value: ToolOptionValue | undefined,
  source: string,
): ToolOptionValue | undefined {
  if (value === undefined || typeof spec === "string") return value
  const bounds: OptionBounds = spec
  const { integer, min, max } = bounds
  if (typeof value === "number") {
    if (
      (integer && !Number.isInteger(value)) ||
      (min !== undefined && value < min) ||
      (max !== undefined && value > max)
    ) {
      throw numberBoundsError(bounds, source)
    }
  } else if (
    Array.isArray(value) &&
    ((min !== undefined && value.length < min) || (max !== undefined && value.length > max))
  ) {
    throw countBoundsError(bounds, source)
  }
  return value
}

function parseOptionText(spec: OptionSpec, given: SettingText, env: Environment): ToolOptionValue | undefined {
  return withinBounds(spec, parseTypedText(optionType(spec), given, env), given.source)
}

function parseTypedText(kind: OptionType, given: SettingText, env: Environment): ToolOptionValue | undefined {
  switch (kind) {
    case "text":
      return nonBlank(given.text)
    case "boolean":
      return parseBoolean(given.text, given.source)
    case "number":
      return parseNumber(given.text, given.source)
    case "list": {
      const items = splitList(given.text)
      return items.length > 0 ? items : undefined
    }
    case "path":
      return pathText(given, env)
    case "paths":
      return absolutePaths(splitList(given.text), given.source, env)
    case "json":
      return parseJsonObject(given)
  }
}

/** The JSON object a `json` setting holds; an object with no keys is unset. The error never quotes the text. */
function parseJsonObject({ text, source }: SettingText): JsonObject | undefined {
  if (nonBlank(text) === undefined) return undefined
  const notObject = new ToolError("invalid_argument", `${source} must be a JSON object.`)
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw notObject
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw notObject
  return Object.keys(parsed).length > 0 ? (parsed as JsonObject) : undefined
}

function optionsFrom(
  flags: Record<string, string>,
  env: Record<string, string | undefined>,
  profile: EntryProfile,
): ToolOptions {
  const options: Record<string, ToolOptionValue> = {}
  for (const [name, spec] of Object.entries(profileOptions(profile))) {
    if (flags[name] !== undefined) {
      const parsed = parseOptionText(spec, { text: flags[name], source: settingOptions(profile)[name]!.flag }, env)
      if (parsed !== undefined) options[name] = parsed
      continue
    }
    const fromEnv = envText(name, env, profile)
    if (fromEnv !== undefined) {
      const parsed = parseOptionText(spec, fromEnv, env)
      if (parsed !== undefined) options[name] = parsed
    }
  }
  return options
}

/** The grant key from `<envPrefix>_GRANT_KEY`; unset or blank is no key, and one under 32 characters is `invalid_argument` that never quotes it. */
function grantKey(env: Environment, profile: EntryProfile): Buffer | undefined {
  const variable = grantKeyVariable(profile)
  const value = env[variable]
  if (value === undefined || value.trim() === "") return undefined
  if (value.length < MIN_GRANT_KEY_LENGTH) {
    throw new ToolError("invalid_argument", `${variable} must be at least ${MIN_GRANT_KEY_LENGTH} characters.`)
  }
  return Buffer.from(value, "utf8")
}

/** Where grants are kept unless a setting says: `<XDG_STATE_HOME>/<name>/grants` when that variable is absolute, else under `<home>/.local/state`. */
function defaultGrantsDir(env: Environment, profile: EntryProfile): string {
  const state = env.XDG_STATE_HOME
  const stateHome = state !== undefined && isAbsolute(state) ? state : join(homeOf(env), ".local", "state")
  return join(stateHome, profile.name, GRANTS_DIR_NAME)
}

/** The grants' context from the `unattended` and `grants_dir` settings, as parsed (`undefined` when unset), and the environment's key. */
function grantContext(
  unattended: boolean | undefined,
  dir: string | undefined,
  env: Environment,
  profile: EntryProfile,
): GrantContext {
  return {
    unattended: unattended ?? false,
    dir: dir ?? defaultGrantsDir(env, profile),
    key: grantKey(env, profile),
  }
}

/** The setting `name` as a flag gave it, else as its environment variable does; a blank variable counts as unset. */
function settingText(
  name: OptionName,
  flags: Record<string, string>,
  env: Environment,
  profile: EntryProfile,
): SettingText | undefined {
  return flags[name] !== undefined ? { text: flags[name], source: OPTIONS[name].flag } : envText(name, env, profile)
}

function grantsFromText(flags: Record<string, string>, env: Environment, profile: EntryProfile): GrantContext {
  const unattended = settingText("unattended", flags, env, profile)
  const dir = settingText("grants_dir", flags, env, profile)
  return grantContext(
    unattended && parseBoolean(unattended.text, unattended.source),
    dir && pathText(dir, env),
    env,
    profile,
  )
}

/** A caller as given by something other than a setting, such as a client's name: trimmed, cut to MAX_CALLER_LENGTH characters, and `undefined` when blank or not text. */
export function callerText(text: unknown): string | undefined {
  return typeof text === "string" ? nonBlank([...text.trim()].slice(0, MAX_CALLER_LENGTH).join("")) : undefined
}

/** The caller the `caller` setting names: trimmed, blank is unset, and one over MAX_CALLER_LENGTH characters is `invalid_argument`. */
function callerSetting(given: SettingText | undefined): string | undefined {
  const text = nonBlank(given?.text)
  if (given === undefined || text === undefined) return undefined
  if ([...text].length > MAX_CALLER_LENGTH) {
    throw new ToolError("invalid_argument", `${given.source} must be at most ${MAX_CALLER_LENGTH} characters.`)
  }
  return text
}

/**
 * Reads the values of the package's own settings, the grants' context and the
 * caller from the command line and environment of a command that takes no
 * other setting (`target`): any other flag is `invalid_argument`.
 */
export function parseTargetSettings(
  argv: string[],
  env: Record<string, string | undefined>,
  profile: EntryProfile = PROJECT_PROFILE,
): Pick<ToolEntrySettings, "options" | "grants" | "caller"> {
  const flags = readFlags(argv, profile)
  const known = profileOptions(profile)
  const other = Object.keys(flags).find(
    (name) => !(name in known) && !TARGET_OPTION_NAMES.some((allowed) => allowed === name),
  )
  if (other !== undefined) {
    throw new ToolError("invalid_argument", `Unknown option "${settingOptions(profile)[other]!.flag}".`)
  }
  const caller = callerSetting(settingText("caller", flags, env, profile))
  return {
    options: optionsFrom(flags, env, profile),
    grants: grantsFromText(flags, env, profile),
    ...(caller !== undefined && { caller }),
  }
}

/**
 * Reads the settings every entry point takes from its command line and
 * environment (`<envPrefix>_<SETTING>` variables). A flag wins over its
 * environment variable; an empty list item is dropped. A mistake is
 * `invalid_argument` naming the culprit.
 */
export function parseSettings(
  argv: string[],
  env: Record<string, string | undefined>,
  profile: EntryProfile = PROJECT_PROFILE,
): EntrySettings {
  const flags = readFlags(argv, profile)
  const value = (name: OptionName) => settingText(name, flags, env, profile)

  const settings: EntrySettings = {
    confirm: "harness",
    options: optionsFrom(flags, env, profile),
    grants: grantsFromText(flags, env, profile),
  }
  const toolsets = value("toolsets")
  if (toolsets) settings.toolsets = checkToolsets(splitList(toolsets.text), toolsets.source, profile.toolsets)
  const readOnly = value("read_only")
  if (readOnly) settings.read_only = parseBoolean(readOnly.text, readOnly.source)
  const tools = value("tools")
  if (tools) settings.tools = splitList(tools.text)
  const excluded = value("exclude_tools")
  if (excluded) settings.exclude_tools = splitList(excluded.text)
  const confirm = value("confirm")
  if (confirm) settings.confirm = parseConfirm(confirm.text.trim(), confirm.source)
  const caller = callerSetting(value("caller"))
  if (caller !== undefined) settings.caller = caller
  return settings
}

/**
 * Reads the tool settings from a command line that has no `confirm` setting,
 * for entry points whose caller does the confirming: `--confirm` is
 * `invalid_argument`, and `<envPrefix>_CONFIRM` is ignored. Everything else
 * is read as `parseSettings` reads it.
 */
export function parseToolSettings(
  argv: string[],
  env: Record<string, string | undefined>,
  profile: EntryProfile = PROJECT_PROFILE,
): ToolEntrySettings {
  const { flag } = OPTIONS.confirm
  if (argv.some((arg) => arg === flag || arg.startsWith(`${flag}=`))) {
    throw new ToolError("invalid_argument", `Option ${flag} is not available here.`)
  }
  const { confirm: _confirm, ...settings } = parseSettings(
    argv,
    { ...env, [envName("confirm", profile)]: undefined },
    profile,
  )
  return settings
}

/** The environment variable of the `language` setting: `<envPrefix>_LANGUAGE`. */
export function languageVariable(profile: EntryProfile = PROJECT_PROFILE): string {
  return `${profile.envPrefix}_LANGUAGE`
}

function nonBlank(text: string | undefined): string | undefined {
  const trimmed = text?.trim()
  return trimmed === "" ? undefined : trimmed
}

/** The language of the prompt from a command line's `--language` value, else `<envPrefix>_LANGUAGE`, else the harness's own display language; blank values count as unset. */
export function promptLanguage(
  flag: string | undefined,
  env: Record<string, string | undefined>,
  harness: string | undefined,
  profile: EntryProfile = PROJECT_PROFILE,
): string | undefined {
  return nonBlank(flag) ?? nonBlank(env[languageVariable(profile)]) ?? nonBlank(harness)
}
