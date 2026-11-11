import subprocess, time, re, os, shutil
from playwright.sync_api import sync_playwright
shutil.rmtree('/tmp/kcui5', ignore_errors=True)
subprocess.run(['node','build.js'], check=True)
env = dict(os.environ, DATA_DIR='/tmp/kcui5', PORT='3112', PUBLIC_URL='http://127.0.0.1:3112')
logf = open('/tmp/kcui5.log','w')
srv = subprocess.Popen(['node','server.js'], env=env, stdout=logf, stderr=subprocess.STDOUT); time.sleep(3)
toks = re.findall(r'/#/invite/(\w+)', open('/tmp/kcui5.log').read())
sa_tok, ad_tok = toks[0], toks[1]
errors = []; base = 'http://127.0.0.1:3112/'
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
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox','--headless=new'], timeout=30000)
    ad = setup(b, ad_tok, 'kclegal.in@gmail.com')
    print('firm home:', ad.inner_text('.hero-hi'), '|', ad.inner_text('#hc'), '|', ad.inner_text('#hw')[:60].replace('\n',' '))
    ad.screenshot(path='/tmp/ui5_home.png')
    firm_pages = ['','clients','matters','tasks','letters','dak','messages','leads','appointments','billing/invoices','billing/payments','billing/cash','billing/bank','billing/reports','judgments','team','settings','account','calendar','files','plan','template','draft','mail','chats','ecourts','causelist','ai','storage','courtdata','fcfg/1','journal']
    for h in firm_pages:
        ad.goto(base+'#/'+h); ad.wait_for_timeout(450)
        t = ad.inner_text('body'); bad = 'Something went wrong' in t
        print(('FAIL ' if bad else 'ok   ')+'firm #/'+h, '|', (ad.inner_text('h1')[:34] if ad.query_selector('h1') else '(no h1)'))
    ad.goto(base+'#/settings'); ad.wait_for_timeout(500); t = ad.inner_text('body')
    print('settings: access card', 'Who can use what' in t, '| whatsapp card', 'WhatsApp to clients' in t, '| reminders card', 'Automatic payment reminders' in t)
    ad.screenshot(path='/tmp/ui5_settings.png', full_page=True)
    nav = ad.inner_text('.side'); print('nav has AI Control/Court data:', 'AI Control' in nav, 'Court data' in nav)
    src = ad.evaluate("Array.from(document.scripts).map(s=>s.src).join(' ')"); print('scripts loaded:', src.replace(base,'/')[:300])
    # Super Admin
    sa = setup(b, sa_tok, 'consultbanerjee@gmail.com'); sa.wait_for_timeout(500)
    print('SA home:', sa.inner_text('h1'), '| nav:', sa.inner_text('.side').replace('\n',' / ')[:120])
    sa.screenshot(path='/tmp/ui5_sa.png', full_page=True)
    for h in ['firms','firms?tab=services','firms?tab=usage','firms?tab=billing','firms?tab=settings','fcfg/1','fcfg/1?tab=claude','fcfg/1?tab=mail','fcfg/1?tab=chat','fcfg/1?tab=court','fcfg/1?tab=wa','fcfg/1?tab=rem','fcfg/1?tab=drive','fcfg/1?tab=args','fcfg/1?tab=cal','journal','journal?tab=built','journal?tab=costs','journal?tab=operate','journal?tab=security','journal?tab=history','journal?tab=notes','account','clients']:
        sa.goto(base+'#/'+h); sa.wait_for_timeout(500)
        t = sa.inner_text('body'); bad = 'Something went wrong' in t
        print(('FAIL ' if bad else 'ok   ')+'SA #/'+h, '|', (sa.inner_text('h1')[:34] if sa.query_selector('h1') else '(no h1)'))
    for tab, must in [('', 'What this portal is'), ('built', 'Technology'), ('costs', 'Cost register'), ('operate', 'Add a new law firm'), ('security', 'Code is not handed out'), ('history', 'Release history'), ('notes', "Owner's notes")]:
        sa.goto(base+'#/journal?tab='+tab if tab else base+'#/journal'); sa.wait_for_timeout(700)
        t = sa.inner_text('body'); print(('ok   ' if must in t else 'FAIL ')+'Journal tab', tab or 'overview', 'shows', repr(must))
        if must not in t: errors.append('journal '+tab)
    sa.goto(base+'#/fcfg/1?tab=claude'); sa.wait_for_timeout(500); sa.screenshot(path='/tmp/ui5_cfg.png', full_page=True)
    sa.goto(base+'#/journal'); sa.wait_for_timeout(500); sa.screenshot(path='/tmp/ui5_journal.png', full_page=True)
    b.close()
srv.terminate()
print('JS errors:', errors or 'none')
