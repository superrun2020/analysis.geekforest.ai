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
sources={'ads':{'source':'fixture_only','rows':[{'projectCode':r['project_code'],'date':day,'requestCount':100,'loadSuccessCount':70,'loadFailedCount':30,'impressionCount':30} for r in registry for day in dates]}}
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
  page.get_by_role('button',name='广告加载终态成功率',exact=True).click();modal=page.locator('.ant-modal:visible');modal.get_by_text('共 35 项（不是 Top 截取）',exact=True).wait_for();rows=modal.locator('tbody tr.ant-table-row');assert rows.count()==20
  first=rows.all_inner_texts();modal.locator('.ant-pagination-item-2').click();page.wait_for_timeout(400);assert rows.count()==15 and not set(first)&set(rows.all_inner_texts())
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
