# Market 分发与版本提升

本文面向发布 `dsh-universe-api` 的维护者，也帮助用户理解：为什么插件可以先在 Market 中被发现，但尚不能一键安装。

DSH Community Market 由目录源驱动。用户必须明确选择一个目录源；它没有默认来源，也没有中央插件审核队列。被目录收录不等于通过安全审查、兼容性认证或获得背书。

## 分发层级

| 层级 | 用户获得的能力 | 达标条件 |
| --- | --- | --- |
| GitHub Release | 手工安装经过校验的 `.tgz` | Release 资产及校验和已发布 |
| dshfind Discover | 可在 Market 中浏览 | 公开仓库带有 `dsh-plugin` topic |
| awesome-dsh-plugin | 精选目录条目与 Release tarball 链接 | 符合目录贡献规则并通过维护者复核 |
| DSH Installable | npm 一键安装 | 唯一 npm 身份、稳定版 `latest`、安全的 `dsh.bundle.patch` |

因此，GitHub 仓库和 dshfind 条目可以早于 npm 发布出现。稳定 npm 版本出现前，只能称为“可浏览”或“可手工安装”，不能称为“已支持 Market 一键安装”。

## 发布通道

- `vX.Y.Z-rc.N` 是候选版。GitHub 将其发布为 prerelease；如将已验收 RC 发布到 npm，必须使用 `next` dist-tag。
- `vX.Y.Z` 是稳定版。tag 流水线只创建 Draft GitHub Release；验收通过后，受保护的提升工作流才会把同一 tarball 发布到 npm `latest`。
- tag 与 npm 版本都是不可变身份。tag 推送后不得移动或复用。

本地包门禁根据 manifest 中的精确版本自动选择 `next` 或 `latest`。它会拒绝其他 prerelease 格式、build metadata、不安全的 bundle 路径、安装/发布生命周期脚本、意外 tarball 文件、私有目录状态、凭据型 URL 和本机用户路径。

## 验收候选版

1. 执行完整本地门禁：

   ```bash
   npm ci
   npm run check
   npm pack --dry-run
   ```

2. 推送精确 RC tag。CI 会运行完整操作系统矩阵，只构建一个经过审计的 tarball，生成 SHA-256，并发布 GitHub prerelease。
3. 从同一个 Release 下载资产，验证校验和后，再把 tarball 安装到 DSH Desktop。
4. 完成人工测试清单中的全部用例。Release tarball 未通过前，不得建立 npm 包所有权。

## 使用已验收 RC 建立 npm 所有权

npm 包存在后才能配置 Trusted Publisher。这是计划中唯一一次交互式 npm 发布。

1. 使用启用 2FA 的维护者账号登录 npm。
2. 再次确认无作用域名称仍未被占用。
3. 从同一个 GitHub Release 下载已验收 RC 的 `.tgz` 和 `.sha256` 并完成校验。
4. 将该精确 tarball 发布到 `next`：

   ```bash
   npm publish ./dsh-universe-api-X.Y.Z-rc.N.tgz \
     --tag next --access public --ignore-scripts \
     --registry=https://registry.npmjs.org/
   npm dist-tag ls dsh-universe-api
   ```

5. 确认 `next` 指向已验收 RC，且 `latest` 不存在或绝不指向 prerelease。

如果执行到这里时 `dsh-universe-api` 已被其他发布者占用，应立即停止；不能静默改名或切换为 scoped 包。

## 配置受保护的 npm 提升

稳定版提升前，在公开 GitHub 仓库中创建 `npm-production` environment：

- 添加 required reviewer；
- 将允许部署的 ref 限制为发布 tag；
- 只有一名维护者时保留 self-review，否则会形成死锁；
- 在维护模式允许时禁止绕过保护规则。

随后在 npm 包的 Trusted Publisher 设置中填写：

| 设置 | 值 |
| --- | --- |
| Provider | GitHub Actions |
| Organization or user | `Ruixinhua` |
| Repository | `dsh-universe-api` |
| Workflow filename | `publish-npm.yml` |
| Environment | `npm-production` |
| Allowed action | `npm publish` |

确认 OIDC 发布正常后，将 npm publishing access 设置为要求 2FA 并禁止传统写入 token。工作流刻意不使用 `NPM_TOKEN`；只有 environment 获批后，GitHub 才会提供短期 OIDC 身份。

## 提升稳定版

1. 仅提升没有未解决 P0/P1 问题的 RC。
2. 将 package 与 lockfile 版本改为精确稳定 SemVer，更新 changelog 和发布文档，并运行完整门禁。
3. 推送稳定 tag。tag 流水线会在 Draft Release 中创建三项资产：
   - `dsh-universe-api-X.Y.Z.tgz`；
   - 对应 `.tgz.sha256`；
   - `catalog-update-report.json`。
4. 维护者下载 Draft 资产，使用该精确 tarball 完成 Desktop 测试清单。
5. 从同一个稳定 tag 运行提升工作流：

   ```bash
   gh workflow run publish-npm.yml \
     --repo Ruixinhua/dsh-universe-api \
     --ref vX.Y.Z \
     -f tag=vX.Y.Z
   ```

