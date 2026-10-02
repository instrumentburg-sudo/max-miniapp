"""Offline 390/1440 tests. Usage: python3 tests/loyalty-browser.py /artifacts."""
import sys, mimetypes
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect
root = Path(__file__).resolve().parents[1]
out = Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
with sync_playwright() as p:
 browser = p.chromium.launch()
 for base, dist in [('max-app', 'dist'), ('cabinet', 'dist-cabinet')]:
  for width in [390,1440]:
   for case in ['off','two','eligible','blocked','ambiguous','error']:
    ctx = browser.new_context(viewport={'width':width,'height':950})
    ctx.add_init_script("window.WebApp={initData:'auth_date='+Math.floor(Date.now()/1000)+'&user=%7B%22id%22%3A7%7D&hash=fixture',ready(){},BackButton:{show(){},hide(){},onClick(){},offClick(){}}}")
    errors=[]
    def route(r):
     path=urlparse(r.request.url).path
     if '/api/max/loyalty' in path:
      assert r.request.post_data_json['initData']
      data={'enabled':True,'linked':True,'completed_rentals':2 if case=='two' else 3,'eligible':case=='eligible','blocking_reasons':['Нужна сверка задолженности'] if case=='blocked' else [],'history_complete':False,'checked_at':1790899200000,'rule_version':'v1','history':[{'order_id':'old-outside-search','closed_at':'2025-07-01','rental_amount_kopecks':120000,'completed':True,'reasons':[]}]}
      if case=='off': data={'enabled':False}
      if case=='ambiguous':data.update(completed_rentals=0,eligible=False,history=[],blocking_reasons=['Телефон связан с несколькими клиентами. Нужна проверка сотрудника.'])
      r.fulfill(status=503 if case=='error' else 200,json=data);return
     if '/api/max/orders' in path:r.fulfill(json={'linked':True,'orders':[{'number':'A12345','kind':'repair','title':'Тестовая дрель','status':'В ремонте','deadline':None,'sum':1000}]});return
     if '/api/intake/max-list' in path:r.fulfill(json={'requests':[]});return
     if path.startswith('/'+base+'/'):
      f=root/dist/path.removeprefix('/'+base+'/')
      if not f.is_file():f=root/dist/'index.html'
      r.fulfill(body=f.read_bytes(),content_type=mimetypes.guess_type(str(f))[0] or 'application/octet-stream');return
     r.fulfill(body='',status=200)
    ctx.route('**/*',route)
    page=ctx.new_page();page.on('pageerror',lambda e: errors.append(str(e)))
    page.goto(f'https://fixture.test/{base}/orders');page.get_by_text('Тестовая дрель',exact=True).wait_for()
    card=page.locator('.loyalty')
    if case in ['off','error']:expect(card).to_have_count(0)
    else:
     expect(card).to_be_visible();expect(card).to_contain_text('История неполная')
     expect(card).to_contain_text('Завершено аренд: '+str(2 if case=='two' else 0 if case=='ambiguous' else 3)+' из 3')
     card.locator('summary').click()
     if case=='ambiguous':expect(card).to_contain_text('Записей об арендах в реестре пока нет')
     else:expect(card).to_contain_text('1 200 ₽')
     if case=='eligible':expect(card).to_contain_text('С 4-й аренды — без залога (подтвердит сотрудник)')
     if case=='blocked':expect(card).to_contain_text('Нужна сверка задолженности')
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    assert not errors,errors
    page.screenshot(path=str(out/f'{base}-{width}-{case}.png'),full_page=True)
    print('PASS',base,width,case)
    ctx.close()
 browser.close()
