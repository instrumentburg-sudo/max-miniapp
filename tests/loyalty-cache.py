"""Real browser HTTP cache, local server only. Old cached pair -> fresh HTML -> new pair."""
import json,mimetypes,subprocess,sys,threading
from collections import Counter
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright,expect
root=Path(__file__).resolve().parents[2]
web=root/'mono/apps/self-service/web';out=Path(sys.argv[1]);out.mkdir(exist_ok=True,parents=True)
version='20261002loyalty4'
old={name:subprocess.check_output(['git','-C',str(root/'mono'),'show','6ddaafce:apps/self-service/web/assets/'+name]) for name in ['max.js','rent.js']}
state={'new':False,'enabled':False,'sync':False};requests=[]
class Handler(BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def send(self,body,typ='application/json',cache='no-store',status=200):
  if not isinstance(body,bytes):body=json.dumps(body,ensure_ascii=False).encode()
  self.send_response(status);self.send_header('Content-Type',typ);self.send_header('Cache-Control',cache);self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
 def do_GET(self):
  path=urlparse(self.path).path;requests.append(('GET',self.path))
  if path=='/max-api/catalog':return self.send({'catalogVersion':3,'items':[{'id':42,'name':'Тестовый перфоратор','deposit':3000,'pricePerDay':600,'article':'42','category':'Перфораторы','image':None}]})
  if path=='/api/intake/quote':return self.send({'product_name':'Тестовый перфоратор','days':1,'rent':600,'deposit':3000})
  if path=='/passport/status':return self.send({'commit_enabled':False})
  f=web/path.lstrip('/')
  if not f.is_file():return self.send(b'',status=404)
  data=f.read_bytes()
  if f.name=='rent.html' and not state['new']:
   data=data.replace(('assets/max.js?v='+version).encode(),b'assets/max.js?v=20261001max3').replace(('assets/rent.js?v='+version).encode(),b'assets/rent.js?v=20261001deposit5')
  if f.name in old and version not in self.path:data=old[f.name]
  return self.send(data,mimetypes.guess_type(str(f))[0] or 'application/octet-stream','no-cache' if f.suffix=='.html' else 'max-age=604800, public')
 def do_POST(self):
  requests.append(('POST',self.path));json.loads(self.rfile.read(int(self.headers.get('Content-Length',0))) or b'{}')
  if self.path=='/api/intake/max-session':return self.send({'phone':'79990000000','first_name':'Тест','loyalty_enabled':state['enabled']})
  if self.path=='/max-api/cvx/api/max/loyalty':return self.send({'enabled':state['enabled'],'linked':state['sync'],'eligible':state['enabled'] and state['sync']})
  return self.send({},status=404)
server=ThreadingHTTPServer(('127.0.0.1',0),Handler);threading.Thread(target=server.serve_forever,daemon=True).start()
url=f'http://127.0.0.1:{server.server_port}/rent.html?product=42'
try:
 with sync_playwright() as p:
  b=p.chromium.launch()
  for width in [390,1440]:
   for sync,show in [(False,False),(True,False),(True,True),(False,True)]:
    state.update(new=False,enabled=show,sync=sync);requests.clear()
    c=b.new_context(viewport={'width':width,'height':950});c.add_init_script("window.WebApp={initData:'auth_date='+Math.floor(Date.now()/1000)+'&user=%7B%22id%22%3A7%7D&hash=fixture',ready(){},BackButton:{show(){},hide(){},onClick(){},offClick(){}}}")
    page=c.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    # No route interception: Playwright routing disables browser HTTP cache.
    for _ in range(2):
     page.goto(url,wait_until='networkidle');expect(page.locator('#quote')).to_contain_text('600 ₽')
    old_counts=Counter(path for method,path in requests if method=='GET' and (path.startswith('/assets/max.js?') or path.startswith('/assets/rent.js?')))
    assert old_counts=={'/assets/max.js?v=20261001max3':1,'/assets/rent.js?v=20261001deposit5':1},old_counts
    assert not any('/loyalty' in path for method,path in requests)
    state['new']=True;requests.clear()
    page.goto(url,wait_until='networkidle');expect(page.locator('#quote')).to_contain_text('3 000 ₽')
    pair=[path for method,path in requests if method=='GET' and (path.startswith('/assets/max.js?') or path.startswith('/assets/rent.js?'))]
    assert set(pair)=={f'/assets/max.js?v={version}',f'/assets/rent.js?v={version}'},pair
    loyalty=[path for method,path in requests if method=='POST' and '/loyalty' in path]
    if show:assert len(loyalty)==1
    else:assert not loyalty
    if sync and show:expect(page.locator('#rental-loyalty-hint')).to_be_visible()
    else:expect(page.locator('#rental-loyalty-hint')).to_have_count(0)
    assert len([1 for method,path in requests if method=='POST' and path=='/api/intake/max-session'])==1
    assert not errors,errors
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    page.screenshot(path=str(out/f'cache-{width}-{int(sync)}-{int(show)}.png'),full_page=True)
    print(json.dumps({'width':width,'sync':sync,'show':show,'old_pair_cached':True,'new_pair':pair,'loyalty_posts':len(loyalty),'errors':errors}));c.close()
  b.close()
finally:server.shutdown()
