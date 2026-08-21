import { chromium } from 'playwright';
import fs from 'fs'; import path from 'path';
const SP='/tmp/claude-0/-home-user-fluffy-umbrella/3446c911-c2e1-590d-a927-72e374efa75e/scratchpad';
const rec=JSON.parse(fs.readFileSync(SP+'/xancode-recovered-codes.json','utf8'));
const codes=rec.state.apps.filter(a=>a.type==='grid');
const dock=[['nav_home','Home','grid'],['nav_gen','Create','plus-circle'],['nav_wifi','WiFi','wifi'],['nav_lib','Library','layout-list'],['nav_scan','Scan','scan-line']];
const PAL=['#516091','#74BEC1','#ADEBBE','#EEF3AD'];
const state={apps:[...dock.map(([id,t,ic],i)=>({id,title:t,icon:ic,type:'dock',order:i})),...codes.map((c,i)=>({...c,page:0,order:i}))],
  gridSize:'auto',skin:'dock',accent:PAL[0],palette:PAL,autoArrange:true,haptics:false,animations:true,history:[],pageNames:[]};
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:412,height:915},deviceScaleFactor:2,isMobile:true,hasTouch:true});
const p=await ctx.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(String(e).slice(0,120)));
await p.addInitScript(s=>localStorage.setItem('xancode_v2_state',s),JSON.stringify(state));
await p.goto('file://'+path.resolve('index.html'));
await p.waitForTimeout(1600);
await p.screenshot({path:'.capture/home-dock.png'});
console.log('errors',errs.slice(0,3));
await b.close();
