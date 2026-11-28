# Tool conventions

The rules every tool in this package follows, so tools read alike across
domains and harnesses. Each rule carries the reason it was chosen; a change
to a rule changes this file first, with its reason.

## Names

- **Tool IDs are `<prefix>_<domain>_<verb>`**: `<prefix>_note_read` and
  `<prefix>_note_create` for a `note` domain. The prefix is `toolPrefix` in
  `src/project.ts`; it keeps a name unambiguous where a harness lists every
  tool in one namespace. When the domain has a well-known command line,
  follow its word order, so a name maps to a command anyone can look up.
- **Each part starts with a lowercase letter**, followed by lowercase
  letters and digits, as in `<prefix>_ipv6_read`. Every harness accepts
  letters, digits and `_` in a tool name; some refuse a name that starts with
  a digit, which a part's first letter rules out.
- **The same ID in every entry point.** Permission rules and skills are
  written once, and an ID is a public interface: renaming one is a breaking
  change.
- **Verbs are plain**: `create`, `edit`, `delete`, `add`, `remove`, and these
  with a fixed meaning:

  | Verb      | Means                                                        |
  | --------- | ------------------------------------------------------------ |
  | `read`    | the one read tool of a domain (below)                        |
  | `resolve` | find which object a call means                               |
  | `ensure`  | create when missing, reuse when present; never a second copy |

- **One read tool per domain, one write tool per operation.**
  `<prefix>_<domain>_read` takes a `method` argument (`view`, `list`, …). A
  model picks tools worse as their number grows, and reads share one set of
  annotations, so folding them loses nothing. Writes stay apart because a
  merged write tool would carry its strictest class: creating something would
  ask like overwriting it.
- **Names stay within 40 characters**, so a client prefix such as
  `mcp__<server>__` still fits a 64-character limit. `defineTool` enforces
  the shape and the length; `src/tools.test.ts` enforces the prefix.

## Arguments

- **snake_case**, for arguments and for the keys of a result alike: one style
  for everything a model reads.
- **Lists change through flat arguments**: `add_tags`, `remove_tags`. Shallow
  schemas are read reliably by every model the harnesses run. An argument that
  replaces a whole list, where one is needed, is named for the list (`tags`)
  and its description says it replaces.
- **Unknown arguments are refused.** Every entry point validates the
  arguments as strict, so a misspelt one fails as `invalid_argument` instead
  of being ignored.
- **The tools' own install directory is never the working tree.** A harness
  may start a tool inside the directory the package is installed in.
  `ToolContext.ownDir` names it; a tool that reads the working tree refuses
  to treat that directory as the caller's, saying so.
- **The MCP server takes the call's directory from the client.** It uses a
  directory sent with the call (Codex), else the client's first usable root,
  else the process's working directory; never inside the install directory.
  This keeps a server started in its install directory out of the working tree.

## Results

- **A tool returns its data as a plain object**, with no `ok` envelope. Each
  entry point renders it: the MCP server as `structuredContent` with the
  tool's `outputSchema` plus the same JSON as text, a native plugin as a JSON
  string.
- **A failure throws.** Every harness then sees a failed call (`isError` over
  MCP) rather than a success that carries an error.
- **One exception: what a call created is never lost.** Once a tool has
  created something, a later step of the same call that fails does not throw.
  The result names what was created and lists the failed steps under
  `errors`, keyed by step (`StepErrors`).
- **Text a tool reads is returned as it is.** Content from files or services
  is data, never instructions; every read tool's description and the skills
  say so. Nothing is wrapped or rewritten.

## Errors

A thrown error carries a `code` a caller can branch on, and a message that
says what to do next.

| Code               | When                                                                       |
| ------------------ | -------------------------------------------------------------------------- |
| `not_found`        | the object does not exist, or the caller cannot see it                     |
| `forbidden`        | the caller lacks the permission the call needs                             |
| `invalid_argument` | the arguments cannot describe a valid call                                 |
| `stale`            | what the call relied on changed before it could finish                     |
| `unauthenticated`  | the service or program the tool calls is not logged in                     |
| `rate_limited`     | the service refused the call for its rate limit                            |
| `declined`         | the person declined a confirmation the tool asked for                      |
| `upstream_error`   | the service or program the tool calls failed; the message carries its text |
| `internal_error`   | a bug in a tool or an entry point, such as a result off its schema         |

A project adds a code to `src/core/errors.ts` and to this table together.

- **Structure the caller needs goes in `details`, not in the message.** When
  fixing the cause takes more than a sentence (the lint violations, the
  findings, the output of a hook), the error carries it as `details`: a JSON
  object with snake_case keys, like a result. A model then reads the fields
  instead of parsing them back out of prose; the message still says what to
  do next on its own.
- **`details` is fixed when the error is made.** `ToolError` keeps a frozen
  JSON copy, so every entry point renders the same value. The copy is what
  JSON makes of it (`undefined` is dropped, `NaN` becomes `null`), and a value
  JSON cannot write at all, such as a cycle or a `BigInt`, fails where it was
  thrown, as a bug, not where it is rendered.
- **Each entry point passes `details` on only when it is set**, so an error
  without it reads as it always did. The MCP server and the command line put
  it beside the code and the message, as `error.details`. The Hermes plugin,
  whose errors are text, appends it to `<code>: <message>` as JSON on a line
  of its own.
- The `errors` of a partial result (`StepErrors`) stay `<code>: <message>`
  strings.

## Write classes

Every tool belongs to one class, and the class sets its MCP annotations.
`openWorldHint` is `true` for every tool.

| Class             | Examples                              | `readOnlyHint` | `destructiveHint` | `idempotentHint` |
| ----------------- | ------------------------------------- | -------------- | ----------------- | ---------------- |
| read              | view, list, resolve                   | `true`         | —                 | `true`           |
| add               | create, add                           | `false`        | `false`           | `false`          |
| idempotent change | ensure, adding a tag                  | `false`        | `false`           | `true`           |
| overwrite         | editing a body or title, removing one | `false`        | `true`            | `true`           |
| administrative    | delete, visibility, publishing        | `false`        | `true`            | `false`          |

- **Overwriting counts as destructive**: it loses what was there, and
  harnesses that confirm only destructive tools should still ask before it.
- **A tool takes the strictest class its arguments can reach.**
- **The harness confirms writes.** Every MCP client asks before it runs a
  write tool, so the tool does not ask again by default. Administrative tools
  also carry `_meta["anthropic/requiresUserInteraction"]: true`, which makes
  Claude Code ask even under an allow rule.
- **A native plugin asks the harness's own permission before every non-read
  call**, since the tools a native plugin adds pass through no harness
  approval of their own.
- **It asks for everything the call writes to.** A write tool's `targets`
  resolver names what the call writes to, as the permission rules name it
  (a path, an account, a record). Anything it cannot tell, every tool
  without a resolver, and a target holding `*` or `?` (which a harness would
  store as a pattern) is `*`, and `*` is never stored. An "always" answer then
  covers only what it named, never a write somewhere else.
- **It shows what the call carries, where the tool can say.** Targets are
  ids, so they cannot tell one kind of target from another, and the person
  decides on the text, the file or the kind of target as much as on where it
  goes. A write tool's `describe` says it. An MCP client draws the call's
  arguments in its own prompt, so the MCP server adds nothing.
- **Every native plugin's prompt has one shape**, so a person reads every
  tool's prompt the same way:

  ```text
  About to create "todo.md"

  --- Details ---

  Target: /work/tree/notes/todo.md
  Size: 42 bytes

  --- Note text ---

  # Todo
  ```

  The headline says what the agent is about to do, as its next step; the
  Details name each target on a `Target` line, then the tool's facts; the
  last section is the text the call carries, under the tool's own label. A
  section with nothing to show is left out, so a tool without `describe`
  shows its intent and its targets, and one whose targets cannot be told
  shows its intent alone. The harness names the tool beside the prompt, so
  the prompt does not repeat its id.

- **A write tool states its intent.** Besides its title, which names the
  tool wherever tools are listed, a write tool gives an `intent`: a fixed
  phrase in the headline's tone that carries no value (`About to create a
