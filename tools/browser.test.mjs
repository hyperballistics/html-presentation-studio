import assert from 'node:assert/strict';
import {test, before, after} from 'node:test';
import {cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {once} from 'node:events';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright';
import {makeServer} from './serve.mjs';
import {defaults, pageSize, readHTML, renderHTML, THEME} from '../workbench/model.mjs';

const first='p01-browser', second='p02-browser', section='01-browser';
const folder=`sections/${section}`, pageFile=id=>`${folder}/pages/${id}.html`;
const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZi8AAAAASUVORK5CYII=';
const box=(id,x,y,w,h,extra={})=>({...defaults,id,type:'rect',x,y,w,h,...extra});
const source={id:first,title:'浏览器回归源页',background:THEME.paper,notes:'',objects:[
  box('picture',180,160,140,100,{text:'示例图片',image}),
  box('label',410,320,160,60,{text:'组合文字'}),
  box('edge',1130,610,150,110,{text:'贴边对象'}),
  {id:'connector',type:'arrow',stroke:THEME.accent,strokeWidth:3,from:{target:'picture',side:'right'},to:{target:'edge',side:'left'}},
],groups:[['picture','label','connector']]};
const target={id:second,title:'浏览器回归目标页',background:THEME.paper,notes:'',format:'a6',objects:[]};
const pages=[source,target];
let browser;
before(async()=>{browser=await chromium.launch({executablePath:process.env.STUDIO_TEST_CHROMIUM||undefined});});
after(async()=>{await browser?.close();});

function regression(name,run,{extraSection=[]}={}){
  test(name,{timeout:60_000},async()=>{
    const root=await mkdtemp(join(tmpdir(),'html-studio-browser-'));
    const contexts=[], errors=[];
    let server;
    try{
      const groups=[[section,'回归测试',pages],...(extraSection.length?[['02-export','扩展分节',extraSection]]:[])];
      const sections=[];
      await cp(new URL('../workbench/',import.meta.url),join(root,'workbench'),{recursive:true});
      for(const [id,title,models] of groups){
        const dir=`sections/${id}`, context=`${dir}/section.md`;
        await mkdir(join(root,dir,'pages'),{recursive:true});
        await writeFile(join(root,context),`# ${title}\n`);
        const entries=[];
        for(const model of models){
          const file=`${dir}/pages/${model.id}.html`;
          await writeFile(join(root,file),renderHTML(model));
          entries.push({id:model.id,title:model.title,file});
        }
        sections.push({id,title,context,pages:entries});
      }
      await writeFile(join(root,'deck.manifest.json'),JSON.stringify({version:1,title:'Browser regression',sections}));
      await writeFile(join(root,'STORYLINE.md'),'# 回归测试\n\n| Page | Content | Role |\n|---|---|---|\n'+
        [...pages,...extraSection].map(({id,title})=>`| \`${id}\` | ${title} | 测试 |`).join('\n')+'\n');
      server=await makeServer(root);server.listen(0,'127.0.0.1');await once(server,'listening');
      const open=async()=>{
        const context=await browser.newContext({viewport:{width:1440,height:900},acceptDownloads:true});
        contexts.push(context);context.setDefaultTimeout(6000);
        await context.tracing.start({screenshots:true,snapshots:true});
        const page=await context.newPage();
        page.on('pageerror',e=>errors.push(e.message));
        await page.goto(`http://127.0.0.1:${server.address().port}`);
        await page.locator(`[data-page="${first}"][aria-current="page"]`).waitFor();
        await page.locator('#save-status').getByText('与源文件一致').waitFor();
        await page.evaluate(()=>document.fonts.ready.then(()=>true));
        return page;
      };
      await run({root,open});
      assert.deepEqual(errors,[]);
    }catch(e){
      const artifacts=resolve('output','browser-tests',name);
      try{
        await mkdir(artifacts,{recursive:true});
        for(const [i,context] of contexts.entries()){
          await context.tracing.stop({path:join(artifacts,`trace-${i+1}.zip`)});
        }
        console.error(`Browser failure traces: ${artifacts}`);
      }catch(traceError){console.error(`Could not save browser traces: ${traceError.message}`);}
      throw e;
    }finally{
      try{await Promise.all(contexts.map(c=>c.close()));}
      finally{
        if(server?.listening)await new Promise(resolve=>server.close(resolve));
        await rm(root,{recursive:true,force:true});
      }
    }
  });
}
const el=(page,id)=>page.locator(`#${id}`);
const layer=(page,id)=>page.locator(`#layers [data-layer="${id}"]`);
const layers=page=>page.locator('#layers [data-layer]');
const selected=page=>page.locator('#layers [aria-pressed="true"]');
const waitStatus=(page,text)=>el(page,'save-status').getByText(text,{exact:true}).waitFor();
const draft=(page,id)=>page.evaluate(id=>Object.entries(localStorage)
  .filter(([key])=>key.startsWith('html-studio:v1:')&&key.endsWith(`:${id}`))
  .map(([,value])=>JSON.parse(value).model)[0],id);
const saved=(root,id)=>readFile(join(root,pageFile(id)),'utf8');
async function go(page,id){
  await page.locator(`[data-page="${id}"]`).click();
  await page.locator(`[data-page="${id}"][aria-current="page"]`).waitFor();
}
async function drag(page,from,to){
  await page.mouse.move(...from);await page.mouse.down();await page.mouse.move(...to,{steps:8});
}

regression('copy-and-paste',async({root,open})=>{
  const page=await open();
  await layer(page,'edge').click();await el(page,'duplicate').click();
  const copy=(await draft(page,first)).objects.at(-1);
  assert.notEqual(copy.id,'edge');assert.deepEqual([copy.x,copy.y],[1112,592]);
  await el(page,'undo').click();assert.equal(await layers(page).count(),source.objects.length);

  await layer(page,'edge').click();await el(page,'copy-objects').click();
  await go(page,second);
  assert.equal(await page.evaluate(()=>document.activeElement?.dataset.page),second);
  await page.keyboard.press('ControlOrMeta+v');
  assert.equal((await draft(page,second)).objects[0].text,'贴边对象');
  await el(page,'undo').click();assert.equal(await layers(page).count(),0);

  await go(page,first);await layer(page,'picture').click();
  await page.keyboard.press('ControlOrMeta+c');
  await el(page,'clipboard-status').getByText('已复制 3 个对象，可切页粘贴。').waitFor();
  await go(page,second);await el(page,'paste-objects').click();
  const pasted=await draft(page,second);
  const [picture,label,connector]=pasted.objects;
  assert.equal(pasted.objects.length,3);
  assert.equal(picture.image,image);assert.equal(label.text,'组合文字');
  assert.deepEqual(pasted.groups,[[picture.id,label.id,connector.id]]);
  assert.deepEqual(connector.from,{target:picture.id,side:'right'});
  assert.deepEqual(Object.keys(connector.to).sort(),['x','y']);
  assert.ok(pasted.objects.every(o=>!source.objects.some(old=>old.id===o.id)));
  assert.ok(picture.x+picture.w<=pageSize('a6').w);
  assert.deepEqual(readHTML(await saved(root,first),first),source);
  assert.deepEqual(readHTML(await saved(root,second),second),target);
  await el(page,'undo').click();assert.equal(await layers(page).count(),0);
});

regression('marquee',async({open})=>{
  const page=await open(), slide=el(page,'slide'), stage=el(page,'stage');
  const r=await slide.boundingBox(), s=await stage.boundingBox();
  const overlay=page.locator('body > .marquee');
  const start=[r.x-8,r.y-8], outside=[s.x+s.width+12,r.y+r.height+8];
  await drag(page,start,outside);
  const visible=await overlay.boundingBox();
  assert.ok(visible.x<r.x&&visible.x+visible.width>s.x+s.width&&visible.y+visible.height>r.y+r.height);
  await page.mouse.up();assert.equal(await selected(page).count(),source.objects.length);
  assert.equal(await overlay.count(),0);
  await page.mouse.click(...start);assert.equal(await selected(page).count(),0);
  await drag(page,[r.x+r.width+8,r.y+r.height+8],start);
  await page.mouse.up();assert.equal(await selected(page).count(),source.objects.length);

  await layer(page,'edge').click();
  const point=(x,y)=>[r.x+x*r.width/1280,r.y+y*r.height/720];
  await page.keyboard.down('Shift');
  await drag(page,point(160,140),point(345,280));await page.mouse.up();
  await page.keyboard.up('Shift');assert.equal(await selected(page).count(),source.objects.length);
  await layer(page,'edge').click();
  await drag(page,start,outside);await page.keyboard.press('Escape');await page.mouse.up();
  assert.equal(await overlay.count(),0);assert.equal(await selected(page).count(),1);

  await el(page,'zoom').click();await el(page,'zoom-in').click();await el(page,'zoom-in').click();
  await stage.evaluate(el=>el.scrollTo(0,0));
  const z=await slide.boundingBox();
  await drag(page,[z.x-5,z.y-5],[s.x+s.width-28,s.y+s.height-28]);
  const before=await overlay.boundingBox();
  await page.mouse.wheel(5000,5000);
  await page.waitForFunction(x=>{
    const stage=document.querySelector('#stage');
    return stage.scrollLeft>50&&stage.scrollTop>0&&document.querySelector('.marquee').getBoundingClientRect().left<x-50;
  },before.x);
  await page.mouse.up();assert.equal(await selected(page).count(),source.objects.length);
});

async function notes(page,text){
  const field=el(page,'notes');
  if(!await field.isVisible())await page.locator('.notes summary').click();
  await field.fill(text);await field.press('Tab');await waitStatus(page,'草稿已自动保存');
}
async function review(page){
  await el(page,'save').click();await page.locator('#review-dialog[open]').waitFor();
}
async function approve(page,status){
  const response=page.waitForResponse(r=>r.request().method()==='PUT'&&r.url().endsWith(`/api/pages/${first}`));
  await el(page,'approve').click();assert.equal((await response).status(),status);
}

regression('writeback-and-backup',async({root,open})=>{
  const page=await open(), original=await saved(root,first);
  await notes(page,'待写回的说明');await page.reload();await waitStatus(page,'草稿已自动保存');
  assert.equal(await el(page,'notes').inputValue(),'待写回的说明');
  await review(page);
  assert.match(await el(page,'diff').textContent(),/待写回的说明/);
  await el(page,'cancel-review').click();
  assert.equal(await saved(root,first),original);assert.ok(await draft(page,first));
  await review(page);await approve(page,200);await waitStatus(page,'与源文件一致');
  assert.equal(await draft(page,first),undefined);
  assert.equal(readHTML(await saved(root,first),first).notes,'待写回的说明');
  const history=join(root,'.runtime','history');
  const names=await readdir(history);assert.equal(names.length,1);
  assert.equal(await readFile(join(history,names[0]),'utf8'),original);
  assert.match(await readFile(join(root,'.runtime','context','PAGE-FACTS.md'),'utf8'),new RegExp(first));
});

regression('writeback-conflict',async({root,open})=>{
  const page=await open(), other=await open();
  const localBytes=()=>page.evaluate(id=>Object.entries(localStorage).find(([key])=>
    key.startsWith('html-studio:v1:')&&key.endsWith(`:${id}`))?.[1],first);
  const openConflict=()=>el(page,'open-conflict').click();
  const pageAPI=`/api/pages/${first}`;
  await notes(page,'应该保留的旧草稿');await review(page);
  const originalDraft=await localBytes();
  await notes(other,'获准写回的新版本');
  await el(other,'add-text').click();
  await el(other,'object-text').fill('磁盘上的新对象文字');
  await review(other);await approve(other,200);
  await waitStatus(other,'与源文件一致');const current=await saved(root,first);
  const {revision,modified_at}=await (await page.request.get(new URL(pageAPI,page.url()).href)).json();
  await approve(page,412);await waitStatus(page,'版本冲突 · 草稿保留');
  assert.equal(await el(page,'approve').isDisabled(),true);
  await el(page,'cancel-review').click();
  const assertSource=async()=>{
    await el(page,'slide').getByText('磁盘上的新对象文字',{exact:true}).waitFor();
    assert.equal(await el(page,'notes').inputValue(),'获准写回的新版本');
    assert.equal(await el(page,'notes').evaluate(node=>node.readOnly),true);
    assert.equal(await el(page,'edit-tools').evaluate(node=>node.inert),true);
    assert.equal(await el(page,'save').getAttribute('aria-disabled'),'true');
  };
  await assertSource();
  await page.reload();await waitStatus(page,'版本冲突 · 草稿保留');await assertSource();
  assert.equal(await el(page,'conflict-workspace').textContent(),'Browser regression');
  assert.equal(await el(page,'conflict-page').textContent(),`${source.title}（${first}）`);
  assert.equal(await el(page,'conflict-base').getAttribute('title'),JSON.parse(originalDraft).base);
  assert.equal(await el(page,'conflict-disk').textContent(),revision.slice(7,19));
  assert.equal(await el(page,'conflict-disk-time').getAttribute('datetime'),modified_at);
  const {base_modified_at}=JSON.parse(originalDraft);
  assert.ok(Number.isFinite(Date.parse(base_modified_at)));
  assert.equal(await el(page,'conflict-base-time').getAttribute('datetime'),base_modified_at);
  assert.equal(await el(page,'conflict-disk').getAttribute('title'),revision);
  await el(page,'slide').focus();await page.keyboard.press('Delete');
  await page.keyboard.press('ArrowRight');await page.locator(`[data-page="${second}"][aria-current]`).waitFor();
  await go(page,first);await assertSource();
  await el(page,'present').click();await el(page,'present-slide').getByText('磁盘上的新对象文字').waitFor();
  await el(page,'close-present').click();
  await el(page,'export').click();
  const sourceDownload=page.waitForEvent('download');
  await el(page,'choose-export-download').click();
  const sourceExport=await sourceDownload;
  assert.equal(sourceExport.suggestedFilename(),`${first}.html`);
  assert.match(await readFile(await sourceExport.path(),'utf8'),/磁盘上的新对象文字/);
  await page.waitForFunction(()=>!document.getElementById('export').disabled);
  if(process.env.STUDIO_CONFLICT_SCREENSHOTS){
    await page.screenshot({path:join(process.env.STUDIO_CONFLICT_SCREENSHOTS,'studio-conflict-desktop.png')});
    await page.setViewportSize({width:320,height:760});
    await openConflict();
    await page.screenshot({path:join(process.env.STUDIO_CONFLICT_SCREENSHOTS,'studio-conflict-mobile.png')});
    await el(page,'cancel-conflict').click();
    await page.setViewportSize({width:1440,height:900});
  }
  await openConflict();await el(page,'view-conflict-draft').click();
  await el(page,'slide').getByText('磁盘上的新对象文字',{exact:true}).waitFor({state:'detached'});
  await el(page,'slide').getByText('组合文字',{exact:true}).waitFor();
  assert.equal(await el(page,'notes').inputValue(),'应该保留的旧草稿');
  assert.equal(await el(page,'notes').evaluate(node=>node.readOnly),false);
  assert.equal(await localBytes(),originalDraft);
  // A failed source read preserves the draft and supports retry in the same dialog.
  await openConflict();
  await page.route(`**${pageAPI}`,route=>route.fulfill({status:503,json:{error:'测试读取失败'}}),{times:1});
  await el(page,'view-conflict-source').click();
  await el(page,'conflict-status').getByText(/无法读取最新源文件/).waitFor();
  assert.equal(await localBytes(),originalDraft);
  await el(page,'view-conflict-source').click();await assertSource();
  assert.equal(await localBytes(),originalDraft);
  assert.equal(await saved(root,first),current);
  await openConflict();
  await el(page,'save-conflict-copy').click();
  const download=page.waitForEvent('download');
  await el(page,'choose-export-download').click();
  const exported=await download;
  assert.equal(exported.suggestedFilename(),`${first}-draft.html`);
  assert.match(await readFile(await exported.path(),'utf8'),/应该保留的旧草稿/);
  await el(page,'conflict-status').getByText(/当前草稿仍保留/).waitFor();
  assert.equal((await draft(page,first)).notes,'应该保留的旧草稿');
  assert.equal(await saved(root,first),current);
  await el(page,'discard-conflict').click();await el(page,'cancel-discard').click();
  assert.ok(await draft(page,first));
  await el(page,'discard-conflict').click();await el(page,'confirm-discard').click();
  await waitStatus(page,'与源文件一致');
  assert.equal(await el(page,'notes').inputValue(),'获准写回的新版本');
  assert.equal(await draft(page,first),undefined);
  assert.equal(await saved(root,first),current);
});

regression('partial-text-color',async({root,open})=>{
  const page=await open();
  await el(page,'add-text').click();
  const field=el(page,'object-text'), apply=el(page,'apply-text-color');
  await field.fill('甲重点乙');
  await field.evaluate(node=>node.setSelectionRange(1,1));
  await field.press('Shift+ArrowRight');await field.press('Shift+ArrowRight');
  await el(page,'text-range-color').fill('#c62828');
  await apply.click();
  const colored=el(page,'slide').locator('.object span').getByText('重点',{exact:true});
  await colored.waitFor();
  assert.equal(await colored.evaluate(node=>getComputedStyle(node).color),'rgb(198, 40, 40)');
  assert.equal(await colored.locator('..').textContent(),'甲重点乙');
  if(process.env.STUDIO_CONFLICT_SCREENSHOTS){
    await page.screenshot({path:join(process.env.STUDIO_CONFLICT_SCREENSHOTS,'studio-partial-text-color.png')});
  }
  await el(page,'clear-text-color').click();await colored.waitFor({state:'detached'});
  await el(page,'undo').click();await colored.waitFor();
  await page.reload();await waitStatus(page,'草稿已自动保存');await colored.waitFor();
  await el(page,'present').click();await el(page,'present-slide').locator('.object span').getByText('重点').waitFor();
  await el(page,'close-present').click();await review(page);await approve(page,200);
  await waitStatus(page,'与源文件一致');
  const html=await saved(root,first);
  assert.match(html,/甲<span style="color:#c62828">重点<\/span>乙/);
  assert.deepEqual(readHTML(html,first).objects.at(-1).textColors,[{start:1,end:3,color:'#c62828'}]);
});

const third={...target,id:'p03-browser',title:'跳过本页'};
const fourth={...target,id:'p04-browser',title:'末页'};
regression('conditional-export',async({root,open})=>{
  const page=await open();
  const button=el(page,'select-export'), dialog=el(page,'select-export-dialog');
  const format=el(page,'select-export-format'), range=el(page,'select-export-range');
  const next=el(page,'select-export-next'), summary=el(page,'select-export-summary');
  const choose=label=>dialog.getByRole('checkbox',{name:label});
  const download=async()=>{
    await next.click();
    const pending=page.waitForEvent('download');
    await el(page,'choose-export-download').click();
    return pending;
  };
  assert.equal(await page.locator('#edit-export-pdf + #select-export').count(),1);
  await layer(page,'edge').click();
  await el(page,'object-text').fill('条件导出的浏览器草稿');
  await el(page,'object-text').press('Tab');
  await waitStatus(page,'草稿已自动保存');
  await button.click();
  assert.equal(await next.isDisabled(),true);
  assert.equal(await format.evaluate(node=>document.activeElement===node),true);
  await range.fill('3-2');
  assert.match(await summary.innerText(),/起点不得大于终点/);
  await range.fill('5');
  assert.equal(await next.isDisabled(),true);
  await page.keyboard.press('Escape');
  await dialog.waitFor({state:'hidden'});
  assert.equal(await button.evaluate(node=>document.activeElement===node),true);

  await button.click();
  await choose('回归测试（2 页）').check();
  assert.equal(await choose(/2\. 浏览器回归目标页/).isChecked(),true);
  await choose(/2\. 浏览器回归目标页/).uncheck();
  assert.equal(await choose('回归测试（2 页）').evaluate(node=>node.indeterminate),true);
  await choose('回归测试（2 页）').check();
  await range.fill('4、1-2');
  await format.selectOption('html');
  assert.match(await summary.innerText(),/3 页.*离线 HTML/);
  if(process.env.STUDIO_EXPORT_PREVIEW){
    await page.screenshot({path:join(process.env.STUDIO_EXPORT_PREVIEW,'conditional-export.png')});
    await page.setViewportSize({width:390,height:680});
    const bounds=await dialog.boundingBox();
    assert.ok(bounds.x>=0&&bounds.x+bounds.width<=390&&bounds.y+bounds.height<=680);
    await page.screenshot({path:join(process.env.STUDIO_EXPORT_PREVIEW,'conditional-export-narrow.png')});
    await page.setViewportSize({width:1440,height:900});
  }
  const deck=await download();
  assert.match(deck.suggestedFilename(),/选页\.html$/);
  const deckPath=join(root,'exported.html');
  await deck.saveAs(deckPath);
  const offline=await browser.newContext({offline:true});
  try {
    const exported=await offline.newPage();
    await exported.goto(pathToFileURL(deckPath).href);
    assert.deepEqual(await exported.locator('.slide').evaluateAll(nodes=>nodes.map(node=>node.dataset.pageId)),[first,second,fourth.id]);
    assert.match(await exported.locator(`#page-${first}`).innerText(),/条件导出的浏览器草稿/);
    assert.equal(await exported.locator('#font-licenses').count(),1);
    assert.equal(await exported.evaluate(async()=>{
      await document.fonts.load('14px "Source Han Sans SC"','浏览');
      return [...document.fonts].some(font=>font.family==='Source Han Sans SC'&&font.status==='loaded');
    }),true);
    await exported.getByRole('link',{name:'3. 末页'}).click();
    assert.equal(new URL(exported.url()).hash,`#page-${fourth.id}`);
    if(process.env.STUDIO_EXPORT_PREVIEW){
      await exported.screenshot({path:join(process.env.STUDIO_EXPORT_PREVIEW,'exported-multipage.png')});
      await deck.saveAs(join(process.env.STUDIO_EXPORT_PREVIEW,'exported-multipage.html'));
    }
  } finally {await offline.close();}

  await button.click();await format.selectOption('html');
  await choose(/4\. 末页/).check();
  const html=await download();
  assert.equal(html.suggestedFilename(),`${fourth.id}.html`);
  const htmlBytes=await readFile(await html.path(),'utf8');
  assert.match(htmlBytes,/data:font\/woff2;base64,/);
  assert.deepEqual(JSON.parse(htmlBytes.match(/<script type="application\/json" id="slide-model">([\s\S]*?)<\/script>/)[1]),fourth);
  await button.click();await el(page,'select-export-current').click();
  await el(page,'select-export-clear').click();assert.equal(await next.isDisabled(),true);
  await range.fill('4, 1-2');
  // Exercise the selected-page PDF fallback without needing a system PDF renderer in CI.
  await page.evaluate(()=>{window.print=()=>{window.printedPages=[...document.querySelectorAll('#print-deck .slide')].map(slide=>slide.dataset.pageId);};});
  await page.route('**/api/pdf?*',async route=>{
    const {models,manifest_revision}=route.request().postDataJSON();
    assert.deepEqual(models.map(model=>model.id),[first,second,fourth.id]);
    assert.match(manifest_revision,/^sha256:/);
    await route.fulfill({status:501,json:{error:'No renderer'}});
  });
  await next.click();await el(page,'choose-export-download').click();
  await page.waitForFunction(()=>window.printedPages?.length);
  assert.deepEqual(await page.evaluate(()=>window.printedPages),[first,second,fourth.id]);
  assert.equal(await saved(root,first),renderHTML(source));
  assert.equal((await draft(page,first)).objects.find(o=>o.id==='edge').text,'条件导出的浏览器草稿');
},{extraSection:[third,fourth]});
