# analysis.geekforest.ai

JKCL 漏斗分析中心前端。系统面向运营、产品、广告变现和数据团队，用来查看多项目概览、单项目工作台、广告变现漏斗、VPN 功能漏斗、Firebase 数据质量、AdMob 收入效率和打点验收。

线上地址：

- <https://analysis.geekforest.ai>

## 当前能力

- 多项目概览：按 Firebase 已配置项目展示项目列表，不再展示没有 Firebase 配置的数据外项目。
- 单项目工作台：展示核心指标、漏斗、流失诊断、证据链和修复闭环。
- VPN 功能分析：围绕 V1.8 VPN 打点分析连接尝试、连接成功、连接阶段、协议回退、节点质量、IP 变化等问题。
- AdMob 分析：展示 AdMob 收入、eCPM、请求、匹配率、展示率，并和 Firebase/ADB 漏斗做诊断联动。
- Firebase 数据：展示 Firebase 配置、同步水位、任务日志和数据质量。
- 漏斗分析：支持产品/VPN 漏斗、广告变现漏斗，支持用户、session、事件等口径。
- 打点验收中心：按项目类型和配置版本选择需要验证的事件，检查已收到/未收到打点。

## 架构说明

本仓库只包含前端代码。

```text
浏览器
  ↓
analysis.geekforest.ai 前端
  ↓ 同源 /api/v3/jkcl-funnel/*
jkcl-funnel-api 后端
  ↓
ADB / Firebase 配置库 / AdMob 收入库 / OA 身份校验
```

前端默认使用当前访问域名作为 API Base。例如部署在 `analysis.geekforest.ai` 时，请求会自动打到：

```text
https://analysis.geekforest.ai/api/v3/jkcl-funnel/projects
https://analysis.geekforest.ai/api/v3/jkcl-funnel/query
```

如需本地调试或部署到其他域名，可通过环境变量覆盖 API 地址。

## 环境要求

- Node.js >= 22.13.0
- pnpm 11+

## 本地开发

```bash
pnpm install
pnpm run dev
```

本地调试时可创建 `.env.local`：

```env
NEXT_PUBLIC_TRACKING_API_BASE_URL=https://analysis.geekforest.ai
NEXT_PUBLIC_OA_API_BASE_URL=https://oa.geekforest.ai
NEXT_PUBLIC_TRACKING_API_SECURE_PATH=
```

说明：

- `NEXT_PUBLIC_TRACKING_API_BASE_URL` 为空时，前端默认使用当前页面域名。
- `NEXT_PUBLIC_OA_API_BASE_URL` 默认是 `https://oa.geekforest.ai`。
- 不要把数据库密码、Firebase JSON、OAuth Token、SSH 密码写入 `.env`、README 或前端代码。

## 构建

```bash
pnpm run build
```

构建产物在：

```text
dist/
```

## 生产部署

当前生产部署在服务器：

```text
/opt/jkcl-analysis/current
```

服务名：

```text
jkcl-analysis
```

端口：

```text
127.0.0.1:3020
```

推荐发布流程：

```bash
pnpm install
pnpm run build

# 在服务器上新建 release
/opt/jkcl-analysis/releases/YYYYMMDD-HHMM-description

# 切换软链
ln -sfnT /opt/jkcl-analysis/releases/YYYYMMDD-HHMM-description /opt/jkcl-analysis/current

# 重启服务
systemctl restart jkcl-analysis
systemctl is-active jkcl-analysis
```

健康检查：

```bash
curl -I http://127.0.0.1:3020/
curl -i https://analysis.geekforest.ai/api/v3/jkcl-funnel/projects
```

未登录时 `/api/v3/jkcl-funnel/projects` 返回 `401 unauthenticated` 属于正常现象，说明路由存在且已到达后端。

## 后端接口

### 项目列表

```http
GET /api/v3/jkcl-funnel/projects
Authorization: Bearer <company_login_token>
```

项目列表来源：