note`). The prompt shows it wherever no headline can stand: a tool without
  `describe`, a headline that is dropped, and one that gives way to keep the
  targets within the budget. A tool without an intent shows its title there.

- **The tool's words are fixed; what the call carries is data.** A model
  chooses the arguments and nothing else, and a prompt is only as good as the
  person's trust in its lines. The headline is the tool's intent, or a
  template the tool picks (`About to create {file}`) whose values the entry
  point quotes, so where the tool's words end and the call's data begins is
  always visible. A value comes from what the tool resolved, never from a
  model's account of it (the record's real name, not the name the model
  gave). The text section holds what the call writes, as it is, never a
  summary of it; a summary the tool can compute is a fact (`Size`, `Lines`).
- **Facts are short and ordered by what they decide.** A label is a noun of
  one or two words, in English like the tool's title, and a value carries
  its unit (`42 bytes`). A value with a unit or other words of the tool's is
  a template the tool picks with the values it holds (`{bytes} bytes` with
  `bytes: 42`), so the unit is the tool's word and the number the call's
  data; the tool picks the English form for the count (`{bytes} byte` for
  one), and numbers are shown as written, without digit grouping. A plain
  string value has no words of the tool's. The fact that changes the person's answer comes
  first (the kind of target, whether it overwrites); amounts come last. A
  fact never repeats the headline or a target. `src/core/facts.ts` holds the
  facts every package can use (`sizeFact`); a package adds its own beside its
  tools in the same form and lists them in its section below.
- **The head of the prompt comes first and fits; the text comes last.** Some
  harnesses cut a prompt from its end at a few hundred characters, so the
  headline, the targets and the facts are kept within the budget of where the
  prompt is shown, and the text is what is cut. A headline that would push a
  target past the cut gives way to the intent, since the targets are what an
  "always" answer stores. Facts that do not fit are counted on a notice
  line, which stays even when the head alone fills the budget: a person
  must know that something was left out. The facts a description drops past
  its eighth are counted on the same line, `(+N more)` after the facts, in
  every prompt, budget or none. A description keeps a
  headline template of 120 characters with values of 80, its first eight
  facts with labels of 40 characters and values of 200 (a value template of
  200 with at most eight values, the filled value cut to 200), and a text label of
  40 with a text of 2000; anything longer is cut with `…`. Nothing in the text
  can come before the facts, since the text is the last section.
- **A cut text says how much it leaves out.** A `…` also ends many ordinary
  messages, so it alone cannot tell a person that the text goes on, or how
  far. A text cut at its 2000 characters is followed by a notice line,
  `(+N more characters)`, and a fact's value cut at its 200 by the same
  notice after it on its line, where the line still fits the budget; a value
  the budget cuts further ends in `…` alone, since what it drops is no longer
  counted in the tool's characters. N counts the code points left out of what
  the tool gave, the unit the cut counts (`(+1 more character)` for one), and
  the notice is the plugin's own words, translated like the facts' notice.
  Only the head counts towards the budget, so the text's notice is lost
  wherever the harness cuts the text, which then shows its own end mark.
- **Characters other people wrote are shown, never obeyed.** A target's name
  or a file's name can hold control, bidi and invisible characters that
  forge a line of the prompt or hide part of a value; each is shown as
  `<U+XXXX>`, and a quote inside a headline value as `\"`. Where the prompt
  renders markup, everything but the plugin's own section lines is escaped,
  so a name cannot draw a link or a mention. The budget and the escaping are
  those of the surface the harness names. A surface the harness shows as
  written, such as its own clients, gets neither. A surface it names that the
  plugin does not know is one the harness does not cut, so it gets no budget,
  but it may render markup the plugin cannot tell, so it gets the strictest
  escaping of all: an escape shown as written reads as a stray backslash,
  while a name left unescaped can draw a link or a mention. A prompt whose
  surface cannot be told gets the strictest budget and escaping of all.
- **A description never stands between a call and its approval.** A tool
  without `describe`, a `describe` that fails, returns another shape or takes
  longer than 10 s gives the prompt it would have given without one. The
  approval is asked either way, and the targets are never lost with the
  description.
- **A call no answer may let run is refused before anyone is asked.** Some
  calls are out of reach whatever the person would say, such as one naming
  an object the settings keep away from the agent; a prompt for it would
  show what it names and invite an "allow" that cannot be honored. A tool
  that can tell such a call from its arguments and settings gives a `gate`
  (see "The core contract"). Every entry point runs it before the approval
  and again before `execute`, so a refusal is the call's result, as an
  error, and no prompt is drawn: the Hermes plugin asks nothing and blocks
  the call. Unlike `targets` and `describe`, a gate
  fails closed: one that cannot tell fails the call with `internal_error`.
  Where the question itself cannot be resolved (the Hermes plugin's `target`
  fails or times out), the person is asked as before, and the run refuses
  the call after the answer. An MCP client draws its own prompt before the server sees the call, so
  there the refusal comes after the client's question, never after the run.
- **A call runs on what its prompt showed.** What a person approves is what
  was true when the prompt was drawn; between the answer and the run, a file
  the call reads can be rewritten or a target can change kind. So a native
  plugin pins the prompt of every call whose tool has `describe`: the
  targets and the description, before translation, as one hash. The hash
  takes the description whole, before the budgets above cut it: a text past
  its 2000 characters, a value past its cut and the facts past the eighth
  are what the call carries too, so a change there is a change of the call
  even where the prompt could not show it. Right
  before the call runs, the entry point resolves both again, and a call
  whose hash differs, or whose description can no longer be told, fails with
  `stale` without running; the person is asked again on the next call. A
  call whose prompt showed no description pins nothing and runs as before,
  and so does every call of a tool without `describe`. A `describe` may also
  give `pins`, values the prompt does not show that the call must still find
  unchanged (a file's hash, beside a size that can stay the same); they go
  into the hash and nowhere else. A `describe` therefore gives the same
  answer for the same state: a value that changes on every call, such as the
  time, makes every call `stale`. The check narrows the gap between the
  answer and the run to the moment before `execute`; a tool that must close
  it entirely still checks inside `execute`. An MCP client draws the call's
  arguments, not a description, so the MCP server pins nothing.
- **The prompt speaks the language set for the harness.** A native plugin
  draws its prompt in the language of the `language` setting, else in the
  harness's own display language where it has one (Hermes's
  `display.language`), else in English. No harness tells a plugin who
  approves a call, so this is the language set where the plugin runs, not
  each person's. The server's locale (`LANG`) is never read: it is the
  machine's, and a person reading English on a machine set to another
  language would see the prompt change. A tag matches its own table, else
  the one of its first subtag (`ja-JP` and `ja_JP` are `ja`; `zh-Hant` can
  have its own), and a language the package has no words for falls back to
  English without a word. An MCP client draws its own prompt,
  so the MCP server takes no `language`.
- **Translations are tables keyed by the English words.** The plugin's own
  words (`Details`, `Target`, `(+N more)`) and a tool's (its title, its
  intent, its headline templates, its fact labels, its value templates and its text
  label) are written in
  English in the code. Per language, a package gives one table from those
  English words to their translation (`src/words.ts`), and the entry point
  looks each word up as it draws the prompt, so a tool's code does not change.
  A translated template must hold the same placeholders as the English one
  and keep within its limits, or the English one is used, so a translation
  cannot move the line between the tool's words and the call's data. Values
  are the call's data and are never translated: a value template is looked
  up and its values filled in after (`{bytes} バイト`), and a plain string
  value stays as the tool wrote it. A translation is marked like every other
  piece of the prompt.
- **`confirm: "elicitation"` adds the tool's own form** for administrative
  tools, where the client offers form-mode elicitation. It is for people who
  switch the client's approvals off: the tool states what will happen in plain
  words and stops on anything but an accept. Where the client does not offer
  elicitation the setting adds nothing, and the harness's approval is then the
  only confirmation.
- **Annotations are hints, not a boundary.** The `read_only` setting
  (below) is what keeps writes out.

## Toolsets and settings

Every entry point takes the same settings:

- **Toolsets**: one per domain, listed in `src/project.ts` with the ones on by
  default. A small default keeps the model's choice sharp.
