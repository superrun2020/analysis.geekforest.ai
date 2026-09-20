"""Native Analysis build, real local anomaly API; isolated identity fixture only."""
import os,sys,json,time,subprocess,tempfile,urllib.request,urllib.parse,csv,io
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
APP=Path(os.environ['OPERATIONS_APP'])
sys.path.insert(0,str(APP/'scripts'))
from daily_anomalies import build,publish
from live_diagnostics import window
from datetime import datetime
from zoneinfo import ZoneInfo
scratch=Path(os.environ['TMPDIR']).resolve(); tmp=Path(tempfile.mkdtemp(prefix='oa-phase2-qa-',dir=scratch));out=scratch/'native-anomaly-browser.json'
now=datetime.now(ZoneInfo('Asia/Shanghai')).isoformat();dates=window(now)
registry=[{'project_code':f'Q{i:03}','package_name':f'fixture.package.{i}'} for i in range(35)]
def audience_rows():
 rows=[]
 for i,r in enumerate(registry):
  rows.append({'projectCode':r['project_code'],'date':dates[-2],'adViewerUsers':80,'activeUsers':100,'missingUserIdEvents':2})
  if i==34:continue
  viewers,active=(120,100) if i==32 else (2,1) if i==33 else (1,0) if i==31 else (20,100)
  rows.append({'projectCode':r['project_code'],'date':dates[-1],'adViewerUsers':viewers,'activeUsers':active,'missingUserIdEvents':2})
 return rows
def vpn_rows():
 rows=[]
 for i,r in enumerate(registry):
  rows.append({'projectCode':r['project_code'],'date':dates[-2],'vpnConnectStartCount':120,'vpnConnectResultCount':100,'vpnConnectSuccessCount':90,'vpnConnectFailedCount':10,'vpnConnectUnknownStatusCount':0,'sameDayMissingTerminalCount':30,'missingConnectionIdEvents':3,'contradictoryConnectionCount':0,'sameDayUnmatchedTerminalCount':10})
  if i==34:continue
  terminal,success,contradiction=(100,50,0)
  if i==32:terminal,success=(1,2)
  if i==33:contradiction=1
  if i==31:terminal,success,contradiction=(0,0,1)
  rows.append({'projectCode':r['project_code'],'date':dates[-1],'vpnConnectStartCount':40,'vpnConnectResultCount':terminal,'vpnConnectSuccessCount':success,'vpnConnectFailedCount':max(0,terminal-success),'vpnConnectUnknownStatusCount':0,'sameDayMissingTerminalCount':15,'missingConnectionIdEvents':3,'contradictoryConnectionCount':contradiction,'sameDayUnmatchedTerminalCount':60})
 return rows
sources={
 'ads':{'source':'fixture_only','checkedAt':now,'rows':[{'projectCode':r['project_code'],'date':day,'requestCount':100,'loadSuccessCount':70,'loadFailedCount':30,'impressionCount':30} for r in registry for day in dates]},
 'ad_audience':{'source':'fixture_final_selected_project_day','rows':audience_rows()},
 'vpn_connection':{'source':'fixture_final_result_project_day','rows':vpn_rows()},
 'errors':{'source':'fixture_all_source_raw_COUNT','checkedAt':now,'rows':[
  {'project_code':'Q000','event_date':dates[-1],'error_category':'internal_error','error_code':'JavaScriptEngine','error_message':'JavaScriptEngine crashed <script>window.__injected=1</script>','n':30},
  {'project_code':'Q000','event_date':dates[-1],'error_category':'internal_error','error_code':'DNS','error_message':'DNS host reset','n':29},
  {'project_code':'Q000','event_date':dates[-1],'error_category':'internal_error','error_code':'INTERNAL','error_message':'plain Internal error','n':28},
  *[{'project_code':'Q000','event_date':dates[-1],'error_category':'internal_error','error_code':f'CODE-{i}','error_message':f'long-tail-{i}','n':30-i} for i in range(3,15)],
  {'project_code':'Q000','event_date':dates[-1],'error_category':None,'error_code':None,'error_message':None,'n':1}]}}
