# 上游构建 worker 到 E2E targets 的解析方案

本文档记录 `2013xile/nocobase-ci` 的 `Build pro image` 在镜像构建完成后，如何把上游代码变更转换成 `Charls-Wu/nocobase-e2e-ci` 的 `targets` 参数。

当前只在 `Charls-Wu/nocobase-e2e-ci` 中保存原型脚本和测试，不修改 `2013xile/nocobase-ci`。

## 现有构建 worker 输入

`2013xile/nocobase-ci/.github/workflows/build-pro-image.yml` 当前是 `workflow_dispatch`，主要输入为：

```text
branch
nocobase_pr_number
pro_plugin
pro_pr_number
repository
checkRunId
```

run-name 形态为：

```text
<branch>-<nocobase_pr_number>-<repository>-<pro_pr_number>
```

近期运行中观察到的典型形态：

```text
develop-9956-nocobase-              主仓 PR
develop--nocobase-                  主仓分支构建
next--plugin-email-manager-113      独立插件仓 PR
develop--pro-plugins-               pro-plugins 分支构建
develop--plugin-auth-ldap-          独立插件仓分支构建
```

## changed files 来源

第一版按当前输入能力处理：

```text
主仓 PR:
  repo = nocobase/nocobase
  pr = nocobase_pr_number
  changed files = GitHub PR files API

pro-plugins PR:
  repo = nocobase/pro-plugins
  pr = pro_pr_number
  changed files = GitHub PR files API

独立插件仓 PR:
  repo = nocobase/<repository>
  pr = pro_pr_number
  changed files = GitHub PR files API

分支构建:
  repo = nocobase/<repository>
  ref = branch
  changed files = GitHub commit API 当前分支最新提交 files
```

限制：分支构建目前没有 source base/head SHA 输入，所以只能先按“最新提交 changed files”处理。后续如果触发源能传 `before_sha` / `after_sha`，可以改成精确 diff。

## 解析规则

### nocobase 主仓

```text
packages/plugins/@nocobase/<plugin>/**
  -> <plugin>

docs/**、.github/**、README.md、*.md、.gitignore、.ignore、.node-version
  -> 不触发 E2E

其他非忽略文件
  -> *
```

说明：主仓核心、构建、公共运行时代码变化影响面不稳定，第一版保守触发 `targets=*`。

示例：

```text
packages/plugins/@nocobase/plugin-block-iframe/src/server/plugin.ts
  -> plugin-block-iframe

packages/core/app/client-v2/src/main.tsx
  -> *

docs/docs/en/file-manager/storage/index.md
  -> 不触发
```

### pro-plugins 仓

```text
@nocobase/<plugin>/**
  -> <plugin>

<package>/**
  -> <package>

docs/**、.github/**、README.md、*.md、.gitignore、.ignore、.node-version
  -> 不触发 E2E

其他根级或公共文件
  -> *
```

示例：

```text
@nocobase/plugin-action-import-pro/src/server/statics/commands/import-xlsx.ts
  -> plugin-action-import-pro

external-db-data-source/package.json
  -> external-db-data-source
```

### 独立插件仓

```text
任意非忽略文件
  -> <repository>

docs/**、.github/**、README.md、*.md、.gitignore、.ignore、.node-version
  -> 不触发 E2E
```

示例：

```text
repository = plugin-backups
src/server/plugin.ts
  -> plugin-backups
```

## E2E 包存在性过滤

解析出的 target 还需要和 `nocobase/e2e` 对应分支里的可执行包做交集。

E2E 仓库只维护三个长期分支：

```text
main
next
develop
```

`2013xile/nocobase-ci` 触发 E2E worker 时，`e2e_ref` 统一取本次构建的 base branch，也就是 `inputs.branch`：

```text
主仓 PR base = develop  -> e2e_ref=develop
主仓 PR base = main     -> e2e_ref=main
主仓 PR base = next     -> e2e_ref=next

pro-plugins PR base = develop -> e2e_ref=develop
独立插件 PR base = main       -> e2e_ref=main

develop 分支构建 -> e2e_ref=develop
main 分支构建    -> e2e_ref=main
next 分支构建    -> e2e_ref=next
```

PR 源分支名不参与 E2E 分支选择；不会要求 `nocobase/e2e` 创建 `pr-xxx` 分支。

如果 `inputs.branch` 不是 `main`、`next`、`develop`，第一版直接跳过 E2E。

可执行包定义：

```text
packages/<name>/package.json 存在 scripts.test:e2e
```

如果解析出 target 但 E2E 仓没有对应包：

```text
记录到 missingTargets
不触发 E2E
```

如果是公共影响面变化：

```text
target_input = *
```

由 E2E worker 自己在对应 `e2e_ref` 下解析所有可执行包。

