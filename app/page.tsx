"use client";

import { useEffect, useMemo, useState } from "react";

type PageKey =
  | "overview"
  | "workbench"
  | "diagnosis"
  | "cohort"
  | "path"
  | "evidence"
  | "issues"
  | "snapshot";

type FunnelMode = "product" | "monetization";
type UnitMode = "users" | "events";
type ModuleKey = "global" | "project" | "funnel" | "admob" | "firebase" | "reconcile" | "tracking" | "config" | "tasks";
type DialogKey =
  | "project-report"
  | "diagnosis"
  | "admob-report"
  | "version-diff-report"
  | "event-dictionary"
  | "reconcile-run"
  | "tracking-run"
  | "retest-run"
  | "config-version"
  | "project-category"
  | "publish-approval"
  | "alert-rule";

const moduleMenus: Array<{ key: ModuleKey; index: string; label: string; group: "经营分析" | "质量治理" }> = [
  { key: "global", index: "01", label: "全局项目总览", group: "经营分析" },
  { key: "project", index: "02", label: "单项目诊断", group: "经营分析" },
  { key: "funnel", index: "03", label: "漏斗分析", group: "经营分析" },
  { key: "admob", index: "04", label: "AdMob 分析", group: "经营分析" },
  { key: "firebase", index: "05", label: "Firebase 分析", group: "经营分析" },
  { key: "reconcile", index: "06", label: "数据对账", group: "经营分析" },
  { key: "tracking", index: "07", label: "打点验收中心", group: "质量治理" },
  { key: "config", index: "08", label: "规范与项目配置", group: "质量治理" },
  { key: "tasks", index: "09", label: "数据任务与告警", group: "质量治理" },
];

const moduleCopy: Record<ModuleKey, { title: string; description: string; action: string }> = {
  global: { title: "全局项目总览", description: "统一查看所有项目的用户、投放、收入、利润和数据健康度", action: "导出项目日报" },
  project: { title: "单项目诊断", description: "围绕单个项目串联用户增长、产品漏斗、广告变现和数据质量", action: "创建诊断任务" },
  funnel: { title: "漏斗分析中心", description: "从多项目异常发现到事件证据、修复重测和效果验证的完整诊断闭环", action: "新建诊断任务" },
  admob: { title: "AdMob 分析", description: "分析请求、匹配、展示、广告浏览用户、eCPM和收入变化", action: "导出 AdMob 报表" },
  firebase: { title: "Firebase 分析", description: "监控活跃用户、事件覆盖、参数质量、版本分布和实时数据延迟", action: "查看事件字典" },
  reconcile: { title: "数据对账", description: "对比 Firebase、AdMob、中台与 ADB 的用户、展示和收入口径", action: "发起重新对账" },
  tracking: { title: "打点验收中心", description: "按项目品类和测试快照验证应收事件、必填参数与完整关联链", action: "新建验收 Run" },
  config: { title: "规范与项目配置", description: "管理项目类型、能力包、事件参数、漏斗版本和项目关联范围", action: "新建配置版本" },
  tasks: { title: "数据任务与告警", description: "监控采集、同步、聚合与对账任务，并闭环处理数据异常", action: "新建告警规则" },
};

const moduleDialog: Record<ModuleKey, DialogKey> = {
  global: "project-report",
  project: "diagnosis",
  funnel: "diagnosis",
  admob: "admob-report",
  firebase: "event-dictionary",
  reconcile: "reconcile-run",
  tracking: "tracking-run",
  config: "config-version",
  tasks: "alert-rule",
};

const pages: Array<{ key: PageKey; label: string; hint: string }> = [
  { key: "overview", label: "多项目漏斗总览", hint: "发现异常项目" },
  { key: "workbench", label: "单项目漏斗分析", hint: "定位异常步骤" },
  { key: "diagnosis", label: "步骤转化诊断", hint: "拆解流失原因" },
  { key: "cohort", label: "分群对比分析", hint: "找到问题人群" },
  { key: "path", label: "路径与流失分析", hint: "还原用户行为" },
  { key: "evidence", label: "事件证据明细", hint: "验证事件链" },
  { key: "issues", label: "问题与效果验证", hint: "修复闭环" },
  { key: "snapshot", label: "漏斗口径快照", hint: "确认计算规则" },
];

const projects = [
  { code: "IRAN-VPN-01", name: "Iran Fast VPN", category: "套利 VPN", dau: "128,430", viewer: "23.1%", opportunity: "28.4%", completion: "42.6%", revenue: "$4,821", status: "严重", issue: "Eligible → Opportunity" },
  { code: "FAST-VPN-02", name: "Fast VPN", category: "套利 VPN", dau: "96,510", viewer: "35.8%", opportunity: "42.1%", completion: "48.9%", revenue: "$4,103", status: "正常", issue: "—" },
  { code: "CLEAN-MAX-03", name: "Clean Max", category: "清理", dau: "76,210", viewer: "38.7%", opportunity: "45.1%", completion: "51.2%", revenue: "$2,104", status: "预警", issue: "Load → Show Attempt" },
  { code: "AIVORA-LAUNCHER", name: "Aivora Launcher", category: "Launcher", dau: "54,870", viewer: "31.4%", opportunity: "37.6%", completion: "46.3%", revenue: "$1,887", status: "正常", issue: "—" },
  { code: "TURBO-CLEAN-05", name: "Turbo Cleaner", category: "清理", dau: "41,360", viewer: "19.8%", opportunity: "24.5%", completion: "39.1%", revenue: "$986", status: "严重", issue: "Opportunity → Request" },
];

const productStages = [
  { label: "DAU", event: "app_active", value: "128,430", rate: "100%", delta: "+2.8%" },
  { label: "VPN 首页", event: "vpn_home_view", value: "117,804", rate: "91.7%", delta: "+1.4%" },
  { label: "点击连接", event: "connect_start", value: "82,361", rate: "69.9%", delta: "-3.2%" },
  { label: "权限通过", event: "permission_result", value: "76,409", rate: "92.8%", delta: "-0.6%" },
  { label: "连接成功", event: "connect_success", value: "64,276", rate: "84.1%", delta: "-5.9%" },
  { label: "稳定连接", event: "session_active", value: "54,729", rate: "85.1%", delta: "-2.1%" },
];

const monetizationUserStages = [
  { label: "DAU", event: "app_active", value: "128,430", rate: "100%", delta: "+2.8%" },
  { label: "Eligible", event: "jk_ad_eligible", value: "83,106", rate: "64.7%", delta: "-1.3%" },
  { label: "Opportunity", event: "jk_ad_opportunity", value: "36,474", rate: "43.9%", delta: "-12.8%" },
  { label: "Request", event: "jk_ad_request", value: "34,921", rate: "95.7%", delta: "-0.9%" },
  { label: "Load", event: "jk_ad_load_success", value: "34,085", rate: "97.6%", delta: "+0.4%" },
  { label: "Show Attempt", event: "jk_ad_show_attempt", value: "31,682", rate: "93.0%", delta: "-1.8%" },
  { label: "AV", event: "jk_ad_impression", value: "29,671", rate: "93.7%", delta: "-0.7%" },
  { label: "Paid", event: "jk_ad_paid_event", value: "29,404", rate: "99.1%", delta: "+0.1%" },
];

const monetizationEventStages = [
  { label: "Opportunity", event: "jk_ad_opportunity", value: "214,306", rate: "100%", delta: "+4.9%" },
  { label: "Request", event: "jk_ad_request", value: "201,944", rate: "94.2%", delta: "-0.8%" },
  { label: "Load", event: "jk_ad_load_success", value: "199,925", rate: "99.0%", delta: "+0.1%" },
  { label: "Show Attempt", event: "jk_ad_show_attempt", value: "144,871", rate: "72.5%", delta: "-2.6%" },
  { label: "Impression", event: "jk_ad_impression", value: "137,628", rate: "95.0%", delta: "-0.4%" },
  { label: "Paid Event", event: "jk_ad_paid_event", value: "136,392", rate: "99.1%", delta: "+0.1%" },
];

const reasons = [
  { code: "NO_OPPORTUNITY", label: "满足资格但没有生成广告机会", users: "24,613", share: 52.8, impact: "$1,482", owner: "产品 / 客户端" },
  { code: "SCENE_NOT_REACHED", label: "未到达配置的广告触发场景", users: "9,384", share: 20.1, impact: "$565", owner: "产品" },
  { code: "FREQUENCY_CAPPED", label: "命中频控或冷却时间", users: "5,817", share: 12.5, impact: "$350", owner: "广告策略" },
  { code: "APP_BACKGROUND", label: "触发前 App 进入后台", users: "3,921", share: 8.4, impact: "$236", owner: "客户端" },
  { code: "EVENT_NOT_RECEIVED", label: "客户端触发但 Firebase 未收到", users: "1,937", share: 4.2, impact: "$117", owner: "数据 / 客户端" },
  { code: "UNKNOWN", label: "暂时无法分类", users: "948", share: 2.0, impact: "$57", owner: "数据" },
];

const cohortRows = [
  { value: "伊朗", volume: "48,420", base: "52.1%", current: "31.8%", change: "-20.3pp", lost: "9,829", impact: "$592", level: "bad" },
  { value: "埃及", volume: "18,304", base: "49.6%", current: "42.7%", change: "-6.9pp", lost: "1,263", impact: "$76", level: "warn" },
  { value: "土耳其", volume: "15,887", base: "47.2%", current: "45.4%", change: "-1.8pp", lost: "286", impact: "$17", level: "ok" },
  { value: "巴基斯坦", volume: "12,641", base: "44.8%", current: "46.1%", change: "+1.3pp", lost: "—", impact: "+$10", level: "good" },
  { value: "印度尼西亚", volume: "9,218", base: "41.3%", current: "40.7%", change: "-0.6pp", lost: "55", impact: "$3", level: "ok" },
];

const eventRows = [
  { time: "10:27:04.132", name: "jk_ad_eligible", result: "有效", detail: "eligible=1 · placement=vpn_connect_success", id: "evt_2a18", source: "Firebase" },
  { time: "10:27:04.146", name: "jk_ad_opportunity", result: "缺失", detail: "预期事件未收到 · scene 已执行", id: "—", source: "质量引擎" },
  { time: "10:27:04.188", name: "jk_ad_request", result: "有效", detail: "request_id=req_91a · retry_index=0", id: "evt_2a19", source: "Firebase" },
  { time: "10:27:04.943", name: "jk_ad_load_success", result: "有效", detail: "ad_instance_id=ins_671 · response_id 可选省略", id: "evt_2a20", source: "Firebase" },
  { time: "10:27:05.106", name: "jk_ad_show_attempt", result: "P1缺失", detail: "visibility_reason 缺失 · 不阻断 P0", id: "evt_2a21", source: "Firebase" },
  { time: "10:27:05.419", name: "jk_ad_impression", result: "链路异常", detail: "request_id 正常 · opportunity_id 未关联", id: "evt_2a22", source: "Firebase" },
  { time: "10:27:05.438", name: "jk_ad_paid_event", result: "有效", detail: "value_micros=2814 · currency=USD", id: "evt_2a23", source: "Firebase" },
];

function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "good" | "warn" | "bad" | "blue" }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

function Metric({ label, value, note, tone }: { label: string; value: string; note: string; tone?: "bad" | "good" }) {
  return (
    <article className="metric-card">
      <div className="metric-label">{label}</div>
      <div className={`metric-value ${tone ? `metric-${tone}` : ""}`}>{value}</div>
      <div className="metric-note">{note}</div>
    </article>
  );
}

function Segmented({ items, active, onChange, label }: { items: Array<{ key: string; label: string }>; active: string; onChange: (key: string) => void; label: string }) {
  return (
    <div className="segmented" aria-label={label}>
      {items.map((item) => (
        <button key={item.key} className={active === item.key ? "selected" : ""} onClick={() => onChange(item.key)}>{item.label}</button>
      ))}
    </div>
  );
}

