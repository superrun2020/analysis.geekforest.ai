"use client";

import { useMemo, useState } from "react";

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

export default function Home() {
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

  const stages = useMemo(() => {
    if (funnelMode === "product") return productStages;
    return unitMode === "users" ? monetizationUserStages : monetizationEventStages;
  }, [funnelMode, unitMode]);

  const currentPage = pages.find((item) => item.key === page)!;
  const visibleEvents = eventRows
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => !onlyErrors || event.result !== "有效");
  const issuePhase = issueStatus === "重测中" ? 3 : 2;

  function notify(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2600);
  }

  function go(next: PageKey) {
    setPage(next);
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
        {[
          ["全局项目总览", "01"], ["单项目诊断", "02"], ["漏斗分析", "03"], ["AdMob 分析", "04"], ["Firebase 分析", "05"], ["数据对账", "06"],
        ].map(([label, index]) => <button key={label} className={`main-nav-item ${label === "漏斗分析" ? "active" : ""}`}><span>{index}</span>{label}</button>)}
        <div className="nav-group-label">质量治理</div>
        {[["打点验收中心", "07"], ["规范与项目配置", "08"], ["数据任务与告警", "09"]].map(([label, index]) => <button key={label} className="main-nav-item"><span>{index}</span>{label}</button>)}
        <div className="sidebar-foot"><span className="status-dot" />Firebase 实时数据正常<small>AdMob 已结算至 8月8日</small></div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumbs">经营分析 / 漏斗分析 / <strong>{currentPage.label}</strong></div>
          <div className="topbar-actions"><div className="global-search">搜索项目、事件、问题单</div><button className="icon-button" aria-label="通知">3</button><div className="avatar">OL</div></div>
        </header>

        <main className="main-content">
          <section className="page-heading">
            <div><h1>漏斗分析中心</h1><p>从多项目异常发现到事件证据、修复重测和效果验证的完整诊断闭环</p></div>
            <div className="heading-actions"><button className="secondary-button" onClick={() => go("snapshot")}>查看口径 V1.7</button><button className="primary-button" onClick={() => { go("issues"); notify("已创建诊断任务草稿"); }}>＋ 新建诊断任务</button></div>
          </section>

          <section className="workflow-strip" aria-label="漏斗诊断流程">
            {[
              ["发现", "多项目总览"], ["定位", "单项目漏斗"], ["拆解", "步骤与分群"], ["取证", "路径与事件"], ["闭环", "修复与验证"],
            ].map(([name, hint], index) => {
              const pageIndex = pages.findIndex((item) => item.key === page);
              const phase = pageIndex === 0 ? 0 : pageIndex === 1 ? 1 : pageIndex <= 3 ? 2 : pageIndex <= 5 ? 3 : 4;
              return <div key={name} className={`workflow-step ${phase === index ? "current" : ""} ${phase > index ? "done" : ""}`}><span>{phase > index ? "✓" : index + 1}</span><div><strong>{name}</strong><small>{hint}</small></div></div>;
            })}
          </section>

          <nav className="page-nav" aria-label="漏斗分析页面">
            {pages.map((item) => <button key={item.key} className={page === item.key ? "active" : ""} onClick={() => go(item.key)}><span>{item.label}</span><small>{item.hint}</small></button>)}
          </nav>

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
            <div className="context-summary"><Badge tone="blue">{currentPage.hint}</Badge><span>{project}</span><i /> <span>{range}</span><i /> <span>Android · 1.8.0</span><i /> <span>口径 V1.7</span></div>
            <div className="context-actions"><button onClick={() => notify("当前分析视图已保存")}>保存视图</button><button onClick={() => notify("报表导出任务已创建")}>导出报表</button></div>
          </section>
          <section className="freshness-note"><div><strong>数据使用提示：</strong>今天的用户漏斗与事件漏斗来自 Firebase 实时数据；收入、匹配率和 AdMob 广告浏览者为 T+3 结算口径。</div><button onClick={() => go("snapshot")}>查看数据口径</button></section>

          {page === "overview" && (
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

          {page === "workbench" && (
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

          {page === "diagnosis" && (
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
                  <div className="action-stack"><button className="primary-button" onClick={() => go("cohort")}>进入分群对比</button><button className="secondary-button" onClick={() => go("evidence")}>查看事件证据</button><button className="secondary-button" onClick={() => { go("issues"); notify("诊断结论已带入问题任务"); }}>创建问题任务</button></div>
                </aside>
              </section>
            </div>
          )}

          {page === "cohort" && (
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

          {page === "path" && (
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

          {page === "evidence" && (
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

          {page === "issues" && (
            <div className="page-stack">
              <section className="surface">
                <div className="surface-title"><div><h2>ISSUE-20260811-024 · Opportunity 覆盖率异常</h2><p>IRAN-VPN-01 · P0 · 负责人：客户端增长组 / Oliver · SLA 剩余 18 小时</p></div><Badge tone={issueStatus === "重测中" ? "blue" : "warn"}>{issueStatus}</Badge></div>
                <div className="issue-workflow">{[["已发现", "8/11 10:32"], ["已定位", "8/11 11:08"], ["修复中", "预计 8/12"], ["打点重测", issueStatus === "重测中" ? "采集中" : "待开始"], ["灰度验证", "待开始"], ["关闭", "指标恢复"]].map(([label, time], index) => <div key={label} className={`${index < issuePhase ? "done" : index === issuePhase ? "current" : ""}`}><span>{index < issuePhase ? "✓" : index + 1}</span><strong>{label}</strong><small>{time}</small></div>)}</div>
              </section>
              <section className="two-column wide-left">
                <div className="surface">
                  <div className="surface-title"><div><h2>问题定义与修复计划</h2><p>所有结论必须关联漏斗版本和事件证据</p></div><button className="secondary-button" onClick={() => go("evidence")}>查看证据</button></div>
                  <div className="issue-form-grid"><div><label>异常步骤</label><strong>Eligible → Opportunity</strong></div><div><label>影响范围</label><strong>伊朗 · Android 1.8.0</strong></div><div><label>异常开始</label><strong>2026-08-09 14:20</strong></div><div><label>预计收入影响</label><strong className="negative">$2,807 / 日</strong></div><div className="span-2"><label>根因</label><strong>连接成功页动画完成后才生成 Opportunity，弱网用户提前进入后台；同时缓存对象没有完整保存 instanceContext。</strong></div><div className="span-2"><label>修复方案</label><strong>页面可见立即创建 Opportunity；缓存广告取出时绑定当前 opportunity_id；补充 background_reason。</strong></div><div><label>修复版本</label><strong>1.8.1 (109)</strong></div><div><label>关联测试 Run</label><strong>待生成</strong></div></div>
                  <div className="action-bar"><button className="secondary-button" onClick={() => notify("修复说明已保存")}>保存修复说明</button><button className="primary-button" onClick={() => { setIssueStatus("重测中"); notify("打点重测已发起，正在采集事件"); }}>发起打点重测</button></div>
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

          {page === "snapshot" && (
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
                <aside className="surface"><div className="surface-title"><div><h2>版本变更</h2><p>当前口径相对 V1.6</p></div><Badge tone="blue">V1.7</Badge></div><div className="version-diff"><div><span>新增</span><p>ip_before_connect / ip_after_connect 诊断字段</p></div><div><span>调整</span><p>ip_after_connect 在广告拉取事件中传输派生信息</p></div><div><span>明确</span><p>完整 IP 不进入 Firebase，且不作为漏斗步骤</p></div><button onClick={() => notify("V1.6 与 V1.7 差异已导出")}>导出版本差异</button></div></aside>
              </section>
            </div>
          )}
        </main>
      </div>
      {notice && <div className="toast" role="status"><span>✓</span>{notice}</div>}
    </div>
  );
}