## 当前原型脚本

位置：

```text
scripts/resolve-upstream-e2e-targets.mjs
scripts/resolve-2013-build-e2e-targets.mjs
```

两层职责：

```text
resolve-2013-build-e2e-targets.mjs
  输入 2013 worker 当前已有参数
  推导 source repo / PR / branch
  获取 changed files
  调用下层解析器

resolve-upstream-e2e-targets.mjs
  输入 source repo + changed files
  输出 target_input / should_run / missingTargets
```

示例：

```bash
node scripts/resolve-upstream-e2e-targets.mjs \
  --source-repo nocobase \
  --changed-files /tmp/changed-files.txt \
  --e2e-repo-dir ../e2e \
  --output /tmp/e2e-targets.json
```

按 2013 worker 输入运行：

```bash
node scripts/resolve-2013-build-e2e-targets.mjs \
  --branch develop \
  --repository nocobase \
  --nocobase-pr-number 8743 \
  --pro-plugin "" \
  --pro-pr-number "" \
  --e2e-repo-dir ../e2e \
  --output /tmp/e2e-targets.json
```

输出核心字段：

```json
{
  "mode": "packages",
  "shouldRun": true,
  "targetInput": "plugin-block-iframe",
  "runnableTargets": ["plugin-block-iframe"],
  "missingTargets": []
}
```

GitHub Actions 接入时使用：

```text
target_input
should_run
mode
e2e_ref
e2e_ref_supported
```

## 已验证样例

```text
模拟主仓 plugin-block-iframe 改动
  packages/plugins/@nocobase/plugin-block-iframe/src/server/plugin.ts
  -> target_input=plugin-block-iframe

nocobase/nocobase PR #9968
  docs only
  -> target_input=<none>

nocobase/pro-plugins PR #520
  @nocobase/plugin-action-import-pro/**
  -> missingTargets=plugin-action-import-pro
  -> 当前 E2E 仓没有对应包，所以不触发

nocobase/plugin-backups PR #39
  src/**
  -> missingTargets=plugin-backups
  -> 当前 E2E 仓没有对应包，所以不触发

nocobase/nocobase PR #8743
  包含 packages/core/** 和 plugin-map
  -> target_input=*
```

## 后续接入 2013 构建 worker 的位置

建议新增 job：

```text
resolve-e2e-targets
```

依赖：

```text
prepare-meta
```

职责：

```text
1. 创建 GitHub App token
2. 根据 inputs.branch 得到 e2e_ref；只支持 main / next / develop
3. checkout nocobase/e2e@e2e_ref 或只读取包列表
4. 运行 resolve-2013-build-e2e-targets.mjs
5. 输出 target_input / should_run / e2e_ref
```

2013 输入到来源仓库的对应关系：

```text
repository = nocobase
  source repo = nocobase/nocobase
  PR 场景使用 nocobase_pr_number
  非 PR 场景使用 branch 最新 commit

repository = pro-plugins
  source repo = nocobase/pro-plugins
  PR 场景使用 pro_pr_number
  非 PR 场景使用 branch 最新 commit

repository = plugin-xxx
  source repo = nocobase/plugin-xxx
  PR 场景使用 pro_pr_number
  非 PR 场景使用 branch 最新 commit
```

已知限制：

```text
分支构建目前只能从 branch 最新 commit 取 files。
如果要覆盖 push 里的多个 commit，需要触发源或 2013 worker 额外传 before_sha / after_sha。
```

`resolve-e2e-targets` 不负责实际跑测试，只负责解析，降低第一版接入风险。

建议新增 job：

```text
dispatch-e2e
```

依赖：

```text
assemble-image
resolve-e2e-targets
```

职责：

```text
1. 读取 assemble-image 产出的 image tag
2. 读取 resolve-e2e-targets 产出的 target_input
3. 触发 Charls-Wu/nocobase-e2e-ci
```

条件：

```text
assemble-image 成功
resolve-e2e-targets.outputs.should_run == 'true'
```

触发：

```text
Charls-Wu/nocobase-e2e-ci/.github/workflows/e2e.yml
targets = resolve-e2e-targets.outputs.target_input
nocobase_version = needs.prepare-meta.outputs.imageTag
e2e_ref = resolve-e2e-targets.outputs.e2e_ref
dry_run = false
```

说明：PR 场景也使用 base branch 对应的 E2E 分支，不使用 `pr-xxx`。

第一版建议拆成两次 PR：

```text
PR 1:
  只新增 resolve-e2e-targets
  只打印 target_input / missingTargets
  不触发真实 E2E

PR 2:
  在 PR 1 观察过真实构建后，再新增 dispatch-e2e
```

这样即使 target 解析规则有问题，第一阶段也不会影响现有镜像构建和状态回写。
