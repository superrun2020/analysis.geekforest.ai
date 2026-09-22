"""Isolated identity fixture; real built native UI and SQLite-backed operations HTTP.
Run with OPERATIONS_APP pointing at the reviewed clean operations worktree.
No production account/session is created or claimed by this test.
"""
import os,sys,json,time,tempfile,subprocess,urllib.request,urllib.parse,urllib.error,csv,io
from pathlib import Path
from datetime import datetime,timedelta
from zoneinfo import ZoneInfo
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
APP=Path(os.environ['OPERATIONS_APP']).resolve()
scratch=Path(os.environ['TMPDIR']).resolve()
assert str(scratch).startswith('/Users/oliver/.hermes/cache/scratch')
sys.path.insert(0,str(APP/'scripts'))
from daily_anomalies import build,build_version_details,publish
now=datetime.now(ZoneInfo('Asia/Shanghai'));dates=[(now.date()-timedelta(days=n)).isoformat() for n in [2,1]]
data=Path(tempfile.mkdtemp(prefix='overall-browser-',dir=scratch))
registry=[{'project_code':f'Q{i:03}','app_name':f'Fixture App {i}','package_name':f'fixture.pkg.{i}','owner_ids':['1','2'],'owners':[{'id':j,'display_name':'Fixture Dev '+j,'status':1,'login_status':1} for j in ['1','2']]} for i in range(35)]
sources={'ads':{'source':'isolated_summary','rows':[{'projectCode':r['project_code'],'date':d,'loadSuccessCount':20,'loadFailedCount':180} for r in registry for d in dates]},'errors':{'source':'isolated_raw','checkedAt':now.isoformat(),'rows':[{'project_code':r['project_code'],'event_date':d,'error_category':'internal_error','error_code':'DNS','error_message':'DNS reset <script>window.__injected=1</script>','n':120} for r in registry for d in dates]}}
collected=build(registry,sources,dates,now.isoformat())
version_sources={key:{**source,'rows':[{**row,'appVersion':version,**({'loadSuccessCount':10 if version=='1.0' else 30,'loadFailedCount':190 if version=='1.0' else 170} if key=='ads' else {'n':40 if version=='1.0' else 80})} for row in source['rows'] for version in ['1.0','2.0']]} for key,source in sources.items()}
collected['versionDetails']=build_version_details(registry,version_sources,dates,now.isoformat());collected['versionSupport']={'status':'available'};collected['schemaVersion']=3
publish(data/'anomalies.sqlite',collected)
# Actual server and fixture state in a scoped temporary data directory, no scheduler.
server_script=f"import {{createApplication}} from {json.dumps((APP/'src/server.js').as_uri())}; const app=await createApplication({{dataDir:{json.dumps(str(data))}}}); app.server.listen(51985,'127.0.0.1');"
logs=[open(data/(n+'.log'),'w') for n in ['backend','static']]
procs=[subprocess.Popen(['node','--input-type=module','-e',server_script],stdout=logs[0],stderr=subprocess.STDOUT),subprocess.Popen([sys.executable,'-m','http.server','51986','--bind','127.0.0.1','--directory',str(ROOT/'dist')],stdout=logs[1],stderr=subprocess.STDOUT)]
checks=[]
try:
 for _ in range(100):
  try:urllib.request.urlopen('http://127.0.0.1:51985/api/anomalies/summary',timeout=.5);urllib.request.urlopen('http://127.0.0.1:51986/',timeout=.5);break
  except Exception:time.sleep(.1)
 else:raise RuntimeError('Fixture server failed; inspect '+str(data))
 with sync_playwright() as pw:
  browser=pw.chromium.launch(executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless=True)
  page=browser.new_page(viewport={'width':1600,'height':1000},accept_downloads=True)
  page.add_init_script("localStorage.setItem('jkcl_funnel_oa_token','ISOLATED_FIXTURE_ONLY');localStorage.setItem('jkcl_funnel_oa_expires_at',new Date(Date.now()+3600000).toISOString())")
  pending=[];held=[];requests=[];errors=[];mode={'status':None,'hold':False,'hold_export':False};exports=[]
  def route(r):
   u=urllib.parse.urlsplit(r.request.url)
   if u.path=='/operations/session':
    if r.request.method=='DELETE':r.fulfill(json={'ok':True})
    else:pending.append(r)
    return
   if u.path.startswith('/operations/api/'):
    requests.append(u.path+'?'+u.query)
    if u.path.endswith('/details') and mode['hold']:mode['hold']=False;held.append(r);return
    if u.path.endswith('/export') and mode['hold_export']:mode['hold_export']=False;exports.append(r);return
    if mode['status']:r.fulfill(status=mode['status'],json={'message':'isolated denied or unavailable'});return
    try:res=urllib.request.urlopen('http://127.0.0.1:51985'+u.path.removeprefix('/operations')+'?'+u.query)
    except urllib.error.HTTPError as e:res=e
    r.fulfill(status=res.status,content_type=res.headers.get('Content-Type','application/json'),body=res.read());return
   if u.path=='/api/auth/me':r.fulfill(json={'user':{'email':'fixture@example.test','employee':{'name':'Fixture','status':'在职'}}});return
   r.fulfill(json={'data':[],'projects':[],'items':[]})
  page.route('**/api/**',route);page.route('**/operations/**',route)
  page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto('http://127.0.0.1:51986/?operations=overview',wait_until='domcontentloaded')
  page.get_by_test_id('daily-overall-config').wait_for()
  assert page.get_by_test_id('anomaly-groups').locator('thead').count()==1
  assert page.locator('iframe').count()==0
  for r in pending:r.fulfill(json={'ok':True})
  pending.clear()
  page.get_by_text('每日异常 Overall · 70 组',exact=True).wait_for()
  checks.append('config and table skeleton before auth; real API 70 grouped rows')
  before=len(requests);page.get_by_label('显示-昨日率',exact=True).locator('..').click();page.wait_for_timeout(150);assert len(requests)==before
  assert page.get_by_test_id('anomaly-groups').get_by_role('columnheader',name='昨日率',exact=True).count()==0
  checks.append('display toggle changes headers without backend query')
  page.get_by_label('维度-错误原因',exact=True).locator('..').click();page.get_by_label('维度-项目',exact=True).locator('..').click();page.get_by_label('维度-异常原因',exact=True).locator('..').click()
  page.get_by_role('button',name='查 询',exact=True).click()
  page.get_by_text('每日异常 Overall · 1 组',exact=True).wait_for()
  assert 'DNS' in page.get_by_test_id('anomaly-groups').inner_text()
  assert any('dimensions=error' in q for q in requests)
  assert page.evaluate('window.__injected') is None
  page.get_by_test_id('anomaly-groups').locator('.ant-table-row-expand-icon').click()
  assert 'fixture.pkg.34' in page.get_by_test_id('anomaly-groups').inner_text()
  with page.expect_download() as download:page.locator('button').filter(has_text='导出 CSV').click()
  rows=list(csv.DictReader(io.StringIO(Path(download.value.path()).read_text(encoding='utf-8-sig'))));assert len(rows)==1 and int(rows[0]['errorCount'])==4200
  checks.append('error-only dedup full 35-package scope, escaped message, full CSV 4200 events')
  page.get_by_role('button',name='重 置',exact=True).click();page.get_by_text('每日异常 Overall · 70 组',exact=True).wait_for()
  with page.expect_download() as download:page.locator('button').filter(has_text='导出 CSV').click()
  rows=list(csv.DictReader(io.StringIO(Path(download.value.path()).read_text(encoding='utf-8-sig'))));assert len(rows)==70
  page.locator('.ant-pagination-item-3').click();page.wait_for_timeout(200)
  assert page.get_by_test_id('anomaly-groups').locator('tbody tr.ant-table-row').count()==10
  checks.append('reset and server pagination 30+30+10, complete CSV 70')
  mode['status']=503;page.get_by_role('button',name='查 询',exact=True).click();page.get_by_text('isolated denied or unavailable',exact=True).wait_for()
  assert '保留上次成功条件' in page.get_by_test_id('overall-applied').inner_text()
  assert page.locator('button').filter(has_text='导出 CSV').is_disabled()
  mode['status']=None;page.get_by_role('button',name='重 置',exact=True).click();page.get_by_text('每日异常 Overall · 70 组',exact=True).wait_for();page.wait_for_timeout(200)
  checks.append('503 preserves labeled last-good data; no mislabeled export')
  page.get_by_label('异常原因筛选',exact=True).click();page.locator('.ant-select-dropdown:visible').get_by_text('广告加载终态成功率',exact=True).click()
  page.get_by_label('版本筛选',exact=True).click();page.locator('.ant-select-dropdown:visible .ant-select-item-option-content').filter(has_text='1.0').click()
  page.get_by_label('维度-版本',exact=True).locator('..').click();page.get_by_role('button',name='查 询',exact=True).click()
  page.get_by_text('每日异常 Overall · 35 组',exact=True).wait_for()
  assert 'Fixture App' in page.get_by_test_id('anomaly-groups').inner_text()
  assert 'fixture.pkg.' in page.get_by_test_id('anomaly-groups').inner_text()
  with page.expect_download() as download:page.locator('button').filter(has_text='导出 CSV').click()
  version_rows=list(csv.DictReader(io.StringIO(Path(download.value.path()).read_text(encoding='utf-8-sig'))))
  assert len(version_rows)==35 and all(r['version']=='1.0' and r['current']=='5' and r['errorCount']=='40' for r in version_rows)
  assert all(r['baselineDate']==dates[0] for r in version_rows)
  page.get_by_label('错误消息关键词',exact=True).fill('does not exist');page.get_by_role('button',name='查 询',exact=True).click();page.get_by_text('每日异常 Overall · 0 组',exact=True).wait_for()
  checks.append('real version controls select independent v1 facts 5 percent/40 events, registry app/package, previous date and full CSV; safe keyword returns empty')
  page.get_by_role('button',name='重 置',exact=True).click();page.get_by_text('每日异常 Overall · 70 组',exact=True).wait_for();page.wait_for_timeout(200)
  mode['hold']=True;page.get_by_role('button',name='查 询',exact=True).click();page.wait_for_timeout(100);assert held
  page.get_by_label('维度-错误原因',exact=True).locator('..').click();page.get_by_label('维度-项目',exact=True).locator('..').click();page.get_by_label('维度-异常原因',exact=True).locator('..').click();page.get_by_role('button',name='查 询',exact=True).click();page.get_by_text('每日异常 Overall · 1 组',exact=True).wait_for()
  for r in held:
   try:r.fulfill(json={'records':[],'options':{'dates':dates},'dimensions':['project'],'total':999})
   except Exception:pass
  held.clear();page.wait_for_timeout(100);assert '999' not in page.get_by_test_id('daily-overall-results').inner_text()
  checks.append('rapid apply ignores obsolete response')
  mode['hold_export']=True;page.locator('button').filter(has_text='导出 CSV').click();page.wait_for_timeout(100);assert exports
  mode['status']=403;page.get_by_role('button',name='查 询',exact=True).click();page.wait_for_timeout(250)
  assert page.get_by_test_id('anomaly-groups').locator('tbody tr.ant-table-row').count()==0
  assert page.locator('button').filter(has_text='导出 CSV').is_disabled()
  for r in exports:
   try:r.fulfill(body='sensitive fixture late CSV',content_type='text/csv')
   except Exception:pass
  checks.append('403 clears all rows/options and cancels pending CSV')
  assert not errors,errors
  page.screenshot(path=str(data/'overall-final.png'));browser.close()
 print(json.dumps({'passed':True,'checks':checks,'fixtureDirectory':str(data),'boundary':'isolated identity fixture plus actual built UI and operations HTTP, not production authenticated browser'},ensure_ascii=False))
finally:
 for p in procs:p.terminate()
 for p in procs:
  try:p.wait(timeout=5)
  except subprocess.TimeoutExpired:p.kill();p.wait()
 for log in logs:log.close()