function ModulePage({ module, project, openModule, openDialog, notify }: { module: Exclude<ModuleKey, "funnel">; project: string; openModule: (next: ModuleKey) => void; openDialog: (dialog: DialogKey) => void; notify: (message: string) => void }) {
  if (module === "global") return (
    <div className="page-stack">
      <section className="metric-grid six"><Metric label="项目数" value="28" note="在线 24 · 灰度 4" /><Metric label="总 DAU" value="1,284,630" note="较昨日 +4.1%" tone="good" /><Metric label="总收入" value="$48,921" note="较昨日 +2.7%" tone="good" /><Metric label="投放消耗" value="$31,406" note="ROAS 155.8%" /><Metric label="预估利润" value="$17,515" note="利润率 35.8%" tone="good" /><Metric label="异常项目" value="4" note="严重 2 · 预警 2" tone="bad" /></section>
      <section className="portfolio-health"><div><Badge tone="bad">2</Badge><strong>变现严重异常</strong><p>广告浏览者比例或收入连续下降</p></div><div><Badge tone="warn">2</Badge><strong>数据质量预警</strong><p>Firebase 与中台 DAU 差异超阈值</p></div><div><Badge tone="blue">3</Badge><strong>待完成验收</strong><p>新版本尚未达到 P0 100%</p></div><div><Badge tone="good">21</Badge><strong>项目运行正常</strong><p>核心指标处于历史基线范围</p></div></section>
      <section className="two-column wide-left">
        <div className="surface"><div className="surface-title"><div><h2>项目经营总览</h2><p>项目代号、包名和产品维度分开管理</p></div><button className="text-button" onClick={() => openModule("project")}>进入单项目诊断</button></div><div className="table-wrap"><table><thead><tr><th>项目</th><th>品类</th><th>DAU</th><th>收入</th><th>消耗</th><th>ROAS</th><th>广告浏览者比例</th><th>数据健康</th><th>状态</th></tr></thead><tbody>{projects.map((item, index) => <tr key={item.code} className="clickable-row" onClick={() => openModule("project")}><td><strong>{item.code}</strong><small>{item.name}</small></td><td>{item.category}</td><td>{item.dau}</td><td>{item.revenue}</td><td>{["$3,118", "$2,791", "$1,436", "$1,210", "$892"][index]}</td><td>{["154.6%", "147.0%", "146.5%", "155.9%", "110.5%"][index]}</td><td>{item.viewer}</td><td>{index === 0 ? "96.8%" : index === 4 ? "91.2%" : "≥99.0%"}</td><td><Badge tone={item.status === "严重" ? "bad" : item.status === "预警" ? "warn" : "good"}>{item.status}</Badge></td></tr>)}</tbody></table></div></div>
        <aside className="surface"><div className="surface-title"><div><h2>今日重点</h2><p>按利润影响和紧急度排序</p></div></div><div className="focus-list"><button onClick={() => openModule("funnel")}><Badge tone="bad">P0</Badge><div><strong>IRAN-VPN-01 覆盖下跌</strong><p>预计影响 $2,807/日</p></div></button><button onClick={() => openModule("reconcile")}><Badge tone="warn">P1</Badge><div><strong>CLEAN-MAX-03 DAU差异</strong><p>Firebase 比中台高 8.7%</p></div></button><button onClick={() => openModule("tracking")}><Badge tone="blue">验收</Badge><div><strong>AIVORA-LAUNCHER 1.4.0</strong><p>P0事件完成 28/31</p></div></button></div></aside>
      </section>
      <section className="two-column"><div className="surface"><div className="surface-title"><div><h2>项目收入与利润贡献</h2><p>近7日 · 按项目排序</p></div></div><div className="contribution-bars">{[["IRAN-VPN-01",82,"$33,747","$12,268"],["FAST-VPN-02",70,"$28,721","$9,816"],["CLEAN-MAX-03",48,"$14,728","$4,193"],["AIVORA-LAUNCHER",39,"$13,209","$3,887"]].map(([name,width,revenue,profit]) => <div key={String(name)}><span>{name}</span><div><i style={{width:`${width}%`}} /></div><strong>{revenue}</strong><small>利润 {profit}</small></div>)}</div></div><aside className="surface"><div className="surface-title"><div><h2>市场分布</h2><p>DAU / 收入占比</p></div></div><div className="market-list">{[["伊朗","38.4%","42.1%"],["埃及","16.7%","14.8%"],["土耳其","12.6%","15.2%"],["巴基斯坦","9.4%","7.8%"],["其他","22.9%","20.1%"]].map(row => <div key={row[0]}><strong>{row[0]}</strong><span>{row[1]} DAU</span><span>{row[2]} 收入</span></div>)}</div></aside></section>
    </div>
  );

  if (module === "project") return (
    <div className="page-stack">
      <section className="project-hero surface"><div><div className="eyebrow">{project} · com.jkcl.iran.vpn</div><h2>Iran Fast VPN</h2><p>套利 VPN · Android · 负责人 Oliver · 当前版本 1.8.0 (108)</p></div><div className="project-health"><span>综合健康度</span><strong>72</strong><Badge tone="warn">需要关注</Badge></div></section>
      <section className="metric-grid six"><Metric label="DAU" value="128,430" note="+2.8%" tone="good" /><Metric label="新增用户" value="31,842" note="占DAU 24.8%" /><Metric label="广告浏览者比例" value="23.1%" note="目标 ≥35%" tone="bad" /><Metric label="收入" value="$4,821" note="-8.4%" tone="bad" /><Metric label="ARPDAU" value="$0.0375" note="-10.1%" tone="bad" /><Metric label="D1留存" value="34.8%" note="+1.2pp" tone="good" /></section>
      <section className="health-dimensions">{[["用户增长",82,"good"],["产品转化",76,"good"],["广告覆盖",48,"bad"],["广告效率",91,"good"],["收入表现",63,"warn"],["数据质量",94,"good"]].map(([name,score,tone]) => <button key={String(name)} onClick={() => tone === "bad" ? openModule("funnel") : notify(`${name}诊断详情已展开`)}><span>{name}</span><strong className={String(tone)}>{score}</strong><div><i className={String(tone)} style={{width:`${score}%`}} /></div><small>{tone === "bad" ? "存在严重异常" : tone === "warn" ? "低于项目基线" : "处于正常范围"}</small></button>)}</section>
      <section className="two-column wide-left"><div className="surface"><div className="surface-title"><div><h2>全链路诊断</h2><p>从安装、活跃、产品使用到广告变现</p></div><Badge tone="bad">1 个核心阻塞</Badge></div><div className="diagnostic-chain">{[["安装","31,842","100%","normal"],["活跃","128,430","—","normal"],["连接成功","64,276","50.0%","normal"],["广告机会","36,474","28.4%","bad"],["广告浏览 AV","29,671","23.1%","bad"],["付费回调","29,404","99.1%","normal"]].map(([label,value,rate,status],index) => <div key={String(label)} className={status === "bad" ? "bad" : ""}><span>{index+1}</span><strong>{label}</strong><em>{value}</em><small>{rate}</small></div>)}</div><div className="diagnosis-callout"><Badge tone="bad">核心问题</Badge><strong>请求前广告机会覆盖不足</strong><p>请求后的加载与展示效率正常；无需先调整 AdMob 填充策略。</p><button onClick={() => openModule("funnel")}>进入漏斗分析</button></div></div><aside className="surface"><div className="surface-title"><div><h2>快速检查</h2><p>按问题优先级执行</p></div></div><div className="quick-checks"><button onClick={() => openModule("funnel")}><span>1</span><div><strong>漏斗异常</strong><p>Eligible → Opportunity -12.8pp</p></div><Badge tone="bad">严重</Badge></button><button onClick={() => openModule("firebase")}><span>2</span><div><strong>Firebase质量</strong><p>P0字段完整率 99.1%</p></div><Badge tone="warn">预警</Badge></button><button onClick={() => openModule("admob")}><span>3</span><div><strong>AdMob效率</strong><p>匹配100% · 展示70.2%</p></div><Badge tone="good">正常</Badge></button><button onClick={() => openModule("reconcile")}><span>4</span><div><strong>数据对账</strong><p>展示差异 1.7%</p></div><Badge tone="good">正常</Badge></button></div></aside></section>
    </div>
  );

  if (module === "admob") return (
    <div className="page-stack">
      <section className="metric-grid six"><Metric label="预估收入" value="$4,821" note="较昨日 -8.4%" tone="bad" /><Metric label="广告请求" value="201,944" note="+4.9%" /><Metric label="匹配率" value="100%" note="AdMob已结算" tone="good" /><Metric label="展示率" value="70.2%" note="目标 ≥68%" tone="good" /><Metric label="eCPM" value="$35.03" note="-3.1%" /><Metric label="广告浏览者 AV" value="29,671" note="AV/DAU 23.1%" tone="bad" /></section>
      <section className="admob-split"><div className="surface"><div className="surface-title"><div><h2>用户覆盖</h2><p>回答有多少用户真正看到了广告</p></div><Badge tone="bad">异常</Badge></div><div className="big-ratio"><strong>23.1%</strong><span>广告浏览者比例</span><div><i style={{width:"23.1%"}} /></div></div><div className="ratio-details"><div><span>DAU</span><strong>128,430</strong></div><div><span>Request UV</span><strong>34,921</strong></div><div><span>AV</span><strong>29,671</strong></div><div><span>Impression/AV</span><strong>3.42</strong></div></div><button className="full-link" onClick={() => openModule("funnel")}>定位用户覆盖漏斗 →</button></div><div className="surface"><div className="surface-title"><div><h2>请求后效率</h2><p>回答广告 SDK 链路是否健康</p></div><Badge tone="good">正常</Badge></div><div className="efficiency-chain">{[["Request","201,944","100%"],["Matched","201,944","100%"],["Show","141,760","70.2%"],["Impression","137,628","97.1%"]].map(row => <div key={row[0]}><strong>{row[0]}</strong><span>{row[1]}</span><Badge tone={row[0] === "Show" ? "blue" : "good"}>{row[2]}</Badge></div>)}</div><div className="conclusion-block good"><strong>结论</strong><p>AdMob匹配和请求后展示正常，低AV主要不是填充问题。</p></div></div></section>
      <section className="surface"><div className="surface-title"><div><h2>广告格式与广告位</h2><p>收入、覆盖和效率必须同时评估</p></div><div className="dimension-tabs"><button className="active">广告格式</button><button>广告位</button><button>国家</button></div></div><div className="table-wrap"><table><thead><tr><th>广告格式</th><th>请求</th><th>匹配率</th><th>展示率</th><th>Impression</th><th>AV</th><th>Impression/AV</th><th>eCPM</th><th>收入</th><th>状态</th></tr></thead><tbody>{[["插屏","128,420","100%","72.4%","90,216","21,904","4.12","$38.42","$3,466","正常"],["激励视频","31,842","99.8%","81.6%","25,912","12,404","2.09","$42.18","$1,093","正常"],["Banner","41,682","100%","51.4%","21,500","18,621","1.15","$12.19","$262","预警"]].map(row => <tr key={row[0]}>{row.map((cell,index) => <td key={index}>{index === 9 ? <Badge tone={cell === "正常" ? "good" : "warn"}>{cell}</Badge> : cell}</td>)}</tr>)}</tbody></table></div></section>
      <section className="two-column"><div className="surface"><div className="surface-title"><div><h2>Mediation Adapter</h2><p>按收入贡献和错误率排序</p></div></div><div className="adapter-list">{[["Google Ads","62.4%","$3,009","0.3%"],["Meta Audience Network","18.7%","$902","1.1%"],["AppLovin","12.8%","$617","0.8%"],["Unity Ads","6.1%","$293","2.4%"]].map(row => <div key={row[0]}><strong>{row[0]}</strong><div><i style={{width:row[1]}} /></div><span>{row[2]}</span><small>错误 {row[3]}</small></div>)}</div></div><aside className="surface"><div className="surface-title"><div><h2>收入异常说明</h2><p>自动关联相关指标</p></div></div><div className="conclusion-block warn"><strong>收入下降不是 eCPM 单因子</strong><p>eCPM下降3.1%，但AV下降12.4%；用户覆盖是更大的收入损失来源。</p></div><button className="primary-button full" onClick={() => openModule("project")}>返回单项目诊断</button></aside></section>
    </div>
  );

  if (module === "firebase") return (
    <div className="page-stack">
      <section className="metric-grid six"><Metric label="Firebase DAU" value="128,430" note="实时 · 延迟8分钟" /><Metric label="中台 DAU" value="124,208" note="差异 3.3%" tone="bad" /><Metric label="今日事件量" value="8.42M" note="+5.7%" /><Metric label="P0参数完整率" value="99.1%" note="目标100%" tone="bad" /><Metric label="未知事件率" value="0.18%" note="目标&lt;0.5%" tone="good" /><Metric label="隔离事件" value="2,184" note="缺ID 1,602" tone="bad" /></section>
      <section className="firebase-status"><div><span className="status-dot" /><strong>Firebase Export</strong><p>最近入库 15:31 · 正常</p></div><i /><div><span className="status-dot" /><strong>标准化任务</strong><p>批次 fb_1530 · 正常</p></div><i /><div><span className="status-dot" /><strong>ADB 聚合</strong><p>水位 15:22 · 延迟9分钟</p></div><i /><div><span className="status-dot warn" /><strong>中台接口</strong><p>成功率 96.7% · 预警</p></div></section>
      <section className="two-column wide-left"><div className="surface"><div className="surface-title"><div><h2>事件健康度</h2><p>按P0覆盖、参数和关联链综合判断</p></div><button className="text-button" onClick={() => openModule("tracking")}>进入打点验收</button></div><div className="table-wrap"><table><thead><tr><th>事件</th><th>今日用户</th><th>事件量</th><th>P0参数</th><th>event_id</th><th>关联链</th><th>版本覆盖</th><th>状态</th></tr></thead><tbody>{[["jk_ad_request","34,921","201,944","100%","100%","99.8%","98.6%","正常"],["jk_ad_impression","29,671","137,628","99.1%","100%","97.8%","异常"],["connect_success","64,276","71,804","100%","99.9%","99.7%","99.2%","正常"],["app_background","82,104","126,908","98.7%","100%","—","96.4%","预警"],["jk_ad_paid_event","29,404","136,392","100%","100%","99.1%","98.6%","正常"]].map(row => <tr key={row[0]}>{row.map((cell,index) => <td key={index}>{index === 7 ? <Badge tone={cell === "正常" ? "good" : cell === "预警" ? "warn" : "bad"}>{cell}</Badge> : cell}</td>)}</tr>)}</tbody></table></div></div><aside className="surface"><div className="surface-title"><div><h2>主要质量问题</h2><p>按影响事件量排序</p></div></div><div className="quality-issues"><button onClick={() => openModule("tracking")}><Badge tone="bad">P0</Badge><strong>impression缺opportunity_id</strong><span>1,824 条 · 1.3%</span></button><button onClick={() => openModule("reconcile")}><Badge tone="warn">同步</Badge><strong>中台接口上报失败</strong><span>4,222 用户 · 3.3%</span></button><button><Badge tone="warn">P1</Badge><strong>background_reason 缺失</strong><span>1,649 条 · 1.3%</span></button><button><Badge tone="neutral">隔离</Badge><strong>event_id 为空</strong><span>1,602 条</span></button></div></aside></section>
      <section className="surface"><div className="surface-title"><div><h2>版本与用户覆盖</h2><p>确认新版本是否完整接入全部事件</p></div><Badge tone="blue">Android</Badge></div><div className="version-coverage">{[["1.8.0 (108)","68.4%",68,"99.1%","31/31"],["1.7.4 (104)","21.7%",22,"99.8%","31/31"],["1.7.2 (102)","7.1%",7,"98.9%","29/31"],["其他","2.8%",3,"95.2%","26/31"]].map(row => <div key={String(row[0])}><strong>{row[0]}</strong><span>{row[1]} DAU</span><div><i style={{width:`${row[2]}%`}} /></div><small>参数 {row[3]}</small><Badge tone={row[4] === "31/31" ? "good" : "warn"}>{row[4]} P0</Badge></div>)}</div></section>
    </div>
  );

  if (module === "reconcile") return (
    <div className="page-stack">
      <section className="metric-grid five"><Metric label="对账项目" value="24" note="今日完成 22" /><Metric label="正常项目" value="19" note="差异&lt;3%" tone="good" /><Metric label="预警项目" value="3" note="差异3%–5%" /><Metric label="异常项目" value="2" note="差异&gt;5%" tone="bad" /><Metric label="待结算日期" value="3 天" note="AdMob T+3" /></section>
      <section className="reconcile-flow">{[["Firebase","用户/事件","128,430 DAU"],["AdMob","请求/展示/收入","T+3 已结算"],["OSS Raw","原始事件备份","8.42M"],["ADB","标准化事实表","水位15:22"],["中台报表","统一口径","差异告警"]].map((row,index) => <div key={row[0]}><span>{index+1}</span><strong>{row[0]}</strong><p>{row[1]}</p><small>{row[2]}</small></div>)}</section>
      <section className="surface"><div className="surface-title"><div><h2>核心指标对账</h2><p>今天仅对账 Firebase 与中台；AdMob 使用已结算日期</p></div><Badge tone="warn">2项异常</Badge></div><div className="table-wrap"><table><thead><tr><th>指标</th><th>日期</th><th>Firebase</th><th>AdMob</th><th>中台/ADB</th><th>差异率</th><th>容差</th><th>判定</th><th>建议</th></tr></thead><tbody>{[["DAU","今天","128,430","—","124,208","3.3%","≤2%","预警","检查中台接口"],["广告浏览人数AV","8/8","31,284","30,901","31,022","1.2%","≤3%","正常","—"],["Impression","8/8","142,821","140,432","141,076","1.7%","≤3%","正常","—"],["Paid Revenue","8/8","$5,018","$4,821","$5,001","4.1%","≤3%","异常","检查币种/时区"],["Request","8/8","203,812","201,944","202,405","0.9%","≤3%","正常","—"]].map(row => <tr key={`${row[0]}${row[1]}`}>{row.map((cell,index) => <td key={index}>{index === 7 ? <Badge tone={cell === "正常" ? "good" : cell === "预警" ? "warn" : "bad"}>{cell}</Badge> : cell}</td>)}</tr>)}</tbody></table></div></section>
      <section className="two-column"><div className="surface"><div className="surface-title"><div><h2>近7日差异趋势</h2><p>差异超过阈值自动创建问题</p></div></div><div className="diff-bars">{[["8/5",1.2,"good"],["8/6",1.6,"good"],["8/7",1.1,"good"],["8/8",1.7,"good"],["8/9",2.6,"warn"],["8/10",3.1,"bad"],["今天",3.3,"bad"]].map(row => <div key={row[0]}><span>{row[1]}%</span><i className={row[2]} style={{height:`${Number(row[1])*24}px`}} /><small>{row[0]}</small></div>)}</div></div><aside className="surface"><div className="surface-title"><div><h2>异常归因</h2><p>DAU 差异 4,222 用户</p></div></div><div className="reason-list compact"><button><div className="reason-title"><strong>中台接口失败</strong><span>3,108 · 73.6%</span></div><div className="reason-bar"><span style={{width:"73.6%"}} /></div></button><button><div className="reason-title"><strong>重复去重规则</strong><span>724 · 17.1%</span></div><div className="reason-bar"><span style={{width:"17.1%"}} /></div></button><button><div className="reason-title"><strong>时区/跨日</strong><span>390 · 9.3%</span></div><div className="reason-bar"><span style={{width:"9.3%"}} /></div></button></div><button className="primary-button full" onClick={() => openDialog("alert-rule")}>创建同步任务告警</button></aside></section>
    </div>
  );

  if (module === "tracking") return (
    <div className="page-stack">
      <section className="acceptance-flow">{[["选择项目与品类","IRAN-VPN-01 · 套利VPN"],["冻结测试快照","snapshot_8fd2"],["执行测试场景","8/12 已执行"],["采集与校验","41/46 已收到"],["反馈与发布门禁","BLOCKED"]].map((row,index) => <div key={row[0]} className={index < 2 ? "done" : index === 2 ? "current" : ""}><span>{index<2?"✓":index+1}</span><strong>{row[0]}</strong><small>{row[1]}</small></div>)}</section>
      <section className="run-banner"><div><strong>RUN-20260811-IRAN-001</strong><p>Android 1.8.0 (108) · Pixel 8 · 套利VPN v1.7 · 广告 v1.7</p></div><span><i />实时采集中</span><button onClick={() => notify("验收 Run 已暂停")}>暂停</button><button onClick={() => notify("已生成当前验收报告")}>生成报告</button></section>
      <section className="metric-grid six"><Metric label="应测场景" value="12" note="已执行 8" /><Metric label="应收事件" value="46" note="已收到 41" /><Metric label="P0事件" value="29/31" note="未完成不可发布" tone="bad" /><Metric label="P0参数" value="99.1%" note="目标100%" tone="bad" /><Metric label="关联链" value="97.8%" note="目标100%" tone="bad" /><Metric label="发布门禁" value="BLOCKED" note="失败3项" tone="bad" /></section>
      <section className="tracking-layout"><div className="surface"><div className="surface-title"><div><h2>测试场景</h2><p>不同项目按品类加载应测范围</p></div><Badge tone="blue">套利VPN</Badge></div><div className="scene-list">{[["01 首次启动与授权","6/6","通过","good"],["02 VPN连接成功","9/9","通过","good"],["03 非缓存插屏广告","7/9","执行中","warn"],["04 缓存广告命中","0/8","未执行","neutral"],["05 VPN断开与重连","0/7","未执行","neutral"]].map(row => <button key={row[0]}><div><strong>{row[0]}</strong><small>{row[1]}事件</small></div><Badge tone={row[3] as "good"|"warn"|"neutral"}>{row[2]}</Badge><div className="scene-progress"><i style={{width:row[2]==="通过"?"100%":row[2]==="执行中"?"78%":"0%"}} /></div></button>)}</div></div><div className="surface"><div className="surface-title"><div><h2>事件验收矩阵</h2><p>未执行和执行后未收到严格分开</p></div><button className="text-button">仅看失败</button></div><div className="table-wrap"><table><thead><tr><th>事件</th><th>执行</th><th>接收</th><th>参数</th><th>关联链</th><th>结论</th></tr></thead><tbody>{[["connect_success","已执行","9/9","100%","完整","PASSED"],["jk_ad_impression","已执行","1/1","100%","缺opportunity_id","CHAIN_INVALID"],["jk_ad_dismiss","已执行","0/1","—","缺终态","NOT_RECEIVED"],["cache_hit","未执行","不判定","—","—","SCENE_NOT_EXECUTED"]].map(row => <tr key={row[0]}>{row.map((cell,index) => <td key={index}>{index===5?<Badge tone={cell==="PASSED"?"good":cell==="SCENE_NOT_EXECUTED"?"neutral":"bad"}>{cell}</Badge>:cell}</td>)}</tr>)}</tbody></table></div></div><aside className="surface"><div className="surface-title"><div><h2>发布门禁</h2><p>P0必须全部100%</p></div><Badge tone="bad">BLOCKED</Badge></div><div className="gate-list"><div><span>P0事件</span><strong>93.5%</strong><Badge tone="bad">失败</Badge></div><div><span>P0参数</span><strong>99.1%</strong><Badge tone="bad">失败</Badge></div><div><span>关联链</span><strong>97.8%</strong><Badge tone="bad">失败</Badge></div></div><div className="conclusion-block bad"><strong>主要原因</strong><p>缓存 Context 未随广告对象保存，导致 impression 丢失 opportunity_id。</p></div><button className="primary-button full" onClick={() => openDialog("retest-run")}>发起失败项重测</button></aside></section>
    </div>
  );

  if (module === "config") return (
    <div className="page-stack">
      <section className="config-head surface"><div><div className="eyebrow">执行权威 · V1.7</div><h2>项目类型、能力包与事件规范</h2><p>公共基础包＋主品类＋能力包＋项目覆盖，最终合并为项目应测范围</p></div><div><Badge tone="good">已发布</Badge><button className="secondary-button" onClick={() => openDialog("config-version")}>复制为新版本</button></div></section>
      <section className="config-layout"><div className="surface"><div className="surface-title"><div><h2>项目主品类</h2><p>每个项目只能选择一个</p></div><button className="text-button" onClick={() => openDialog("project-category")}>＋新增</button></div><div className="category-list"><button className="selected"><strong>套利 VPN</strong><span>v1.7 · 14项目</span><small>连接、权限、服务器、协议、连接广告</small></button><button><strong>清理</strong><span>v1.5 · 8项目</span><small>扫描、清理、结果、大小、清理广告</small></button><button><strong>Launcher</strong><span>v1.3 · 6项目</span><small>引导、默认桌面、主题、桌面交互</small></button></div></div><div className="surface"><div className="surface-title"><div><h2>套利 VPN · 规则解析</h2><p>发布前预览事件、参数和冲突</p></div><Badge tone="blue">46事件</Badge></div><div className="resolution-list"><div><span>公共基础包</span><strong>生命周期、会话、网络</strong><em>18</em></div><div><span>主品类</span><strong>套利VPN v1.7</strong><em>12</em></div><div><span>能力包</span><strong>广告＋VPN＋订阅</strong><em>19</em></div><div><span>项目覆盖</span><strong>新增2 · 禁用1</strong><em>+1</em></div><div><span>合并去重</span><strong>同名事件条件取并集</strong><em>-4</em></div></div><div className="conclusion-block warn"><strong>配置冲突 1 项</strong><p>项目覆盖尝试将 subscription_status 从 P1 降为 P2，发布前需要审批。</p></div></div><aside className="surface"><div className="surface-title"><div><h2>发布检查</h2><p>规则完整性</p></div></div><div className="publish-checks"><div><span>✓</span><p>产品漏斗每个P0阶段均绑定事件</p></div><div><span>✓</span><p>缓存/非缓存广告逻辑完整</p></div><div><span>✓</span><p>Firebase参数≤22</p></div><div><span>!</span><p>订阅Provider有1个P1未配置</p></div></div><button className="primary-button full" onClick={() => openDialog("publish-approval")}>提交发布审批</button></aside></section>
      <section className="surface"><div className="surface-title"><div><h2>事件与字段包</h2><p>客户端接入和中台验收的唯一来源</p></div><div className="dimension-tabs"><button className="active">事件</button><button>公共字段</button><button>枚举</button><button>Provider</button></div></div><div className="table-wrap"><table><thead><tr><th>事件</th><th>业务阶段</th><th>优先级</th><th>适用条件</th><th>参数数</th><th>移动端可得性</th><th>降级口径</th><th>状态</th></tr></thead><tbody>{[["jk_ad_request","广告请求","P0","真实Load前","13","稳定可得","缺失阻断","已发布"],["jk_ad_impression","广告展示","P0","SDK回调","11","依赖广告SDK","缺失阻断","已发布"],["connect_success","VPN连接","P0","成功回调","10","依赖业务模块","缺失阻断","已发布"],["background_reason","生命周期","P2","后台时","4","推断可得","unknown/省略","已发布"]].map(row => <tr key={row[0]}>{row.map((cell,index)=><td key={index}>{index===2?<Badge tone={cell==="P0"?"bad":"neutral"}>{cell}</Badge>:index===7?<Badge tone="good">{cell}</Badge>:cell}</td>)}</tr>)}</tbody></table></div></section>
    </div>
  );

  return (
    <div className="page-stack">
      <section className="metric-grid six"><Metric label="今日任务" value="186" note="成功 179" /><Metric label="运行中" value="4" note="最长 8分钟" /><Metric label="失败任务" value="3" note="需立即处理" tone="bad" /><Metric label="数据延迟" value="9分钟" note="SLA ≤15分钟" tone="good" /><Metric label="活动告警" value="7" note="P0 2 · P1 5" tone="bad" /><Metric label="今日恢复" value="12" note="自动恢复 9" tone="good" /></section>
      <section className="surface"><div className="surface-title"><div><h2>数据流水线任务</h2><p>Firebase → OSS → ADB → 聚合 → 对账</p></div><div className="dimension-tabs"><button className="active">全部</button><button>失败</button><button>运行中</button></div></div><div className="table-wrap"><table><thead><tr><th>任务</th><th>项目</th><th>批次/水位</th><th>开始时间</th><th>耗时</th><th>处理量</th><th>SLA</th><th>状态</th><th>操作</th></tr></thead><tbody>{[["Firebase增量拉取","全部项目","15:30","15:31","2m18s","8.42M","≤10m","成功"],["OSS Raw归档","全部项目","fb_1530","15:34","1m06s","4.8GB","≤15m","成功"],["ADB事件标准化","IRAN-VPN-01","batch_8241","15:35","运行8m","2.14M","≤15m","运行中"],["中台DAU聚合","CLEAN-MAX-03","2026-08-11","15:20","失败","76,210","≤20m","失败"],["AdMob T+3同步","全部项目","2026-08-08","14:10","12m44s","24项目","≤60m","成功"]].map(row => <tr key={`${row[0]}${row[1]}`}>{row.map((cell,index)=><td key={index}>{index===7?<Badge tone={cell==="成功"?"good":cell==="运行中"?"blue":"bad"}>{cell}</Badge>:index===8?<button className="table-link" onClick={()=>notify(cell==="失败"?"失败任务已重新执行":"任务日志已打开")}>{cell==="失败"?"重试":"日志"}</button>:cell}</td>)}</tr>)}</tbody></table></div></section>
      <section className="two-column wide-left"><div className="surface"><div className="surface-title"><div><h2>活动告警</h2><p>指标告警与数据任务告警统一管理</p></div><button className="text-button" onClick={() => openDialog("alert-rule")}>告警规则</button></div><div className="alert-list">{[["P0","IRAN-VPN-01 广告浏览者比例低于25%","持续3小时 · 影响$2,807/日","产品/广告/客户端"],["P0","CLEAN-MAX-03 中台DAU差异8.7%","持续42分钟 · 接口失败率9.1%","数据平台"],["P1","ADB标准化任务延迟接近SLA","已运行8分钟 · 阈值15分钟","数据平台"],["P1","jk_ad_impression 关联链完整率97.8%","缺opportunity_id 1,824条","客户端增长组"]].map(row => <button key={row[1]} onClick={() => row[1].includes("浏览者") ? openModule("funnel") : row[1].includes("DAU") ? openModule("reconcile") : notify("告警详情已展开")}><Badge tone={row[0]==="P0"?"bad":"warn"}>{row[0]}</Badge><div><strong>{row[1]}</strong><p>{row[2]}</p><small>负责人：{row[3]}</small></div><span>→</span></button>)}</div></div><aside className="surface"><div className="surface-title"><div><h2>告警通知</h2><p>当前值班策略</p></div></div><div className="notification-rules"><div><span>P0</span><strong>立即通知</strong><p>飞书群＋负责人＋值班人</p></div><div><span>P1</span><strong>持续15分钟</strong><p>飞书群＋负责人</p></div><div><span>P2</span><strong>每日汇总</strong><p>数据质量日报</p></div></div><button className="primary-button full" onClick={() => openDialog("alert-rule")}>＋ 新建告警规则</button></aside></section>
    </div>
  );
}

