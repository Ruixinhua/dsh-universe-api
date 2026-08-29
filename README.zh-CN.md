# dsh-universe-api

[English](README.md)

`dsh-universe-api` 是一个面向 DeepSeek Harness（DSH）和 DSH Desktop 的离线 API 发现插件。它只注册一个只读工具 `universe_api_search`，用于对 [public-apis](https://github.com/public-apis/public-apis) 的固定快照进行确定性的中英文检索。

> 这是 API 发现工具，不是 API 客户端。它不会调用候选 API，不接收 API key，运行时也不会发起网络请求。重要选型前，请到供应商官方文档再次核对价格、可用性、认证方式和使用条款。

`0.1.0-rc.2` 是供实际测试的候选版本。

## 能力

- 对 1,693 条规范化公共 API 记录进行离线、确定性检索。
- 支持中英文查询扩展、Unicode 规范化和 CJK 感知匹配。
- category、auth、HTTPS、CORS、status、source tier 均为硬过滤。
- 稳定排序，并返回匹配理由和目录新鲜度信息。
- 可选加载私有 canonical v1 目录，完整覆盖内置公共快照。
- 仅依赖通用 DSH contract，可复用于 CLI、普通 Web profile 和 DSH Desktop。

零结果时，插件不会悄悄放宽过滤条件。尤其是 `unknown` 与 `no` 严格区分；内置目录只含公共数据，因此 `sourceTier: "apilayer"` 会正常返回零条。

## 环境要求

- DSH 或 DSH Desktop，并能打开 DSH Terminal。
- 从源码开发需要 Node.js `^22.19.0 || >=24.0.0`。普通 Desktop 用户通常直接使用 Desktop 自带运行时。

兼容性基线如下。`0.1.0-rc.2` 的真实 Desktop 验收仍需按本文末尾的人工清单完成，表中的自动化覆盖不代表已经替代 Desktop 人工测试。

| 组件 | 版本 | 覆盖方式 |
| --- | --- | --- |
| `dsh-universe-api` | `0.1.0-rc.2` | 当前候选版本 |
| DSH Desktop | `2.0.3` | 契约目标；真实 Desktop 人工验收待完成 |
| DSH runtime packages | `0.1.1-rc.2` | 原生工具注册、执行管线与 Loader 测试 |
| Cordis | `4.0.1` | 自动化测试 |
| Node.js | `22.19.0`、`24.x` | CI；Desktop 用户使用其内置运行时 |
| 操作系统 | Ubuntu、Windows、macOS | Ubuntu 完整门禁；Windows/macOS 运行时、Loader 与打包 smoke |

以下安装命令应在 **DSH Desktop 中打开的 DSH Terminal** 执行，不要在无关的系统终端中执行。如果使用非默认 profile，请分别在 `plugin` 和 `dsh` 命令后添加 `--profile <名称>`。

## 安装

选择一种来源；能固定版本时请固定版本。

### 本地 checkout

```bash
dsh plugin add /absolute/path/to/dsh-universe-api
```

### GitHub tag

```bash
dsh plugin add github:Ruixinhua/dsh-universe-api#v0.1.0-rc.2
```

本包是无需构建的纯 ESM，并且没有 `build` 或 `prepare` 安装钩子，所以从 GitHub 安装不需要配置 pnpm `allowBuilds`。

### Release tarball

从 GitHub Release 下载 `.tgz` 和对应的 `.sha256`，放在同一目录后校验：

```bash
sha256sum --check dsh-universe-api-0.1.0-rc.2.tgz.sha256
dsh plugin add /absolute/path/to/dsh-universe-api-0.1.0-rc.2.tgz
```

macOS 没有 `sha256sum` 时，可执行 `shasum -a 256 -c dsh-universe-api-0.1.0-rc.2.tgz.sha256`。

Windows 用户应先切换到两个下载文件所在目录，或把下面的 `$archive` 和 `$checksum` 替换为绝对路径。以下 PowerShell 会先验证归档，再安装刚刚验证的同一文件：

```powershell
$ErrorActionPreference = 'Stop'
$archive = '.\dsh-universe-api-0.1.0-rc.2.tgz'
$checksum = '.\dsh-universe-api-0.1.0-rc.2.tgz.sha256'
$archivePath = (Resolve-Path -LiteralPath $archive).Path
$expected = ((Get-Content -LiteralPath $checksum -Raw).Trim() -split '\s+')[0]
$actual = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash
if ($expected -notmatch '^[0-9a-fA-F]{64}$') { throw "Invalid SHA-256 file: $checksum" }
if ($actual -ine $expected) { throw "SHA-256 mismatch for $archivePath" }
dsh plugin add $archivePath
```

### 确认启用

```bash
dsh --dump-config
```

确认输出包含 `dsh-universe-api` layer 和插件行。安装或修改配置后必须从托盘选择 **Quit/退出**，再重新启动 DSH Desktop；关闭窗口或只打开一个新对话都不够。

## 升级固定版本

本项目推荐固定 GitHub tag 或 Release tarball。选择一种固定来源，在已经安装插件的同一 profile 中升级：

- **Release tarball：**下载新版本的 `.tgz` 与 `.sha256`，按上面的平台说明完成校验，然后安装刚刚校验的同一 tarball。Windows 应把新文件名代入 PowerShell 代码后重新执行；该代码以 `dsh plugin add $archivePath` 结束。Linux 或 macOS 执行：

```bash
dsh plugin add /absolute/path/to/dsh-universe-api-NEW_VERSION.tgz
```

- **GitHub tag：**直接安装准确的新 tag。这是另一种来源；Release tarball 的 SHA-256 不能认证 pnpm 随后获取的 Git checkout。

  ```bash
  # 将 NEW_VERSION 替换为完整版本号，包括预发布后缀。
  dsh plugin add github:Ruixinhua/dsh-universe-api#vNEW_VERSION
  ```

`dsh plugin add` 会更新 profile 中已安装的直接依赖规范，无需先删除插件。随后执行 `dsh --dump-config`，确认配置中仍只有一个 `dsh-universe-api` bundle layer，并保留预期的 `catalogPath` 配置（如有），再从托盘选择 **Quit/退出** 并重新启动。`dsh plugin update` 适合按可变 registry 范围安装的依赖；它不会替你选择另一个固定 tag 或 tarball，因此不作为本项目固定 Release 的升级步骤。

## 使用

测试时可明确要求 DSH 使用该工具：

```text
请使用 universe_api_search，找 3 个无需 API key、HTTPS=yes、CORS=yes 的天气 API，并说明匹配理由。
```

英文示例：

```text
Use universe_api_search to find 3 weather APIs that require no API key and have HTTPS=yes and CORS=yes. Explain why each result matched.
```

工具输入如下：

| 输入 | 类型与行为 |
| --- | --- |
| `query` | 最长 2,048 字符的可选自然语言字符串。不传时可只用过滤器浏览。 |
| `categories` | 最多 20 项、每项最长 128 字符的可选字符串数组；多个分类按 OR 处理。 |
| `sourceTier` | `all`（默认）、`public` 或 `apilayer`。 |
| `auth` | `none`、`api_key`、`oauth2`、`basic`、`bearer`、`signed`、`user_agent`、`other` 或 `unknown`。 |
| `https`、`cors` | `yes`、`no` 或 `unknown`；严格精确匹配。 |
| `status` | `active`、`coming_soon`、`stale`、`candidate` 或 `unknown`。 |
| `limit` | 1–20 的整数；默认 5。 |

输出包括目录身份和新鲜度、规范化查询信息、实际过滤条件、总匹配数、是否截断，以及带匹配理由的排序结果。聊天模式会渲染紧凑 Markdown；Code Mode 可读取完整结构化值。

## 使用私有目录

在当前 profile 的 `cordis.patch.yml` 中添加一个后置配置行（通常位于 `$DSH_HOME/profiles/<名称>/`），并设置 `catalogPath`：

```yaml
- id: dsh-universe-api
  config:
    catalogPath: '/absolute/path/to/private/catalog.json'
```

该文件必须：

- 使用 canonical catalog v1 schema；
- 是绝对路径指向的普通 JSON 文件；
- 不超过 16 MiB；
- 包含完整目录，而不是增量覆盖。

使用相同 profile 选择执行 `dsh --dump-config`，确认这一行是 `dsh-universe-api` 的最终配置。外部目录会完整替换内置公共快照，二者不会合并。路径相对、文件不存在、超限、不可读或校验失败时，插件会加载失败，绝不静默回退。工具结果只标记来源为 `external`，不会泄露本机路径。修改文件或路径后需要重启 DSH Desktop。

测试错误目录前，先完成一次健康启动并记下时间。若错误目录导致 Desktop 进入 Recovery，打开 **回滚/Rollback**，选择时间戳与该次健康启动对应的准确 checkpoint 槽位，预览并确认后重启。若没有可用槽位，从 **诊断/Diagnostics → 打开 Profile Patch/Open profile patch** 手动恢复已知健康的插件行。若仍能进入托盘，也可从设置旁的重启菜单选择 **重启到恢复模式/Restart in Recovery Mode**。确认健康启动后，再测试下一个错误用例。完整步骤见[人工测试清单](docs/MANUAL_TESTING.md)。

格式和校验规则见[私有目录格式](docs/PRIVATE_CATALOG.md)。

## 卸载

```bash
dsh plugin remove dsh-universe-api
```

从托盘选择 **Quit/退出**，重新启动 DSH Desktop，然后用 `dsh --dump-config` 确认该 layer 已消失。

## 测试候选版本

维护者门禁命令为：

```bash
npm ci
npm run typecheck
npm test
npm run verify:loader
npm run check
npm pack --dry-run
```

真实验收时必须安装 **Release tarball**，不要只测试生成它的本地 checkout。请按[人工测试清单](docs/MANUAL_TESTING.md)验证离线行为、精确过滤、私有目录覆盖、Web profile 和卸载。

## Market 可用性

目录提供方（例如 dshfind）已经可以发现本仓库，但只有 GitHub Release 时，条目属于“可浏览”，并不自动具备 DSH Community Market 一键安装资格。一键安装还要求 npm `latest` 是精确稳定版，并且目录条目只暴露一个无歧义的 npm 包身份。

维护者应遵循[Market 分发与版本提升](docs/MARKET_RELEASE.zh-CN.md)指南。它分别说明 GitHub prerelease、一次性的 npm `next` 建包、受保护的 OIDC 稳定版提升、dshfind 验证和精选目录投稿。

## 数据、隐私与限制

- 内置快照来自 `public-apis/public-apis` 的固定提交 [`988c57be4616cc9507fd3e8c34adedba5387f079`](https://github.com/public-apis/public-apis/commit/988c57be4616cc9507fd3e8c34adedba5387f079)，按其 MIT 许可证分发。详见[第三方声明](THIRD_PARTY_NOTICES.md)。
- 不会重新分发此前混合私有目录中的任何 APILayer 记录。保留 `sourceTier: "apilayer"`，只是为了让兼容的私有目录能够公开该层。
- 快照生成后，目录条目可能逐渐过时。工具不会探测端点，也不会验证供应商当前条款。
- 插件不提供浏览器 UI、语义 embedding、远程数据库、MCP 包装或 API 执行。
- 私有目录路径和 API 文档 URL 只用于发现。插件不接收、不保存、也不传输凭据。
- 未声明的工具参数会被拒绝。不要把凭据放进工具调用；即使插件拒绝，DSH 仍可能把尝试调用的参数保留在会话历史中。

## 维护者文档

- [开发与架构](docs/DEVELOPMENT.md)
- [目录维护](docs/CATALOG_MAINTENANCE.md)
- [候选版本人工验收](docs/MANUAL_TESTING.md)
- [Market 分发与版本提升](docs/MARKET_RELEASE.zh-CN.md)
- [贡献指南](CONTRIBUTING.md)
- [安全策略](SECURITY.md)

## 许可证

插件代码使用 [MIT License](LICENSE)。内置第三方数据保留上游声明，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
