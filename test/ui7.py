import subprocess, time, re, os, shutil
from playwright.sync_api import sync_playwright
shutil.rmtree('/tmp/kcui7', ignore_errors=True)
subprocess.run(['node','build.js'], check=True)
env = dict(os.environ, DATA_DIR='/tmp/kcui7', PORT='3117', PUBLIC_URL='http://127.0.0.1:3117')
logf = open('/tmp/kcui7.log','w')
srv = subprocess.Popen(['node','server.js'], env=env, stdout=logf, stderr=subprocess.STDOUT); time.sleep(3)
toks = re.findall(r'/#/invite/(\w+)', open('/tmp/kcui7.log').read())
sa_tok, ad_tok = toks[0], toks[1]
errors = []; base = 'http://127.0.0.1:3117/'
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
    ad.screenshot(path='/tmp/ui7_home.png')
    assert ad.query_selector('.rbox'), 'research box on dashboard'
    ad.screenshot(path='/tmp/ui7_home.png')
    assert 'at a glance' in ad.inner_text('#view'), 'usage card on dashboard'
    r = ad.evaluate("""async()=>{const h={'Content-Type':'application/json','X-Requested-With':'kcportal'};const c=await (await fetch('/api/clients',{method:'POST',headers:h,body:JSON.stringify({name:'UI Client',phone:'9000000001'})})).json();const m=await (await fetch('/api/matters',{method:'POST',headers:h,body:JSON.stringify({client_id:c.id,title:'UI label case'})})).json();await fetch('/api/matters/'+m.id+'/labels',{method:'PUT',headers:h,body:JSON.stringify({labels:['ROC','Urgent']})});await fetch('/api/team/settings',{method:'PUT',headers:h,body:JSON.stringify({advocate:['research']})});return m.id}""")
    ad.goto(base+'#/matters'); ad.wait_for_selector('#lbar .chip'); assert 'ROC' in ad.inner_text('#res'), 'label shown in list'
    ad.click('#lbar [data-l=Urgent]'); ad.wait_for_timeout(400); assert 'UI label case' in ad.inner_text('#res'), 'filter keeps case'
    ad.click('#lbar [data-l=""]') if False else None
    ad.screenshot(path='/tmp/ui7_matters.png')
    ad.goto(base+'#/matter/%s' % r); ad.wait_for_selector('#mlb'); assert 'Urgent' in ad.inner_text('#mlb') and ad.query_selector('#elb'), 'labels on case page'
    ad.screenshot(path='/tmp/ui7_case.png')
    ad.goto(base+'#/research?mode=saved'); ad.wait_for_timeout(600); assert 'Nothing saved yet' in ad.inner_text('#view'), 'saved tab'
    ad.evaluate("fetch('/api/research/saved',{method:'POST',headers:{'Content-Type':'application/json','X-Requested-With':'kcportal'},body:JSON.stringify({title:'Sample judgment',kind:'Judgment',note:'check later'})})")
    ad.goto(base+'#/research?mode=keyword'); ad.goto(base+'#/research?mode=saved'); ad.wait_for_timeout(600); assert 'Sample judgment' in ad.inner_text('#view') and 'check later' in ad.inner_text('#view'), 'saved item listed'
    ad.screenshot(path='/tmp/ui7_saved.png')
    print('ui7 errors:', errors if errors else 'none')
    b.close(); srv.terminate()