publish(tmp/'anomalies.sqlite',build(registry,sources,dates,now))
env={**os.environ,'OA_PHASE2_QA_DATA':str(tmp),'OA_PHASE2_BACKEND_PORT':'51981','OA_PHASE2_PROXY_PORT':'51982'}
logs=[open(tmp/(n+'.log'),'w') for n in ('backend','proxy','static')]
procs=[subprocess.Popen(['node',str(APP/'tests/phase2-browser/backend.mjs')],env=env,stdout=logs[0],stderr=subprocess.STDOUT),subprocess.Popen([sys.executable,str(APP/'tests/phase2-browser/proxy.py')],env=env,stdout=logs[1],stderr=subprocess.STDOUT),subprocess.Popen([sys.executable,'-m','http.server','51984','--bind','127.0.0.1','--directory',str(ROOT/'dist')],stdout=logs[2],stderr=subprocess.STDOUT)]
checks=[];requests=[];errors=[]
try:
 for _ in range(100):
  try:urllib.request.urlopen('http://127.0.0.1:51982/api/anomalies/summary',timeout=.5);urllib.request.urlopen('http://127.0.0.1:51984/',timeout=.5);break
  except Exception:time.sleep(.1)
 with sync_playwright() as pw:
  browser=pw.chromium.launch(executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless=True)
  page=browser.new_page(viewport={'width':1600,'height':1000},accept_downloads=True)
  page.add_init_script("localStorage.setItem('jkcl_funnel_oa_token','ISOLATED_FIXTURE_ONLY');localStorage.setItem('jkcl_funnel_oa_expires_at',new Date(Date.now()+3600000).toISOString())")
  pending=[]
  def route(r):
   u=urllib.parse.urlsplit(r.request.url)
   if u.path=='/operations/session':pending.append(r);return
   if u.path.startswith('/operations/api/'):
    res=urllib.request.urlopen('http://127.0.0.1:51982'+u.path.removeprefix('/operations')+('?' + u.query if u.query else ''))
    r.fulfill(status=res.status,content_type=res.headers.get('Content-Type','application/json'),body=res.read());return
   if u.path=='/api/auth/me':r.fulfill(json={'user':{'email':'fixture@example.test','employee':{'name':'Fixture','status':'在职'}}});return
   r.fulfill(json={'data':[],'projects':[],'items':[]})
  page.route('**/api/**',route);page.route('**/operations/**',route)
  page.on('request',lambda r:requests.append({'url':r.url,'type':r.resource_type}));page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto('http://127.0.0.1:51984/?operations=projects&operationsPage=team',wait_until='domcontentloaded')
  page.get_by_test_id('native-daily-anomalies').wait_for();assert page.locator('iframe').count()==0
  assert page.get_by_test_id('anomaly-groups').locator('thead').count()==1
  assert 'operations=overview' in page.url and 'operationsPage' not in page.url
  checks.append('native table header before session/API ready; legacy link canonicalized; no iframe')
  for r in pending:r.fulfill(json={'ok':True})
  pending.clear();page.get_by_role('button',name='广告加载终态成功率',exact=True).wait_for()
  sidebar=page.locator('aside');assert sidebar.get_by_role('button',name='每日异常',exact=True).count()==1
  for label in ['运营总览','项目管理','问题跟进','自动监控','项目与Owner','设置与采集']:assert sidebar.get_by_role('button',name=label,exact=True).count()==0
  checks.append('only daily anomalies menu, no old management replacement entries')
  for label in ['数据对账','域名解析报表','打点测试配置','任务与告警','异常报警']:
   assert sidebar.get_by_role('button',name=label,exact=True).count()==0,label
  assert sidebar.locator('.main-nav-item').first.inner_text()=='每日异常'
  assert '质量治理' not in sidebar.inner_text()
  geometry=[]
  for height in [768,900]:
   page.set_viewport_size({'width':1440,'height':height});page.wait_for_timeout(100)
   sizes=sidebar.evaluate('(e)=>({client:e.clientHeight,scroll:e.scrollHeight,buttons:[...e.querySelectorAll(".main-nav-item,.nav-submenu-item")].map(b=>({label:b.innerText,y:b.getBoundingClientRect().y,bottom:b.getBoundingClientRect().bottom,height:b.getBoundingClientRect().height}))})')
   main_heights=sidebar.locator('.main-nav-item').evaluate_all('(items)=>items.map(e=>e.getBoundingClientRect().height)')
   submenu_heights=sidebar.locator('.nav-submenu-item').evaluate_all('(items)=>items.map(e=>e.getBoundingClientRect().height)')
   assert main_heights and all(value==32 for value in main_heights),main_heights
   assert submenu_heights and all(value==28 for value in submenu_heights),submenu_heights
   assert sizes['scroll']<=sizes['client'],sizes
   assert all(b['bottom']<height for b in sizes['buttons']),sizes
   geometry.append({'viewportHeight':height,**sizes})
   page.screenshot(path=str(scratch/f'v154-sidebar-{height}.png'))
  sidebar.get_by_role('button',name='折叠左侧菜单',exact=True).click()
  sidebar.get_by_role('button',name='展开左侧菜单',exact=True).click()
  daily=sidebar.get_by_role('button',name='每日异常',exact=True);daily.focus();assert daily.evaluate('(e)=>document.activeElement===e')
  checks.append({'compactSidebar':geometry,'collapseAndKeyboardFocus':True})
  for metric,coverage_field,visible_reason in [('广告浏览者比例','identityCoverage','当前去重展示用户/活跃用户'),('VPN连接成功率（终态）','sessionCoverage','成功终态/全部终态')]:
   page.get_by_role('button',name=metric,exact=True).click();metric_modal=page.locator('.ant-modal:visible');metric_modal.get_by_text('共 34 项（不是 Top 截取）',exact=True).wait_for();metric_rows=metric_modal.locator('tbody tr.ant-table-row');assert metric_rows.count()==20
   assert visible_reason in metric_rows.first.inner_text();assert ('缺用户标识事件' if metric.startswith('广告') else '终态') in metric_rows.first.inner_text()
   metric_rows.first.locator('td').first.click();assert metric_modal.get_by_text('实际错误消息 / 探测目标明细（不是推断根因）：',exact=True).count()>=1
   with page.expect_download() as metric_dl:metric_modal.get_by_role('button',name='导出当前筛选全部 CSV').click()
   metric_csv=list(csv.DictReader(io.StringIO(Path(metric_dl.value.path()).read_text(encoding='utf-8-sig'))));assert len(metric_csv)==34 and all(r[coverage_field] for r in metric_csv);assert any(r['status']=='data_anomaly' and r['denominator']=='1' for r in metric_csv);assert any(r['status']=='data_anomaly' and r['current']=='' for r in metric_csv)
   metric_modal.get_by_label('异常明细范围').click();page.get_by_text('全部项目（含未命中/缺数）',exact=True).click();metric_modal.get_by_text('共 35 项（不是 Top 截取）',exact=True).wait_for()
   metric_modal.get_by_label('异常明细范围').click();page.get_by_text('不可计算/缺数项目',exact=True).click();metric_modal.get_by_text('共 2 项（不是 Top 截取）',exact=True).wait_for()
   metric_modal.locator('.ant-modal-close').click()
  checks.append('both new metrics show reason/coverage, expand, affected/all/missing filters, >100/small/zero fixtures, and CSV coverage parity')
  page.get_by_role('button',name='广告加载终态成功率',exact=True).click();modal=page.locator('.ant-modal:visible');modal.get_by_text('共 35 项（不是 Top 截取）',exact=True).wait_for();rows=modal.locator('.ant-table-wrapper').first.locator('tbody').first.locator(':scope > tr.ant-table-row');assert rows.count()==20
  first_row=rows.first
  direct=first_row.inner_text();assert 'JavaScriptEngine crashed <script>window.__injected=1</script>' in direct;assert 'DNS host reset' in direct;assert 'plain Internal error' in direct
  assert '错误日志分布（事件口径）' in direct and 'raw event total' in direct and 'all-source incl retries' in direct
  assert 'request/final scope' in direct and '差异（未对账）' in direct and 'checkedAt' in direct
  unknown=rows.nth(1).inner_text();assert '无观测' in unknown and 'raw event total —' in unknown and '来源不可用' in unknown
  project_left=first_row.locator('td').nth(0).bounding_box()['x'];reason_left=first_row.get_by_test_id('failure-reasons').bounding_box()['x'];assert reason_left-project_left<620
  assert page.evaluate('window.__injected') is None
  reason_head=first_row.locator('.ant-table-wrapper thead').first.inner_text();assert '类别' in reason_head and '错误码' in reason_head and '消息' in reason_head
  first_row.get_by_text('另13类，展开全部',exact=True).click();first_row.get_by_text('long-tail-9',exact=True).wait_for();first_row.locator('.ant-pagination-item-2').last.click();first_row.get_by_text('long-tail-14',exact=True).wait_for();first_row.get_by_text('(空错误消息)',exact=True).wait_for()
  first_row.locator('td').first.click();expanded=modal.locator('tr.ant-table-expanded-row').first;expanded.wait_for()
  checks.append('ad_load directly shows real top3 category/code/message; escaped HTML; full long-tail+unknown pagination; raw/summary denominators and provenance')
  first=rows.all_inner_texts();modal.locator('.ant-pagination-item-2').last.click();page.wait_for_timeout(400);assert rows.count()==15 and not set(first)&set(rows.all_inner_texts())
  with page.expect_download() as dl:modal.get_by_role('button',name='导出当前筛选全部 CSV').click()
  records=list(csv.DictReader(io.StringIO(Path(dl.value.path()).read_text(encoding='utf-8-sig'))));assert len(records)==35
  checks.append('real isolated API: all 35 packages paginated 20+15 and CSV count identical')
  modal.locator('.ant-modal-close').click()
  page.reload(wait_until='domcontentloaded');page.get_by_test_id('native-daily-anomalies').wait_for()
  for r in pending:r.fulfill(json={'ok':True})
  pending.clear();page.get_by_role('button',name='广告加载终态成功率',exact=True).wait_for()
  # Exercise browser history independently of report data fetches.
  page.evaluate("history.pushState(null,'','/');window.dispatchEvent(new PopStateEvent('popstate'))")
  assert page.get_by_test_id('native-daily-anomalies').count()==0
  page.go_back(wait_until='domcontentloaded');page.get_by_test_id('native-daily-anomalies').wait_for()
  for r in pending:r.fulfill(json={'ok':True})
  pending.clear();page.go_forward(wait_until='domcontentloaded');assert page.get_by_test_id('native-daily-anomalies').count()==0
  checks.append('reload/back/forward preserve canonical native route')
  forbidden=[r for r in requests if '/operations/' in r['url'] and ('/api/' not in r['url'] and '/session' not in r['url'])];assert not forbidden,forbidden
  assert not errors,errors
  checks.append('no operations HTML, assets, embedded bootstrap or document requests; no page errors')
  out.write_text(json.dumps({'passed':True,'isolatedIdentity':True,'checks':checks,'requests':requests},ensure_ascii=False,indent=2));print(json.dumps(checks,ensure_ascii=False));browser.close()
finally:
 for p in procs:p.terminate()
 for p in procs:
  try:p.wait(5)
  except subprocess.TimeoutExpired:p.kill()
 for f in logs:f.close()
