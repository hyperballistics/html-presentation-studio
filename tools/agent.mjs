import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {openWorkspace} from './workspace.mjs';
import {proposalFor,readHTML,renderHTML} from '../workbench/model.mjs';

const usage='用法：npm run agent -- request <page_id> <edit_id> "修改目标" | review <proposal.json> [--apply]';
try {
  const [command,...args]=process.argv.slice(2);
  const workspace=await openWorkspace(fileURLToPath(new URL('..',import.meta.url)));
  if(command==='request'&&args.length===3) {
    const [page,edit_id,goal]=args, current=await workspace.read(page);
    const task=await workspace.task(page,{edit_id,goal,base_revision:current.revision});
    console.log(`请读取 AGENTS.md、agents/protocol.md 及 .runtime/requests/${task.id}.json；只返回提案 JSON，不直接改实体 HTML。`);
  } else if(command==='review'&&(args.length===1||(args.length===2&&args[1]==='--apply'))) {
    const raw=await readFile(args[0],'utf8');
    if(raw.length>16000)throw new Error('提案文件过大。');
    const proposal=JSON.parse(raw), task=await workspace.getTask(proposal?.request_id), source=await workspace.read(task.page_id);
    const replay=task.base_revision!==source.revision;
    const prior=replay?await workspace.historical(task.page_id,task.base_revision):source.html;
    if(prior===null)throw new Error('源文件已更新；旧提案不能写回。');
    const {model,diff}=proposalFor(replay?readHTML(prior,task.page_id):source.model,proposal,task);
    if(replay&&renderHTML(model)!==source.html)throw new Error('源文件已更新；旧提案不能写回。');
    console.log(`${source.page.file} · ${task.edit_id}`);
    if(replay)console.log('该提案的结果已是当前版本，无需重复写回。');
    else for(const [field,before,after] of diff)console.log(`${field}\n  - ${JSON.stringify(before)}\n  + ${JSON.stringify(after)}`);
    if(args[1]==='--apply'){
      const result=await workspace.save(task.page_id,`"${task.base_revision}"`,model);
      console.log(`${replay||!diff.length?'未改写':'已写回'}，版本 ${result.revision}`);
    }else console.log('只审阅，未写文件。由人确认、写回或导出浏览器草稿并停止编辑服务后，才可加 --apply。');
  } else throw new Error(usage);
} catch(e) {console.error(e.message); process.exitCode=1;}
