// All code and git refs are local. Actual dispatchers, network-only spies.
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),cp=require('child_process');
const mini=path.resolve(__dirname,'..'), mono=path.resolve(process.argv[2]);
const ts=require(path.join(mono,'apps/calculator/node_modules/typescript'));
function handler(ref, module='maxWebhook', member='handleMaxWebhookUpdate') {
 const cache=new Map();
 function load(file) {
  file=path.resolve(file)+'.ts'; if(cache.has(file))return cache.get(file);
  const mod={exports:{}};cache.set(file,mod.exports);
  const source=ref?cp.execFileSync('git',['show',ref+':'+path.relative(mono,file)],{cwd:mono,encoding:'utf8'}):fs.readFileSync(file,'utf8');
  const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  new Function('require','exports','module',js)(s=>s.startsWith('.')?load(path.resolve(path.dirname(file),s)):require(s),mod.exports,mod);
  return mod.exports;
 }
 return load(path.join(mono,'apps/calculator/convex/lib',module))[member];
}
const old=handler('1bb24212'), current=handler();
const handleRequest=handler(null,'maxForward','handleMaxWebhookRequest');
const fixtures=JSON.parse(fs.readFileSync(path.join(__dirname,'start-commands.json'))).filter(x=>x.text.trim());
const updates=fixtures.map(x=>({update_type:'message_created',message:{recipient:{chat_id:456},sender:{user_id:123},body:{text:x.text}}}));
updates.push({update_type:'bot_started',chat_id:456,user_id:123});
for(const text of ['A023222','start','/start'])updates.push({update_type:'message_created',message:{recipient:{chat_id:456},sender:{user_id:123},body:{text,attachments:[{type:'contact',payload:{vcf_info:'signed-fixture',hash:'signed-hash'}}]}}});
const source=cp.execFileSync('git',['show','45637db:api-php/index.php'],{cwd:mini,encoding:'utf8'});
const oldDispatcher=source.match(/function process_bot_update\(array \$update\): void[\s\S]*?\n}\n/)[0];
const input=JSON.stringify({oldDispatcher,updates});
const invoke=(file,args=[])=>JSON.parse(cp.execFileSync('php',[path.join(__dirname,file),...args],{input,encoding:'utf8'}));
const handoff=invoke('ownership-dispatch.php',['handoff']),full=invoke('ownership-full.php');
async function replies(fn,body,forwarded=false) {
 let count=0;
 await fn(body,{resolveStartToken:async()=>null,saveChatLink:async()=>{},removeChatLink:async()=>{},sendContactPrompt:async()=>count++,sendMessage:async()=>count++,verifyContact:async()=>'79991234567',answerCallback:async()=>({ok:true}),recordAlertAction:async()=>{}},{forwardedStart:forwarded});
 return count;
}
(async()=>{
 for(const [stage,fn,php] of [['handoff+old',old,handoff],['handoff+new',current,handoff],['full+new',current,full]]){
  for(let i=0;i<updates.length;i++){
   const direct=await replies(fn,updates[i]);let forwarded=0;
   for(const {envelope} of php[i].forwards) {
    const headers=new Headers();
    for(const header of envelope.headers) { const at=header.indexOf(':'); headers.set(header.slice(0,at),header.slice(at+1).trim()); }
    const response=await handleRequest(new Request('https://local.test/max/webhook',{method:'POST',headers,body:envelope.body}),{slug:'not-used',botToken:'matrix-only-token',dispatch:async(body,forwardedStart)=>{assert.equal(forwardedStart,true);forwarded+=await replies(fn,body,forwardedStart);}});
    assert.equal(response.status,200,'PHP-generated HMAC must authenticate');
   }
   const total=direct+forwarded+php[i].replies.length;
   assert.equal(total,1,JSON.stringify({stage,update:updates[i],direct,forwarded,php:php[i]}));
   console.log(JSON.stringify({stage,text:updates[i].message?.body.text??'bot_started',contact:!!updates[i].message?.body.attachments,direct,php:php[i].replies.length,forwarded,total}));
  }
 }
 console.log('PASS all three deployment states: exactly one responder, including BOM/NEL and signed contact captions; no network');
})().catch(e=>{console.error(e);process.exitCode=1});