- **`read_only`** registers no write tool, and wins over every other setting.
- **`tools` / `exclude_tools`** add or remove single tools; an exclusion wins
  over an inclusion.
- **`confirm`** is `harness` (the default) or `elicitation`; it says who asks
  before an administrative tool acts (see "Write classes"). The default leaves
  the question to the harness, whose approval every user already knows.
- **`language`** is the language of a native plugin's approval prompt (see
  "Write classes"); unset, the prompt follows the harness's display language
  or stays in English.
- **`emoji`** maps a toolset name to the emoji the Hermes plugin shows beside
  it, merged over the package's `TOOLSET_EMOJI`; `""` shows no emoji for that
  toolset, and no other entry point shows an emoji. A value that is not a
  mapping, an entry whose value is not a string, and a name that is no toolset
  are ignored rather than refused: the setting only changes what is shown, so a
  typo must not take every tool away.
- **`require_plugins`** names the Hermes plugins the Hermes plugin's writes
  depend on, such as a guard whose `pre_tool_call` block keeps writes from
  running unattended. Hermes drops a plugin that fails to import or register
  and loads the rest, and treats a manifest's `requires_plugins` as advisory,
  so a guard can vanish with nothing to say so. While any named plugin is not
  loaded (`ctx.has_plugin` says no, or cannot be asked), every call of a tool
  that is not a read is refused before its approval is asked, so neither YOLO,
  an approvals mode of `off` nor a remembered answer lets it run, and again
  before it runs. The refusal is `forbidden` with `details.reason`
  `missing_plugin` and `details.plugins` the names missing. Reads run as
  before. The check runs on every call, not at registration, since the order
  in which Hermes loads two plugins is not the plugins' to fix. Unset or
  empty, nothing is checked. A value that is not a list of names is refused,
  like a wrong `read_only`, and the plugin then registers nothing: ignoring it
  would loosen what the person asked for. No other entry point has it.
- **Options** are the package's own settings, the ones the tools themselves
  read, listed in `options` in `src/project.ts` (and `OPTIONS` in the Hermes
  plugin's `project.py`), each mapping a snake_case name to its type (`text`,
  `boolean`, `number`, `list`, `path` or `paths`) or a declaration with
  `{ type, integer, min, max }`. `integer: true` requires a whole `number`;
  `min` and `max` bound a `number` or count the items of a `list` or `paths`.
  Only `type` is required. Its flag is the name with `_` as `-` (a
  `boolean` flag takes no value), its variable is `<envPrefix>_<NAME>`
  uppercased, and its setting in the Hermes plugin's configuration is the name
  itself. A flag wins over its variable, a setting over its variable, and a
  blank text or path or
  empty list counts as unset. A `path` is trimmed; `~` alone or followed by
  `/` (or the platform separator) stands for the home directory: `HOME` when
  it is absolute, else the account's.
  The expanded path must be absolute and reaches the tool normalized, without
  a filesystem check. A `paths` value is a list of such paths, comma-separated
  in a flag or variable and a list in the Hermes plugin's configuration; items
  are
  trimmed and blank items dropped, and none left counts as unset. Bounds
  check only a value that is given, after blanks are dropped; unset stays
  unset. Refused values are `invalid_argument`, naming the flag or variable
  and what it must be. A package should not have to check a directory
  or a limit again inside its tool. They reach a tool as `context.options`,
  keyed by name, and one that is not given is absent: a neutral default means
  unset, and the tool then does nothing extra. A tool reads an option when it
  runs, so a change applies on the next call.
- **`unattended`** says that no person can answer a question, as in a
  scheduled job, CI or a headless run; **`grants_dir`** is the `path` where
  grants and their use are kept. See "Writes no one is there to approve".

## Writes no one is there to approve

When no person can answer, a harness either refuses a write or, with its
approvals skipped, runs it with no limit at all; a host's allow rule names a
tool and at most its targets, with no expiry, no count and nothing about what
the call carries. So a person delegates, in advance, a bounded set of writes,
and every entry point checks them the same way.

- **The person decides what to delegate; the package keeps only its
  guarantees.** A person who cannot delegate a write still runs it
  unattended through the host, with no bound and no record, so a rule that
  narrows what can be delegated protects nothing and only pushes the person
  there. The package limits a grant only where the mechanism needs it: the
  expiry ceiling, that only a person's answer creates a grant, and the
  signatures, the log and the lock. Everything else (which tool, which
  targets, which bounds, how many calls) is the person's choice, shown whole
  on the consent screen.

- **A setting says that no one can be asked.** No harness tells a plugin or
  an MCP server that its questions will go unanswered, and the modes that
  skip approvals are the ones with no person in the loop, so nothing is
  inferred from them. `unattended` says it. Off, the default, nothing changes
  and grants are not read. On, a read runs as before and a write runs only
  under a live grant that covers it.
- **Every write tool can be granted; a tool may add what a grant can
  bound.** A grant over any write tool limits its targets, its rate and its
  expiry. `bounds` adds more, naming each bound with its kind: `max` (a whole
  number the call must stay at or under, such as a text's length in
  characters), `allow` (whether the call may do one thing, such as attach a
  file), `oneOf` (the values the call may use, such as DNS record types) or
  `prefix` (the paths the call's values must sit under, such as the folders
  a file may be written to, for a set of values no tool could list ahead; the
  tool declares the one character its paths split at, such as `/`).
  `measure(args, context)` gives the call's value for each: a number, a
  boolean, or one or more of the declared values or paths. A path is matched
  as the string `measure` gives, so the tool gives it in the one form its
  target reads (relative parts resolved, case and suffixes settled); the
  package reads nothing into it. A tool declares at most six bounds and a
  grant's values must fit a fact (200 characters), so the consent screen
  shows every one. A bound is a fact about the call, computed the same way
  every time, never the model's account of it, and it is checked whole, never
  cut to a budget as a prompt's facts are.
- **A grant** names one tool, its targets, a value for the bounds the person
  limits, a rate in calls per hour or none, and an expiry of at most 90 days.
  Its targets are names, or `*` alone for any target, the call's included when
  it cannot be told; a pattern beside or inside a name is refused. Its paths
  for a `prefix` are compared as given: one that is blank, holds `*` or `?`
  or ends in the separator is refused, since a pattern grants more than it
  names and a trailing separator covers nothing the person was shown (so the
  separator alone cannot be granted). A call is covered when its
  tool matches, every target it resolves is among the grant's (or the
  grant's is `*`), every bound the grant sets is met by the measured value
  (at or under a `max`, `false` or allowed for an `allow`, every value among
  a `oneOf`'s, every value one of a `prefix`'s paths or under one, the
  separator right after it, so `a/b` covers `a/b/c` but never `a/bc`, which
  only shares its characters), the grant has not expired, and, when it sets
  a rate, fewer calls than the rate ran under it in the last 60 minutes. A
  bound the grant leaves out is no limit, and the consent screen says so; a
  measure that fails or returns another shape covers nothing under a grant
  that sets a bound. Where several grants cover a call, one that names its
  targets is used before a `*` one, then the one with the fewest targets,
  then the one that sets the most bounds, then the one that expires first.
  A call counts against its grant's rate whether it succeeds or fails, and
  every call is logged whether the grant sets a rate or not.
- **Grants restrict; the host still allows.** `invoke` checks the grant
  after the gate and before `execute`, so the MCP server and the command
  line's `run` enforce it too, and the Hermes plugin's `target` checks it
  before it asks, refusing without a question.
  The harness's own permission still decides whether the call reaches the
  package at all (an allow rule, an allowed-tools list, an approve mode), so
  a grant means the same in every harness and never lets a call through
  that the host would stop.