- Firebase 配置库中的 `firebase_project_bindings`
- 关联 `firebase_remote_apps`
- 关联 `firebase_remote_projects`
- 关联 `firebase_connections`
- 使用 `project_projects` 补充 App 名、包名、平台、负责人等展示字段

只展示已配置 Firebase 且未禁用的项目。

### 漏斗查询

```http
POST /api/v3/jkcl-funnel/query
Authorization: Bearer <company_login_token>
Content-Type: application/json
```

常用请求：

```json
{
  "page": "workbench",
  "dateFrom": "2026-08-25",
  "dateTo": "2026-08-25",
  "projectCode": "A003",
  "domain": "ads",
  "unit": "sessions"
}
```

`domain`：

- `ads`：广告变现
- `vpn`：VPN 功能
- `quality`：数据质量

`unit`：

- `users`：用户 UV 口径
- `sessions`：session / vpn_session 口径
- `events`：事件次数口径

## 数据口径

### 广告链路

- 用户口径：按 `my_user_id`
- Session 口径：按 `session_id`
- 事件口径：按事件次数
- 关键事件：`ad_eligibility_check`、`ad_opportunity`、`ad_request`、`ad_load_success`、`ad_show_attempt`、`ad_impression`、`ad_paid_event`

### VPN 链路

- 用户口径：按 `my_user_id`
- VPN Session 口径：按 `vpn_session_id`
- 连接尝试：`vpn_connection_start`
- 连接结果：`vpn_connection_result`
- 阶段分析：`vpn_connection_phase`
- 质量分析：`vpn_quality_sample`、`vpn_session_summary`
- IP 变化：`ip_before_connect`、`ip_after_connect`

### DWS / DWM 要求

后端支持读取以下聚合口径：

- `dwm_funnel_subject_stage_daily.subject_type = user`
- `dwm_funnel_subject_stage_daily.subject_type = session`
- `dwm_funnel_subject_stage_daily.subject_type = vpn_session`
- `dws_app_funnel_stage_daily.scope_type = users`
- `dws_app_funnel_stage_daily.scope_type = sessions`
- `dws_app_funnel_stage_hourly.scope_type = sessions`

如果 `scope_type=sessions` 没有数据，前端 session 口径会缺少完整聚合能力。

## 身份登录

前端使用公司邮箱登录。

准入规则：

- 邮箱必须属于 `geekforest.ai`
- OA/HRBP 系统校验员工属于极客主体
- 员工必须是在职状态
- 验证后的设备默认 1 个月免登录

权限必须由后端强校验，前端只负责展示登录状态和携带 token。

## 代码结构

```text
app/
  api-base-url.ts                 API Base 解析
  company-auth.tsx                公司登录和设备信任
  funnel-analysis-api.ts          漏斗查询接口
  project-options-api.ts          线上项目列表接口
  operational-funnel.tsx          后端数据驱动的漏斗分析页面
  page.tsx                        主页面和模块路由
  firebase-configuration.tsx      Firebase 数据页
  tracking-acceptance-center.tsx  打点验收中心
  tracking-config-workspace.tsx   打点配置页面
  tracking-config-repository.ts   事件/字段字典数据边界
  v18-event-catalog.ts            V1.8 事件字典镜像
```

## 常用命令

```bash
pnpm run dev
pnpm run build
pnpm run lint
git diff --check
```

## 安全注意事项

- 不允许提交 `.env`、数据库密码、SSH 密码、Firebase service account JSON、OAuth Token。
- Firebase 凭证只能保存密钥引用或服务端加密后的记录。
- README 只写变量名和部署方式，不写真实密钥。
- 项目权限、数据权限、OA 身份校验必须在后端执行。

## 最近关键变更

- 项目列表改为从 Firebase 配置库拉取，不再展示无 Firebase 配置项目。
- 前端 API Base 改为默认同源，修复部署在 `analysis.geekforest.ai` 时仍请求旧域名导致项目列表 HTTP 404 的问题。
- 增加 V1.8 VPN 功能分析菜单和 VPN 弱网专项指标。
- 广告和 VPN 链路支持 session 口径展示，ETL 需要补齐 `scope_type=sessions` 聚合行。
