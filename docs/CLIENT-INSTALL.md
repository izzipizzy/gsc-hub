# Prepare macOS or Windows and install the clients

You can install **only the CLI**, **only agent skills**, or both. The server
application, SvelteKit dependencies, Docker, pnpm and Google OAuth credentials
are not needed on the client machine. API credentials are needed only when
connecting to an existing hub, after installation.

The installer needs **Node.js 22.18 or newer**; current Node.js LTS is a suitable
choice ([official downloads](https://nodejs.org/en/download)). CLI installation
also needs npm, which is included in the normal Node.js installation. Installing
skills alone does not use npm. Git fetches the repository.

## Install with an AI agent

Pick a prompt and paste it into Codex or Claude Code. Each uses the public
GitHub release. For skill installation, the agent should select `--agent codex`
or `--agent claude` to match the client you are using. Existing skill edits
must be preserved; replacement requires an explicit choice of `--force`.

### CLI and skills / CLI и скиллы

**English**

```text
Install the gsc-hub CLI and all five skills for my current agent from
https://github.com/izzipizzy/gsc-hub, release v0.9.4.
Read docs/CLIENT-INSTALL.md at that release. Check macOS or Windows
prerequisites, fetch cli and .agents/skills, and use cli/install.mjs with
--cli --skills and the appropriate --agent. Verify the installed CLI by
its full path and list the skill destinations. I'll configure my hub URL
and API key separately.
```

**Русский**

```text
Установи CLI gsc-hub и все пять скиллов для моего текущего агента из
https://github.com/izzipizzy/gsc-hub, релиз v0.9.4.
Прочитай docs/CLIENT-INSTALL.md этого релиза. Проверь подготовку macOS или
Windows, забери cli и .agents/skills и используй cli/install.mjs с
--cli --skills и подходящим --agent. Проверь установленный CLI по полному
пути и перечисли каталоги скиллов. Адрес своего хаба и API-ключ я настрою
отдельно.
```

### CLI only / Только CLI

**English**

```text
Install only the gsc-hub CLI from https://github.com/izzipizzy/gsc-hub,
release v0.9.4. Read docs/CLIENT-INSTALL.md at that release, check my macOS
or Windows prerequisites, fetch cli and run cli/install.mjs --cli.
Verify the command using its full installed path and explain the PATH
entry I need. I'll configure the hub URL and API key separately.
```

**Русский**

```text
Установи только CLI gsc-hub из https://github.com/izzipizzy/gsc-hub,
релиз v0.9.4. Прочитай docs/CLIENT-INSTALL.md этого релиза, проверь подготовку
моей macOS или Windows, забери cli и запусти cli/install.mjs --cli.
Проверь команду по полному пути установки и покажи, какой каталог добавить
в PATH. Адрес хаба и API-ключ я настрою отдельно.
```

### Skills only / Только скиллы

**English**

```text
Install only the five gsc-hub skills for my current agent from
https://github.com/izzipizzy/gsc-hub, release v0.9.4.
Read docs/CLIENT-INSTALL.md at that release, check my macOS or Windows
prerequisites, fetch cli and .agents/skills, then run cli/install.mjs
--skills with the appropriate --agent codex or --agent claude.
Preserve existing skill edits and report the installed paths. Skill
installation does not need an API key, npm, or the server application.
```

**Русский**

```text
Установи только пять скиллов gsc-hub для моего текущего агента из
https://github.com/izzipizzy/gsc-hub, релиз v0.9.4.
Прочитай docs/CLIENT-INSTALL.md этого релиза, проверь подготовку моей macOS
или Windows, забери cli и .agents/skills и запусти cli/install.mjs --skills
с подходящим --agent codex или --agent claude. Сохрани мои правки в
существующих скиллах и сообщи пути установки. Для установки скиллов
API-ключ, npm и серверное приложение не нужны.
```

## macOS preparation

In Terminal, check what is already installed:

```bash
git --version
node --version
npm --version
```

If Homebrew is missing, install it using the command from the
[official Homebrew site](https://brew.sh/):

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Complete the installer's **Next steps** to put `brew` on PATH, then reopen
Terminal. Install missing tools:

```bash
brew install node git
git --version
node --version
npm --version
```

If Node is already installed but too old, update it through the same manager
you used to install it. You can also use the macOS installer from the Node.js
download page instead of Homebrew. Do not mix managers just for this client.

## Windows preparation

Use PowerShell on native Windows. Check:

```powershell
winget --version
git --version
node --version
npm.cmd --version
```

Install missing tools:

```powershell
winget install --id Git.Git --exact
winget install --id OpenJS.NodeJS.LTS --exact
```

The `--id` and `--exact` flags select an unambiguous package
([Microsoft's winget documentation](https://learn.microsoft.com/en-us/windows/package-manager/winget/install)).
If `winget` is missing, install/update **App Installer** from Microsoft Store,
or use the official [Git for Windows](https://git-scm.com/downloads/win) and
[Node.js](https://nodejs.org/en/download) installers. Reopen PowerShell after
installation, then repeat the version checks.

Use `npm.cmd` and `gsc-hub.cmd` in PowerShell if a `.ps1` execution-policy error
appears; there is no need to weaken the system execution policy. The client
installer invokes npm's JavaScript entrypoint through Node, so it also avoids
that restriction and handles spaces in paths.

## Repository and release

Install from the public repository `https://github.com/izzipizzy/gsc-hub.git`,
release **v0.9.4**. The installer is `cli/install.mjs`; skill sources are
`.agents/skills/<name>/SKILL.md`. A GitHub account or SSH key is not required
for this HTTPS clone.

## macOS installation

```bash
gsc_client_dir=$(mktemp -d)
git clone --branch v0.9.4 --depth 1 --filter=blob:none --sparse \
  https://github.com/izzipizzy/gsc-hub.git "$gsc_client_dir"
git -C "$gsc_client_dir" sparse-checkout set cli .agents/skills
node "$gsc_client_dir/cli/install.mjs" --check
node "$gsc_client_dir/cli/install.mjs" --cli --skills --agent codex
export PATH="$HOME/.local/bin:$PATH"
gsc-hub --version
```

The default CLI prefix is `~/.local`; the executable is `~/.local/bin/gsc-hub`.
To keep it on PATH across Terminal sessions, add that `export PATH` line to your
shell configuration (normally `~/.zshrc`). The installer does not edit it.

## Windows installation

```powershell
$gscClientDir = Join-Path $env:TEMP ("gsc-hub-client-" + [guid]::NewGuid())
git clone --branch v0.9.4 --depth 1 --filter=blob:none --sparse `
  https://github.com/izzipizzy/gsc-hub.git $gscClientDir
git -C $gscClientDir sparse-checkout set cli .agents/skills
node "$gscClientDir\cli\install.mjs" --check
node "$gscClientDir\cli\install.mjs" --cli --skills --agent codex
$env:Path = "$env:LOCALAPPDATA\gsc-hub;" + $env:Path
gsc-hub.cmd --version
```

The default executable is `%LOCALAPPDATA%\gsc-hub\gsc-hub.cmd`. To persist PATH,
add `%LOCALAPPDATA%\gsc-hub` to your **user** Path in Windows Environment
Variables, then reopen PowerShell. WSL is not required.

After a successful install, you can remove the temporary checkout: the CLI is
installed from a packed archive, and skills are copied into their destination.
Neither depends on a symlink to that checkout. Sparse checkout selects the
client directories; no server dependencies or native SQLite module are built.
If the Git host ignores partial-clone filtering, Git may transfer more history
objects, but the selected working tree and installation remain client-only.

## Install components independently

Run these from the fetched checkout, on either platform:

```text
node cli/install.mjs --cli
node cli/install.mjs --skills --agent codex
node cli/install.mjs --skills --agent claude
node cli/install.mjs --skills --skill gsc-hub-cli --agent codex
node cli/install.mjs --skills --skills-dir /absolute/custom/skills
```

Use an actual platform path for a custom directory, e.g. `C:\Users\you\skills`
on Windows. Repeat `--skill NAME` to select several skills.

Codex destination: `$CODEX_HOME/skills`, or `~/.codex/skills` if unset.
Claude Code destination: `~/.claude/skills`. Restart the agent session after
installing skills. An installed skill is a file of instructions; its installation
does not create an API key or authorize writes to the hub.

Existing selected skill directories cause a failure **before anything is
installed**. Review local edits, then add `--force` to replace those directories.
For updates, fetch the desired repository revision and run the installer again;
the CLI package is updated automatically, while skill replacement stays explicit.

## Connect and troubleshoot

Configure `GSC_HUB_URL` and privately load `GSC_HUB_KEY` from a key created on
the hub's `/api` page. Start with `gsc-hub sites --json` (Windows:
`gsc-hub.cmd sites --json`). See [CLI.md](CLI.md) for commands and exit codes.

| Symptom | What to do |
|---|---|
| `git` or `node` not found | Complete the preparation for your OS, reopen the terminal, check versions again |
| Node version below 22.18 | Update Node.js through your existing manager or the official LTS installer |
| `npm is missing` | Reinstall Node.js with npm included; or use `--skills` if you only need skill files |
| `Module not found` for the installer | Check out `cli` and `.agents/skills` from a revision containing the installer; do not run an old GitHub release |
| Git asks for an SSH key | Use the public HTTPS clone URL above |
| `gsc-hub` not found after installation | Use the full executable path printed by the installer and fix user PATH |
| PowerShell refuses a `.ps1` file | Run the `.cmd` command instead |
| Skill already exists | Preserve your edits or explicitly update the selected skill with `--force` |
| HTTP 401/403 after installation | Check `GSC_HUB_URL`, key and scope; this is server authorization, not a missing npm module |

The CLI has no external runtime npm dependencies. Do not install SvelteKit,
better-sqlite3, pnpm, Homebrew on Windows, or Python just to use it.

Validation: macOS installation, isolated skill copying, missing-npm/old-Node
failures, paths with spaces and operation after checkout removal are automated.
Native Windows paths and npm invocation are implemented; a real Windows runner
is still required to claim an end-to-end Windows verification.