- **A refusal says why.** It is `forbidden`, with `details.reason`.
  `person_only` (a tool only a person's own answer may run), `no_key` and
  `tampered` (a grant or the log fails its MAC) refuse every call. Otherwise
  each grant that names the tool is checked in order, `expired`, `target` (a
  target outside the grant, or one that cannot be told, under a grant that
  names its targets), `bound` (named in
  `details.bound`) and `rate`, and the reason is the one of the grant that
  passed the most checks; `no_grant` when none names the tool. The message
  says what a person would change: a new grant, or waiting for the rate.
- **A person delegates; the agent only asks.** `<prefix>_grant_create`
  takes the tool, the targets, the bounds, the rate, the days it lasts and a
  reason. It is administrative, and its prompt is the consent screen: the
  headline names the tool (and says it may write anywhere under `*`), the
  facts the rate (or no limit), the expiry and every bound the tool declares
  (`no limit` for one left out), named targets stand as targets (a prompt
  shows no target line for `*`, so the headline carries it) and the reason
  as text, and the pin makes the
  grant exactly what the prompt showed. Widening or extending one is a new
  grant. `<prefix>_grant_read` lists the grants and their use, and
  `<prefix>_grant_revoke` removes one. They form the `grants` toolset, off by
  default.
- **Only a person's answer creates a grant.** A grant that the agent could
  give itself would bound nothing. `grant_create` is marked person-only: it is
  refused while `unattended` is on, no grant ever covers a person-only tool
  nor can one be created for it, and every
  entry point keeps a standing answer from covering it: the MCP server marks it
  `requiresUserInteraction` and asks through form elicitation where the
  client offers it, whatever `confirm` says, and the Hermes plugin gives each
  call a rule key of its own. A harness run with every approval skipped asks
  about nothing, and no package can tell; the README says so for each
  harness. Revoking only narrows, so `grant_revoke` runs while `unattended`
  is on without a grant.
- **Grants and their use are signed with a key the host supplies.** The
  variable `<envPrefix>_GRANT_KEY` (at least 32 characters; a variable only,
  never a flag or a setting, so it stays out of configuration files)
  keys an HMAC-SHA256 over each grant and over a chained log of every call
  made under one: the grant, the tool, the targets, the measured values, a
  digest of the arguments, when it started and how it ended. A grant or a
  log edited outside the package fails its MAC, and nothing runs under any
  grant until a person revokes the grant that fails (`grant_read` marks it)
  or, for the log, clears the directory. Without the
  key, while `unattended` is on, no write runs and no grant can be created.
  The files are written under a lock and replaced whole, since several
  processes may run calls at once. An earlier copy put back whole, MACs
  included, is not detected; the expiry bounds what it can bring back.

## Skills

- **A skill names the toolset it documents**, under `metadata` in its
  frontmatter:

  ```yaml
  metadata:
    toolset: notes
  ```

  The Agent Skills format allows no other top-level key, and its validators
  refuse one. The value is a plain or quoted one-line scalar; any other form
  reads as no link. A folder's name never links a skill, so every entry point
  reads the link the same way without knowing the package's toolsets.

- **A native plugin registers a linked skill only when its toolset is on**:
  when the settings register at least one tool of that toolset, from the same
  selection the tools come from. A skill that describes tools the model does
  not have invites calls that fail. So `read_only`, `tools` and
  `exclude_tools` count too: a toolset whose every tool is left out takes its
  skill with it. A skill with no link is always registered.
- **Plugins that install the skill folder whole cannot follow the settings**:
  Claude Code, Codex, Grok Build and Antigravity load every skill, since the
  settings reach only the MCP server.
- **Every linked skill names one of the package's toolsets**; a test checks
  it, since a misspelt link would hide the skill wherever it is filtered.
- **A skill that works across toolsets names the one it cannot work without.**
  The link holds one toolset, and a skill linked to none would be registered
  with every tool it describes turned off. Its body says which steps to skip
  when another toolset's tools are missing, and it leans only on toolsets that
  are on by default, since the plugins that install the skill folder whole
  list it whatever the settings select.

## The core contract

- A tool spec declares its ID, description, argument schema, output schema,
  toolset and write class; every entry point derives the same metadata from
  it. A write tool also declares `targets(args, context)`, which names what
  the call writes to.
- Any tool, read or write, may declare `gate(args, context)`, which throws a
  `ToolError` (usually `not_found`, worded as for an object that does not
  exist) for a call no approval may let run, and returns otherwise. `invoke`
  runs it after the arguments are checked and before `execute`; the entry
  points also run it before they ask (see "Write classes"). It is cheap, it
  reads only what it needs to decide, and its message says no more about
  the target than the arguments already do.
- A write tool may declare `bounds` and `measure(args, context)`, which say
  what a grant over it can limit beyond its targets, rate and expiry, and
  what this call's values are (see "Writes
  no one is there to approve"). `defineTool` refuses a `measure` without
  `bounds`, a bound of an unknown kind, a `oneOf` with no values, a `prefix`
  whose separator is not one character (or is blank, `*` or `?`) and more
  than six bounds.
- `execute(args, context)` gets the working directory, an abort signal, an
  optional `ownDir` (the directory the tools are installed in, never the
  working tree), the values of the package's own settings as `options` (see
  "Toolsets and settings"; `gate`, `describe` and `targets` get them too) and
  an optional `confirm(request) => Promise<boolean>` hook.
  Nothing in it names a harness. An entry point supplies `confirm` when the
  `elicitation` setting is on; without it the harness's approval stands, and a
  tool that needs a confirmation treats a missing hook as the harness having
  approved the call.
- `src/core/` uses only the `node:*` modules and plain dependencies, never a
  runtime's own globals (`Bun.spawn`, `Bun.file`, …), so the same code runs on
  Node and on Bun. It knows no project either: names, prefixes and toolsets
  come from `src/project.ts` through the entry points.

## Programs a tool runs

- **Every program a tool runs goes through one runner** built on `exec`, with
  an explicit environment: what the program needs to find itself and
  authenticate is passed through, and nothing else, so a stray variable
  cannot redirect a call. Prompts and colors are switched off, so nothing
  waits on a person and output parses the same everywhere.
- **Every variable the tools read besides the settings is named in
  `toolVariables` in `src/project.ts`**, whether a tool reads it itself or
  passes it through to a program. Codex gives a plugin's server only a few
  basic variables (`PATH`, `HOME` and the like) and those its manifest names,
  and `pnpm run manifests` writes that list from the settings and
  `toolVariables`: a variable left out is set everywhere but in Codex.
- **Every call has a time limit**, and a call that is stopped, by that limit
  or by cancellation, has its child process killed: `SIGTERM`, then `SIGKILL`
  after two seconds. A hung program neither holds a harness forever nor
  outlives its call.
- **The runner maps the program's failures to the error codes above.**

## Tests

- Tests sit beside the code they test (`*.test.ts`) and run on `bun test`;
  CI also starts the built MCP server and command line under Node and lists
  their tools, so a runtime-only API cannot slip in unnoticed.
- No test reaches a real service. A tool that runs a program is tested
  against a fake of that program on `PATH`.
- A test file stays within about 300 lines, split by topic
  (`<name>.<topic>.test.ts`), so one commit can carry a change and its test.

## The OpenCode tools

