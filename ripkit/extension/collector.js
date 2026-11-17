'use strict';
// Runs in Chrome's isolated world in the selected tab. No page script is evaluated.
function collectPageFonts(){
 const sources=[],links=new Set(),fontURLs=new Set(),seenSheets=new Set();let elements=0,truncated=false;
 function sheetData(sheet){
  if(seenSheets.has(sheet))return;seenSheets.add(sheet);
  const base=sheet.href||document.baseURI;
  try{
   const rules=[...sheet.cssRules];
   // Resolve imported stylesheets against their own URL, including constructed sheets.
   for(const rule of rules){if(rule.type===3){if(rule.styleSheet)sheetData(rule.styleSheet);else if(rule.href)links.add(new URL(rule.href,base).href)}}
   sources.push({text:rules.filter(r=>r.type!==3).map(r=>r.cssText).join('\n'),url:base});
  }catch{if(sheet.href)links.add(sheet.href)}
 }
 function visit(root){
  for(const sheet of root.styleSheets||[])sheetData(sheet);
  for(const sheet of root.adoptedStyleSheets||[])sheetData(sheet);
  for(const node of root.querySelectorAll('style,link[rel~="stylesheet"],link[rel~="preload"][as="style"]')){
   if(node.sheet)sheetData(node.sheet);
   else if(node.href)links.add(node.href);
   else if(node.tagName==='STYLE')sources.push({text:node.textContent,url:document.baseURI});
  }
  for(const node of root.querySelectorAll('link[as="font"]'))if(node.href)fontURLs.add(node.href);
  for(const node of root.querySelectorAll('*')){
   if(++elements>25000){truncated=true;break;}
   if(node.shadowRoot)visit(node.shadowRoot);
  }
 }
 visit(document);
 for(const entry of performance.getEntriesByType('resource'))if(/\.(woff2?|ttf|otf|eot)(?:[?#]|$)/i.test(entry.name))fontURLs.add(entry.name);
 return {url:location.href,title:document.title,sources,links:[...links],fontURLs:[...fontURLs],truncated};
}
