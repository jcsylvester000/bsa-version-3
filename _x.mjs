import { chromium } from 'playwright';
const base='http://localhost:3032';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const ctx=await b.newContext({viewport:{width:1280,height:850}});
const p=await ctx.newPage();
try {
  await p.goto(base+'/login',{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(1000);
  await p.click('button[type=submit]');
  await p.waitForTimeout(3000);
  const RUN='mock-run-0000-0000-0000-000000000001';
  await p.goto(base+'/lease-benchmark?runId='+RUN,{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(1500);
  await p.click('text=Run Lease Benchmark').catch(()=>{});
  await p.waitForTimeout(2500);
  await p.screenshot({path:'/tmp/lease-dark.png'});
  console.log('lease shot ok');
} catch(e){ console.log('err:', e.message); }
await b.close();
