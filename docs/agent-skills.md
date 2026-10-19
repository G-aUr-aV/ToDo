# Set up Todo skills for your agent

Read this from a cloned Todo repository when asked to enable its skills on a machine. This is an agent-neutral runbook: use your agent's filesystem and configuration tools. It installs no AI service, API key, hooks or background worker.

## What the clone provides

| Skill source | Purpose |
| --- | --- |
| `.agents/skills/todo-tasks/` | Read, add, plan, update, complete and carry out personal tasks using the live Todo Vault |
| `.agents/skills/todo-setup/` | Set up or repair the existing server and Todo/Mini browser launchers |

Each folder contains a standard `SKILL.md`; keep its accompanying references and assets together. `agents/openai.yaml` is optional Codex UI metadata; other agents can use the Markdown without it. Repository `AGENTS.md` points to both skills, and `CLAUDE.md` imports those shared instructions for Claude Code. An agent without skill discovery can read the relevant `SKILL.md` directly.

Cloning supplies the sources, not another machine's global instructions, vault, login or filesystem permissions. Install only for the agent/profile the owner requested. An instruction to read this guide is not by itself a request to modify every installed agent.

## 1. Resolve this machine's installation

1. Find the actual checkout root containing this file, `app/package.json` and `launchers/install.mjs`. Resolve symlinks and use its absolute path. Do not copy a path from the original maintainer's computer.
2. Identify the intended vault and existing server. Prefer the owner's explicit destination and the running service's actual configuration. Read only the necessary non-secret settings. For Node, `VAULT_PATH` is relative to `app/` unless absolute, and the default resolves to `<checkout>/Todo Vault`. For Compose, the host bind source uses `TODO_VAULT_PATH`, relative to the checkout unless absolute; the container's `/vault` is not the host path. See [setup](setup.md) and [Docker](docker.md).
3. Confirm the vault with `Home.md` and `Tasks/`. Record the confirmed vault path and server origin. Preserve `.env`, private state and the running service. If setup is fresh or the vault is missing, use `todo-setup` within the requested scope; do not silently make a second vault/server while installing skills.
4. Identify the active agent profile/home and its documented skill locations. Custom profiles can differ from the defaults below. The machine running the agent may also differ from the server host: a remote client can use the authenticated UI/API, but cannot read the server's local vault path. State that limitation rather than inventing a local copy.

## 2. Make the skills discoverable

Use a symlink from each requested skill's user-level location to its source folder in this checkout. This keeps one maintained copy and makes repository updates available through the link. Inspect any existing destination first: reuse a link to this same source, and preserve a different skill or installation until the owner chooses how to resolve the conflict. Do not force-replace links or duplicate an already discovered skill under another user directory.

| Agent | User-level skill location | Instance-wide routing location |
| --- | --- | --- |
| Codex | `~/.agents/skills/<name>/`; reuse an existing working `$CODEX_HOME/skills/<name>` installation instead of duplicating it | `$CODEX_HOME/AGENTS.md`, normally `~/.codex/AGENTS.md` |
| Claude Code | `~/.claude/skills/<name>/` | `~/.claude/CLAUDE.md` |
| Hermes | `<HERMES_HOME>/skills/<name>/`, normally `~/.hermes/skills/<name>/` | A small section in the active instance's `<HERMES_HOME>/SOUL.md` |
| Another agent | Its documented personal Agent Skills directory; otherwise retain an absolute link to `SKILL.md` in its user instructions | Its documented global/user instruction file |

For Codex, inspect a nonempty `AGENTS.override.md` in its home: it takes precedence over the global `AGENTS.md`, so put or reconcile the routing in the effective file rather than leaving it shadowed. Check custom `CODEX_HOME` and skill settings before selecting a destination. Claude profiles/configuration may also change the default paths; verify the installed version's settings.

Example for Bash/Zsh on Linux or macOS, run **from the checkout root**. Choose the destination for the requested agent first; these commands do not edit global instructions:

```sh
todo_repo=$(pwd -P)
todo_user_skills="$HOME/.agents/skills"  # Codex default; select the table's location for another agent
test -f "$todo_repo/.agents/skills/todo-tasks/SKILL.md" || exit 1
test -f "$todo_repo/.agents/skills/todo-setup/SKILL.md" || exit 1
mkdir -p "$todo_user_skills"
for todo_name in todo-tasks todo-setup; do
  todo_dest="$todo_user_skills/$todo_name"
  if [ -e "$todo_dest" ] || [ -L "$todo_dest" ]; then
    printf 'Inspect/reuse existing destination: %s\n' "$todo_dest"
  else
    ln -s "$todo_repo/.agents/skills/$todo_name" "$todo_dest"
  fi
done
```

