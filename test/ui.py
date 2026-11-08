import subprocess, time, re, os, sys, json
from playwright.sync_api import sync_playwright
env = dict(os.environ, DATA_DIR='/tmp/kcui', PORT='3111', PUBLIC_URL='http://127.0.0.1:3111')
logf = open('/tmp/kcui_server.log','w')
srv = subprocess.Popen(['node','server.js'], env=env, stdout=logf, stderr=subprocess.STDOUT)
time.sleep(2.5)
out = open('/tmp/kcui_server.log').read()
tok = re.search(r'/#/invite/(\w+)', out).group(1)
errors = []
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox','--headless=new'], timeout=30000)
    pg = b.new_page(viewport={'width':1200,'height':800}); pg.set_default_timeout(8000)
    pg.on('pageerror', lambda e: errors.append('PAGEERR '+str(e)))
    pg.on('console', lambda m: errors.append('CONSOLE '+m.text) if m.type=='error' else None)
    base='http://127.0.0.1:3111/'
    pg.goto(base+'#/invite/'+tok); pg.wait_for_selector('#pf')
    pg.fill('[name=p1]','StrongPass123'); pg.fill('[name=p2]','StrongPass123'); pg.click('#pf button')
    pg.wait_for_selector('#lf')
    pg.fill('[name=email]','consultbanerjee@gmail.com'); pg.fill('[name=password]','StrongPass123'); pg.click('#lf button')
    pg.wait_for_selector('.side'); print('logged in:', pg.inner_text('h1'))
    pg.screenshot(path='/tmp/ui_home.png')
    # create client, matter
    pg.goto(base+'#/clients'); pg.click('#add'); pg.fill('[name=name]','Test Client'); pg.fill('[name=phone]','9830000000'); pg.fill('[name=email]','tc@example.com'); pg.click('.modal .btn:not(.ghost)')
    pg.wait_for_selector('h1:has-text("Test Client")'); print('client page ok')
    pg.click('#nm'); pg.fill('[name=title]','Test v. Bank'); pg.fill('[name=forum]','Calcutta High Court'); pg.click('.modal .btn:not(.ghost)')
    pg.wait_for_selector('h1:has-text("Test v. Bank")'); print('matter page ok')
    pg.click('#ah'); pg.fill('[name=purpose]','Admission'); pg.fill('[name=next_date]','2099-02-02'); pg.click('.modal .btn:not(.ghost)')
    pg.wait_for_selector('td:has-text("Admission")'); print('hearing ok')
    pg.screenshot(path='/tmp/ui_matter.png', full_page=True)
    # every nav page renders without error
    for h in ['','clients','matters','tasks','letters','dak','messages','leads','appointments','billing/invoices','billing/payments','billing/cash','billing/bank','billing/reports','judgments','team','settings','account','book']:
        pg.goto(base+'#/'+h); pg.wait_for_timeout(350)
        txt = pg.inner_text('body')
        bad = 'Something went wrong' in txt or 'not found' in txt.lower() and h!='' 
        print(('FAIL ' if bad else 'ok   ')+h, '|', pg.inner_text('h1')[:30] if pg.query_selector('h1') else '(no h1)')
    # mobile screenshot
    m = b.new_page(viewport={'width':390,'height':780}); m.goto(base); 
    m.context.add_cookies(pg.context.cookies()); m.goto(base+'#/matters'); m.wait_for_timeout(500); m.screenshot(path='/tmp/ui_mobile.png')
    pg2 = b.new_page(); pg2.on('pageerror', lambda e: errors.append('PAGEERR '+str(e)))
    pg2.goto(base+'#/book'); pg2.wait_for_timeout(500); pg2.screenshot(path='/tmp/ui_book.png')
    b.close()
srv.terminate()
print('JS errors:', errors or 'none')