The rules below are opencode-tools' own, on top of everything above; where one
changes a rule above, it says so. The discussion behind them is on
[#2](https://github.com/craft-agent/opencode-tools/issues/2).

### Scope

- **The tools drive OpenCode sessions from another harness.** An agent starts
  a session under a role, follows it, steers it, answers what it asks and
  reads what it did, through the person's own OpenCode service.
- **Not from OpenCode itself.** The package has no OpenCode plugin, and a run
  is denied the package's own tools. A run that could start runs would need
  rules against the chain, and inside OpenCode one session already hands work
  to another through its subagents.
- **It knows no particular setup.** No profile, model, provider account, path
  or tool of another package appears in code, defaults, messages, examples,
  tests or skills. The one default that names anything is the two roles
  below, which are OpenCode's own agents.
- **A consumer's workflow is not the package's.** Tying a run to an issue,
  keeping a person's approval beside it, a job's phases and progress file,
  saving a reply as a report and estimating what a model's funding still
  holds are one consumer's way of working. A consumer builds them from the
  general parts here: a session's instruction entries, the notes and an
  output directory.

### Terms

The settings, messages, README, skills and code use one vocabulary:

| Term           | Means                                                                      |
| -------------- | -------------------------------------------------------------------------- |
| run            | a session the tools started and bound to a caller, with its subagents      |
| turn           | one brief of a run and the work that follows, until the session is idle    |
| caller         | whoever a call is made for: an opaque text the entry point supplies        |
| role           | a name for an OpenCode agent and a policy, with an optional model and note |
| policy         | what a run may change: `read-only` or `write`                              |
| ruleset        | the permission rules the package gives a run's session                     |
| request        | what a run is paused on: a permission request or a question                |
| brief          | the message that starts or continues a run                                 |
| operating note | the instruction every run carries about how it is being driven             |

### The service

- **The service is reached through OpenCode's own client**,
  `@opencode/client`. It is typed against the API the service publishes, and
  finding the service and authenticating to it stay OpenCode's contract
  rather than a file layout or a command's output the package would have to
  track.
- **The client is pinned to one version and bundled into the built files.**
  It promises no compatibility between versions, and its dependencies serve
  entry points the package never loads, so a consumer installs nothing for
  it. The package uses its root and its `/service` entry point only.
- **OpenCode is what the tools drive, not a harness they are delivered to**,
  so `src/core/` names it, in code and in messages.
- **Every tool starts a missing service, a read included.** A check of a
  directory's readiness that cannot ask a stopped service about its agents
  and models answers nothing. Starting it changes nothing a person keeps, so
  `read_only` still starts it, and a result says when the call did.
- **The service is found with the client's `discover` and started by the
  package itself**: `opencode serve --service` through the runner, left
  running, then found again within 30 seconds or the call fails as
  `upstream_error`. It is the one program the tools do not stop when its
  call ends, unlike every program under "Programs a tool runs": a service
  serves the calls that follow. A call that is cancelled before the start
  starts nothing. The client's `ensure` and `stop` are never called.
  `ensure` hands the service this process's whole environment, replaces a
  running service of another version when given one, and ends one that
  misses three checks; either would end a person's own sessions.
- **A missing service is started with a minimal environment.** A service
  keeps its starter's environment for every session it later serves, a
  person's own included. So the tools give it only what finds the person's
  programs and configuration, and never the harness's own variables: `PATH`,
  `HOME`, `USER`, `LOGNAME`, `SHELL`, `LANG`, `LANGUAGE`, `LC_ALL`,
  `LC_CTYPE`, `LC_MESSAGES`, `TERM`, `TMPDIR`, `TZ`, `XDG_CONFIG_HOME`,
  `XDG_DATA_HOME`, `XDG_STATE_HOME`, `XDG_CACHE_HOME` and `XDG_RUNTIME_DIR`.
  They are named one by one, in `toolVariables`, so a harness that forwards
  only named variables forwards them. What else a service needs a person
  adds in OpenCode's own service configuration; the package has no setting
  for it, and one can be added without breaking anything.
- **Every request has a time limit of ten seconds and ends with the call's
  abort signal.** The client has no limit of its own. The limit covers the
  whole request, so a tool that reads a stream sets its own.
- **A call ends within `wait_seconds` of its start**, whatever it had to do
  first. Starting a missing service, loading a directory, each request and a
  wait all draw on that one limit, and keep their own limits under it. A
  harness that ends a tool call after a minute then never cuts one off, where
  a start of the service, a load and a slow request once added up to more. A
  call that runs out fails as `upstream_error` and says what it was waiting
  for. The client's own search for the service, two seconds at most, is the
  one step the limit cannot end.
- **A failure maps to the codes above**: a missing session to `not_found`; a
  request the service calls invalid to `invalid_argument`; a refused or
  timed-out connection, a service that is starting or stopping, a status the
  route does not declare, a refusal without a name (as of a route this
  service does not have) and a reply that cannot be read to `upstream_error`.
  No message and no result carries the service's address or its password:
  where a message carries the service's own text, both are taken out of it.
- **A reply is checked where it is read.** The client does not validate what
  the service sends, so a tool checks the fields it uses, and a reply of
  another shape is `upstream_error`. A readiness check that took a malformed
  reply for a model would answer that a run can start.
- **A directory is read once the service has loaded it.** The first request
  for a directory the service has not opened answers at once with nothing in
  it: no agents, no providers, no repository. The service loads the
  directory in the background, and no read waits for that. So a tool that
  reads a directory first asks for its plugins until the service lists some,
  as OpenCode's own command line does, for up to fifteen seconds, and fails
  as `upstream_error` after that: a readiness check that answered from an
  empty reply would report a repository as none. The load takes a fraction
  of a second in a running service and a few seconds in one that has just
  started. Whether a directory is a
  repository is read from its project, which is settled before the first
  reply; its branch arrives later and is waited for briefly, then left out.
- **Asking about a directory opens it in OpenCode**, as starting OpenCode
  there would: the service keeps it as a project. A read changes nothing
  else.
- **OpenCode 2.4.2 is the minimum version.** Below it every tool fails as
  `upstream_error`, naming the version found and the minimum. Above it nothing
  is refused by version, and a tool whose route is missing fails alone: the
  service publishes no API version to gate on, and refusing every version not
  yet seen would break the tools at each OpenCode release. A development
  build's version, written `0.0.0-…` or not as `x.y.z` at all, is not refused
  either.
- **Stable routes only, with two exceptions**, each with what happens where
  the service refuses it. The instruction entries exist only as an
  experimental route: without it the operating note goes at the head of the
  brief, and the instruction tools fail as `upstream_error`. The commands a
  run moved to the background are listed and stopped only through the
  experimental job routes: without them an interrupt stops the run's
  sessions and says that the background was not checked.
- **The README lists the versions the tools are tested against.**

### Domains and names

- **Six domains, one toolset each**:

  | Domain        | Covers                                                              | Tools                                                                                                                                      |
  | ------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
  | `service`     | what the service offers, and whether a directory is ready for a run | `opencode_service_read`                                                                                                                    |
  | `run`         | starting, following, steering, stopping and copying a run           | `opencode_run_read`, `opencode_run_start`, `opencode_run_start_write`, `opencode_run_steer`, `opencode_run_interrupt`, `opencode_run_fork` |
  | `request`     | what a run is paused on, and answering it                           | `opencode_request_read`, `opencode_request_reply`                                                                                          |
  | `instruction` | the instruction entries a session keeps across turns                | `opencode_instruction_read`, `opencode_instruction_set`, `opencode_instruction_remove`                                                     |
  | `worktree`    | a worktree of its own for a write run                               | named with the domain's first tool                                                                                                         |
  | `history`     | sessions and token usage over a period                              | `opencode_history_read`                                                                                                                    |

- **On by default: `service`, `run` and `request`**, what commissioning a run
  needs. `instruction`, `worktree` and `history` are opt-in.
- **A role is the `role` argument of a start tool, never a tool of its own.**
  Tool ids are fixed when the package is built, and the manifests list them;
  roles are a person's configuration.
- **Two tools start a run, split by the role's policy.** `opencode_run_start`
  takes a role whose policy is `read-only`, and `opencode_run_start_write` one
  whose policy is `write`; each refuses the other's roles as
  `invalid_argument`, naming the tool to use. One tool for both would carry
  the write run's class, so a person could not let read-only runs start
  unasked and still be asked for each write run.
- **Waiting is a read.** `wait` is a method of `opencode_run_read`: it blocks
  and changes nothing.

### Write classes of run operations

| Operation                                | Class     | Why                                                                       |
| ---------------------------------------- | --------- | ------------------------------------------------------------------------- |
| Every domain's read, waiting included    | read      | changes nothing                                                           |
| Starting or continuing a read-only run   | add       | adds a session or a turn; its ruleset denies the edit tools               |
| Steering a turn                          | add       | adds a message to a turn that is already running                          |
| Forking a session                        | add       | adds a session; the one it copies stays as it is                          |
| Starting or continuing a write run       | overwrite | the run changes files in its worktree                                     |
| Interrupting a turn                      | overwrite | the turn's work in flight is lost; interrupting twice is the same as once |
| Answering a request                      | overwrite | an approval lets a command run that may not be undone                     |
| Setting or removing an instruction entry | overwrite | replaces or removes what the session was told                             |

- **`read_only` leaves no run to start.** Starting a run creates a session
  and spends a model's usage, so it is a write whatever the run's own policy;
  with `read_only` on, the tools read the caller's runs and nothing else.
- **Every write names its run's worktree directory as its target.** An answer
  a person gives for a worktree then covers the later calls there, a
  continued session and its forks included, and nowhere else. A session id
  would make a person answer again for each fork.
- **A start's prompt shows what will run.** Its facts are the role, the
  agent, the policy, the model and whether the session is new; its text is
  the brief.
- **An answer's prompt shows what it approves.** Its text is the whole command
  or tool call of each request, never a first line: in a compound command the
  part that needs approval is often the last. Its facts count the approvals,
  the rejections and the answers of the call.
- **A grant can bound a reply by the number of its approvals.** None lets a
  call reject, answer and decline only. The actions a call approves are not a
  bound: a call that approves nothing has none to measure, and a set of
  values takes at least one. What may never be approved is `never_approve`'s
  to say.
- **A steer's prompt shows the message**, as its text, with the role and the
  run's state as its facts. An interrupt's facts are the role, the run's
  state and what of it is active: it has no text. A fork's are the role and
  the session's title.
- **An instruction's prompt shows what the session will be told**: a set's
  text is the value and a remove's the value it removes, each with the key
  as a fact.
- **A grant can bound a steer by the length of its message, and a set by the
  length of its value**, as a brief is bounded. An interrupt, a fork and a
  remove have nothing to measure.
- **A grant can bound a start by role**, and a brief by its length in
  characters. The role is a bound of the `prefix` kind: a role's name cannot
  hold the separator, so the bound matches it exactly, and the contract needs
  no kind whose values a person's configuration would have to fill.

### The caller

- **The tool context gains `caller`, an opaque text.** A session belongs to
  the caller that started it, and only an entry point can say who that is.
  This adds to the context under "The core contract": `src/core/` still knows
  no harness, and compares a caller only for equality.
- **Each entry point supplies it.** The MCP server takes the `caller` setting,
  else the client's name from its initialization, else `mcp`, decided at the
  first call and kept for the connection, so a caller never changes under its
  sessions. The command line takes the `caller` setting, else `cli`. The
  Hermes plugin passes the id of the Hermes session a call belongs to, else
  `hermes`, and has no `caller` setting: its conversations are what it tells
  apart. A conversation that is reset gets a new session id and no longer
  sees its runs;
  [#10](https://github.com/craft-agent/opencode-tools/issues/10) settles
  whether the conversation's route replaces the id.
- **A session id that cannot be passed as it is becomes its SHA-256.** One
  over 200 characters, or holding a character a command line cannot carry or
  would trim, is passed as `sha256:` and the digest: cutting it would make
  two sessions one caller. The plugin's listing of the tools at its start
  passes `hermes`, so no variable of another entry point can stop it.
- **`caller` is a setting of the entry points, as `toolsets` is.** It reaches
  a tool as the context's `caller` and never among its options, so no entry
  point can leave it out. It is at most 200 characters, and blank is unset.
- **A harness that cannot tell its conversations apart is one caller.** An MCP
  server over standard input serves one client and is told nothing of its
  conversations, so every conversation of that client shares its runs.
- **A session of another caller, or of none, is out of reach.** It is not
  listed, and reading, steering or answering it fails as `not_found`, worded
  as for a session that does not exist. A session with no binding is a
  person's own.
- **The binding is cooperation, not protection.** It keeps callers that use
  the tools apart. Any process that can reach the service can act on every
  session, and nothing in the package says otherwise.

### Names in shared spaces

- **The session metadata key is `opencode-tools`**, the package's name, so it
  cannot collide with another plugin's key and says whose it is. It holds `v`
  (1), `caller`, `role`, `repository` and `branch`, and `starting` while a
  start sets the session up: the time and a token of that call. A domain that
  binds more adds its fields here first. A session's other metadata is kept:
  the service replaces metadata as a whole, so a tool writes back what it
  read with its own key changed.
- **An instruction entry the package owns is `opencode-tools.<name>`.**
  `opencode-tools.note` is the operating note, which a caller can read and
  can neither set nor remove.

### Roles

- **`roles` maps a name to `agent`, `policy` and, optionally, `model` and
  `note`.** A name is `[a-z][a-z0-9_]{0,23}`; `agent` is a primary agent the
  service lists; `model` is written as OpenCode writes one,
  `<provider>/<model>` with an optional `#<variant>`, and read as OpenCode
  reads it: the provider ends at the first `/`, and the variant starts after
  the first `#` that follows.
- **With no `roles` configured there are two**: `plan`, OpenCode's own `plan`
  agent with the `read-only` policy, and `build`, its own `build` agent with
  the `write` policy. They are the agents every OpenCode has, so the tools
  work as installed. Configured `roles` replace both.
- **A role that breaks the shape is refused when the settings are read**, as
  `invalid_argument` naming the role: a name outside the pattern, a missing
  `agent` or `policy`, a `model` not written as above, a key that is none of
  the four, or more than 20 roles. An entry point that started with a broken
  role would fail at the first run instead, far from the mistake.
- **Code keys on the policy, never on a role's or an agent's name.**

### A run's worktree

- **A run starts in the top level of a Git worktree.** A subdirectory is
  refused: the ruleset tells inside from outside by the session's directory,
  and the binding names the worktree.
- **The repository and the branch are read with git**, through the runner,
  with git's prompts off. The repository is the common directory a checkout
  and its linked worktrees share. The service knows a branch too, but late
  for a directory it has just opened, and a binding made from a branch that
  had not arrived would refuse the next turn. `ready` keeps asking the
  service: it reports what the service sees.
- **A detached HEAD is a worktree with no branch**, and is bound as that.
- **A session that has left its repository or its branch is not continued.**
  An agent can move its session with no permission asked, so both are read
  again at every start. A read runs no git: it shows where the session is.

### Starting a run

- **A session holds its agent, its model and its ruleset; a prompt carries
  none of them.** So a start sets them on the session and reads the session
  back before any prompt: the agent, the model, the ruleset, the binding and
  the directory. On a difference nothing is sent.
- **A start resolves its role with the function `ready` uses, before it
  creates a session.** The service checks an agent, a model and a variant
  only when the turn runs, where a mistake shows as a failed turn; and a
  `ready` that resolved otherwise would be a promise the start does not keep.
- **A continued session is set up again.** Its agent, its ruleset and its
  binding are sent with every start, so a role can change between turns: a
  session that planned can go on to build, through the write tool. Its model
  becomes the role's when the role names one and stays otherwise, since the
  service may have moved the session to another.
- **A start refuses a session that is running.** A prompt to one is never
  refused by the service, and even a queued one joins the turn in flight.
  Adding to a running turn is steering, a tool of its own.
- **The brief is sent queued, with an id the tool makes.** The service takes
  a prompt of the same id once.
- **A start does not wait for its turn.** It returns once the prompt is
  admitted, with the run's state then; waiting is a read.
- **Two starts in one worktree are told apart by the service, with no lock
  file.** A start marks its session's binding, then looks at the worktree's
  sessions; where it finds another's mark it sends nothing, takes its own
  mark back and is refused. Each looks after it has marked, so of two starts
  at once at least one sees the other; both may be refused, never both let
  through. A mark counts for a minute, and no longer once its session has
  run since. A lock on disk would be a record beside the service, and would
  not hold between two harnesses. Two continues of one session at the same
  instant are the case this cannot always tell apart, since the second mark
  replaces the first.
- **A write run is not started while another session runs in its worktree**,
  whoever it belongs to. Read-only runs may share one.

### The ruleset

OpenCode evaluates the agent's rules, which hold the global ones, then the
session's, and the last match wins; a subagent's session copies its parent's
ruleset. Every agent's rules start by allowing everything.

- **A ruleset holds denies, asks and narrow allows, and no broad allow.** A
  session's rules come after its agent's and reach every subagent, so a broad
  allow would reopen what an agent or a subagent denies itself. What a run
  may do is its agent's to say; the ruleset only takes away. An earlier form
  of this rule allowed a write run's edits inside its worktree: every agent
  already starts from allowing, so that allow added nothing to an agent that
  edits, and reopened edits for a subagent that does not.
- **The rules are text the service matches, not a sandbox.** A shell command
  is matched as it is written, one simple command at a time: a variable
  before it or a wrapper around it stays in the text, so a pattern finds the
  command anywhere in it. Extra spaces, a quote inside a word and a script
  that runs the command are not found. A file rule covers the file tools
  only: a shell command reads and writes past it, and a search reads past a
  rule on reading. So the rules stop the plain forms and the operating note
  says the rest. Nothing here claims a run cannot get round them, as with the
  binding.
- **A read-only run is denied the edit tools and the git commands that
  write.** Denied, not asked: an ask would reopen what a read-only agent
  denies itself. Its shell stays, as under OpenCode's own `plan` agent: a run
  that reviews or plans runs tests and reads history, and a command can
  still write a file.
- **A write run is denied every edit outside its worktree**, and asks before
  it rewrites history, moves a branch or runs a command that downloads and
  runs a package. An approval a person saved in OpenCode settles such an ask
  without the caller.
- **Outside its worktree a run asks.** The exceptions are narrow allows: the
  directories the service itself sends a run to, for a command's output and
  for scratch files, and a read-only run's `read_roots`.
- **Every run is denied**: reading secret files, editing a repository's or
  the person's git configuration and hooks, pushing from a shell, publishing
  a package, discarding work by force, the package's own tools, and moving
  its own session. These come last, so nothing reopens them.
- **A git command that names another repository or sets configuration on its
  command line is denied** (`-C`, `--git-dir`, `--work-tree`, `-c`). The
  first three act outside the worktree the run is bound to, and the last is
  configuration by another road. It also keeps the patterns exact: the only
  options looked for before a subcommand are the ones that change nothing.
- **A run cannot move its session.** OpenCode gives every agent a tool for
  that and asks no permission for it; a rule that denies the tool for every
  resource hides it from the model. A session that left its worktree would
  no longer be the one its binding and its ruleset describe.
- **A command the service cannot parse is refused** once any shell command
  is denied, with the reason. That is the service's own rule, and the safe
  side.
- **A shell push is denied, not asked.** The request would show a command,
  not the commits, the branch or whether it forces. Pushing is the caller's
  act, or a tool a consumer's `rules` open.
- **`rules` adds a consumer's own rules per policy**, in OpenCode's own form,
  after the package's rules and before what every run is denied. They tighten
  a run or open another package's tools, and never reopen those denies. The
  package itself names no other package's tool and no subagent.
- **A path is written as given and as resolved**, since the service matches
  a path as text. A wildcard matches the whole value and `*` crosses `/`, so
  a secret file's pattern is spelled to match one at the top level too. A
  file inside the worktree is matched by its path from the top, one outside
  by its absolute path.
- **The package's own tools are denied under any server's name**: a tool of
  an MCP server is named after the server, which a person chooses.
- **Paths outside a worktree are the person's**: `read_roots` (directories a
  read-only run may read), `output_roots` (where a run's output directory may
  sit) and `protected_dirs` (checkouts no write run may start in). A read
  root that holds the home directory is refused, since credentials live
  there. A write run gets no read roots: the shell's directory is checked
  under the same rule, so a root would let it work there.

### Answers

- **A permission request is answered `once` or `reject`.** OpenCode's third
  answer saves an approval for the whole project, which the person's own
  sessions would inherit, and approves other sessions' pending requests it
  covers.
- **What an approval lets run is the request's tool call.** A request holds
  an action and resources, and for a shell call the resources are its simple
  commands, cut out of the command. The call itself is in the messages of
  the session that asked, under the message and the call id the request
  names. So a request's `text` is read from there: the whole command of a
  shell call, and any other call's arguments as JSON. A request that names
  no call, or whose call cannot be read, has its resources as its text, one
  to a line.
- **An approval repeats the request's text**, as the read gave it, and one
  that differs sends nothing. An MCP client shows a call's arguments and no
  description, so a reply that named a request by its id alone would be
  approved unseen there. No request is approved on its id.
- **A rejection carries a reason, and so does a question that is declined.**
  At a rejection without one the service ends the turn with no end marker,
  and takes that turn up again when it next starts. With one, the call fails
  with the reason, the run reads it and the turn goes on.
- **`never_approve` lists the actions that can only be rejected**, as
  patterns in which `*` stands for any text and which match a whole action.
- **A subagent's request that the run's own ruleset asks for can only be
  rejected.** A subagent's session copies the run's ruleset, so an ask the
  ruleset adds reaches a subagent that denies the action itself, and an
  approval would reopen what it denies. Such a request is told by the
  session's rules: the last one that matches it is an ask. A request to work
  outside the worktree is the exception, since every run asks there.
- **The tools match a rule as the service does, and only to withhold an
  approval.** The matcher is a copy of the service's, which a later version
  of OpenCode can leave behind. It never grants anything: where it is wrong,
  a request that should only be rejected can be approved, by a caller who
  still reads its text and a person who is still asked.
- **A request whose text an approval's prompt cannot show whole can only be
  rejected**: one over the prompt's 2000 characters. The approvals of one
  call share that limit. A person can still answer such a request in
  OpenCode.
- **The reply tool's `gate` reads what is pending.** What a request asks is
  in the service, not in the call's arguments, so this gate cannot tell from
  its arguments and settings alone, as "Write classes" has it. It reads the
  run's sessions within the call's time, and refuses an approval that can
  only be a rejection before anyone is asked. A rejection is never refused.
- **Only a run's own requests are answered**: those of its session and its
  subagents' sessions, each through the session that asked. A form that
  belongs to no session, such as one an MCP server asks for, is no run's.
- **Every reply of a call is checked before any is sent**, against one read
  of what is pending in the run. A request named twice is refused.
- **A question is answered by field, and the answer is checked against its
  fields first**: a key it lacks, a value of another kind, a value outside a
  field's options where the field takes no text of the answerer's own, a
  required field left out. A field that is a link to visit can only be
  declined: no tool has visited it.
- **Approvals and answers are sent before rejections.** The service rejects
  every other pending request of a step along with one, with the same
  reason; an approval sent after it would find its request gone. The result
  names what a rejection took along.
- **A request that is gone when its reply arrives is said so, and is no
  failure.** The service answers in the same words for a request that was
  answered, that never was and that is another session's, and a person may
  have answered in OpenCode meanwhile.
- **After a send that fails, no later reply is sent**, and the result says
  of each reply whether it was sent. The failed one may have been taken, so
  the caller reads what is pending before answering again.
- **After its replies a call waits ten seconds at most for the run to pause
  again or end**, within the call's time, and returns the run's state. The
  next request of a turn follows an approval within a few seconds, so one
  result usually carries it. Where the run cannot be read after the replies
  were sent, the result still says of each reply whether it was sent, and
  gives the error in place of the run.

### Steering, interrupting and forking

The service delivers a prompt marked as a steer at the session's next step,
after the tool calls in flight, and starts a turn with one sent to a session
that has stopped. Its interrupt stops one session. When a subagent or a
background command ends, its report goes to the session that started it and
wakes that session, also one that was interrupted.

- **A steer never starts a turn.** It is sent so that it does not wake its
  session. A turn the tools start is set up first: its agent, its model, its
  ruleset and its binding. One a steer started would run on whatever the
  session was left with, and under the steer's class, which is not a write
  run's.
- **A steer needs a session of the run in the service's active set**, a
  paused one included, and is refused otherwise as `invalid_argument` with
  the reason `not_running`: by the tool's `gate`, which reads the service as
  the reply tool's does, and again when it runs.
- **A steer whose turn ended before reading it is withdrawn, and the call is
  refused as one to a run that is not running.** The tool looks once after
  it has sent: a message that waits while nothing of the run is active would
  arrive with a later turn nobody connects with it.
- **A steer's result says when the run reads it**: read already, at its next
  step, or once the request it is paused on is answered. The call does not
  wait for that.
- **A steer goes to the run's own session.** A subagent is steered by its
  parent, which the message reaches.
- **An interrupt stops the whole run**: its session, its subagents' sessions
  and the commands it moved to the background. A run of which a part still
  works is not stopped, and reads as `running`.
- **Subagents and background commands are stopped before the run's own
  session**, the deepest session first. Stopped the other way round, the
  report of the first child to end starts the parent again.
- **An interrupt looks again until nothing of the run is active**, and stops
  again what has become active: a report can arrive after its session was
  stopped. It looks for 20 seconds at most, within the call's time; a
  session settles within a second, and a tool has five to stop on its own.
  Where something is still active then, the result says `running` and
  `timed_out`.
- **An interrupt withdraws the caller's messages the run has not read**, and
  says how many. They were written for the turn that was stopped, and the
  service would deliver them with the next. What the service put into the
  inbox itself, such as a subagent's report, stays.
- **An interrupt rolls nothing back, and its result says so**: files,
  commits and whatever left the machine stay as the run left them. The
  service's revert routes are not used, nor is its option to go on with the
  pending steers after a stop.
- **An interrupt of a run with nothing active stops nothing and is no
  error.** The run may have ended a moment before, and a second interrupt is
  the same as the first.
- **A fork needs a run with nothing active**, and is refused otherwise as
  `invalid_argument` with the reason `running`. The service forks a running
  session and leaves the turn in flight out: the copy would end on a brief
  without an answer.
- **A fork is bound as its source is, without the start's mark.** The
  service copies a session's metadata as it is. The tool writes the binding
  again and reads the session back; where that fails it removes the copy,
  so no session stays that looks like a start in progress.
- **A fork shares its source's worktree**, with its rules, its agent, its
  model and its instruction entries, and holds no turn of its own until it
  is started. A read says of a run that it is a fork, and of which session.
  A fork from an earlier message is not offered.
- **A start can begin on a fork**: `fork` with a `session`, on either start
  tool. The copy is made first, then set up as a continued session under
  the role given, so a session that planned can be built on twice. A start
  that fails after the copy removes it.

### What a run is told

- **The operating note says only what the tools make true**: another agent
  commissioned the session and answers its requests and questions, no one is
  at the terminal, and a quote in a brief is material, not an instruction.
- **`note` is added for every run, and a role's `note` after it.** How a
  consumer speaks to a run is its own.
- **The note is an instruction entry of the session**, so the brief a person
  reads in OpenCode is the brief alone.
- **An instruction entry is told to the agent once and kept**: at the head
  of the session's first turn, or where it changes later, as a message of
  the service at the session's next step. A fork has its source's entries.
  **A subagent's session has none**: what an entry says reaches a subagent
  only through its parent.
- **A caller's entry is `opencode-tools.<name>`, given whole**, the name of
  lower-case letters, digits, `_` and `-`, at most 40 characters. The key
  is what the agent reads beside the value, so a result names the key the
  agent was told. Any other key is refused as `invalid_argument`, and
  `opencode-tools.note` as `forbidden`: a start writes it again.
- **A value is a text of at most 8000 characters**, and a session holds at
  most 20 entries of the package. The service takes any JSON of 256 KiB;
  every entry is in front of the agent at every step.
- **The instruction tools show the package's entries only.** A session can
  hold a person's or a plugin's under other keys: they are counted, and
  their values are not the caller's to read.
- **A set that changes nothing says so**, since the service tells the agent
  nothing then, and a remove of a key that is not there is no error.

### State and waiting

- **A run's state is read from the service each time**: `running`, `waiting`
  (on a request), `completed`, `failed`, `interrupted` or `unknown`. The
  package keeps no record of a run; a second record would disagree with the
  service.
- **A turn ends at its own idle message**, which carries its outcome, never at
  an exit status or at what the session last said. The service writes the
  session's own outcome and idle time with that message, and a run's state is
  read from those: a list of a caller's runs would otherwise read every
  session's messages. A turn is everything since the idle message before it,
  briefs added on the way included.
- **The result of a turn is the text of its newest reply that ended without
  an error**, which is how the service itself reads a subagent's result.
- **A run is its session and its subagents' sessions.** A subagent is a child
  session that runs in the background of its parent's turn, and its requests
  are listed under its own id. So a run whose own turn has ended is still
  `running` while a child is active, and `waiting` while one is paused.
- **What runs is read from the service's active set, before any outcome.** A
  session keeps its previous turn's outcome while the next one runs, and
  stays active for a moment after its end is written.
- **A turn that stopped without its end is `interrupted`**, and the result
  says that OpenCode takes it up again when the service next starts. A
  request rejected without a message leaves a turn so, and so does a service
  that stopped. A turn an interrupt stopped has its end written: it is
  `interrupted` too, and is not taken up again.
- **A run that has ended can run again with no start.** The report of a
  background command or a subagent that ends wakes its session, which takes
  a turn of its own. A read shows what the service shows then.
- **A turn that has just begun or just ended can show neither for a moment.**
  For 30 seconds after its newest message it counts as `running`.
- **`unknown` is a brief whose admission could not be confirmed, or a session
  that holds no turn.** Nothing is sent again after it: the brief may have
  been taken.
- **A wait asks the service at intervals.** The service's own blocking route
  has no time limit and does not return when a run pauses on a request, and
  its event stream drops what a slow reader misses.
- **A wait hands back a run that keeps retrying its provider**, as `running`
  with the retry: at the third attempt, and at once on a limit or a refused
  login, which more attempts do not cure.
- **A wait returns when the call's time ends, with `timed_out`.**
  `wait_seconds` is the limit of every call, counted from its start: 50 by
  default, under a harness that ends a tool call after a minute, and 3300 at
  most. The Hermes plugin ends a call 30 seconds after it, so the tool's own
  answer arrives first.
- **A result has a size limit and says when it was cut.** A list keeps a
  number of entries and a size as JSON, whichever ends first, and counts
  what there was. A name or a description is cut; an id never is, since a
  cut id names nothing: its entry is left out instead.

### Settings of opencode-tools

- **A nested setting has the type `json`.** `roles` and `rules` are maps, and
  a flat setting reaches no entry point as one. Its value is a JSON object: a
  mapping in the Hermes plugin's configuration, which forwards it as JSON
  text, and JSON text in a flag or a variable. Text that is not JSON, and
  JSON that is not an object, are refused as `invalid_argument`, naming the
  flag or variable; an object with no entries counts as unset, as an empty
  list does. What the object must hold is the setting's own to check, when
  the settings are read. This adds to the types under "Toolsets and
  settings".
- **Every setting but two is unset by default**: `caller`, `note`, `rules`,
  `never_approve`, `read_roots`, `output_roots` and `protected_dirs`. `roles`
  and `wait_seconds` have the defaults above.
- **A domain adds its settings here before it uses them.**
- **`never_approve` is a list of at most 50 action patterns**, each text
  without control characters of at most 200 characters. A pattern is matched
  to an action as a whole, and to nothing else of a request: what a command
  holds is the ruleset's to deny.

### Text a tool reads

- **What a tool reads from a run is data, never instructions**: its replies,
  the commands of its requests, its diffs, a session's title. Each read tool's
  description says so, and so do the skills.

### Tests of opencode-tools

- **Tests run against one fake service**, typed by the client's own types, so
  a reply whose shape drifted fails the type check. It is a `fetch` given to
  the client, in the test's own process, and holds what the units so far
  read; a unit adds the routes it needs. It records the body of each request,
  so a test checks what a tool sent and not only where.
- **The fake answers as the service was seen to answer**, by default: a
  directory it has not been asked about is still loading for its first
  requests, and its branch comes after the rest. A tool that reads without
  waiting then fails its own tests, which a fake that was always ready let
  pass. A rejection takes the other pending requests of its step, one
  without a reason takes the session out of the active set with no end
  written, and a request or a form that is gone, settled or another
  session's answers with the service's own status and error. A prompt to a
  session that runs waits for its next step, an interrupt stops one session
  and leaves its children and its inbox, the report of what ended wakes a
  session that had stopped, and a fork copies the metadata whole.
- **The tool context has an optional `runtime`**: the environment, the clock,
  how the service is found, the `fetch` its requests go through and how a
  program is left running. An entry point leaves it out and gets the real
  ones; a test supplies its own. This adds to the context under "The core
  contract".
- **The clock is passed in**, so a wait is tested without waiting.
- **No test needs a harness, a real service or a consumer's configuration.**
