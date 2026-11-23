const invalid=message=>Object.assign(new Error(message),{status:409});
const row=/^\|[ \t]*`([a-z][a-z0-9-]*)`[ \t]*\|[^\r\n]*$/gm;
export function parseStoryline(text,expectedIds) {
  const rows=[...text.matchAll(row)];
  if(!rows.length||JSON.stringify(rows.map(m=>m[1]))!==JSON.stringify(expectedIds))throw invalid('STORYLINE.md 的页 ID 或顺序与清单不一致，请先同步。');
  const endOf=m=>m.index+m[0].length;
  const start=rows[0].index, end=endOf(rows.at(-1));
  const separator=rows.length>1?text.slice(endOf(rows[0]),rows[1].index):text.match(/\r?\n/)?.[0];
  const newline=separator==='\r\n'?'\r\n':'\n';
  if(text.slice(start,end)!==rows.map(m=>m[0]).join(newline))throw invalid('STORYLINE.md 的页面行须连续且换行格式一致，请先整理。');
  return {rows,start,end,newline};
}