function ActionDialog({ dialog, project, onClose, onSubmit }: { dialog: DialogKey; project: string; onClose: () => void; onSubmit: (message: string) => void }) {
  const meta: Record<DialogKey, { title: string; description: string; submit: string }> = {
    "project-report": { title: "导出项目日报", description: "选择范围、指标和接收方式", submit: "创建导出任务" },
    diagnosis: { title: "新建诊断任务", description: "将异常指标、范围和负责人写入诊断闭环", submit: "创建诊断任务" },
    "admob-report": { title: "导出 AdMob 报表", description: "按结算日期和广告维度生成报表", submit: "创建导出任务" },
    "version-diff-report": { title: "导出版本差异", description: "选择对比版本和导出范围", submit: "创建导出任务" },
    "event-dictionary": { title: "Firebase 事件字典", description: "查看已发布事件、优先级和参数数量", submit: "关闭" },
    "reconcile-run": { title: "发起重新对账", description: "重新计算指定日期和指标的数据差异", submit: "开始重新对账" },
    "tracking-run": { title: "新建验收 Run", description: "冻结项目、品类、版本和设备测试快照", submit: "创建并开始验收" },
    "retest-run": { title: "发起失败项重测", description: "继承原快照，只重新验证失败事件和关联链", submit: "创建重测 Run" },
    "config-version": { title: "新建配置版本", description: "基于当前 V1.7 创建可编辑草稿", submit: "创建版本草稿" },
    "project-category": { title: "新增项目主品类", description: "定义品类范围、能力包和默认漏斗", submit: "创建主品类" },
    "publish-approval": { title: "提交发布审批", description: "确认版本范围、审批人和发布计划", submit: "提交审批" },
    "alert-rule": { title: "新建告警规则", description: "配置指标、阈值、持续时间和通知范围", submit: "创建告警规则" },
  };
  const current = meta[dialog];
  const isDictionary = dialog === "event-dictionary";

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (isDictionary) return onClose();
    onSubmit(`${current.title}已提交`);
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="action-dialog-title">
        <header><div><h2 id="action-dialog-title">{current.title}</h2><p>{current.description}</p></div><button type="button" aria-label="关闭弹窗" onClick={onClose}>×</button></header>
        <form onSubmit={submit}>
          <div className="modal-body">
            {dialog === "diagnosis" && <div className="modal-form-grid"><label>项目<select defaultValue={project}><option>{project}</option><option>CLEAN-MAX-03</option><option>AIVORA-LAUNCHER</option></select></label><label>优先级<select><option>P0</option><option>P1</option><option>P2</option></select></label><label className="span-2">任务名称<input defaultValue="Opportunity 覆盖率异常诊断" /></label><label>异常指标<select><option>Opportunity覆盖率</option><option>广告浏览者比例</option><option>收入</option></select></label><label>负责人<select><option>Oliver / 客户端增长组</option><option>数据平台</option><option>广告变现组</option></select></label><label className="span-2">诊断范围<input defaultValue="伊朗 · Android 1.8.0 · Eligible → Opportunity" /></label><label className="span-2">问题说明<textarea defaultValue="广告浏览者比例下降，但AdMob匹配率与展示率正常，优先排查请求前用户覆盖。" /></label></div>}
            {(dialog === "project-report" || dialog === "admob-report") && <div className="modal-form-grid"><label>项目范围<select><option>全部项目</option><option>{project}</option><option>VPN增长组</option></select></label><label>日期范围<select><option>昨天</option><option>近7天</option><option>近30天</option><option>自定义</option></select></label><label>报表粒度<select><option>项目 × 日期</option><option>项目 × 国家</option><option>项目 × 广告位</option></select></label><label>文件格式<select><option>Excel (.xlsx)</option><option>CSV</option></select></label><label className="span-2">包含指标<div className="checkbox-grid"><span><input type="checkbox" defaultChecked /> DAU/AV</span><span><input type="checkbox" defaultChecked /> 请求/展示</span><span><input type="checkbox" defaultChecked /> 收入/eCPM</span><span><input type="checkbox" defaultChecked /> ROAS/利润</span></div></label><label className="span-2">接收方式<select><option>完成后在任务中心下载</option><option>同时发送飞书通知</option></select></label></div>}
            {dialog === "version-diff-report" && <div className="modal-form-grid"><label>基准版本<select><option>V1.6</option><option>V1.5</option></select></label><label>目标版本<select><option>V1.7（当前执行权威）</option></select></label><label className="span-2">导出内容<div className="checkbox-grid"><span><input type="checkbox" defaultChecked /> 新增事件/字段</span><span><input type="checkbox" defaultChecked /> 规则调整</span><span><input type="checkbox" defaultChecked /> 删除与废弃</span><span><input type="checkbox" defaultChecked /> 影响项目</span></div></label><label>文件格式<select><option>Excel (.xlsx)</option><option>PDF</option></select></label><label>完成通知<select><option>任务中心＋飞书通知</option><option>仅任务中心</option></select></label></div>}
            {dialog === "event-dictionary" && <div className="dictionary-dialog"><div className="dictionary-search"><input placeholder="搜索事件名、业务阶段或参数" /><select><option>全部优先级</option><option>P0</option><option>P1</option><option>P2</option></select></div><div className="table-wrap"><table><thead><tr><th>事件</th><th>阶段</th><th>优先级</th><th>参数数</th><th>版本</th></tr></thead><tbody>{[["jk_ad_request","广告请求","P0","13","V1.7"],["jk_ad_impression","广告展示","P0","11","V1.7"],["connect_success","VPN连接","P0","10","V1.7"],["app_background","生命周期","P1","8","V1.6"],["jk_ad_paid_event","收入回调","条件P0","9","V1.7"]].map(row => <tr key={row[0]}>{row.map((cell,index)=><td key={index}>{index===2?<Badge tone={cell.includes("P0")?"bad":"warn"}>{cell}</Badge>:cell}</td>)}</tr>)}</tbody></table></div></div>}
            {dialog === "reconcile-run" && <div className="modal-form-grid"><label>项目<select><option>{project}</option><option>全部异常项目</option><option>全部项目</option></select></label><label>对账日期<select><option>2026-08-08（AdMob已结算）</option><option>2026-08-07</option><option>今天（仅Firebase/中台）</option></select></label><label className="span-2">指标<div className="checkbox-grid"><span><input type="checkbox" defaultChecked /> DAU</span><span><input type="checkbox" defaultChecked /> AV</span><span><input type="checkbox" defaultChecked /> Impression</span><span><input type="checkbox" defaultChecked /> Revenue</span></div></label><label>覆盖旧结果<select><option>保留历史并生成新批次</option><option>覆盖当前结果</option></select></label><label>完成通知<select><option>飞书通知负责人</option><option>仅任务中心</option></select></label><div className="modal-warning span-2"><strong>预计影响</strong><p>将重新读取 Firebase、AdMob 与 ADB 事实表，预计耗时 8–15 分钟。</p></div></div>}
            {(dialog === "tracking-run" || dialog === "retest-run") && <div className="modal-form-grid"><label>项目<select><option>{project}</option><option>CLEAN-MAX-03</option><option>AIVORA-LAUNCHER</option></select></label><label>项目品类<select><option>套利 VPN</option><option>清理</option><option>Launcher</option></select></label><label>App版本<input defaultValue="1.8.1 (109)" /></label><label>平台<select><option>Android</option><option>iOS</option></select></label><label>测试设备<select><option>Pixel 8 · Android 15</option><option>Samsung S23 · Android 14</option></select></label><label>环境<select><option>Production Test</option><option>Staging</option></select></label><label className="span-2">测试范围<select><option>{dialog === "retest-run" ? "继承 RUN-20260811-IRAN-001 的 3 个失败项" : "公共基础包＋VPN＋广告＋订阅（46事件）"}</option></select></label><div className="snapshot-preview span-2"><span>即将冻结快照</span><strong>规范 V1.7 · P0事件31个 · P0参数100%门禁</strong></div></div>}
            {dialog === "config-version" && <div className="modal-form-grid"><label>基础版本<select><option>V1.7（当前执行权威）</option><option>V1.6</option></select></label><label>新版本号<input defaultValue="V1.8" /></label><label className="span-2">版本名称<input defaultValue="跨团队埋点规范 V1.8" /></label><label>负责人<select><option>数据产品 / Oliver</option><option>客户端架构组</option></select></label><label>计划发布时间<input type="date" defaultValue="2026-08-18" /></label><label className="span-2">变更目标<textarea placeholder="说明本版本准备解决的问题" /></label><div className="modal-warning span-2"><strong>创建规则</strong><p>新版本默认为草稿，不影响当前已发布 V1.7；发布时仍需产品与数据负责人审批。</p></div></div>}
            {dialog === "project-category" && <div className="modal-form-grid"><label className="span-2">品类名称<input placeholder="例如：文件管理" required /></label><label>品类代号<input placeholder="file_manager" required /></label><label>负责人<select><option>产品平台组</option><option>VPN增长组</option><option>清理产品组</option></select></label><label className="span-2">默认能力包<div className="checkbox-grid"><span><input type="checkbox" defaultChecked /> 公共基础</span><span><input type="checkbox" defaultChecked /> 广告</span><span><input type="checkbox" /> 订阅</span><span><input type="checkbox" /> 归因</span></div></label><label className="span-2">品类说明<textarea placeholder="描述核心业务阶段和适用项目" /></label></div>}
            {dialog === "publish-approval" && <div className="modal-form-grid"><label>发布版本<select><option>V1.8 草稿</option><option>V1.7 当前版本</option></select></label><label>计划发布时间<input type="datetime-local" defaultValue="2026-08-18T10:00" /></label><label>产品审批人<select><option>Oliver / 数据产品</option><option>产品平台负责人</option></select></label><label>技术审批人<select><option>客户端架构组</option><option>数据平台负责人</option></select></label><label className="span-2">发布说明<textarea defaultValue="完成事件、参数、Provider 与验收门禁检查后发布。" /></label><div className="modal-warning span-2"><strong>发布前仍有 1 项提醒</strong><p>订阅 Provider 有 1 个 P1 未配置。可提交审批，但审批人需明确接受该风险。</p></div></div>}
            {dialog === "alert-rule" && <div className="modal-form-grid"><label className="span-2">规则名称<input defaultValue="广告浏览者比例低于目标" required /></label><label>监控项目<select><option>{project}</option><option>全部VPN项目</option><option>全部项目</option></select></label><label>监控指标<select><option>广告浏览者比例</option><option>Opportunity覆盖率</option><option>DAU对账差异</option><option>任务延迟</option></select></label><label>判断条件<select><option>低于</option><option>高于</option><option>环比下降超过</option></select></label><label>阈值<input defaultValue="25%" /></label><label>持续时间<select><option>15分钟</option><option>30分钟</option><option>1小时</option></select></label><label>告警等级<select><option>P0</option><option>P1</option><option>P2</option></select></label><label className="span-2">通知范围<div className="checkbox-grid"><span><input type="checkbox" defaultChecked /> 飞书项目群</span><span><input type="checkbox" defaultChecked /> 项目负责人</span><span><input type="checkbox" /> 数据值班人</span><span><input type="checkbox" /> 邮件</span></div></label></div>}
          </div>
          <footer><button type="button" className="secondary-button" onClick={onClose}>取消</button><button type="submit" className="primary-button">{current.submit}</button></footer>
        </form>
      </section>
    </div>
  );
}