6. 检查 preflight 证据，然后批准 `npm-production` job。

工作流会把远端 tag 解析到一个不可变提交；审批后重新下载全部三项资产，并比较它们与 preflight 的组合摘要；拒绝让 npm `latest` 回退；直接发布已验收 tarball，绝不重新打包。只有 npm integrity 验证一致后，Draft GitHub Release 才会公开。重跑时也只接受完全相同的 npm 字节和 Market 身份。

## 验证 Market 资格

npm 数据传播后直接检查 registry：

```bash
npm view dsh-universe-api \
  name version dist-tags.latest dsh engines repository dist.integrity \
  --json --registry=https://registry.npmjs.org/
```

结果必须包含预期的稳定版 `latest`、包名、安全 patch 路径，以及与 Release 相同的 integrity。

dshfind 会异步同步仓库并重新探测安装信息，但没有公布安装探测的服务时限。因此应直接检查状态，不要假定一个不存在的 SLA：

```bash
curl -fsSL https://api.dshfind.com/market/manifest.json | jq
curl -fsSL https://api.dshfind.com/v1/plugins/Ruixinhua/dsh-universe-api | jq '{is_plugin,is_risky,install}'
curl -fsSL 'https://api.dshfind.com/market/v1/plugins?q=dsh-universe-api&limit=10' | jq '.items[] | select(.id == "Ruixinhua/dsh-universe-api")'
```

普通条目必须报告 `is_plugin: true`、没有风险分类、npm 已发布、包名与稳定版本精确一致，并且只提供一个通过 `repository_backlink` 验证、无需 build allowance 的 npm method。Market 条目必须包含 `package.registry: "npm"`、`package.name: "dsh-universe-api"` 和预期的 `latestVersion`。随后在 DSH Desktop 中选择 dshfind 目录源，依次验证 Discover、Installable、一键安装、完整重启、一次工具调用和卸载。

如果官方 npm 证据已经正确，但 dshfind 在下一次常规仓库同步后仍保持旧安装信息，应提交 dshfind issue 请求重新探测，并附上两项 API 返回和 npm registry 证据；不要声称提供方没有公布的探测 SLA。

## 提交精选目录条目

canonical 精选目录是 [`awesome-dsh-plugin/awesome-dsh-plugin`](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)，不要提交到其他同名仓库。仅当默认分支至少包含十个有意义提交、且所引用 Release tarball 已可下载时提交。在该目录仓库中新增 `data/plugins/Ruixinhua__dsh-universe-api.yml`，重新生成两个 README，不要添加不受支持的 `npm:` 字段。分类使用 `tools`，中英文描述保持事实性。

```yaml
url: https://github.com/Ruixinhua/dsh-universe-api
name: Ruixinhua/dsh-universe-api
category: tools
tarball: https://github.com/Ruixinhua/dsh-universe-api/releases/download/vX.Y.Z-rc.N/dsh-universe-api-X.Y.Z-rc.N.tgz
description:
  en: Offline, deterministic public API catalog search for DeepSeek Harness, with Chinese and English queries plus exact filters for authentication, HTTPS, CORS, status, source tier, and category.
  zh: 面向 DeepSeek Harness 的离线确定性公共 API 目录检索，支持中英文查询，以及认证、HTTPS、CORS、状态、来源层级与分类的精确筛选。
```

在目录仓库 checkout 中执行：

```bash
npm ci
node scripts/generate-readme.mjs
node scripts/generate-readme.mjs --check
npx awesome-lint
SKIP_PUBLISH_CHECKS=1 node scripts/build-site.mjs
```

PR 应只包含这一份 YAML 和脚本生成的两个 README。

稳定版提升后，再把目录条目的 `tarball` URL 从 RC 更新为精确稳定版 Release 资产。

## 失败与恢复

- RC 验证失败时修复问题并发布新的 RC 编号。
- 稳定版 Draft 验证失败时保持未发布，修复后使用新版本；不得移动 tag。
- npm 成功但 GitHub 最终公开失败时，重跑同一个提升工作流；它只接受相同 registry integrity 和 Release 资产集合。
- 已发布 npm 版本存在缺陷时，发布更高 patch 并 deprecate 受影响版本；npm 包字节不能替换。
- dshfind 或精选目录元数据过期时，应修复来源数据，不能通过降低包身份校验来绕过。

## 参考资料

- [DSH Community Market 行为](https://github.com/anywhere-labs/dsh-desktop/blob/v2.0.3/dsh-community-market/README.md)
- [DSH 目录提供方契约](https://github.com/anywhere-labs/dsh-desktop/blob/v2.0.3/dsh-community-market/docs/catalog-provider-contract.zh.md)
- [awesome-dsh-plugin 贡献规则](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md)
- [dshfind 收录与同步](https://github.com/hikariming/dshfind/blob/main/README.md)
- [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/)
