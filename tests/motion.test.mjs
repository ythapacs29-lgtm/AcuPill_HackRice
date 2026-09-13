import test from 'node:test'
import assert from 'node:assert/strict'
import {analyzeSessionJS,analyzeSessionWithMatlab,orientation,CORE_METRICS} from '../src/services/motionAnalysis.js'
const reference={ax:0,ay:1,az:0}
const sample=(t_ms,ax=0,ay=1,az=0)=>({t_ms,ax,ay,az})
const session={reference,samples:[sample(0),sample(100,1,0),sample(200)]}
test('orientation, L1 motion, population variability and jerk',()=>{
 assert.equal(orientation(reference,reference).tilt,0)
 assert.equal(orientation({ax:1,ay:0,az:0},reference).tilt,90)
 const m=analyzeSessionJS(session)
 assert.equal(m.total_motion_score,4);assert.equal(m.sample_count,3)
 assert.ok(Math.abs(m.motion_variability_score-Math.sqrt(8/9))<1e-12)
 assert.ok(Math.abs(m.peak_jerk-Math.sqrt(2)/.1)<1e-12)
 assert.equal(analyzeSessionJS({reference,samples:[sample(0),sample(100)]}).peak_jerk,0)
})
test('duplicate clocks are finite; invalid samples and zero vectors rejected',()=>{
 assert.equal(analyzeSessionJS({reference,samples:[sample(0),sample(0,1,0)]}).peak_jerk,0)
 for(const s of [{reference,samples:[]},{reference,samples:[sample(0),sample(100,0,0,0)]},{reference,samples:[sample(0),sample(100,Infinity)]}]) assert.throws(()=>analyzeSessionJS(s))
})
test('accepted MATLAB output and failure/timeout/mismatch preserve legacy metrics',async()=>{
 const legacy=analyzeSessionJS(session)
 assert.equal((await analyzeSessionWithMatlab(session,legacy,{analyze:async()=>legacy})).metrics_source,'matlab')
 for(const analyze of [undefined,async()=>{throw Error()},async()=>({}),async()=>({...legacy,total_motion_score:999}),()=>new Promise(()=>{})]){
  const result=await analyzeSessionWithMatlab(session,legacy,{analyze,timeoutMs:15,warn:()=>{}})
  assert.equal(result.metrics_source,'js_fallback')
  for(const k of CORE_METRICS)assert.equal(result[k],legacy[k])
 }
})
test('queue freezes metrics on retry and preserves arrivals during a request',async()=>{
 const store=new Map(); globalThis.window={localStorage:{getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v)},dispatchEvent:()=>{}}
 globalThis.CustomEvent=class {constructor(type,options){Object.assign(this,{type,...options})}}
 const api=await import('../src/services/acupillApi.js')
 let analysisCalls=0,fail=true;const posts=[]
 globalThis.fetch=async(url,options)=>{
  if(url.endsWith('/analyze')){analysisCalls++;return {ok:false}}
  posts.push(JSON.parse(options.body))
  if(posts.length===1)api.queueInteractionEvent({event_id:'second'})
  if(fail)throw Error('offline')
  return {ok:true,json:async()=>({event:posts.at(-1)})}
 }
 api.queueInteractionEvent({event_id:'first',...analyzeSessionJS(session)},session)
 assert.deepEqual(await api.flushInteractionEventQueue(),{uploaded:0,pending:2})
 fail=false
 assert.deepEqual(await api.flushInteractionEventQueue(),{uploaded:2,pending:0})
 assert.equal(analysisCalls,1);assert.deepEqual(posts[0],posts[1]);assert.equal(posts[0].__motionSession,undefined)
})
