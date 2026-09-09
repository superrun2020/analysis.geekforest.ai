# JKCL 漏斗分析后端模块

本目录保存 `analysis.geekforest.ai` 当前使用的 Laravel 后端模块快照，供部署到现有 NxPanel Laravel 服务。它不是第二套独立业务系统；目录结构与 NxPanel 保持一致，发布时覆盖到 Laravel 项目的对应路径。

## 主要能力

- OA/HRBP 企业员工鉴权与项目数据权限。
- 多项目、单项目、广告、VPN、质量、页面路径及证据查询。
- 从 ADB DWD 明细生成独立的 `_v18` DWM/DWS 汇总表。
- 广告 Session 使用 `session_id`，VPN Session 使用 `vpn_session_id`。
- App 版本及 Build 版本核心指标对比。
- 每日 08:00 汇总昨天数据，09:30 补充延迟入库数据。
- 汇总失败后每 30 分钟自动重试；成功后预热工作台缓存。

## 目录说明

```text
backend/
├── app/       Laravel Controller、Request、Middleware、Service、Command
├── config/    ADB 只读连接与独立写连接配置
└── systemd/   日汇总、最近7天回刷和缓存预热服务模板
```

## 必要环境变量

在服务器 Secret Manager 或 Laravel `.env` 中配置，禁止提交真实值：

```env
ADB_HOST=
ADB_PORT=3306
ADB_DATABASE=
ADB_USER=
ADB_PASSWORD=
ADB_WRITE_USER=
ADB_WRITE_PASSWORD=
ADB_FUNNEL_AGGREGATE_WRITE_CONNECTION=adb_write
ADB_FUNNEL_AGGREGATE_ENABLED=true
```

只读账号用于页面查询；写账号仅操作新建的 `_v18` 汇总表。不要把真实凭据写进 Git。

## 新汇总表

```text
dwm_funnel_subject_stage_daily_v18
dws_app_funnel_stage_hourly_v18
dws_app_funnel_stage_daily_v18
dws_ad_fulfillment_daily_v18
dws_vpn_connection_quality_daily_v18
dws_app_event_quality_daily_v18
dws_screen_path_daily_v18
```

旧表不删除、不覆盖。首次上线前应通过 migration/受控 SQL 按旧表结构创建上述新表。

## 校验

```bash
php -l app/Services/FunnelAnalyticsService.php
php -l app/Services/FunnelAnalyticsAggregateService.php
php artisan funnel-analysis:aggregate --start-date=YYYY-MM-DD --end-date=YYYY-MM-DD --force
php artisan funnel-analysis:warm-workbench-cache --date=YYYY-MM-DD --domain=all --platform=all --limit=200 --force
```

生产发布应先备份旧文件、执行语法检查，再原子切换 release 并验证 `/api/v3/jkcl-funnel/projects` 和 `/api/v3/jkcl-funnel/query`。
