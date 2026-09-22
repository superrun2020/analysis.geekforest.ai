"""Real input regression on the full application; never set scrollTop."""
import json

def check_scroll(page, browser, data, checks):
 evidence=[]
 for width,height in [(1366,768),(1440,900),(390,844)]:
  page.set_viewport_size({'width':width,'height':height});page.wait_for_timeout(200)
  chain=page.get_by_test_id('native-daily-anomalies').evaluate('''e=>{let a=[];for(;e;e=e.parentElement){let c=getComputedStyle(e);a.push({tag:e.tagName,cls:e.className,h:e.clientHeight,sh:e.scrollHeight,overflow:c.overflow,height:c.height,minHeight:c.minHeight,display:c.display,flex:c.flex,touch:c.touchAction})}return a}''')
  page.mouse.move(width-40,height//2)
  before=page.get_by_test_id('daily-overall-config').bounding_box()['y']
  for _ in range(12):page.mouse.wheel(0,650);page.wait_for_timeout(70)
  after=page.get_by_test_id('daily-overall-config').bounding_box()['y']
  item=page.locator('.ant-pagination-item-3');box=item.bounding_box()
  result={'viewport':[width,height],'chain':chain,'wheelBefore':before,'wheelAfter':after,'pagination':box}
  evidence.append(result);(data/'scroll-evidence.json').write_text(json.dumps(evidence,indent=2))
  print(json.dumps(result),flush=True)
  assert after<before-100, 'Real wheel cannot move daily anomaly content'
  assert box and 0<=box['y']<height-20,'Pagination unreachable by wheel'
  page.screenshot(path=str(data/f'scroll-{width}.png'))
  horizontal=page.locator('[data-testid="anomaly-groups"] .ant-table-content')
  overflow=horizontal.evaluate('e=>e.scrollWidth-e.clientWidth')
  if overflow>0:
   page.wait_for_timeout(600) # End the preceding vertical wheel gesture before horizontal input.
   tablebox=horizontal.bounding_box();targety=min(height-100,tablebox['y']+tablebox['height']-30)
   page.mouse.move(width-55,targety)
   for _ in range(3): page.mouse.wheel(20000,0);page.wait_for_timeout(250)
   assert horizontal.evaluate('e=>e.scrollLeft')>=overflow-2,'Last table column unreachable by horizontal wheel'
   result['horizontalReachedLastColumn']=True
   page.mouse.wheel(-20000,0);page.wait_for_timeout(100)
  page.mouse.click(width-12,height//2);page.keyboard.press('Control+Home');page.keyboard.press('Meta+Home')
  for _ in range(15):page.mouse.wheel(0,-750);page.wait_for_timeout(30)
  before=page.get_by_test_id('daily-overall-config').bounding_box()['y']
  page.keyboard.press('PageDown');page.wait_for_timeout(250)
  after=page.get_by_test_id('daily-overall-config').bounding_box()['y']
  assert after<before-50,'PageDown cannot scroll report'
  if width==390:
   for _ in range(15):page.mouse.wheel(0,-750);page.wait_for_timeout(30)
   cdp=page.context.new_cdp_session(page);cdp.send('Emulation.setTouchEmulationEnabled',{'enabled':True,'maxTouchPoints':1})
   before=page.get_by_test_id('daily-overall-config').bounding_box()['y']
   for _ in range(25):
    cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':300,'y':700}]})
    for y in [650,550,450,350,250,150]:
     cdp.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[{'x':300,'y':y}]});page.wait_for_timeout(20)
    cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]});page.wait_for_timeout(60)
   box=item.bounding_box();after=page.get_by_test_id('daily-overall-config').bounding_box()['y']
   assert after<before-100 and box and 0<=box['y']<height-20,'Touch cannot reach pagination'
   result['touch']={'before':before,'after':after,'pagination':box};cdp.detach()
  result['keyboardPassed']=True
  (data/'scroll-evidence.json').write_text(json.dumps(evidence,indent=2))
  checks.append(f'{width}x{height} real wheel/PageDown reaches report pagination'+(' and CDP touch swipe' if width==390 else ''))
  for _ in range(20):page.mouse.wheel(0,-750);page.wait_for_timeout(30)
 page.set_viewport_size({'width':1600,'height':1000})
