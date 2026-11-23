import {fileURLToPath} from 'node:url';
import {openWorkspace} from './workspace.mjs';
import {addPageWithId} from './outline.mjs';

const [section,id,title,...extra]=process.argv.slice(2);
if(!section||!id||!title?.trim()||extra.length)throw new Error('用法：npm run new -- 01-intro p02-example "页面标题"');
const workspace=await openWorkspace(fileURLToPath(new URL('..',import.meta.url)));
const result=await addPageWithId(workspace,section,id,title);
const {file}=result.workspace.pages.get(id);
console.log(result.created?`已新增 ${file}，清单与 STORYLINE.md 已同步。请复核叙事并运行 npm run check。`:`页面已登记：${file}，未覆盖。`);
