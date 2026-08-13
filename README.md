# JKCL Funnel Analysis

JKCL Funnel Analysis 是面向产品、投放和数据团队的项目分析与数据质量工作台。它把项目经营分析、Firebase/AdMob 数据诊断、数据对账、打点验收和数据任务告警放在同一个操作界面中。

当前阶段已完成“规范与项目配置”以及独立“Firebase 对接”控制面。页面已经按 V1.7 数据结构改成从 repository 读取，Firebase 页当前展示演示数据；数据库连接信息、密钥引用和真实表结构待提供后接入，不会访问或修改线上数据库。

## 环境要求

- Node.js `>=22.13.0`
- npm

## 本地运行

```bash
npm install
npm run dev
```

开发服务器启动后，打开终端输出的本地地址。直接查看配置页面可以使用：

```text
/?module=config
```

## 功能范围

### 经营分析

- 全局项目总览：查看项目用户、投放、收入、利润和数据健康度。
- 单项目诊断：围绕单项目串联用户增长、产品漏斗、广告变现和数据质量。
- 漏斗分析中心：从异常项目发现、步骤诊断、分群/路径分析到事件证据和效果验证。
- AdMob 分析：按广告格式、广告位和国家查看请求、匹配、展示、eCPM 与收入。
- Firebase 分析：查看活跃用户、事件覆盖、参数质量、版本分布和实时延迟。
- 数据对账：对比 Firebase、AdMob、中台和 ADB 的用户、展示与收入口径。

### 质量治理

- 打点验收中心：按项目和已发布配置快照执行操作任务，核对事件、参数和关联链。
- 规范与项目配置：从标准事件主库选择事件，生成项目配置草稿，发布不可变快照供验收 Run 引用。
- Firebase 对接：独立管理凭证连接、一个或多个 Firebase Project、其下多个 App、`project_projects` 项目绑定、同步水位与接口健康。
- 数据任务与告警：查看采集、同步、聚合、对账任务和活动告警。

## Firebase 对接

Firebase 对接和项目打点配置已经解耦。一个认证连接可以发现一个或多个 Firebase Project，每个 Project 可以包含多个 Android、iOS 或 Web App；Firebase App 通过独立绑定表与现有 `project_projects.project_code` 显式关联，包名只用于校验，真正的远端绑定键为 `firebase_app_id`。

页面入口：

```text
/?module=firebaseSetup
```

页面包含接入总览、连接与资源、项目绑定、同步任务、最新数据、接口健康和接口说明。真实数据链路为：

```text
密钥托管引用 → Firebase资源发现 → BigQuery Export → OSS Raw → ADB firebase_event_fact → 分析/验收
```

控制面使用 MySQL 保存连接、远端资源、绑定、同步策略、运行、水位和接口检查日志；原始事件保存至 OSS，标准化强类型事件保存至 ADB。当天数据读取 `events_intraday_*`，历史读取 `events_*`；GA4 Realtime 仅用于健康检查和汇总对照。

凭证只允许提交密钥系统引用 `credential_secret_ref`，严禁在页面、数据库、日志、聊天或代码仓库中粘贴服务账号 JSON 私钥或 OAuth Refresh Token。真实接入前还需核对线上 `project_projects` 的完整 DDL。

## 规范与项目配置

配置页面的核心流程是：

```text
事件主库 → 按模块选择/单事件筛选 → 保存草稿 → 校验 → 发布配置快照 → 验收 Run 引用
```

页面支持：

- 选择配置名称、版本、品类、平台和关联项目。
- 按模块全选/取消，也可以按标准事件逐项选择。
- 在事件汇总和字段明细之间切换。
- 按模块、标准事件名、显示名、优先级和关键词筛选。
- 查看事件字段数量、字段类型、入库方式、字段说明、触发时机和指标用途。
- 草稿可继续编辑；已发布版本复制为新版本，发布后形成不可变 `snapshot_id`。
- 配置页展示当前事件数、字段数、Schema 版本、事件表、字段表和数据源状态。

## 数据模型与接库规范

页面当前使用 `/app/tracking-config-repository.ts` 作为唯一数据读取边界。它提供稳定的页面模型，后续接数据库只替换该文件中的数据 provider，不改动配置选择和验收页面。

### 事件主表模型

事件记录至少需要提供：

| 字段 | 用途 |
| --- | --- |
| `eventId` | 事件主键，关联字段明细 |
| `schemaVersion` | 规范版本，例如 `V1.7` |
| `module` | 事件模块/业务阶段 |
| `standardEventName` | 标准事件名 |
| `displayName` | 事件显示名 |
| `analysisGoal` | 分析目标 |
| `platforms` | 适用端 |
| `trackingLocation` | 具体打点位置 |
| `triggerTiming` | 触发时机 |
| `metricPurpose` | 中台指标和用途 |
| `sourceAlias` | 来源规范或历史事件别名 |
| `provider` | 字段生产 Provider |

### 字段明细表模型

字段记录至少需要提供：

| 字段 | 用途 |
| --- | --- |
| `eventId` | 关联事件主表 |
| `fieldOrder` | 同一事件内的展示顺序 |
| `fieldName` | 标准属性名 |
| `displayName` | 属性显示名 |
| `dataType` | 数据类型 |
| `reportingMode` | 上报方式/频率 |
| `description` | 字段说明和枚举约束 |

