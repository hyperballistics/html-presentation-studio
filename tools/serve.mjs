import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {parseArgs} from 'node:util';
import {embeddedFonts,openExportRoot} from './export-files.mjs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {openWorkspace,httpError,revision} from './workspace.mjs';
import {changeOutline} from './outline.mjs';
import {updateContext} from './context.mjs';
import {exportPDF} from './pdf.mjs';
import {validate,fontAssets,fontFace,renderHTML,renderDeckHTML} from '../workbench/model.mjs';

const files={'/':['index.html','text/html'], '/style.css':['style.css','text/css'], '/app.mjs':['app.mjs','text/javascript'], '/model.mjs':['model.mjs','text/javascript'], '/selection.mjs':['selection.mjs','text/javascript']};
for(const [,name,license] of fontAssets){files[`/fonts/${name}`]=[`fonts/${name}`,'font/woff2'];files[`/fonts/${license}`]=[`fonts/${license}`,'text/plain'];}
const allowedHost=/^(?:localhost|127\.0\.0\.1)(?::\d+)?$/;
const LIMIT=800_000;
const json=async (req,limit=LIMIT)=>{
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||'')) throw httpError(415,'需要 application/json。');
  let size=0; const chunks=[];
  for await (const chunk of req) { size+=chunk.length; if(size<=limit) chunks.push(chunk); }
  if (size>limit) throw httpError(413,'请求过大。');
  try {return JSON.parse(Buffer.concat(chunks).toString('utf8'));} catch {throw httpError(400,'JSON 无效。');}
};
export async function makeServer(root=fileURLToPath(new URL('..',import.meta.url)),{exportRoot}={}) {
  let workspace=await openWorkspace(root);
  const exports=exportRoot?await openExportRoot(exportRoot):null;
  const {version}=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
  const catalog=()=>({...workspace.manifest,studio_version:version,export_root:exports?.dir??null,manifest_revision:revision(workspace.manifestText)});
  let queue=Promise.resolve(), printing=false;
  function enqueue(write) { const job=queue.then(write); queue=job.catch(()=>{}); return job; }
  return createServer(async (req,res)=>{
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Content-Security-Policy',"default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'self'; form-action 'none'");
    const send=(code,body,type='application/json')=>{res.writeHead(code,{'Content-Type':type==='font/woff2'?type:`${type}; charset=utf-8`});res.end(type==='application/json'?JSON.stringify(body):body);};
    const host=req.headers.host||'';
    try {
      if (!allowedHost.test(host) || ['cross-site','same-site'].includes(req.headers['sec-fetch-site'])) throw httpError(403,'仅允许本机同源访问。');
      const {pathname:path,searchParams}=new URL(req.url,`http://${host}`);
      const {method}=req;
      if (method!=='GET' && req.headers.origin!==`http://${host}`) throw httpError(403,'写操作需要本机同源请求。');
      if(method==='GET'&&path==='/favicon.ico'){res.writeHead(204);res.end();return;}
      if(method==='GET'&&path==='/fonts.css')return send(200,fontAssets.map(asset=>fontFace(asset,`/fonts/${asset[1]}`)).join('\n'),'text/css');
      if (method==='GET' && Object.hasOwn(files,path)) {
        const [name,type]=files[path]; if(type==='font/woff2')res.setHeader('Cache-Control','public, max-age=86400'); return send(200,await readFile(resolve(root,'workbench',name)),type);
      }
      const selected=searchParams.get('scope')==='selected';
      if(method==='POST'&&path==='/api/html'&&exports&&!selected){
        const model=await json(req), id=model?.id;
        if(!workspace.pages.has(id))throw httpError(404,'页面不存在。');
        try{validate(model,id);}catch(e){throw httpError(400,e.message);}
        const html=renderHTML(model,await embeddedFonts(root,{licenses:true}));
        return send(201,{file:await exports.save(id,'html',html)});
      }
      if(method==='POST'&&(path==='/api/pdf'||(path==='/api/html'&&selected&&exports))) {
        const pdf=path==='/api/pdf';
        if(pdf&&printing)throw httpError(409,'有一份 PDF 正在导出。');
        if(pdf)printing=true;
        try {
          const payload=await json(req,8_000_000);
          const models=selected?payload?.models:payload;
          const current=selected?await openWorkspace(workspace.root):workspace;
          if(selected&&payload?.manifest_revision!==revision(current.manifestText)){
            throw httpError(409,'大纲已更新，请刷新工作台后重选导出范围。');
          }
          const ids=[...current.pages.keys()];
          if(!selected&&ids.length>120)throw httpError(413,'此演示超过 120 页。');
          if(!Array.isArray(models)||!models.length||(!selected&&models.length!==ids.length))throw httpError(400,'导出页数不匹配。');
          if(models.length>120)throw httpError(413,'每次最多导出 120 页。');
          const positions=new Map(ids.map((id,i)=>[id,i]));
          let previous=-1;
          try {
            models.forEach((model,i)=>{
              const id=selected?model?.id:ids[i], position=positions.get(id);
              if(position===undefined||position<=previous)throw new Error('导出页须存在且按大纲顺序排列，每页只允许出现一次。');
              validate(model,id);previous=position;
            });
          }catch(e){throw httpError(400,e.message);}
          if(!pdf){
            const assets=await embeddedFonts(root,{licenses:true});
            const html=renderDeckHTML(models,{title:current.manifest.title,...assets});
            return send(201,{file:await exports.save('slides-selection','html',html)});
          }
          const bytes=await exportPDF(root,models), stem=selected?'slides-selection':'slides';
          if(exports&&searchParams.get('delivery')!=='browser')return send(201,{file:await exports.save(stem,'pdf',bytes)});
          res.writeHead(200,{'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="${stem}.pdf"`});
          res.end(bytes);return;
        } finally {if(pdf)printing=false;}
      }
      if (method==='GET' && path==='/api/manifest') {
        return send(200,await enqueue(async()=>{workspace=await openWorkspace(workspace.root);return catalog();}));
      }
      if (method==='POST' && path==='/api/context/sync') {
        try {
          const {changed,pending}=await enqueue(()=>workspace.locked(async()=>updateContext(await openWorkspace(workspace.root))));
          return send(200,{changed,pending_count:pending.length});
        } catch(e) {
          if(e.status)throw e;
          console.error(`上下文同步失败：${e.message}`);
          throw httpError(500,'无法更新索引，请查看服务终端。');
        }
      }
      if (method==='PATCH' && path==='/api/outline') {
        const match=req.headers['if-match'];
        if(!match)throw httpError(428,'缺少大纲版本。');
        const body=await json(req,8192);
        const result=await enqueue(async()=>{
          const changed=await changeOutline(workspace,match,body);workspace=changed.workspace;
          return {...catalog(),affected:changed.affected,context_synced:changed.context_synced};
        });
        return send(200,result);
      }
      if (method==='GET' && path.startsWith('/api/requests/')) return send(200,await workspace.getTask(path.slice(14)));
      const m=path.match(/^\/api\/pages\/([a-z][a-z0-9-]{0,59})(\/requests)?$/);
      if (m) {
        const [,id,requests]=m;
        if (!requests && (method==='GET' || method==='PUT')) {
          let result;
          if (method==='GET') result=await workspace.read(id);
          else {
            if (!req.headers['if-match']) throw httpError(428,'缺少 If-Match 版本。');
            const model=await json(req);
            try {validate(model,id);} catch(e) {throw httpError(400,e.message);}
            result=await enqueue(()=>workspace.save(id,req.headers['if-match'],model));
          }
          res.setHeader('ETag',`"${result.revision}"`);
          const {file,context,full}=result.page;
          return send(200,{file,context,absolute_file:full,revision:result.revision,modified_at:result.modifiedAt,model:result.model,context_synced:result.context_synced});
        }
        if (requests && method==='POST') {
          const body=await json(req);
          return send(201,await enqueue(()=>workspace.task(id,body)));
        }
      }
      send(404,{error:'路径不存在。'});
    } catch(e) {
      if(!e.status) console.error(e.message);
      send(e.status||500,{error:e.status?e.message:'工作区读取或写入失败，请查看终端；草稿不会因此删除。'});
    }
  });
}
if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const {values}=parseArgs({options:{port:{type:'string',default:'4377'},'export-root':{type:'string'}}});
  const raw=values.port, port=Number(raw), dest=values['export-root'];
  if(!/^\d+$/.test(raw)||port<1||port>65535||(dest!==undefined&&!dest.trim()))throw new Error('用法：npm start -- [--port 4377] [--export-root <已有目录>]');
  const server=await makeServer(undefined,{exportRoot:dest===undefined?undefined:resolve(process.env.INIT_CWD||process.cwd(),dest)});
  server.on('error',e=>{console.error(e.code==='EADDRINUSE'?'端口已被占用。请用 npm start -- --port 4378 指定别的端口。':e.message);process.exitCode=1;});
  server.listen(port,'127.0.0.1',()=>console.log(`HTML Studio · http://127.0.0.1:${port}`));
}
