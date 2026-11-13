import subprocess, time, re, os, shutil, threading, json
from http.server import BaseHTTPRequestHandler, HTTPServer
from playwright.sync_api import sync_playwright
shutil.rmtree('/tmp/kcui8', ignore_errors=True)
class H(BaseHTTPRequestHandler):
    def log_message(self,*a): pass
    def do_GET(self):
        p=self.path.split('?')[0]; o={'error':'nf'}; code=200
        if p=='/api/v1/courts': o={'courts':[{'folder':'CalHC','name':'Calcutta High Court','docs':1200},{'folder':'SCI','name':'Supreme Court of India','docs':900}]}
        elif p=='/api/v1/search': o={'ms':9,'more':False,'courts':['CalHC'],'results':[{'id':7,'folder':'CalHC','court':'Calcutta High Court','title':'Alpha v Beta','year':2020,'decision_date':'2020-05-01','judge':'X J','snip':'the <mark>limitation</mark> period'}]}
        elif p=='/api/v1/doc/CalHC/7': o={'doc':{'id':7,'folder':'CalHC','court':'Calcutta High Court','title':'Alpha v Beta','case_no':'WP 1/2020','body':'Full text about limitation.'}}
        else: code=404
        b=json.dumps(o).encode(); self.send_response(code); self.send_header('Content-Type','application/json'); self.end_headers(); self.wfile.write(b)
fk=HTTPServer(('127.0.0.1',3199),H); threading.Thread(target=fk.serve_forever,daemon=True).start()
subprocess.run(['node','build.js'], check=True)
env = dict(os.environ, DATA_DIR='/tmp/kcui8', PORT='3118', PUBLIC_URL='http://127.0.0.1:3118', SEARCH_URL='http://127.0.0.1:3199', SEARCH_API_KEY='k')
logf = open('/tmp/kcui8.log','w')
srv = subprocess.Popen(['node','server.js'], env=env, stdout=logf, stderr=subprocess.STDOUT); time.sleep(3)
toks = re.findall(r'/#/invite/(\w+)', open('/tmp/kcui8.log').read()); ad_tok = toks[1]
errors = []; base = 'http://127.0.0.1:3118/'
try:
  with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox','--headless=new'], timeout=30000)
    pg = b.new_page(viewport={'width':1280,'height':850}); pg.set_default_timeout(8000)
    pg.on('pageerror', lambda e: errors.append('PAGEERR '+str(e)))
    pg.on('console', lambda m: errors.append('CONSOLE '+m.text) if m.type=='error' and 'Failed to load resource' not in m.text else None)
    pg.goto(base+'#/invite/'+ad_tok); pg.wait_for_selector('#pf'); pg.fill('[name=p1]','StrongPass123'); pg.fill('[name=p2]','StrongPass123'); pg.click('#pf button')
    pg.wait_for_selector('#lf'); pg.fill('[name=email]','kclegal.in@gmail.com'); pg.fill('[name=password]','StrongPass123'); pg.click('#lf button'); pg.wait_for_selector('.side')
    pg.goto(base+'#/research?mode=caselaw'); pg.wait_for_selector('#cf'); assert 'CalHC' in pg.inner_text('#cc'), 'court chips'
    pg.click('#cc [data-f=CalHC]'); pg.fill('#cq','limitation'); pg.click('#cf button.btn'); pg.wait_for_selector('#cl')
    assert 'Alpha v Beta' in pg.inner_text('#cr') and pg.query_selector('#cl mark'), 'results with highlight'
    pg.screenshot(path='/tmp/ui8_results.png')
    pg.click('[data-o="CalHC/7"]'); pg.wait_for_selector('.modal a[href$="/docx"]'); assert 'Full text about limitation' in pg.inner_text('.modal'), 'judgment opens'
    assert pg.query_selector('.modal a[href$="/pdf"]'), 'pdf link'
    pg.screenshot(path='/tmp/ui8_doc.png')
    pg.click('#cjb'); pg.wait_for_timeout(600); pg.click('[data-x]')
    pg.goto(base+'#/research?mode=saved'); pg.wait_for_timeout(600); assert 'Alpha v Beta' in pg.inner_text('#view') and pg.query_selector('[data-j="CalHC/7"]'), 'bookmark with judgment link'
    sizes = pg.evaluate("(()=>{const s=new Set();document.querySelectorAll('#view *').forEach(e=>{if(!e.offsetParent)return;if([...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim()))s.add(getComputedStyle(e).fontSize)});return [...s]})()")
    print('font sizes', sizes)
    assert not errors, errors
    print('ui8 OK')
finally:
    srv.kill()
