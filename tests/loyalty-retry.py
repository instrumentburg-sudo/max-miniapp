"""Offline regression: eligible -> 503 -> pending retry -> denied. No stale promise."""
import sys,mimetypes
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright,expect
root=Path(__file__).resolve().parents[1]
out=Path(sys.argv[1]);out.mkdir(exist_ok=True,parents=True)
with sync_playwright() as p:
 b=p.chromium.launch()
 for base,dist in [('max-app','dist'),('cabinet','dist-cabinet')]:
  for width in [390,1440]:
   c=b.new_context(viewport={'width':width,'height':950})
   c.add_init_script("window.WebApp={initData:'auth_date='+Math.floor(Date.now()/1000)+'&user=%7B%22id%22%3A7%7D&hash=fixture',ready(){},BackButton:{show(){},hide(){},onClick(){},offClick(){}}}")
   calls=[];pending=[];errors=[]
   data={'enabled':True,'linked':True,'completed_rentals':3,'eligible':True,'blocking_reasons':[],'history_complete':True,'checked_at':1790899200000,'rule_version':'v1','history':[]}
   def route(r):
    path=urlparse(r.request.url).path
    if '/api/max/loyalty' in path:
     calls.append(path)
     if len(calls)==1:r.fulfill(json=data)
     elif len(calls)==2:r.fulfill(status=503,json={'error':'unavailable'})
     else:pending.append(r)
     return
    if '/api/max/orders' in path:r.fulfill(json={'loyalty_enabled':True,'linked':True,'orders':[]});return
    if '/api/intake/max-list' in path:r.fulfill(json={'requests':[]});return
    if path.startswith('/'+base+'/'):
     f=root/dist/path.removeprefix('/'+base+'/')
     if not f.is_file():f=root/dist/'index.html'
     r.fulfill(body=f.read_bytes(),content_type=mimetypes.guess_type(str(f))[0] or 'application/octet-stream');return
    r.fulfill(body='')
   c.route('**/*',route);page=c.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
   page.goto(f'https://fixture.test/{base}/orders');card=page.locator('.loyalty')
   expect(card).to_contain_text('С 4-й аренды — без залога.')
   card.get_by_role('button',name='Обновить данные',exact=True).click()
   expect(card).to_contain_text('Не удалось обновить данные')
   expect(card).not_to_contain_text('С 4-й аренды — без залога.')
   card.get_by_role('button',name='Обновить данные',exact=True).click()
   expect(card.get_by_role('button',name='Обновляем данные…')).to_be_disabled()
   expect(card).to_contain_text('Не удалось обновить данные')
   expect(card).not_to_contain_text('С 4-й аренды — без залога.')
   page.screenshot(path=str(out/f'{base}-{width}-pending-retry.png'),full_page=True)
   assert len(calls)==3 and len(pending)==1
   pending[0].fulfill(json={**data,'eligible':False,'blocking_reasons':['Есть задолженность']})
   expect(card).to_contain_text('Есть задолженность')
   expect(card).not_to_contain_text('С 4-й аренды — без залога.')
   expect(card).not_to_contain_text('Не удалось обновить данные')
   assert not errors,errors
   assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
   print('PASS stale retry',base,width);c.close()
 b.close()
