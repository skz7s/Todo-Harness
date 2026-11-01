# Todo Harness

[简体中文](README.md) | [English](README.en.md)

Todo Harness is a todo-focused executive assistant built on a customized DeepSeek Harness. It turns assigned work into a persistent task list shared across conversations, then follows progress in a dedicated task board to reduce forgotten tasks and work lost in chat history.

![Full Todo Harness application with workspace and session navigation, conversation area, and fictional todo board](docs/todo-harness-demo.png)

*Full application view; all task data is fictional.*

## One-click installation

Git, Node.js 20 or newer, and npm are required. The installer places the app in your user directory, installs runtime dependencies, and starts the service. The local Harness page opens on first launch.

macOS / Linux:

```sh
curl -fsSL https://raw.githubusercontent.com/skz7s/Todo-Harness/main/install.sh | sh
```

Windows PowerShell:

```powershell
irm https://raw.githubusercontent.com/skz7s/Todo-Harness/main/install.ps1 | iex
```

## Deploy from source

```sh
git clone https://github.com/skz7s/Todo-Harness.git
cd Todo-Harness
npm ci --omit=dev
npm start
```

The launcher starts the Harness Web profile and Todo API, then opens the local page in your browser. On first use, choose a model provider and configure its credentials in Harness settings. You can then assign work in a conversation. Stop the service with `Ctrl+C` in the terminal.

The default web address is `http://127.0.0.1:3210`, and the Todo API uses the next port. If the ports are occupied, run `npm start -- --port 3220` to choose a web port; the following port must also be available. Run `npm start -- --no-open` to start without opening a browser and print the local URL.

## Data, updates, and backups

Todo data, usage, and app settings are stored under `~/.todo-harness` by default (`%USERPROFILE%\.todo-harness` on Windows). The Harness profile and browser authentication data are stored in its `dsh` subdirectory. Stop the service before backing up the entire data directory. Restoring it on another machine preserves local tasks and the Harness profile.

The one-click installer places the app in `~/.local/share/todo-harness/app` by default (`%LOCALAPPDATA%\TodoHarness\app` on Windows); runtime data remains in the user data directory. Stop Todo Harness before updating, then run the installer again to update a clean installation. If it detects local changes, it stops and asks you to handle them first rather than overwriting them.

Use environment variables to change paths: `TODO_HARNESS_INSTALL_DIR` sets the installation directory, `TODO_HARNESS_DATA_DIR` sets the Todo data directory, `DSH_HOME` sets the Harness profile directory, and `TODO_HARNESS_WORKSPACE_DIR` sets the agent workspace. The install directory is the default agent workspace. Todo Harness listens only on the local loopback interface and should not be exposed directly to the public internet.

The project is pinned to DeepSeek Harness `0.2.0-rc.2`.

## Development and license

```sh
npm test
npm run check
```

Apache-2.0. See [LICENSE](LICENSE). For the architecture overview, see [docs/architecture.md](docs/architecture.md).
