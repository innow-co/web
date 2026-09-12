'use strict';
const {test,after}=require('node:test');
const assert=require('node:assert/strict');
const handler=require('../api/download');
const originalFetch=global.fetch;
const originalEnv={RESEND_API_KEY:process.env.RESEND_API_KEY,LEAD_RECIPIENT_EMAIL:process.env.LEAD_RECIPIENT_EMAIL,LEAD_FROM_EMAIL:process.env.LEAD_FROM_EMAIL};
after(()=>{global.fetch=originalFetch;for(const[k,v]of Object.entries(originalEnv)){if(v===undefined)delete process.env[k];else process.env[k]=v;}});
const body={name:'ผู้ทดสอบ',email:'preview@example.com',phone:'0812345678',position:'HR Manager',organization:'Example Company',interest:'Secure Coding'};
function request(overrides={}){return {method:'POST',headers:{host:'innow.example',origin:'https://innow.example','content-type':'application/json','idempotency-key':'12345678-1234-1234-1234-123456789abc'},body:{...body},...overrides};}
async function call(req){const res={code:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(v){this.data=v;return this;}};await handler(req,res);return res;}
function configure(){process.env.RESEND_API_KEY='test-key';process.env.LEAD_RECIPIENT_EMAIL='owner@example.com';process.env.LEAD_FROM_EMAIL='website@example.com';}
test('rejects unsupported methods',async()=>{const r=await call(request({method:'GET'}));assert.equal(r.code,405);assert.equal(r.headers.Allow,'POST');});
test('rejects cross-origin requests',async()=>{const r=await call(request({headers:{host:'innow.example',origin:'https://elsewhere.example'}}));assert.equal(r.code,403);});
test('requires all five fields and validates email and phone',async()=>{for(const bad of [{position:''},{name:'  '},{email:'invalid'},{phone:'--------'},{name:'line\nbreak'}]){const r=await call(request({body:{...body,...bad}}));assert.equal(r.code,400);}});
test('rejects malformed JSON and honeypot',async()=>{assert.equal((await call(request({body:'{bad'}))).code,400);assert.equal((await call(request({body:{...body,website:'spam'}}))).code,400);});
test('fails honestly without provider configuration',async()=>{delete process.env.RESEND_API_KEY;assert.equal((await call(request())).code,503);});
test('sends all five fields to the configured owner, with reply-to and idempotency',async()=>{configure();let sent;global.fetch=async(url,options)=>{sent={url,...options};return {ok:true,json:async()=>({id:'mock-email-id'})};};const r=await call(request());assert.equal(r.code,200);assert.equal(r.data.ok,true);const payload=JSON.parse(sent.body);assert.deepEqual(payload.to,['owner@example.com']);assert.equal(payload.reply_to,body.email);for(const field of Object.values(body))assert.ok(payload.text.includes(field));assert.match(sent.headers['Idempotency-Key'],/^innow-/);assert.equal(sent.url,'https://api.resend.com/emails');});
test('does not report success when provider rejects or returns no ID',async()=>{configure();for(const result of [{ok:false,json:async()=>({error:'no'})},{ok:true,json:async()=>({})}]){global.fetch=async()=>result;assert.equal((await call(request())).code,502);}});
test('handles network failure without disclosing credentials',async()=>{configure();global.fetch=async()=>{throw new Error('sensitive provider error');};const r=await call(request());assert.equal(r.code,502);assert.ok(!JSON.stringify(r.data).includes('sensitive'));});