On Windows, an agent can use PowerShell `New-Item -ItemType SymbolicLink` with absolute paths if permitted, or copy each complete skill folder to the selected personal directory. A directory junction is another option for a local directory. For copies, record the checkout's absolute path in the routing rule below: repository documentation links in a copied skill must be resolved under that checkout, while its `references/` stays beside `SKILL.md`. Update copies deliberately after reviewing upstream changes; never overwrite locally edited skills blindly. No admin privileges or global policy changes are required just to read a skill by its source path.

Hermes additionally supports `skills.external_dirs` in its active `config.yaml`. If that is already the user's preferred approach, add this checkout's absolute `.agents/skills` path to the existing list without replacing other entries, instead of installing another copy. This exposes both skills across workspaces. For **repository-only** discovery, run `hermes skills trust /absolute/path/to/checkout` after reviewing the skill sources; that trust decision alone does not make them global. Preserve other Hermes configuration and trust settings.

## 3. Add the global routing rule

Skill discovery and global task routing serve different purposes. Install the skill, then add a short rule to the effective user-instruction file from the table. Back up the file first. Preserve existing sections, imports, persona and managed blocks; update an existing Todo routing section rather than appending duplicates. Keep this machine's paths in the user file, not in tracked repository documents.

Replace **every** uppercase placeholder below with confirmed values. `TASK_SKILL_FILE` and `SETUP_SKILL_FILE` are absolute paths to the installed or source `SKILL.md` files. `VAULT_LOCATION` is the accessible local vault path, or an explicit statement that the vault is on the remote server and unavailable as local files. Omit `SERVER_ORIGIN` if it is not known yet and state that connection setup is needed.

```markdown
## Personal tasks: Todo Vault

- For my personal task requests from any project or chat (review pending work; add, plan, prioritize, schedule, update, complete or carry out tasks), read and follow the Todo Tasks skill at TASK_SKILL_FILE. Use this installation's live Todo Vault as the source of truth. Respect an explicitly named alternative source and distinguish personal tasks from steps in the current conversation.
- Application checkout: APP_ROOT. Vault location: VAULT_LOCATION. Server origin: SERVER_ORIGIN. Read Home.md and relevant task/project notes when local access is available. Use the existing authenticated UI/API for writes, preserve UUIDs and unmentioned content, and verify results before claiming completion. Report inaccessible data or missing authentication instead of guessing or editing task files directly.
- For Todo server or browser-launcher installation/repair, read SETUP_SKILL_FILE. Reuse the existing vault/server and detect the destination OS and CPU.
```

For Hermes, preserve the active `SOUL.md` personality and add only this short workflow section. Its project `AGENTS.md`/`HERMES.md` files are not instance-wide routing files. Follow any permission requirement enforced by Hermes when editing its identity file. For a different agent, verify that its chosen user instruction file loads outside this repository before claiming global setup.

## 4. Verify before reporting success

Start a fresh session for the chosen agent, with its usual profile, **outside this checkout**. Verify each layer separately:

1. Confirm each installed skill resolves to the intended `SKILL.md` and supporting files. Use the agent's skill list/selector where available. In Codex select `$todo-tasks`; in Claude Code or Hermes try `/todo-tasks`. Read-only discovery checks are enough; do not create a test task in the real vault.
2. Ask: “Which task source and skill would you use if I ask to add a personal task? Do not add one.” It should identify the configured Todo installation and the task skill without relying on project-local instructions.
3. Ask: “Which skill would you use to repair Todo's desktop launcher?” It should select `todo-setup`. Ordinary app-development requests should not be routed to the personal task list.
4. Verify read access with `Home.md`/a requested listing, or the authenticated server API, within the owner's authorization. Missing sign-in or remote filesystem access can block operations even when discovery and routing work. Test actual write mechanics only on invented temporary vaults.

Report the agent/profile, installed skill paths, global routing file, confirmed vault/origin, checks run and any remaining access limitation. Distinguish source review, skill discovery, routing checks and actual task operations. Another agent's successful setup does not prove this one's behavior.

## Updates and removal

After a repository update, symlinked skills read the updated source; copies need a reviewed refresh. If the checkout moves, repair only the affected links and local routing paths. To remove integration when requested, remove only the installed links/copies and the Todo section you added. Preserve the repository sources, vault, private state and unrelated agent instructions.

## Sources

- [Codex skill discovery](https://learn.chatgpt.com/docs/build-skills) and [global instruction discovery](https://learn.chatgpt.com/docs/agent-configuration/agents-md).
- [Claude Code skills](https://code.claude.com/docs/en/skills) and [user/project instructions](https://code.claude.com/docs/en/memory).
- [Hermes skills, external directories and project trust](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills) and [global versus project context](https://hermes-agent.nousresearch.com/docs/user-guide/features/context-files).

Agent discovery changes over time. Use these primary references or the installed agent's documentation if its behavior differs from the defaults here.
