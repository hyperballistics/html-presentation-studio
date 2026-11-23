import {fileURLToPath} from 'node:url';
import {openWorkspace} from './workspace.mjs';
import {updateContext} from './context.mjs';

try{
  const [mode,id,...extra]=process.argv.slice(2);
  if(!(((mode==='check'||mode==='sync')&&id===undefined)||(mode==='review'&&id&&!extra.length)))
    throw new Error('用法：npm run context -- check | sync | review <页ID>');
  const root=fileURLToPath(new URL('..',import.meta.url)), ws=await openWorkspace(root);
  const result=mode==='check'?await updateContext(ws,{check:true}):
    await ws.locked(async()=>updateContext(await openWorkspace(root),{review:mode==='review'?id:undefined}));
  if(!result.current){
    console.error('页面事实索引缺失或过期。请运行 npm run context -- sync，再读索引。');
    process.exitCode=1;
  }else{
    if(mode==='review')console.log(`已记录逐页叙事复核：${id}`);
    console.log(`${result.changed?'已更新':'已是最新'}：.runtime/context/PAGE-FACTS.md`);
  }
  console.log(result.pending.length?`待复核（${result.pending.length}）：${result.pending.join('、')}`:'无待复核页面。');
}catch(e){console.error(e.message);process.exitCode=1;}
