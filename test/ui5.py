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
    # Mercury-style case page: red case number, registration line, next hearing, side cards, tabs, orders table
    import json
    ident = {'case_no':'Complaint Case No. 44 of 2019','case_date':'2019-02-05','reg_no':'Reg no. 44 of 2019','reg_date':'2019-02-11','filing_no':'Filing No: 330/2019','cnr':'WBPU030047982019','stage':'EVIDENCE','act':'IPC 138','next_date':'2027-03-25','court':'CJM Purulia','court_no':'16','item_no':'7','adv_p':['Krishnika Chatterjee'],'adv_r':['Opp Advocate'],'judges':['J.M. 1st Court'],'ias':['IA 1 of 2024 - stay'],'business':['24-10-2024 Evidence']}
    def mat(route):
        r = route.fetch(); d = r.json(); d['ident'] = ident; route.fulfill(response=r, body=json.dumps(d), content_type='application/json')
    def eco(route):
        route.fulfill(content_type='application/json', body=json.dumps({'linked':True,'ready':True,'cnr':'WBPU030047982019','fetched_at':'2026-11-11 10:00:00','fails':0,'brief':{},'archive':None,'orders':[{'date':'2024-10-24','next':'2025-02-13','summary':['Evidence fixed','Complainant absent'],'type':'Order','kind':'Interim order','file':'o4.pdf','url':'x'}]}))
    ad.route('**/api/matters/*/ecourt', eco)
    mid = ad.evaluate("(async()=>{const h={'Content-Type':'application/json','X-Requested-With':'kcportal'};const c=await fetch('/api/clients',{method:'POST',headers:h,body:JSON.stringify({name:'UI Test Client',phone:'9000000001'})}).then(r=>r.json());const m=await fetch('/api/matters',{method:'POST',headers:h,body:JSON.stringify({client_id:c.id,title:'Raja v. Badal',forum:'Chief Judicial Magistrate'})}).then(r=>r.json());return m.id})()")
    if mid:
        ad.route('**/api/matters/'+str(mid), mat)
        ad.goto(base+'#/matter/'+str(mid)); ad.wait_for_timeout(1200); t = ad.inner_text('body')
        red = ad.evaluate("getComputedStyle(document.querySelector('#view b[style*=c00000], main b[style*=c00000], b[style*=c00000]')).color")
        for need in ['Complaint Case No. 44 of 2019','Reg no. 44 of 2019','Listings','Orders','Evidence fixed','Krishnika Chatterjee','16']:
            ok_ = need in t; print(('ok   ' if ok_ else 'FAIL ')+'case page shows', repr(need)); (not ok_) and errors.append('casepage '+need)
        print(('ok   ' if red == 'rgb(192, 0, 0)' else 'FAIL ')+'case no colour', red)
        ntabs = ad.evaluate("Array.from(document.querySelectorAll('[data-mt]')).map(a=>a.textContent).join(',')")
        print(('ok   ' if ntabs == 'Listings,Orders,IA,History' else 'FAIL ')+'case tabs', ntabs); ntabs != 'Listings,Orders,IA,History' and errors.append('tabs '+ntabs)
        pos = ad.evaluate("(()=>{const h=[...document.querySelectorAll('h2')].map(x=>x.textContent.trim());return h.slice(-3).join('|')})()")
        print(('ok   ' if pos == 'Tasks|File notings|Files' else 'FAIL ')+'page ends with', pos); pos != 'Tasks|File notings|Files' and errors.append('order '+pos)
        ad.wait_for_selector('#fx .fx', timeout=8000); print('ok   files explorer present:', ad.evaluate("!!document.querySelector('#fx .fx-body')"))
        ad.wait_for_selector('#dcard #dform', timeout=8000); ad.fill('#dn', 'Client met; documents received'); ad.select_option('#dk', 'meeting'); ad.click('#dadd'); ad.wait_for_selector('#dlist .drow', timeout=5000)
        ad.select_option('#dk', 'notice_sent'); ad.fill('#dn', 'Notice sent by speed post'); ad.click('#dadd'); ad.wait_for_selector('#dlist .drow:nth-child(2)', timeout=5000)
        dtxt = ad.inner_text('#dcard'); okd = 'Reply due' in dtxt and 'Client met' in dtxt and 'Notice' in dtxt; print(('ok   ' if okd else 'FAIL ')+'case diary entries + reply clock:', okd); okd or errors.append('diary')
        ad.click('#dlist [data-a=up] >> nth=1'); ad.wait_for_timeout(600); first = ad.inner_text('#dlist .drow >> nth=0'); okm = 'Notice sent' in first; print(('ok   ' if okm else 'FAIL ')+'move entry up:', okm); okm or errors.append('diary move')
        ad.wait_for_selector('#dm', timeout=3000); print('ok   delete case button present')
        ad.goto(base+'#/matters'); ad.wait_for_selector('#add'); ad.click('#add'); ad.wait_for_selector('select[name=client_id]'); ad.wait_for_timeout(300); hid = ad.is_visible('input[name=new_client]'); ad.select_option('select[name=client_id]', '__new'); shown = ad.is_visible('input[name=new_client]')
        ad.fill('input[name=new_client]', 'Brand New Client'); ad.fill('input[name=title]', 'Case for new client'); ad.click('form.modal button:not(.ghost)'); ad.wait_for_url('**#/matter/*', timeout=8000); ad.wait_for_timeout(1000); okn = (not hid) and shown and 'Brand New Client' in ad.inner_text('body'); print(('ok   ' if okn else 'FAIL ')+'add case with a new client from the drop-down:', okn); okn or errors.append('new client in case')
        ad.wait_for_selector('#mvcard .chip', timeout=8000); mt = ad.inner_text('#mvcard'); print(('ok   ' if 'File is with' in mt and ad.is_visible('#mm') else 'FAIL ')+'move card:', mt.replace(chr(10),' | ')[:80]); ('File is with' in mt) or errors.append('move card')
        ad.wait_for_selector('#tcard .chip', timeout=8000); txt = ad.inner_text('#tcard'); print(('ok   ' if 'My access: Full' in txt and 'Case team' in txt else 'FAIL ')+'team card:', txt.replace(chr(10),' | ')[:120]); ('My access: Full' in txt and 'Case team' in txt) or errors.append('team card')
        ad.click('#tm'); ad.wait_for_selector('[data-tu]', timeout=5000); n = ad.evaluate("document.querySelectorAll('[data-tu]').length"); print(('ok   ' if n >= 1 else 'FAIL ')+'assign dialog lists people:', n); n >= 1 or errors.append('assign dialog'); ad.click('#tx')
        ad.set_viewport_size({'width': 390, 'height': 800}); ad.wait_for_timeout(300); qb = ad.evaluate("getComputedStyle(document.querySelector('.qbar')).display"); print(('ok   ' if qb == 'flex' else 'FAIL ')+'phone action bar shown:', qb); qb == 'flex' or errors.append('qbar'); ad.set_viewport_size({'width': 1280, 'height': 800})
        ad.screenshot(path='/tmp/ui5_case.png', full_page=True)
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
