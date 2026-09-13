import {spawn} from 'node:child_process'
import {mkdtemp,writeFile,readFile,rename,rm} from 'node:fs/promises'
import {existsSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {randomUUID} from 'node:crypto'
import {setTimeout as delay} from 'node:timers/promises'

export function createMatlabWorker({binary=process.env.ACUPILL_MATLAB_BIN || '/Applications/MATLAB_R2026a.app/bin/matlab', timeoutMs=1200}={}) {
  let folder,child,heartbeat,pending=0,stopped=false,state='starting'
  const matlabFolder=fileURLToPath(new URL('../matlab/',import.meta.url))
  const quote=s=>s.replaceAll("'","''")
  const start=(async()=>{
    if(process.env.ACUPILL_MATLAB_DISABLED==='true' || !existsSync(binary)) {state='unavailable';return}
    folder=await mkdtemp(join(tmpdir(),'acupill-matlab-'))
    const beat=()=>writeFile(join(folder,'heartbeat'),'alive').catch(()=>{})
    await beat(); heartbeat=setInterval(beat,2000);heartbeat.unref()
    child=spawn(binary,['-batch',`addpath('${quote(matlabFolder)}'); runMotionWorker('${quote(folder)}')`],{stdio:'ignore'})
    child.on('error',()=>{state='unavailable';clearInterval(heartbeat)})
    child.on('exit',()=>{state='unavailable';clearInterval(heartbeat)})
    // Startup is asynchronous: the API and detector do not wait for MATLAB.
    const deadline=Date.now()+90000
    while(!stopped && state==='starting' && Date.now()<deadline){
      if(existsSync(join(folder,'ready'))){state='ready';console.info('AcuPill MATLAB session worker ready');return}
      await delay(100)
    }
    if(state==='starting'){state='unavailable';child.kill();clearInterval(heartbeat)}
  })().catch(()=>{state='unavailable'})
  return {
    status:()=>state,
    async analyze(session){
      if(state!=='ready' || pending>=4) throw new Error('MATLAB unavailable or busy')
      pending++
      const id=randomUUID(),input=join(folder,`${id}.request.json`),output=join(folder,`${id}.response.json`)
      try {
        await writeFile(input+'.tmp',JSON.stringify(session),{mode:0o600});await rename(input+'.tmp',input)
        const deadline=Date.now()+timeoutMs
        while(Date.now()<deadline && state==='ready'){
          try {const result=JSON.parse(await readFile(output,'utf8'));if(result.error)throw new Error('Analysis rejected');return result}
          catch(e){if(e.code!=='ENOENT')throw e}
          await delay(25)
        }
        throw new Error('MATLAB timeout')
      } finally {
        pending--
        await Promise.all([input,input+'.tmp',output,output+'.tmp'].map(f=>rm(f,{force:true}).catch(()=>{})))
        // A late worker completion is discarded, never reused for another event.
        const cleanup=setTimeout(()=>{void rm(output,{force:true}).catch(()=>{})},5000);cleanup.unref()
      }
    },
    async stop(){stopped=true;state='unavailable';clearInterval(heartbeat);child?.kill();await start;clearInterval(heartbeat);child?.kill();if(folder)await rm(folder,{recursive:true,force:true}).catch(()=>{})},
  }
}
