// Executes the actual App.jsx detector functions, with React setters isolated.
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
import {parse} from '@babel/parser'
import {analyzeSessionJS,CORE_METRICS} from '../src/services/motionAnalysis.js'
const source=readFileSync(new URL('../src/App.jsx',import.meta.url),'utf8')
const ast=parse(source,{sourceType:'module',plugins:['jsx']}).program.body
const app=ast.find(n=>n.type==='FunctionDeclaration'&&n.id.name==='App')
const names=['resetCounters','calculateMotorTelemetry','addRejectedInteraction','tryLogMedicationInteraction','changeState','updateMovementState']
const funcs=app.body.body.filter(n=>n.type==='FunctionDeclaration'&&names.includes(n.id.name))
const top=ast.filter(n=>(n.type==='FunctionDeclaration'&&!['App','Sparkline','TrendCard','LogoMark','MetricCard'].includes(n.id.name))||n.type==='VariableDeclaration').map(n=>source.slice(n.start,n.end)).join('\n')
function run(angles,touch=1){
 const out={events:[],sessions:[],rejections:[],states:[]}
 const env={Date,Math,console,crypto:{randomUUID:()=> 'test'},setEventLog:()=>{},setDebug:()=>{},setMovementState:s=>out.states.push(s),setStateHistory:()=>{},setRejectionLog:f=>out.rejections=f(out.rejections),queueInteractionEvent:(e,s)=>{out.events.push(e);out.sessions.push(s)},flushPendingEventUploads:()=>{},evaluateMajorChange:()=>{}}
 const refs={handlingCount:0,tiltCount:0,returnCount:0,idleCount:0,lastEventTime:-1e9,eventAlreadyDecided:false,currentInteraction:null,previousData:null,movementState:'IDLE',stateStartedAt:0,eventLog:[],eventId:1,rejectionId:1,restBaseline:{ax:0,ay:1,az:0}}
 for(const [k,v] of Object.entries(refs))env[k+'Ref']={current:v}
 vm.createContext(env)
 vm.runInContext(top+'\n'+funcs.map(n=>source.slice(n.start,n.end)).join('\n')+'\nthis.step=updateMovementState',env)
 angles.forEach((degrees,i)=>env.step({t_ms:5000+i*250,touch:(degrees || angles.every(a=>a===0))?touch:0,ax:Math.sin(degrees*Math.PI/180),ay:Math.cos(degrees*Math.PI/180),az:0}))
 return out
}
const rest=Array(8).fill(0)
for(const [name,angles,touch,accepted] of [
 ['valid tilt and return',[0,0,45,45,45,45,45,...rest],1,1],
 ['touch only',Array(16).fill(0),1,0],
 ['pickup without qualifying tilt',[0,20,20,20,...rest],1,0],
 ['no touch',[0,0,45,45,45,45,45,...rest],0,0],
 ['brief bump',[0,45,...rest],1,0],
 ['shaky valid interaction',[0,0,45,70,40,80,45,...rest],1,1],
])test('live detector regression: '+name,()=>{
 const result=run(angles,touch);assert.equal(result.events.length,accepted)
 if(name==='no touch')assert.match(result.rejections[0].reason,/no touch/)
 if(accepted){
  assert.deepEqual(result.states,['HANDLING','TILTED','RETURNED','IDLE'])
  const m=analyzeSessionJS(result.sessions[0]);for(const k of CORE_METRICS)assert.ok(Math.abs(m[k]-result.events[0][k])<1e-9,k)
 }
})
