'use strict';

const genericFontFamilies = new Set([
 'serif','sans-serif','monospace','cursive','fantasy','system-ui','ui-serif',
 'ui-sans-serif','ui-monospace','ui-rounded','emoji','math','fangsong',
 '-apple-system','blinkmacsystemfont','-webkit-standard'
]);

function splitFontStack(stack) {
 return [...stack.matchAll(/(?:^|,)\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|([^,]+))/g)]
  .map(match => (match[1] ?? match[2] ?? match[3]).trim()).filter(Boolean);
}

async function detectLocalFamilies(stacks, webFamilies, available) {
 const matched = new Map();
 const cache = new Map();
 for (const stack of stacks) {
  for (const family of splitFontStack(stack)) {
   const key = family.toLowerCase();
   if (isFontAwesome(family)) continue;
   if (genericFontFamilies.has(key) || webFamilies.has(key)) break;
   if (!cache.has(key)) cache.set(key, await available(family));
   const face = cache.get(key);
   if (face) {
    matched.set(key,{family,face});
    break;
   }
  }
 }
 return [...matched.values()];
}

async function probeLocalFont(family) {
 for (const name of [family,family+' Regular']) {
  try {
   const alias = 'scout_local_' + Math.random().toString(36).slice(2);
   // Escape quotes and backslashes before passing a name to the CSS parser.
   const source = 'local("' + name.replace(/["\\]/g,'\\$&').replace(/[\r\n\f]/g,' ') + '")';
   return await new FontFace(alias,source).load();
  } catch {}
 }
 return null;
}

async function renderLocalFonts(brand) {
 if (!brand?.textStacks?.length) return 0;
 const webFamilies = new Set((brand.loadedFamilies || []).flatMap(splitFontStack).map(name=>name.toLowerCase()));
 const found = await detectLocalFamilies(brand.textStacks,webFamilies,probeLocalFont);
 for (const {family,face} of found.sort((a,b)=>a.family.localeCompare(b.family))) {
  document.fonts.add(face);
  state.faces.push(face);
  const card = element('article',null,'card font-family');
  const sample = element('div',$('preview').value,'sample');
  sample.style.fontFamily = '"' + face.family + '", sans-serif';
  sample.style.fontSize = $('size').value + 'px';
  const label = element('span','Local font family','local-font-label');
  card.append(element('h3',family),sample,label);
  $('results').append(card);
 }
 $('count').textContent = Number($('count').textContent) + found.length;
 return found.length;
}
