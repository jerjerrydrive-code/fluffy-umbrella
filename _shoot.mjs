import { chromium } from 'playwright';
import fs from 'fs'; import path from 'path';
const SP='/tmp/claude-0/-home-user-fluffy-umbrella/3446c911-c2e1-590d-a927-72e374efa75e/scratchpad';
const rec=JSON.parse(fs.readFileSync(SP+'/xancode-recovered-codes.json','utf8'));
const codes=rec.state.apps.filter(a=>a.type==='grid');
const dockIds=[['nav_home','Home','grid'],['nav_scan','Scan','scan-line'],['nav_add','Add','plus'],['nav_library','Library','library'],['nav_settings','Settings','settings']];
const OUT='.capture';
const PAL=['#516091','#74BEC1','#ADEBBE','#EEF3AD'];
const state={
  apps:[...dockIds.map(([id,t,ic],i)=>({id,title:t,icon:ic,type:'dock',order:i})),
        ...codes.map((c,i)=>({...c,page:0,order:i}))],
  gridSize:'auto', skin:'dock', accent:PAL[0], palette:PAL,
  autoArrange:true, haptics:false, animations:true, history:[], pageNames:[]
};
const browser=await chromium.launch();
const ctx=await browser.newContext({viewport:{width:412,height:915},deviceScaleFactor:2,isMobile:true,hasTouch:true});
const page=await ctx.newPage();
await page.addInitScript(s=>localStorage.setItem('xancode_v2_state',s),JSON.stringify(state));
await page.goto('file://'+path.resolve('index.html'));
await page.waitForTimeout(1500);

const shot=(n)=>page.screenshot({path:`${OUT}/${n}.png`});
const setSkin=async(s)=>{ await page.evaluate(k=>{window.OS_STATE.skin=k;document.body.dataset.skin=k;window.Layout.calculateGrid();},s); await page.waitForTimeout(900); };

for (const s of ['dock','scancard','glass','soft']) { await setSkin(s); await shot('home-'+s); }
await setSkin('dock');

// library
await page.evaluate(()=>document.getElementById('nav_library')?.click());
await page.evaluate(()=>{ const l=document.querySelector('[data-id="nav_library"]'); if(l) l.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true})); });
await page.waitForTimeout(400);
console.log('lib visible?', await page.evaluate(()=>getComputedStyle(document.getElementById('library-overlay')).opacity));
await page.evaluate(()=>window.openLibrary&&window.openLibrary());
await page.waitForTimeout(800); await shot('library');
await page.evaluate(()=>window.closeLibrary&&window.closeLibrary());
await page.waitForTimeout(600);
await page.evaluate(()=>document.getElementById('btn-open-settings').click());
await page.waitForTimeout(900); await shot('settings');
await browser.close();
console.log('done');
