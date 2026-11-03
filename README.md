# Todo Harness

[简体中文](README.md) | [English](README.en.md)

Todo Harness 是基于 DeepSeek Harness 定制的待办智能秘书。它把交办事项从聊天记录中提取出来，存入跨会话共享的任务清单，并通过专门的任务看板持续跟进，帮助你减少全局任务遗漏和遗忘。

![Todo Harness 完整应用界面，包含工作区与会话列表、对话区和虚构待办看板](https://raw.githubusercontent.com/skz7s/Todo-Harness/main/docs/todo-harness-demo.png)

*完整应用界面示例，任务数据为虚构内容。*

### 一键安装

安装器会将程序安装到用户目录、安装运行依赖并启动服务；首次启动时会自动打开本地 Harness 页面。macOS / Linux 需要预先安装 Git、Node.js 20 或更高版本，以及 npm。Windows 安装器会通过 `winget` 自动安装缺失的 Git 或 Node.js LTS（包含 npm）；需要 Windows 的 App Installer 提供 `winget`，安装系统级组件时可能会弹出授权提示。

macOS / Linux：

```sh
curl -fsSL https://raw.githubusercontent.com/skz7s/Todo-Harness/main/install.sh | sh
```

Windows PowerShell：

```powershell
irm https://raw.githubusercontent.com/skz7s/Todo-Harness/main/install.ps1 | iex
```

### 从源码部署

```sh
git clone https://github.com/skz7s/Todo-Harness.git
cd Todo-Harness
npm ci --omit=dev
npm start
```

启动器会运行 Harness Web profile 和 Todo API，并在浏览器中打开本地页面。首次使用时，在 Harness 的模型设置中选择模型服务商并配置凭据，然后即可在对话中交办任务。停止服务请在终端按 `Ctrl+C`。

默认 Web 地址使用 `http://127.0.0.1:3210`，Todo API 使用下一个端口。若端口已占用，可运行 `npm start -- --port 3220` 指定 Web 端口；对应的下一个端口也必须空闲。运行 `npm start -- --no-open` 可在不自动打开浏览器的情况下启动，并打印本地 URL。

### 数据、升级与备份

Todo 数据、用量和应用设置默认保存在 `~/.todo-harness`（Windows：`%USERPROFILE%\.todo-harness`），Harness profile 和浏览器认证数据默认位于其 `dsh` 子目录。备份前先停止服务，再备份整个数据目录。更换设备时恢复该目录即可保留本地任务与 Harness profile。

一键安装器默认将程序放在 `~/.local/share/todo-harness/app`（Windows 为 `%LOCALAPPDATA%\TodoHarness\app`），运行数据仍保存在用户数据目录。升级前先停止正在运行的 Todo Harness，再运行对应的一键安装命令更新干净的安装目录；如果目录中有本地修改，安装器会停止并要求先自行处理，避免覆盖修改。

也可以通过环境变量调整路径：`TODO_HARNESS_INSTALL_DIR` 设置安装目录，`TODO_HARNESS_DATA_DIR` 设置 Todo 数据目录，`DSH_HOME` 设置 Harness profile 目录，`TODO_HARNESS_WORKSPACE_DIR` 设置 agent 工作区。默认 agent 工作区是安装目录。Todo Harness 只监听本机 loopback 地址，不应直接暴露到公网。

项目固定依赖 DeepSeek Harness `0.2.0-rc.2`。

### 开发与许可

```sh
npm test
npm run check
```

Apache-2.0，详见 [LICENSE](LICENSE)。架构概览见 [docs/architecture.md](docs/architecture.md)。
