'use strict';
const fs=require('fs'),os=require('os'),path=require('path');
process.env.DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'kcl-'));process.env.PUBLIC_URL='https://portal.kclegal.us';
const app=require('../server');const {db}=require('../db');
const srv=app.listen(0),base='http://127.0.0.1:'+srv.address().port;let pass=0,fail=0;const ok=(c,m)=>{if(c)pass++;else{fail++;console.log('FAIL',m)}};
const post=async(u,b)=>{const r=await fetch(base+u,{method:'POST',headers:{'Content-Type':'application/json','X-Requested-With':'kcportal'},body:JSON.stringify(b)});return{s:r.status,j:await r.json().catch(()=>({}))}};
(async()=>{
 const tok=db.prepare("SELECT invite_token t FROM users WHERE role='admin' AND email='kclegal.in@gmail.com'").get().t;
 await post('/api/invite/'+tok,{password:'StrongPass123'});
 const cred={email:'kclegal.in@gmail.com',password:'StrongPass123'};
 let r=await post('/api/login',{...cred,as:'client'});ok(r.s===403&&/Administrator Login/.test(r.j.error),'admin refused on the client page: '+r.j.error);
 r=await post('/api/login',{...cred,as:'firm'});ok(r.s===403,'admin refused on the law firm page');
 r=await post('/api/login',{...cred,as:'admin'});ok(r.s===200,'admin accepted on the admin page');
 r=await post('/api/login',cred);ok(r.s===200,'plain login still works');
 console.log(pass+' passed, '+fail+' failed');srv.close();process.exit(fail?1:0)})();
