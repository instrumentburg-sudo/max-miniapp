"""Offline booking hint and unchanged quote. Usage: python3 tests/loyalty-booking.py /artifacts."""
import sys,mimetypes
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright,expect
web=Path(__file__).resolve().parents[2]/'mono/apps/self-service/web'
out=Path(sys.argv[1]);out.mkdir(exist_ok=True,parents=True)
with sync_playwright() as p:
 b=p.chromium.launch()
 for width in [390,1440]:
  for case in ['site','unknown','off','eligible','blocked']:
   c=b.new_context(viewport={'width':width,'height':950})
   if case!='site':c.add_init_script("window.WebApp={initData:'auth_date='+Math.floor(Date.now()/1000)+'&user=%7B%22id%22%3A7%7D&hash=fixture',ready(){},BackButton:{show(){},hide(){},onClick(){},offClick(){}}}")
   calls=[];errors=[]
   def route(r):
    path=urlparse(r.request.url).path
    if path=='/max-api/cvx/api/max/loyalty':calls.append(path);r.fulfill(json={'enabled':case!='off','linked':True,'eligible':case=='eligible'});return
    if path=='/max-api/catalog':r.fulfill(json={'catalogVersion':3,'items':[{'id':42,'name':'Тестовый перфоратор','deposit':3000,'pricePerDay':600,'article':'42','category':'Перфораторы','image':None}]});return
    if path=='/api/intake/quote':r.fulfill(json={'product_name':'Тестовый перфоратор','days':1,'rent':600,'deposit':3000});return
    if path=='/api/intake/max-session':r.fulfill(json={**({'loyalty_enabled':case!='off'} if case!='unknown' else {}),'phone':'79990000000','first_name':'Тест'});return
    if path=='/passport/status':r.fulfill(json={'commit_enabled':False});return
    f=web/path.lstrip('/')
    if f.is_file():r.fulfill(body=f.read_bytes(),content_type=mimetypes.guess_type(str(f))[0] or 'application/octet-stream');return
    r.fulfill(body='')
   c.route('**/*',route);page=c.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
   page.goto('https://zayavka.instrumentburg.ru/rent.html?product=42');expect(page.locator('#quote')).to_contain_text('600 ₽');expect(page.locator('#quote')).to_contain_text('3 000 ₽')
   if case=='eligible':
    expect(page.locator('#rental-loyalty-hint')).to_be_visible()
    expect(page.locator('#rental-loyalty-hint')).to_contain_text('Право рассчитано автоматически по истории аренд')
    expect(page.locator('#rental-loyalty-hint')).to_contain_text('сотрудник проверит стоимость техники')
    expect(page.locator('#rental-loyalty-hint')).not_to_contain_text('подтвердит сотрудник')
   else:expect(page.locator('#rental-loyalty-hint')).to_have_count(0)
   if case in ['site','off','unknown']:assert not calls
   else:assert calls
   assert not errors,errors
   assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
   page.screenshot(path=str(out/f'booking-{width}-{case}.png'),full_page=True);print('PASS booking',width,case);c.close()
 b.close()
