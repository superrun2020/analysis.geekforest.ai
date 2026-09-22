# Analysis frontend inventory and validation

Base: deployed V163 / efd30543a3e4335cdab4c8a969f106ce8d8b5462. Existing React19.2.6, Vite8.0.13, AntD6.6.3; existing app/main.tsx ConfigProvider reused. Backend/API/auth/metrics unchanged.

## Application shell and public report controls
All normal routes use AnalysisShell: AntD Layout/Sider/Menu/Header/Content/Drawer/Dropdown/Button/Tooltip. Mobile drawer replaces sider; desktop248px/64px. Only selected leaf highlighted. Header56px with child flex-scroll instead of100dvh report.
Shared report controls: 21 Select instances and 10 date input instances migrated across operational-funnel, page global filters, and domain-report (verify exact counts from source diff); ReportSelect uses AntD value callbacks, ReportDate preserves ISO date/null guard. Daily report already uses AntD Select/Input/Table/Pagination and keeps collected-date-only choices.

## Route matrix
Real built Chrome, isolated employee identity and explicit API empty-response fixtures (not production-data E2E), 1440x900 and380x956. Main shell also tested1366x768 and390x844.

| Query route | Renderer | Verified |
|---|---|---|
| `?operations=overview` | OperationsWorkspace → DailyAnomalies | mounted, no uncaught JS error, outer viewport containment |
| `?module=funnel&page=overview` | OperationalFunnel | mounted, no uncaught JS error, outer viewport containment |
| `?module=funnel&page=workbench` | OperationalFunnel | mounted, no uncaught JS error, outer viewport containment |
| `?module=funnel&page=evidence` | OperationalFunnel | mounted, no uncaught JS error, outer viewport containment |
| `?module=funnel&page=issues` | OperationalFunnel | mounted, no uncaught JS error, outer viewport containment |
| `?module=vpn&page=workbench` | OperationalFunnel | mounted, no uncaught JS error, outer viewport containment |
| `?module=vpnReport&reportSection=matrix` | OperationalFunnel | mounted, no uncaught JS error, outer viewport containment |
| `?module=vpnReport&reportSection=exitIp` | OperationalFunnel | mounted, no uncaught JS error, outer viewport containment |
| `?module=vpnReport&reportSection=adOverall` | OperationalFunnel | mounted, no uncaught JS error, outer viewport containment |
| `?module=vpnReport&reportSection=adDns` | OperationalFunnel | mounted, no uncaught JS error, outer viewport containment |
| `?module=vpnReport&reportSection=versions` | OperationalFunnel | mounted, no uncaught JS error, outer viewport containment |
| `?module=admob` | ModuleContent → OnlineModulePage / report-specific component | mounted, no uncaught JS error, outer viewport containment |
| `?module=firebase` | ModuleContent → OnlineModulePage / report-specific component | mounted, no uncaught JS error, outer viewport containment |
| `?module=reconcile` | ModuleContent → OnlineModulePage / report-specific component | mounted, no uncaught JS error, outer viewport containment |
| `?module=tracking` | ModuleContent → OnlineModulePage / report-specific component | mounted, no uncaught JS error, outer viewport containment |
| `?module=tasks` | ModuleContent → OnlineModulePage / report-specific component | mounted, no uncaught JS error, outer viewport containment |
| `?module=shareAlerts` | ModuleContent → OnlineModulePage / report-specific component | mounted, no uncaught JS error, outer viewport containment |
| `?module=report` | ModuleContent → OnlineModulePage / report-specific component | mounted, no uncaught JS error, outer viewport containment |

## Preserved specialized UI / boundaries
- Funnel diagrams, metric drilldowns, network matrices, evidence/custom business tables and their existing exports remain React implementations; they were not blindly converted to AntD Table. Their business renderers/API payloads remain intact.
- AdMob/Firebase share the migrated global report filter and shell; their existing custom table layouts remain.
- Hidden legacy config/tracking/task/reconciliation/share-alert/domain URLs remain reachable but their previously deleted sidebar entries are not restored. Legacy administrative dialogs retain native form fields/FormData behavior. No claim every legacy form/table has been replaced.
- Standalone auth and shared reports (`/shared-report`, `/shared-report/:id`, `?sharedReport=1`, `?projectReportShare=1`) intentionally remain outside authenticated shell; login Button/diagnostics tests pass. Production logged-in share export/browser not verified.
- All-route fixture verifies render/error containment only, not live analytics values. The daily Overall suite separately uses actual isolated SQLite HTTP and verifies filters/query/reset/export/70-row pagination/503/revocation.
- Integrated real wheel/PageDown/touch and horizontal last-column checks, no scrollTop writes.

## Acceptance evidence
Logs in `/Users/oliver/oa-production-deploy`: antd-routes.log, antd-node-tests.log (38/38), antd-overall-horizontal.log, antd-shell-build.log; earlier RED logs retained. Typecheck errors compared to actual same-base worktree: see antd-base-tsc.log and antd-tsc.log; no new error signatures.