接入真实数据库时需要确认：数据库名、事件主表名、字段明细表名、主键关系、Schema 版本字段、排序字段和时区。数据库账号、密码和连接串只能放在服务端环境变量或托管密钥中，不能写入页面代码、README 或 Git。

### 当前数据源状态

当前页面使用 V1.7 本地镜像，来源是已有的 `app/v17-event-catalog.ts`，用于验证页面结构和交互。页面会明确显示“本地镜像预览”和“待接数据库”，不会把本地镜像标记为线上数据库，也不会执行数据库写入。

收到数据库信息后，接入顺序为：

1. 根据实际表结构完成 repository 查询映射。
2. 使用参数化查询读取事件主表和字段明细表。
3. 按 `eventId` 关联、按 `fieldOrder` 排序。
4. 读取后回填事件数、字段数、版本和最近读取时间。
5. 读回验证配置页、验收中心和事件/字段/Provider 三个数据视图。
6. 确认只读查询无误后，再讨论是否需要配置写入接口。

## 代码结构

- `app/page.tsx`：主工作台、模块导航和配置页容器。
- `app/tracking-config-repository.ts`：事件/字段数据访问边界，当前为 V1.7 本地镜像。
- `app/tracking-config-data.ts`：从 repository 派生事件目录和配置记录。
- `app/tracking-config-workspace.tsx`：新建/编辑配置和事件字段选择页面。
- `app/v17-event-catalog.ts`：V1.7 本地预览数据，不作为未来数据库连接配置。
- `app/firebase-configuration.tsx`：Firebase 数据源和绑定配置界面。
- `app/globals.css`：工作台和配置页样式。

## 验证命令

```bash
npm run build
npm test
npm run lint
git diff --check
```

构建、测试和 lint 只验证本地代码；在数据库信息提供前，不进行线上部署，也不修改线上数据库。

## 发布说明

每次功能更新都要同步维护本 README，至少说明：功能目标、页面入口、数据来源、数据模型变化、配置/权限要求、验证命令和部署限制。当前改动仅用于本地预览，尚未提交 Git、尚未部署线上。

## Starter 说明

项目基于 [vinext](https://github.com/cloudflare/vinext) 运行，可选 Cloudflare D1 与 Drizzle 支持。`.openai/hosting.json` 用于 Sites 的可选绑定，`drizzle.config.ts` 用于需要时生成 Drizzle migration。

## Workspace Auth Headers

Signed-in visitors receive both `oai-authenticated-user-id` and `oai-authenticated-user-email`. Private Sites require every visitor to sign in; public Sites may also have anonymous visitors, for whom neither header is present.

The user ID is stable for the same user on the same Site and different across Sites. Email and name are intended for display or contact purposes.

SIWC-authenticated workspace sites may also receive
`oai-authenticated-user-full-name` when the user's SIWC profile has a non-empty
`name` claim. The full-name value is percent-encoded UTF-8 and is accompanied by
`oai-authenticated-user-full-name-encoding: percent-encoded-utf-8`.

Treat the full name as optional and fall back to email when it is absent:

```tsx
import { headers } from "next/headers";

export default async function Home() {
  const requestHeaders = await headers();
  const userId = requestHeaders.get("oai-authenticated-user-id");
  const email = requestHeaders.get("oai-authenticated-user-email");
  const encodedFullName = requestHeaders.get("oai-authenticated-user-full-name");
  const fullName =
    encodedFullName &&
    requestHeaders.get("oai-authenticated-user-full-name-encoding") ===
      "percent-encoded-utf-8"
      ? decodeURIComponent(encodedFullName)
      : null;

  const displayName = fullName ?? email;
  // ...
}
```

## Optional Dispatch-Owned ChatGPT Sign-In

Import the ready-to-use helpers from `app/chatgpt-auth.ts` when the site needs
optional or required ChatGPT sign-in:

- Use `getChatGPTUser()` for optional signed-in UI.
- Use `requireChatGPTUser(returnTo)` for server-rendered pages that should send
  anonymous visitors through Sign in with ChatGPT.
- Use `chatGPTSignInPath(returnTo)` and `chatGPTSignOutPath(returnTo)` for
  browser links or actions.
- Pass a same-origin relative `returnTo` path for the destination after sign-in
  or sign-out. The helper validates and safely encodes it.
- Mark protected pages with `export const dynamic = "force-dynamic"` because
  they depend on per-request identity headers.

Dispatch owns `/signin-with-chatgpt`, `/signout-with-chatgpt`, `/callback`, the
OAuth cookies, and identity header injection. Do not implement app routes for
those reserved paths. Routes that do not import and call the helper remain
anonymous-compatible.

SIWC establishes identity only; it does not prove workspace membership. Use the
Sites hosting platform's access policy controls for workspace-wide restrictions,
or enforce explicit server-side membership or allowlist checks.

Use SIWC for account pages, user-specific dashboards, saved records, and write
actions tied to the current ChatGPT user. Leave public content anonymous.

## Useful Commands

- `npm run dev`: start local development
- `npm run build`: verify the vinext build output
- `npm test`: build the starter and verify its rendered loading skeleton
- `npm run db:generate`: generate Drizzle migrations after schema changes

## Learn More

- [vinext Documentation](https://github.com/cloudflare/vinext)
- [Drizzle D1 Guide](https://orm.drizzle.team/docs/get-started/d1-new)
