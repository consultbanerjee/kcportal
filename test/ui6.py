import subprocess, time, re, os, shutil
from playwright.sync_api import sync_playwright
shutil.rmtree('/tmp/kcui6', ignore_errors=True)
subprocess.run(['node','build.js'], check=True)
env = dict(os.environ, DATA_DIR='/tmp/kcui6', PORT='3116', PUBLIC_URL='http://127.0.0.1:3116')
logf = open('/tmp/kcui6.log','w')
srv = subprocess.Popen(['node','server.js'], env=env, stdout=logf, stderr=subprocess.STDOUT); time.sleep(3)
toks = re.findall(r'/#/invite/(\w+)', open('/tmp/kcui6.log').read())
sa_tok, ad_tok = toks[0], toks[1]
errors = []; base = 'http://127.0.0.1:3116/'
def setup(b, tok, email):
    pg = b.new_page(viewport={'width':1280,'height':850}); pg.set_default_timeout(8000)
    pg.on('pageerror', lambda e: errors.append(email+' PAGEERR '+str(e)))
    pg.on('console', lambda m: errors.append(email+' CONSOLE '+m.text) if m.type=='error' and 'Failed to load resource' not in m.text else None)
    pg.goto(base+'#/invite/'+tok); pg.wait_for_selector('#pf'); pg.fill('[name=p1]','StrongPass123'); pg.fill('[name=p2]','StrongPass123'); pg.click('#pf button')
    pg.wait_for_selector('#lf'); pg.fill('[name=email]',email); pg.fill('[name=password]','StrongPass123'); pg.click('#lf button')
    try: pg.wait_for_selector('.side')
    except Exception:
        pg.screenshot(path='/tmp/ui5_fail.png'); print('LOGIN FAIL', email, pg.inner_text('body')[:300], pg.evaluate("fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json','X-Requested-With':'kcportal'},body:JSON.stringify({email:'"+email+"',password:'StrongPass123'})}).then(async r=>r.status+' '+await r.text())")); print(errors); raise
    return pg
SIZES = "(()=>{const s={};document.querySelectorAll('body *').forEach(e=>{if(!e.offsetParent&&e.tagName!=='BODY')return;if(e.closest('.sheet,.letter,.paper-print'))return;const t=[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim());if(!t)return;const f=getComputedStyle(e).fontSize;s[f]=(s[f]||0)+1;});return s;})()"
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox','--headless=new'], timeout=30000)
    ad = setup(b, ad_tok, 'kclegal.in@gmail.com')
    ad.wait_for_selector('.qod .qt'); print('quote:', ad.inner_text('.qod')[:90])
    ad.screenshot(path='/tmp/ui6_home.png')
    assert ad.query_selector('.rbox'), 'research box on dashboard'
    bad = {}
    for h in ['','clients','matters','tasks','letters','research?mode=ask','research?mode=keyword','judgments','team','settings','activity','billing/invoices','calendar','files']:
        ad.goto(base+'#/'+h); ad.wait_for_timeout(500)
        if 'Something went wrong' in ad.inner_text('body'): print('FAIL page', h)
        sz = ad.evaluate(SIZES)
        off = {k: v for k, v in sz.items() if k not in ('10px','12px','14px')}
        if off: bad[h] = off
    print('font sizes outside 10/12/14:', bad if bad else 'none')
    ad.goto(base+'#/research?mode=keyword&q=cheque'); ad.wait_for_timeout(500); ad.screenshot(path='/tmp/ui6_research.png')
    ad.goto(base+'#/team'); ad.wait_for_timeout(700); ad.screenshot(path='/tmp/ui6_team.png')
    sa = setup(b, sa_tok, 'consultbanerjee@gmail.com'); sa.wait_for_selector('.qod .qt', timeout=6000); print('SA quote ok')
    sa.screenshot(path='/tmp/ui6_sa.png')
    b.close()
srv.terminate()
print('JS errors:', errors if errors else 'none')
