"""Real built shell responsive regression; isolated identity, no production session."""
import functools,http.server,threading,json
from pathlib import Path
from datetime import date,timedelta
minimum=(date.today()-timedelta(days=7)).isoformat();maximum=(date.today()-timedelta(days=1)).isoformat()
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
server=http.server.ThreadingHTTPServer(('127.0.0.1',51989),functools.partial(http.server.SimpleHTTPRequestHandler,directory=str(ROOT/'dist')))
threading.Thread(target=server.serve_forever,daemon=True).start()
try:
 with sync_playwright() as pw:
  browser=pw.chromium.launch(executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless=True)
  page=browser.new_page(viewport={'width':380,'height':956})
  page.add_init_script("localStorage.setItem('jkcl_funnel_oa_token','ISOLATED_FIXTURE_ONLY');localStorage.setItem('jkcl_funnel_oa_expires_at',new Date(Date.now()+3600000).toISOString())")
  def route(r):
   if '/api/auth/me' in r.request.url:r.fulfill(json={'user':{'email':'fixture@example.test','employee':{'name':'Fixture','status':'在职'}}})
   elif '/jkcl-funnel/projects' in r.request.url or '/jkcl-funnel/options' in r.request.url:r.fulfill(json={'data':{'projects':[{'projectCode':'Q001','appName':'Fixture App','appIdentifier':'fixture.app','platform':'Android'}],'platforms':['Android','iOS'],'countries':['US'],'appVersions':['1.0','2.0'],'dateRange':{'min':minimum,'max':maximum}}})
   else:r.fulfill(json={'data':[],'projects':[],'items':[]})
  page.route('**/api/**',route);page.route('**/operations/**',route)
  page.goto('http://127.0.0.1:51989/?operations=overview')
  page.get_by_test_id('daily-overall-config').wait_for()
  page.get_by_role('button',name='打开导航菜单',exact=True).wait_for(timeout=3000)
  assert page.locator('.analysis-sider:visible').count()==0
  assert page.locator('.operations-workspace').bounding_box()['width']>=360
  page.get_by_role('button',name='打开导航菜单',exact=True).click()
  page.get_by_role('menuitem',name='每日异常',exact=True).click()
  page.locator('.ant-drawer').wait_for(state='hidden')
  assert page.locator('.ant-drawer:visible').count()==0
  for w,h in [(1440,900),(1366,768),(390,844),(380,956)]:
   page.set_viewport_size({'width':w,'height':h});page.wait_for_timeout(300)
   assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
   card=page.get_by_test_id('daily-overall-config').bounding_box()
   assert card['x']>=0 and card['x']+card['width']<=w+1, f'config clipped {w}: {card}'
   for box in page.locator('[data-testid="daily-overall-config"] .ant-select').evaluate_all('els=>els.map(e=>{let r=e.getBoundingClientRect();return {x:r.x,right:r.right}})'):
    assert box['x']>=card['x'] and box['right']<=card['x']+card['width'], f'control clipped {w}: {box}'
   page.screenshot(path=str(ROOT/f'antd-shell-{w}.png'))
  page.set_viewport_size({'width':1440,'height':900});page.wait_for_timeout(250)
  assert page.locator('.analysis-sider').bounding_box()['width']==248
  assert page.get_by_role('menuitem').first.inner_text()=='每日异常'
  page.get_by_role('button',name='折叠左侧菜单',exact=True).click();page.wait_for_timeout(300)
  assert page.locator('.analysis-sider').bounding_box()['width']==64
  page.get_by_role('button',name='展开左侧菜单',exact=True).focus();page.keyboard.press('Enter');page.wait_for_timeout(300)
  assert page.locator('.analysis-sider').bounding_box()['width']==248
  page.get_by_role('menuitem',name='诊断报表',exact=True).click()
  page.get_by_role('menuitem',name='版本对比',exact=True).click()
  assert page.locator('.ant-menu-item-selected').count()==1
  assert page.locator('.operations-workspace:visible').count()==0
  page.reload();page.get_by_role('menuitem',name='版本对比',exact=True).wait_for()
  assert '版本对比' in page.locator('.ant-menu-item-selected').inner_text()
  page.get_by_role('menuitem',name='每日异常',exact=True).click()
  page.go_back();page.wait_for_timeout(300)
  assert '版本对比' in page.locator('.ant-menu-item-selected').inner_text()
  for label in ['广告漏斗分析中心','VPN功能漏斗分析','AdMob 分析','Firebase 数据']:
   page.get_by_role('menuitem',name=label,exact=True).click();page.reload();page.locator('.analysis-sider').wait_for()
   assert label in page.locator('.ant-menu-item-selected').inner_text()
   page.get_by_role('menuitem',name='每日异常',exact=True).click();page.go_back();page.wait_for_timeout(200)
   assert label in page.locator('.ant-menu-item-selected').inner_text()
   page.go_forward();page.wait_for_timeout(200)
   assert '每日异常' in page.locator('.ant-menu-item-selected').inner_text()
  errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  routes=['?operations=overview']+['?module=funnel&page='+p for p in ['overview','workbench','evidence','issues']]+['?module=vpn&page=workbench']+['?module=vpnReport&reportSection='+p for p in ['matrix','exitIp','adOverall','adDns','versions']]+['?module='+p for p in ['admob','firebase','reconcile','tracking','tasks','shareAlerts','report']]
  results=[]
  for width,height in [(1440,900),(380,956)]:
   page.set_viewport_size({'width':width,'height':height})
   for routepath in routes:
    page.goto('http://127.0.0.1:51989/'+routepath);page.locator('.analysis-content').wait_for();page.wait_for_timeout(180)
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'), routepath
    assert not errors, (routepath,errors)
    results.append({'route':routepath,'width':width,'rendered':True,'errors':list(errors)})
  queries=[]
  page.on('request',lambda req:queries.append(req.post_data_json) if '/jkcl-funnel/query' in req.url and req.method=='POST' else None)
  page.set_viewport_size({'width':1440,'height':900})
  page.goto('http://127.0.0.1:51989/?module=vpnReport&reportSection=adOverall');page.wait_for_timeout(400)
  platform=page.locator('.overall-filter-item').filter(has_text='平台：').locator('.ant-select')
  platform.click();page.get_by_text('iOS',exact=True).last.click();page.wait_for_timeout(400)
  assert 'iOS' in platform.inner_text()
  assert any(q.get('platform')=='ios' for q in queries),queries
  picker=page.locator('.overall-filter-item .ant-picker').first
  picker.click();page.locator('.ant-picker-dropdown:visible').wait_for()
  assert page.locator('.ant-picker-dropdown:visible').bounding_box()['x']>=0
  page.keyboard.press('Escape')
  page.goto('http://127.0.0.1:51989/?module=funnel&page=workbench');page.wait_for_timeout(400)
  bounded=page.locator('.ant-picker').first;bounded.click()
  popup=page.locator('.ant-picker-dropdown:visible')
  low=(date.fromisoformat(minimum)-timedelta(days=1)).isoformat();high=(date.fromisoformat(maximum)+timedelta(days=1)).isoformat()
  assert 'ant-picker-cell-disabled' in popup.locator(f'td[title="{low}"]').get_attribute('class')
  assert 'ant-picker-cell-disabled' in popup.locator(f'td[title="{high}"]').get_attribute('class')
  chosen=(date.fromisoformat(maximum)-timedelta(days=1)).isoformat()
  queries.clear();popup.locator(f'td[title="{chosen}"]').click();page.wait_for_timeout(400)
  assert bounded.locator('input').input_value()==chosen
  assert any(q.get('dateFrom')==chosen and q.get('dateTo')==chosen for q in queries),queries
  (ROOT/'antd-route-results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
  browser.close()
 print('PASS responsive shell: 4 viewports, mobile drawer, unique selection')
finally:server.shutdown()