export default function Home() {
  const [module, setModule] = useState<ModuleKey>("funnel");
  const [page, setPage] = useState<PageKey>("overview");
  const [project, setProject] = useState("IRAN-VPN-01");
  const [range, setRange] = useState("今天");
  const [funnelMode, setFunnelMode] = useState<FunnelMode>("monetization");
  const [unitMode, setUnitMode] = useState<UnitMode>("users");
  const [dimension, setDimension] = useState("国家");
  const [selectedEvent, setSelectedEvent] = useState(5);
  const [evidenceMode, setEvidenceMode] = useState("ad");
  const [onlyErrors, setOnlyErrors] = useState(false);
  const [rawOpen, setRawOpen] = useState(false);
  const [issueStatus, setIssueStatus] = useState("修复中");
  const [notice, setNotice] = useState("");
  const [baseline, setBaseline] = useState("近7日均值");
  const [dialog, setDialog] = useState<DialogKey | null>(null);

  useEffect(() => {
    if (!dialog) return;
    const closeOnEscape = (event: KeyboardEvent) => event.key === "Escape" && setDialog(null);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [dialog]);

  const stages = useMemo(() => {
    if (funnelMode === "product") return productStages;
    return unitMode === "users" ? monetizationUserStages : monetizationEventStages;
  }, [funnelMode, unitMode]);

  const currentPage = pages.find((item) => item.key === page)!;
  const currentModule = moduleCopy[module];
  const visibleEvents = eventRows
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => !onlyErrors || event.result !== "有效");
  const issuePhase = issueStatus === "重测中" ? 3 : 2;

  function notify(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2600);
  }

  function go(next: PageKey) {
    setModule("funnel");
    setPage(next);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openModule(next: ModuleKey) {
    setModule(next);
    if (next === "funnel") setPage("overview");
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function resetFilters() {
    setProject("IRAN-VPN-01");
    setRange("今天");
    notify("筛选条件已恢复默认");
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">JK</span><span><strong>变现与埋点</strong><small>质量分析中心</small></span></div>
        <div className="nav-group-label">经营分析</div>
        {moduleMenus.filter((item) => item.group === "经营分析").map((item) => <button key={item.key} className={`main-nav-item ${module === item.key ? "active" : ""}`} onClick={() => openModule(item.key)}><span>{item.index}</span>{item.label}</button>)}
        <div className="nav-group-label">质量治理</div>
        {moduleMenus.filter((item) => item.group === "质量治理").map((item) => <button key={item.key} className={`main-nav-item ${module === item.key ? "active" : ""}`} onClick={() => openModule(item.key)}><span>{item.index}</span>{item.label}</button>)}
        <div className="sidebar-foot"><span className="status-dot" />Firebase 实时数据正常<small>AdMob 已结算至 8月8日</small></div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumbs">{moduleMenus.find((item) => item.key === module)?.group} / {currentModule.title}{module === "funnel" && <> / <strong>{currentPage.label}</strong></>}</div>
          <div className="topbar-actions"><div className="global-search">搜索项目、事件、问题单</div><button className="icon-button" aria-label="通知">3</button><div className="avatar">OL</div></div>
        </header>

        <main className="main-content">
          <section className="page-heading">
            <div><h1>{currentModule.title}</h1><p>{currentModule.description}</p></div>
            <div className="heading-actions"><button className="secondary-button" onClick={() => module === "funnel" ? go("snapshot") : notify("数据已刷新至最新水位")}>{module === "funnel" ? "查看口径 V1.7" : "刷新数据"}</button><button className="primary-button" onClick={() => setDialog(moduleDialog[module])}>{["project", "funnel", "tracking", "config", "tasks"].includes(module) ? "＋ " : ""}{currentModule.action}</button></div>
          </section>

          {module === "funnel" && <section className="workflow-strip" aria-label="漏斗诊断流程">
            {[
              ["发现", "多项目总览"], ["定位", "单项目漏斗"], ["拆解", "步骤与分群"], ["取证", "路径与事件"], ["闭环", "修复与验证"],
            ].map(([name, hint], index) => {
              const pageIndex = pages.findIndex((item) => item.key === page);
              const phase = pageIndex === 0 ? 0 : pageIndex === 1 ? 1 : pageIndex <= 3 ? 2 : pageIndex <= 5 ? 3 : 4;
              return <div key={name} className={`workflow-step ${phase === index ? "current" : ""} ${phase > index ? "done" : ""}`}><span>{phase > index ? "✓" : index + 1}</span><div><strong>{name}</strong><small>{hint}</small></div></div>;
            })}
          </section>}

          {module === "funnel" && <nav className="page-nav" aria-label="漏斗分析页面">
            {pages.map((item) => <button key={item.key} className={page === item.key ? "active" : ""} onClick={() => go(item.key)}><span>{item.label}</span><small>{item.hint}</small></button>)}
          </nav>}

          <section className="filter-bar">
            <label>项目<select value={project} onChange={(event) => setProject(event.target.value)}>{projects.map((item) => <option key={item.code}>{item.code}</option>)}</select></label>
            <label>日期<select value={range} onChange={(event) => setRange(event.target.value)}><option>今天</option><option>昨天</option><option>近7天</option><option>近30天</option></select></label>
            <label>平台<select><option>Android</option><option>iOS</option><option>全部</option></select></label>
            <label>国家<select><option>全部国家</option><option>伊朗</option><option>埃及</option><option>土耳其</option></select></label>
            <label>App版本<select><option>1.8.0 (108)</option><option>1.7.4 (104)</option><option>全部版本</option></select></label>
            <div className="filter-actions"><button onClick={resetFilters}>重置</button><button onClick={() => notify("筛选条件已应用，数据已刷新")}>应用筛选</button></div>
            <div className="data-state"><span className="status-dot" /><strong>实时预估</strong><small>Firebase · 延迟约 8 分钟</small></div>
          </section>

          <section className="context-toolbar">
            <div className="context-summary"><Badge tone="blue">{module === "funnel" ? currentPage.hint : currentModule.title}</Badge><span>{project}</span><i /> <span>{range}</span><i /> <span>Android · 1.8.0</span><i /> <span>口径 V1.7</span></div>
            <div className="context-actions"><button onClick={() => notify("当前分析视图已保存")}>保存视图</button><button onClick={() => setDialog(module === "admob" ? "admob-report" : "project-report")}>导出报表</button></div>
          </section>
          <section className="freshness-note"><div><strong>数据使用提示：</strong>今天的用户漏斗与事件漏斗来自 Firebase 实时数据；收入、匹配率和 AdMob 广告浏览者为 T+3 结算口径。</div><button onClick={() => go("snapshot")}>查看数据口径</button></section>

          {module !== "funnel" && <ModulePage module={module as Exclude<ModuleKey, "funnel">} project={project} openModule={openModule} openDialog={setDialog} notify={notify} />}

          {module === "funnel" && page === "overview" && (
            <div className="page-stack">
              <section className="metric-grid six">
                <Metric label="全项目 DAU" value="397,380" note="较昨日 +3.2%" />
                <Metric label="广告浏览人数 AV" value="116,842" note="较昨日 -4.7%" tone="bad" />
                <Metric label="广告浏览者比例" value="29.4%" note="目标 ≥ 35%" tone="bad" />
                <Metric label="Opportunity 覆盖率" value="34.8%" note="较基线 -6.1pp" tone="bad" />
                <Metric label="人均展示次数" value="3.42" note="Impression / AV" />
                <Metric label="预估收入" value="$13,901" note="ARPDAU $0.035" tone="good" />
              </section>

              <section className="signal-strip">
                <div className="signal-item bad"><span>用户覆盖异常</span><strong>AV / DAU 29.4%</strong><p>主要问题在广告请求之前，优先看 Eligible 与 Opportunity 覆盖。</p></div>
                <div className="signal-item good"><span>请求后链路健康</span><strong>Request → Load 99.0%</strong><p>匹配与加载正常，不应先优化 AdMob 填充。</p></div>
                <div className="signal-item warn"><span>展示集中</span><strong>Impression / AV 3.42</strong><p>少数用户承担较多展示，需同时控制频次与扩大覆盖。</p></div>
                <button onClick={() => go("workbench")}>查看完整判断依据 →</button>
              </section>

              <section className="two-column wide-left">
                <div className="surface">
                  <div className="surface-title"><div><h2>项目漏斗健康度</h2><p>同时关注用户覆盖和请求后的事件转化</p></div><div className="legend"><span className="dot bad" />严重 <span className="dot warn" />预警 <span className="dot good" />正常</div></div>
                  <div className="table-wrap"><table><thead><tr><th>项目</th><th>品类</th><th>DAU</th><th>产品完成率</th><th>广告浏览者比例</th><th>Opportunity覆盖率</th><th>收入</th><th>异常步骤</th><th>状态</th></tr></thead><tbody>
                    {projects.map((item) => <tr key={item.code} onClick={() => { setProject(item.code); go("workbench"); }} className="clickable-row"><td><strong>{item.code}</strong><small>{item.name}</small></td><td>{item.category}</td><td>{item.dau}</td><td>{item.completion}</td><td>{item.viewer}</td><td>{item.opportunity}</td><td>{item.revenue}</td><td>{item.issue}</td><td><Badge tone={item.status === "严重" ? "bad" : item.status === "预警" ? "warn" : "good"}>{item.status}</Badge></td></tr>)}
                  </tbody></table></div>
                </div>
                <aside className="surface">
                  <div className="surface-title"><div><h2>优先处理</h2><p>按影响用户与收入排序</p></div></div>
                  <div className="issue-list">
                    <button onClick={() => { setProject("IRAN-VPN-01"); go("diagnosis"); }}><span className="rank bad">1</span><div><strong>IRAN-VPN-01</strong><p>Eligible→Opportunity 下降 12.8pp</p><small>影响 46,632 用户 · 约 $2,807/日</small></div></button>
                    <button onClick={() => { setProject("TURBO-CLEAN-05"); go("diagnosis"); }}><span className="rank bad">2</span><div><strong>TURBO-CLEAN-05</strong><p>Opportunity→Request 下降 9.4pp</p><small>影响 3,887 用户 · 约 $391/日</small></div></button>
                    <button onClick={() => { setProject("CLEAN-MAX-03"); go("diagnosis"); }}><span className="rank warn">3</span><div><strong>CLEAN-MAX-03</strong><p>Load→Show Attempt 下降 5.1pp</p><small>影响 2,043 用户 · 约 $218/日</small></div></button>
                  </div>
                  <button className="full-link" onClick={() => go("diagnosis")}>进入异常诊断 →</button>
                </aside>
              </section>

              <section className="surface">
                <div className="surface-title"><div><h2>全项目变现链路</h2><p>用户覆盖漏斗与事件效率必须分开判断</p></div><Badge tone="blue">Firebase T+0</Badge></div>
                <div className="dual-funnel">
                  <div><h3>用户覆盖漏斗</h3><div className="mini-funnel">{["DAU 397,380", "Eligible 263,941", "Opportunity 138,283", "Request UV 132,940", "AV 116,842"].map((item, index) => <div key={item} style={{ width: `${100 - index * 10}%` }}>{item}<small>{index === 0 ? "100%" : ["66.4%", "52.4%", "96.1%", "87.9%"][index - 1]}</small></div>)}</div></div>
                  <div><h3>事件效率漏斗</h3><div className="mini-funnel blue">{["Opportunity 828,492", "Request 786,318", "Load 778,455", "Show Attempt 566,201", "Impression 537,891"].map((item, index) => <div key={item} style={{ width: `${100 - index * 8}%` }}>{item}<small>{index === 0 ? "100%" : ["94.9%", "99.0%", "72.7%", "95.0%"][index - 1]}</small></div>)}</div></div>
                </div>
              </section>
            </div>
          )}

          {module === "funnel" && page === "workbench" && (
            <div className="page-stack">
              <section className="analysis-head surface">
                <div><div className="eyebrow">{project} · Android 1.8.0</div><h2>{funnelMode === "product" ? "VPN 产品主漏斗" : "广告变现主漏斗"}</h2><p>当前周期：{range} 00:00–当前 · 对比昨日同期</p></div>
                <div className="mode-controls">
                  <Segmented label="漏斗类型" active={funnelMode} onChange={(key) => { setFunnelMode(key as FunnelMode); if (key === "product") setUnitMode("users"); }} items={[{ key: "product", label: "产品漏斗" }, { key: "monetization", label: "变现漏斗" }]} />
                  {funnelMode === "monetization" && <Segmented label="统计单位" active={unitMode} onChange={(key) => setUnitMode(key as UnitMode)} items={[{ key: "users", label: "用户数" }, { key: "events", label: "事件数" }]} />}
                </div>
              </section>

              <section className="surface funnel-surface">
                <div className="surface-title"><div><h2>{unitMode === "users" ? "用户到达漏斗" : "事件转化漏斗"}</h2><p>点击转化箭头进入步骤诊断</p></div><div className="legend"><span className="dot blue" />当前 <span className="dot neutral" />昨日同期</div></div>
                <div className={`funnel-stages ${stages.length > 6 ? "dense" : ""}`}>
                  {stages.map((stage, index) => <div className="stage-group" key={stage.label}><button className={`funnel-stage ${stage.delta.startsWith("-") && Math.abs(parseFloat(stage.delta)) > 5 ? "stage-alert" : ""}`} onClick={() => index > 0 && go("diagnosis")}><span>{stage.label}</span><strong>{stage.value}</strong><small>{stage.event}</small></button>{index < stages.length - 1 && <button className={`conversion-arrow ${stages[index + 1].delta.startsWith("-") ? "down" : ""}`} onClick={() => go("diagnosis")}><strong>{stages[index + 1].rate}</strong><span>→</span><small>{stages[index + 1].delta}</small></button>}</div>)}
                </div>
                <div className="funnel-summary"><div><span>首尾转化率</span><strong>{funnelMode === "product" ? "42.6%" : unitMode === "users" ? "22.9%" : "63.6%"}</strong></div><div><span>最大流失步骤</span><strong>{funnelMode === "product" ? "首页 → 点击连接" : "Eligible → Opportunity"}</strong></div><div><span>流失用户</span><strong>{funnelMode === "product" ? "35,443" : "46,632"}</strong></div><div><span>预计收入影响</span><strong className="negative">$2,807 / 日</strong></div></div>
                {funnelMode === "monetization" && <div className="denominator-audit"><div><span>广告浏览者比例</span><strong>AV / DAU = 23.1%</strong><small>衡量覆盖用户</small></div><div><span>机会覆盖率</span><strong>Opportunity UV / DAU = 28.4%</strong><small>定位请求前问题</small></div><div><span>展示成功率</span><strong>Impression / Show Attempt = 95.0%</strong><small>衡量请求后效率</small></div><div><span>人均展示</span><strong>Impression / AV = 3.42</strong><small>衡量展示集中度</small></div></div>}
              </section>

              <section className="two-column">
                <div className="surface">
                  <div className="surface-title"><div><h2>关键指标趋势</h2><p>广告浏览者比例与机会覆盖率同步下降</p></div><Segmented label="趋势指标" active="viewer" onChange={() => undefined} items={[{ key: "viewer", label: "浏览者比例" }, { key: "opportunity", label: "机会覆盖" }]} /></div>
                  <div className="bar-chart" aria-label="近七日广告浏览者比例趋势">{[34.9, 35.4, 34.6, 35.1, 31.8, 26.7, 23.1].map((value, index) => <div key={index}><span style={{ height: `${value * 2}px` }} className={index > 3 ? "alert" : ""}><em>{value}%</em></span><small>{["8/5", "8/6", "8/7", "8/8", "8/9", "8/10", "今天"][index]}</small></div>)}</div>
                </div>
                <aside className="surface diagnostic-card">
                  <div className="surface-title"><div><h2>智能诊断</h2><p>基于漏斗与数据质量规则</p></div><Badge tone="bad">严重</Badge></div>
                  <h3>问题发生在广告请求之前</h3>
                  <p>AdMob 匹配率 100%、展示率 70.2% 基本正常，但 Opportunity 用户覆盖率从 41.2% 降至 28.4%。</p>
                  <ul><li>请求后链路基本健康</li><li>请求集中在少数活跃用户</li><li>伊朗地区 1.8.0 版本下降最明显</li></ul>
                  <button className="primary-button full" onClick={() => go("diagnosis")}>诊断 Eligible → Opportunity</button>
                </aside>
              </section>
            </div>
          )}

          {module === "funnel" && page === "diagnosis" && (
            <div className="page-stack">
              <section className="transition-banner">
                <div><span>上一步</span><strong>Eligible 用户</strong><em>83,106</em></div><span className="transition-arrow">→<small>43.9%</small></span><div><span>下一步</span><strong>Opportunity 用户</strong><em>36,474</em></div><div className="transition-loss"><span>流失用户</span><strong>46,632</strong><small>较基线多流失 10,641</small></div>
              </section>
              <section className="metric-grid five">
                <Metric label="当前转化率" value="43.9%" note="基线 56.7%" tone="bad" />
                <Metric label="下降幅度" value="-12.8pp" note="连续下降 3 天" tone="bad" />
                <Metric label="异常流失用户" value="10,641" note="排除正常业务流失" />
                <Metric label="预计损失展示" value="40,436" note="按历史 3.8 次/AV" />
                <Metric label="预计收入影响" value="$2,807" note="每天" tone="bad" />
              </section>
              <section className="diagnosis-quality">
                <div><span>原因分类覆盖率</span><strong>98.0%</strong><div><i style={{ width: "98%" }} /></div></div>
                <div><span>事件链可关联率</span><strong>95.8%</strong><div><i style={{ width: "95.8%" }} /></div></div>
                <div><span>Unknown率</span><strong>2.0%</strong><div><i className="warn" style={{ width: "20%" }} /></div></div>
                <p><strong>可信度：高。</strong>异常主要由可行动原因构成；Unknown 未超过 5% 告警线。</p>
              </section>
              <section className="two-column wide-left">
                <div className="surface">
                  <div className="surface-title"><div><h2>流失原因拆解</h2><p>按服务端规则与事件链自动分类</p></div><button className="text-button" onClick={() => go("snapshot")}>查看判定规则</button></div>
                  <div className="reason-list">{reasons.map((reason) => <button key={reason.code} onClick={() => go("evidence")}><div className="reason-title"><strong>{reason.code}</strong><span>{reason.users} 用户 · {reason.share}%</span></div><p>{reason.label}</p><div className="reason-bar"><span style={{ width: `${reason.share}%` }} /></div><div className="reason-meta"><span>影响 {reason.impact}/日</span><Badge tone={reason.code === "UNKNOWN" ? "neutral" : reason.share > 20 ? "bad" : "warn"}>{reason.owner}</Badge></div></button>)}</div>
                </div>
                <aside className="surface">
                  <div className="surface-title"><div><h2>诊断结论</h2><p>优先验证可行动原因</p></div></div>
                  <div className="conclusion-block bad"><strong>主要原因</strong><p>1.8.0 版本把 Opportunity 生成放在页面动画完成后；伊朗弱网用户在动画结束前离开或进入后台。</p></div>
                  <div className="conclusion-block warn"><strong>数据风险</strong><p>4.2% 流失用户存在事件未收到，需要结合 Firebase DebugView 与本地 outbox 继续确认。</p></div>
                  <div className="action-stack"><button className="primary-button" onClick={() => go("cohort")}>进入分群对比</button><button className="secondary-button" onClick={() => go("evidence")}>查看事件证据</button><button className="secondary-button" onClick={() => setDialog("diagnosis")}>创建问题任务</button></div>
                </aside>
              </section>
            </div>
          )}

          {module === "funnel" && page === "cohort" && (
            <div className="page-stack">
              <section className="surface">
                <div className="surface-title cohort-header"><div><h2>Eligible → Opportunity 分群对比</h2><p>找出贡献最大的问题人群，而不只是转化率最低的人群</p></div><div className="dimension-tabs">{["国家", "App版本", "广告位", "网络类型", "新老用户", "VPN状态"].map((item) => <button key={item} className={dimension === item ? "active" : ""} onClick={() => setDimension(item)}>{item}</button>)}</div></div>
                <div className="comparison-controls"><label>基准<select value={baseline} onChange={(event) => setBaseline(event.target.value)}><option>近7日均值</option><option>昨日同期</option><option>上周同期</option><option>版本1.7.4</option></select></label><label>排序<select><option>异常流失贡献</option><option>转化下降幅度</option><option>收入影响</option><option>用户规模</option></select></label><label>最小样本<select><option>≥ 1,000 用户</option><option>≥ 500 用户</option><option>不限</option></select></label><span>当前与 <strong>{baseline}</strong> 比较</span></div>
                <div className="cohort-summary"><div><span>当前维度</span><strong>{dimension}</strong></div><div><span>最大异常分群</span><strong>{dimension === "国家" ? "伊朗" : dimension === "App版本" ? "1.8.0 (108)" : "vpn_connect_success"}</strong></div><div><span>贡献异常流失</span><strong>92.4%</strong></div><div><span>建议优先级</span><Badge tone="bad">P0</Badge></div></div>
                <div className="table-wrap"><table><thead><tr><th>{dimension}</th><th>Eligible用户</th><th>历史基线</th><th>当前转化率</th><th>变化</th><th>异常流失用户</th><th>收入影响/日</th><th>证据</th></tr></thead><tbody>{cohortRows.map((row) => <tr key={row.value} className={row.level === "bad" ? "row-bad" : ""}><td><strong>{dimension === "国家" ? row.value : dimension === "App版本" ? ["1.8.0 (108)", "1.7.4 (104)", "1.7.2 (102)", "1.6.9 (98)", "其他"][cohortRows.indexOf(row)] : dimension === "广告位" ? ["vpn_connect_success", "vpn_home_banner", "server_select", "vpn_disconnect", "home_resume"][cohortRows.indexOf(row)] : row.value}</strong></td><td>{row.volume}</td><td>{row.base}</td><td><span className={`heat-cell ${row.level}`}>{row.current}</span></td><td className={row.change.startsWith("-") ? "negative" : "positive"}>{row.change}</td><td>{row.lost}</td><td>{row.impact}</td><td><button className="table-link" onClick={() => go("evidence")}>查看</button></td></tr>)}</tbody></table></div>
              </section>
              <section className="two-column">
                <div className="surface">
                  <div className="surface-title"><div><h2>异常流失贡献度</h2><p>流失用户数 × 历史人均展示 × 单次展示收入</p></div></div>
                  <div className="horizontal-bars">{[["伊朗 · 1.8.0", 82, "$2,301"], ["伊朗 · 1.7.4", 21, "$286"], ["埃及 · 1.8.0", 16, "$141"], ["其他", 8, "$79"]].map(([label, width, value]) => <div key={String(label)}><span>{label}</span><div><i style={{ width: `${width}%` }} /></div><strong>{value}</strong></div>)}</div>
                </div>
                <aside className="surface">
                  <div className="surface-title"><div><h2>交叉分析建议</h2><p>继续缩小问题范围</p></div></div>
                  <div className="recommend-list"><button onClick={() => setDimension("App版本")}><strong>伊朗 × App版本</strong><small>验证是否集中在 1.8.0</small></button><button onClick={() => setDimension("网络类型")}><strong>伊朗 × 网络类型</strong><small>检查弱网与代理环境</small></button><button onClick={() => setDimension("广告位")}><strong>1.8.0 × 广告位</strong><small>确认具体触发场景</small></button></div>
                  <button className="primary-button full" onClick={() => go("path")}>分析该分群用户路径</button>
                </aside>
              </section>
            </div>
          )}

          {module === "funnel" && page === "path" && (
            <div className="page-stack">
              <section className="surface">
                <div className="surface-title"><div><h2>伊朗 · 1.8.0 流失用户路径</h2><p>观察没有进入 Opportunity 前后的真实行为，不把“页面离开”和“App 后台”混为一谈</p></div><Badge tone="blue">46,632 用户</Badge></div>
                <div className="path-canvas">
                  <div className="path-column"><h3>流失前事件</h3><div className="path-node"><strong>connect_success</strong><span>38,204 · 81.9%</span></div><div className="path-node muted"><strong>vpn_home_view</strong><span>5,887 · 12.6%</span></div><div className="path-node muted"><strong>app_foreground</strong><span>2,541 · 5.5%</span></div></div>
                  <div className="path-connectors"><span>81.9%</span><i /><span>12.6%</span><i /><span>5.5%</span></div>
                  <div className="path-column center"><h3>当前流失点</h3><div className="path-node alert"><strong>NO_OPPORTUNITY</strong><span>46,632 用户</span><small>Eligible 后 30 秒内未生成机会</small></div></div>
                  <div className="path-connectors right"><span>52.8%</span><i /><span>20.1%</span><i /><span>8.4%</span></div>
                  <div className="path-column"><h3>流失后事件</h3><div className="path-node"><strong>app_background</strong><span>24,613 · 52.8%</span></div><div className="path-node muted"><strong>vpn_disconnect</strong><span>9,384 · 20.1%</span></div><div className="path-node muted"><strong>screen_view</strong><span>3,921 · 8.4%</span></div></div>
                </div>
              </section>
              <section className="path-classification">
                <div><Badge tone="bad">52.8%</Badge><strong>App进入后台</strong><p>收到 app_background，进程仍存活；不能记为用户离开页面。</p></div>
                <div><Badge tone="warn">20.1%</Badge><strong>页面离开</strong><p>收到 screen_leave，但 App 仍在前台；属于产品路径流失。</p></div>
                <div><Badge tone="neutral">8.4%</Badge><strong>进程终止/无后续</strong><p>窗口内无后续事件，只能标记 unknown_exit，不强行推断。</p></div>
                <div><Badge tone="blue">18.7%</Badge><strong>业务阻止</strong><p>频控、订阅或展示条件明确阻止，不算埋点缺失。</p></div>
              </section>
              <section className="three-column">
                <div className="surface"><div className="surface-title"><div><h2>终止原因</h2><p>服务端推断分类</p></div></div><div className="donut-row"><div className="donut"><span>52.8%</span></div><div className="donut-legend"><span><i className="c1" />App进入后台 52.8%</span><span><i className="c2" />离开页面 20.1%</span><span><i className="c3" />频控阻止 12.5%</span><span><i className="c4" />其他 14.6%</span></div></div></div>
                <div className="surface"><div className="surface-title"><div><h2>关键时间间隔</h2><p>P50 / P90</p></div></div><div className="timing-list"><div><span>连接成功 → 后台</span><strong>1.8s / 5.6s</strong></div><div><span>Eligible → 页面离开</span><strong>2.3s / 8.1s</strong></div><div><span>页面动画时长</span><strong>2.0s / 3.2s</strong></div><div><span>机会等待窗口</span><strong>30s</strong></div></div></div>
                <aside className="surface diagnostic-card"><div className="surface-title"><div><h2>路径结论</h2><p>产品行为与打点证据一致</p></div></div><h3>动画完成后才创建机会过晚</h3><p>52.8% 流失用户在动画完成前进入后台，建议将 Opportunity 提前到连接成功页可见时。</p><button className="primary-button full" onClick={() => go("evidence")}>抽查事件时间线</button></aside>
              </section>
            </div>
          )}

          {module === "funnel" && page === "evidence" && (
            <div className="page-stack">
              <section className="evidence-head surface"><div><div className="eyebrow">样本 user_pseudo_id · u_8f1a***92</div><h2>事件证据时间线</h2><p>IRAN-VPN-01 · Android 1.8.0 · Iran · session=s_728c</p></div><Segmented label="证据模式" active={evidenceMode} onChange={setEvidenceMode} items={[{ key: "user", label: "用户事件链" }, { key: "ad", label: "广告关联链" }]} /></section>
              <section className="two-column wide-left evidence-layout">
                <div className="surface">
                  <div className="surface-title"><div><h2>{evidenceMode === "ad" ? "Opportunity → Paid 关联链" : "用户会话完整时间线"}</h2><p>event_id 去重 · event_time 排序 · 未知事件进入隔离区</p></div><div><Badge tone="bad">1 个链路异常</Badge> <Badge tone="warn">1 个P1缺失</Badge></div></div>
                  <div className="evidence-controls"><label>事件/ID<input placeholder="搜索 event_name 或 request_id" /></label><label>来源<select><option>全部来源</option><option>Firebase</option><option>质量引擎</option></select></label><button className={onlyErrors ? "active" : ""} onClick={() => setOnlyErrors(!onlyErrors)}>{onlyErrors ? "显示全部事件" : "仅看异常 3"}</button></div>
                  <div className="event-timeline">{visibleEvents.map(({ event, index }) => <button key={`${event.time}-${event.name}`} className={`${selectedEvent === index ? "selected" : ""} ${event.result === "缺失" || event.result === "链路异常" ? "event-bad" : ""}`} onClick={() => setSelectedEvent(index)}><span className="event-time">{event.time}</span><span className="event-dot" /><div><strong>{event.name}</strong><p>{event.detail}</p><small>{event.id} · {event.source}</small></div><Badge tone={event.result === "有效" ? "good" : event.result === "P1缺失" ? "warn" : "bad"}>{event.result}</Badge></button>)}</div>
                </div>
                <aside className="surface event-detail">
                  <div className="surface-title"><div><h2>事件详情</h2><p>{eventRows[selectedEvent].name}</p></div></div>
                  <div className="validation-summary"><Badge tone={eventRows[selectedEvent].result === "有效" ? "good" : "bad"}>{eventRows[selectedEvent].result}</Badge><strong>{eventRows[selectedEvent].time}</strong></div>
                  <dl><div><dt>event_id</dt><dd>{eventRows[selectedEvent].id}</dd></div><div><dt>opportunity_id</dt><dd className={selectedEvent === 5 ? "negative" : ""}>{selectedEvent === 5 ? "缺失" : "opp_82c"}</dd></div><div><dt>request_id</dt><dd>req_91a</dd></div><div><dt>ad_instance_id</dt><dd>{selectedEvent > 2 ? "ins_671" : "—"}</dd></div><div><dt>placement</dt><dd>vpn_connect_success</dd></div><div><dt>ad_format</dt><dd>interstitial</dd></div><div><dt>数据来源</dt><dd>{eventRows[selectedEvent].source}</dd></div></dl>
                  {selectedEvent === 5 && <div className="conclusion-block bad"><strong>CHAIN_INVALID</strong><p>缓存广告对象取出时没有绑定当前 opportunity_id；request_id 和 ad_instance_id 正常。</p></div>}
                  <div className="detail-actions"><button onClick={() => { setRawOpen(!rawOpen); }}>{rawOpen ? "收起原始参数" : "查看原始参数"}</button><button onClick={() => notify("事件证据链接已复制")}>复制证据链接</button></div>
                  {rawOpen && <pre className="raw-payload">{`{\n  "event_name": "${eventRows[selectedEvent].name}",\n  "event_id": "${eventRows[selectedEvent].id}",\n  "request_id": "req_91a",\n  "opportunity_id": ${selectedEvent === 5 ? "null" : "\"opp_82c\""},\n  "schema_version": "1.7"\n}`}</pre>}
                  <button className="primary-button full" onClick={() => { go("issues"); notify("事件证据已加入问题单"); }}>将证据加入问题单</button>
                </aside>
              </section>
            </div>
          )}

          {module === "funnel" && page === "issues" && (
            <div className="page-stack">
              <section className="surface">
                <div className="surface-title"><div><h2>ISSUE-20260811-024 · Opportunity 覆盖率异常</h2><p>IRAN-VPN-01 · P0 · 负责人：客户端增长组 / Oliver · SLA 剩余 18 小时</p></div><Badge tone={issueStatus === "重测中" ? "blue" : "warn"}>{issueStatus}</Badge></div>
                <div className="issue-workflow">{[["已发现", "8/11 10:32"], ["已定位", "8/11 11:08"], ["修复中", "预计 8/12"], ["打点重测", issueStatus === "重测中" ? "采集中" : "待开始"], ["灰度验证", "待开始"], ["关闭", "指标恢复"]].map(([label, time], index) => <div key={label} className={`${index < issuePhase ? "done" : index === issuePhase ? "current" : ""}`}><span>{index < issuePhase ? "✓" : index + 1}</span><strong>{label}</strong><small>{time}</small></div>)}</div>
              </section>
              <section className="two-column wide-left">
                <div className="surface">
                  <div className="surface-title"><div><h2>问题定义与修复计划</h2><p>所有结论必须关联漏斗版本和事件证据</p></div><button className="secondary-button" onClick={() => go("evidence")}>查看证据</button></div>
                  <div className="issue-form-grid"><div><label>异常步骤</label><strong>Eligible → Opportunity</strong></div><div><label>影响范围</label><strong>伊朗 · Android 1.8.0</strong></div><div><label>异常开始</label><strong>2026-08-09 14:20</strong></div><div><label>预计收入影响</label><strong className="negative">$2,807 / 日</strong></div><div className="span-2"><label>根因</label><strong>连接成功页动画完成后才生成 Opportunity，弱网用户提前进入后台；同时缓存对象没有完整保存 instanceContext。</strong></div><div className="span-2"><label>修复方案</label><strong>页面可见立即创建 Opportunity；缓存广告取出时绑定当前 opportunity_id；补充 background_reason。</strong></div><div><label>修复版本</label><strong>1.8.1 (109)</strong></div><div><label>关联测试 Run</label><strong>待生成</strong></div></div>
                  <div className="action-bar"><button className="secondary-button" onClick={() => notify("修复说明已保存")}>保存修复说明</button><button className="primary-button" onClick={() => setDialog("retest-run")}>发起打点重测</button></div>
                </div>
                <aside className="surface">
                  <div className="surface-title"><div><h2>发布门禁</h2><p>修复版本必须全部通过</p></div></div>
                  <div className="gate-list"><div><span>P0事件完整率</span><strong>目标 100%</strong><Badge tone={issueStatus === "重测中" ? "blue" : "neutral"}>{issueStatus === "重测中" ? "采集中" : "待测"}</Badge></div><div><span>P0参数完整率</span><strong>目标 100%</strong><Badge tone={issueStatus === "重测中" ? "blue" : "neutral"}>{issueStatus === "重测中" ? "采集中" : "待测"}</Badge></div><div><span>关联链完整率</span><strong>目标 100%</strong><Badge tone={issueStatus === "重测中" ? "blue" : "neutral"}>{issueStatus === "重测中" ? "采集中" : "待测"}</Badge></div><div><span>Unknown率</span><strong>目标 &lt; 1%</strong><Badge tone={issueStatus === "重测中" ? "blue" : "neutral"}>{issueStatus === "重测中" ? "采集中" : "待测"}</Badge></div></div>
                  <div className="conclusion-block warn"><strong>{issueStatus === "重测中" ? "重测进行中" : "当前不可发布"}</strong><p>{issueStatus === "重测中" ? "系统正在按原 snapshot 采集失败项，完成后自动刷新门禁结果。" : "完成打点重测且 P0 指标达到 100% 后，才允许进入灰度。"}</p></div>
                </aside>
              </section>
              <section className="surface">
                <div className="surface-title"><div><h2>修复前后效果验证</h2><p>灰度后自动比较同国家、同版本范围的转化率与收入</p></div><Badge tone="neutral">等待灰度数据</Badge></div>
                <div className="before-after"><div><span>修复前 7 天</span><strong>Opportunity覆盖率 28.4%</strong><div className="comparison-bar"><i style={{ width: "28.4%" }} /></div><small>广告浏览者比例 23.1% · $4,821/日</small></div><div className="comparison-arrow">→</div><div><span>关闭目标</span><strong>Opportunity覆盖率 ≥ 40%</strong><div className="comparison-bar target"><i style={{ width: "40%" }} /></div><small>广告浏览者比例 ≥ 33% · 收入恢复 ≥ 90%</small></div></div>
              </section>
              <section className="surface activity-log"><div className="surface-title"><div><h2>任务动态与审计记录</h2><p>记录状态、负责人、证据和验收操作</p></div><button className="text-button" onClick={() => notify("已加载全部任务动态")}>查看全部</button></div><div><span>11:08</span><strong>Oliver</strong><p>确认根因并关联 7 条事件证据。</p><Badge tone="good">已定位</Badge></div><div><span>11:26</span><strong>客户端增长组</strong><p>提交修复方案：Opportunity 前移并修复缓存 Context。</p><Badge tone="warn">修复中</Badge></div>{issueStatus === "重测中" && <div><span>刚刚</span><strong>系统</strong><p>已创建失败项重测 Run，等待设备开始执行。</p><Badge tone="blue">重测中</Badge></div>}</section>
            </div>
          )}

          {module === "funnel" && page === "snapshot" && (
            <div className="page-stack">
              <section className="snapshot-head surface"><div><div className="eyebrow">只读执行快照</div><h2>IRAN-VPN-01 · 漏斗口径 V1.7</h2><p>生效于 2026-08-01 · 套利 VPN v1.7 ＋ 广告 v1.7 ＋ VPN v1.7</p></div><div><Badge tone="good">已发布</Badge> <button className="secondary-button" onClick={() => notify("已定位到项目类型设置中的 V1.7 配置")}>前往项目类型设置</button></div></section>
              <section className="metric-grid five"><Metric label="产品漏斗" value="6 步" note="严格顺序" /><Metric label="变现用户漏斗" value="8 步" note="UV 去重" /><Metric label="变现事件漏斗" value="6 步" note="event_id 去重" /><Metric label="转化窗口" value="30 分钟" note="跨会话不合并" /><Metric label="规范版本" value="V1.7" note="schema_version 1.7" /></section>
              <section className="surface">
                <div className="surface-title"><div><h2>变现用户漏斗定义</h2><p>Firebase 实时口径；AdMob 数据仅用于结算对账</p></div><Badge tone="blue">User Funnel</Badge></div>
                <div className="table-wrap"><table><thead><tr><th>步骤</th><th>事件</th><th>用户判定</th><th>条件/窗口</th><th>关键关联字段</th><th>优先级</th><th>数据源</th></tr></thead><tbody>{[
                  ["DAU", "app_active", "当日活跃去重用户", "自然日", "user_pseudo_id", "P0", "Firebase"],
                  ["Eligible", "jk_ad_eligible", "eligible=1 的去重用户", "活跃后", "session_id", "P0", "Firebase"],
                  ["Opportunity", "jk_ad_opportunity", "生成真实展示机会", "Eligible后30分钟", "opportunity_id", "P0", "Firebase"],
                  ["Request", "jk_ad_request", "发起真实Load的用户", "Opportunity后", "request_id / opportunity_id", "P0", "Firebase"],
                  ["Load", "jk_ad_load_success", "SDK加载成功用户", "Request后", "ad_instance_id / request_id", "P0", "Firebase"],
                  ["Show Attempt", "jk_ad_show_attempt", "业务调用show的用户", "Load后", "ad_instance_id", "P0", "Firebase"],
                  ["AV", "jk_ad_impression", "至少1次Impression用户", "Show Attempt后", "opportunity_id / request_id", "P0", "Firebase"],
                  ["Paid", "jk_ad_paid_event", "收到Paid回调用户", "Impression后", "ad_instance_id", "条件P0", "Firebase"],
                ].map((row) => <tr key={row[0]}>{row.map((cell, index) => <td key={index}>{index === 5 ? <Badge tone="bad">{cell}</Badge> : cell}</td>)}</tr>)}</tbody></table></div>
              </section>
              <section className="two-column">
                <div className="surface"><div className="surface-title"><div><h2>统一计算规则</h2><p>避免不同页面出现不同答案</p></div></div><div className="rule-grid"><div><span>用户去重</span><strong>project_code + user_pseudo_id</strong></div><div><span>事件去重</span><strong>event_id</strong></div><div><span>顺序模式</span><strong>严格按 event_time</strong></div><div><span>同一步重复</span><strong>仅取首次到达</strong></div><div><span>缺失事件</span><strong>进入质量隔离区，不补算</strong></div><div><span>未知 jk_ 事件</span><strong>allowlist 外进入隔离表</strong></div></div></div>
                <aside className="surface"><div className="surface-title"><div><h2>数据时效</h2><p>页面必须明确显示数据状态</p></div></div><div className="source-list"><div><Badge tone="blue">T+0</Badge><strong>Firebase 实时预估</strong><small>用户与事件漏斗，延迟约 5–15 分钟</small></div><div><Badge tone="good">T+3</Badge><strong>AdMob 已结算</strong><small>收入、匹配率、展示率与广告浏览者</small></div><div><Badge tone="neutral">对账</Badge><strong>Firebase × AdMob</strong><small>只在已结算日期输出最终差异</small></div></div></aside>
              </section>
              <section className="two-column">
                <div className="surface"><div className="surface-title"><div><h2>核心指标公式</h2><p>页面、导出和告警统一引用</p></div></div><div className="formula-list"><div><strong>广告浏览者比例</strong><code>COUNT_DISTINCT(impression_user) / DAU</code><p>回答有多少活跃用户真正看到了广告。</p></div><div><strong>Opportunity覆盖率</strong><code>COUNT_DISTINCT(opportunity_user) / DAU</code><p>定位广告请求之前的机会覆盖问题。</p></div><div><strong>展示尝试成功率</strong><code>impression_count / show_attempt_count</code><p>定位真实调用 Show 后的展示失败。</p></div><div><strong>人均展示次数</strong><code>impression_count / AV</code><p>判断展示是否集中在少数用户。</p></div></div></div>
                <aside className="surface"><div className="surface-title"><div><h2>版本变更</h2><p>当前口径相对 V1.6</p></div><Badge tone="blue">V1.7</Badge></div><div className="version-diff"><div><span>新增</span><p>ip_before_connect / ip_after_connect 诊断字段</p></div><div><span>调整</span><p>ip_after_connect 在广告拉取事件中传输派生信息</p></div><div><span>明确</span><p>完整 IP 不进入 Firebase，且不作为漏斗步骤</p></div><button onClick={() => setDialog("version-diff-report")}>导出版本差异</button></div></aside>
              </section>
            </div>
          )}
        </main>
      </div>
      {dialog && <ActionDialog dialog={dialog} project={project} onClose={() => setDialog(null)} onSubmit={(message) => { if (dialog === "retest-run" || dialog === "tracking-run") setIssueStatus("重测中"); setDialog(null); notify(message); }} />}
      {notice && <div className="toast" role="status"><span>✓</span>{notice}</div>}
    </div>
  );
}
