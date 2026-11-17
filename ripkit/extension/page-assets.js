'use strict';

function collectPageAssets() {
 const assets = new Map();
 const typography = new Map();
 const paragraphs = new Map();
 const textStacks = new Set();
 const colours = new Map();
 const buttons = new Map();
 const imagePattern = /\.(avif|bmp|gif|ico|jpe?g|png|svg|webp|tiff?)(?:[?#]|$)/i;
 const svgNS = 'http://www.w3.org/2000/svg';
 let svgCount = 0;
 let svgBytes = 0;
 let truncated = false;
 function addImage(raw, label, dimensions) {
  if (!raw) return;
  try {
   const url = new URL(raw, document.baseURI);
   if (!/^https?:$/.test(url.protocol) && !/^data:image\//i.test(url.href)) return;
   if (assets.has(url.href)) return;
   if (assets.size >= 300) { truncated = true; return; }
   assets.set(url.href, {url: url.href, label, dimensions});
  } catch {}
 }
 function count(map, value) {
  const key = JSON.stringify(value);
  const existing = map.get(key);
  if (existing) existing.count++;
  else map.set(key, {...value, count: 1});
 }
 function inlineSVG(node, rect, sprite = false) {
  if (assets.size >= 300 || svgCount >= 100) { truncated = true; return; }
  const clone = node.cloneNode(true);
  clone.setAttribute('xmlns', svgNS);
  if (!sprite) {
   clone.setAttribute('width', Math.round(rect.width));
   clone.setAttribute('height', Math.round(rect.height));
  }
  const originals = [node, ...node.querySelectorAll('*')];
  const copies = [clone, ...clone.querySelectorAll('*')];
  const paint = ['fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width',
   'stroke-opacity', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'color',
   'font-family', 'font-size', 'font-weight', 'stop-color', 'stop-opacity'];
  for (let i = 0; i < copies.length; i++) {
   const copy = copies[i];
   if (/^(script|style|foreignobject|iframe|animate.*|set)$/i.test(copy.localName)) {
    copy.remove();
    continue;
   }
   for (const attr of [...copy.attributes]) {
    if (/^on/i.test(attr.name) || attr.localName === 'style' ||
       (attr.localName === 'href' && !attr.value.startsWith('#') &&
         !(copy.localName === 'image' && /^data:image\/(?:png|jpeg|gif|webp|avif|bmp|tiff?)[;,]/i.test(attr.value))) ||
       (/url\(/i.test(attr.value) && !/^url\(['"]?#/.test(attr.value))) {
     copy.removeAttributeNode(attr);
    }
   }
   const style = getComputedStyle(originals[i]);
   for (const prop of paint) {
    const value = style.getPropertyValue(prop);
    if (value && !/url\(/i.test(value)) copy.style.setProperty(prop, value);
   }
  }
  const label = node.getAttribute('aria-label') || node.querySelector('title')?.textContent || 'Inline vector';
  const svg = new XMLSerializer().serializeToString(clone);
  if (svg.length > 500000 || svgBytes + svg.length > 5000000) { truncated = true; return; }
  svgBytes += svg.length;
  assets.set('inline-' + (++svgCount), {
   svg, label, dimensions: sprite ? null : [Math.round(rect.width), Math.round(rect.height)], vector: true
  });
 }
 const roots = [document];
 let inspected = 0;
 for (const root of roots) {
  for (const node of root.querySelectorAll('*')) {
   if (++inspected > 12000) { truncated = true; break; }
   if (node.shadowRoot) roots.push(node.shadowRoot);
   const tag = node.localName;
   if (tag === 'img') addImage(node.currentSrc || node.src, node.alt,
    node.naturalWidth ? [node.naturalWidth, node.naturalHeight] : null);
   if (['image','use'].includes(tag) && node.namespaceURI === svgNS) {
    const href = node.getAttribute('href') || node.getAttribute('xlink:href');
    if (href && !href.startsWith('#')) addImage(href, tag === 'use' ? 'SVG sprite' : 'SVG image');
   }
   const rect = node.getBoundingClientRect();
   if (tag === 'svg' && !node.ownerSVGElement && node.querySelector('symbol')) {
    inlineSVG(node, rect, true);
    continue;
   }
   if (!rect.width || !rect.height) continue;
   const css = getComputedStyle(node);
   if (css.visibility === 'hidden' || css.opacity === '0') continue;
   if (tag === 'svg' && !node.ownerSVGElement && !node.querySelector('use')) inlineSVG(node, rect);
   for (const style of [css, getComputedStyle(node, '::before'), getComputedStyle(node, '::after')]) {
    for (const value of [style.backgroundImage, style.maskImage, style.content]) {
     for (const match of (value || '').matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/g)) {
      addImage(match[1] ?? match[2] ?? match[3], 'CSS image');
     }
    }
   }
   const isButton = node.matches('button, [role="button"], input[type="submit"], input[type="button"], a[class*="btn"], a[class*="button"]');
   const ownText = [...node.childNodes].some(child => child.nodeType === 3 && child.textContent.trim());
   const isHeading = /^h[1-6]$/.test(tag);
   const textStyle = {
    family: css.fontFamily, size: css.fontSize, weight: css.fontWeight,
    lineHeight: css.lineHeight, colour: css.color, style: css.fontStyle
   };
   if (tag === 'p' && node.textContent.trim()) count(paragraphs, textStyle);
   if (isHeading || ownText || isButton) {
    textStacks.add(css.fontFamily);
    count(typography, {tag: isHeading ? tag.toUpperCase() : isButton ? 'Button' : 'Body text', ...textStyle});
    count(colours, {value: css.color, usage: 'Text'});
   }
   if (css.backgroundColor !== 'rgba(0, 0, 0, 0)') {
    count(colours, {value: css.backgroundColor, usage: 'Background'});
   }
   if (isButton) {
    const hint = (node.getAttribute('class') || '') + ' ' + (node.getAttribute('data-variant') || '');
    const role = /\bsecondary\b|\boutline\b/i.test(hint) ? 'Secondary' :
     /\bprimary\b/i.test(hint) ? 'Primary' : '';
    const border = css.borderTopStyle === 'none' ? 'None' : css.borderTopColor;
    const fill = css.backgroundImage === 'none' ? css.backgroundColor : css.backgroundImage;
    count(buttons, {role, background: fill, colour: css.color, border});
   }
  }
  if (inspected > 12000) break;
 }
 for (const entry of performance.getEntriesByType('resource')) {
  if (entry.initiatorType === 'img' || imagePattern.test(entry.name)) addImage(entry.name, 'Loaded image');
 }
 const ranked = map => [...map.values()].sort((a, b) => b.count - a.count);
 const styles = ranked(typography);
 // Computed styles report the default unvisited link blue as RGB.
 const brandColours = ranked(colours).filter(({value}) =>
  !/^(?:#0000ee|rgb\(0,0,238\)|rgba\(0,0,238,1\))$/i.test(value.replace(/\s+/g,''))
 );
 return {
  images: [...assets.values()], truncated,
  brand: {
   url: location.href, title: document.title, capturedAt: new Date().toISOString(),
   viewport: [innerWidth, innerHeight],
   typography: ['H1','H2','H3','H4','H5','H6','Body text','Button'].flatMap(
    tag => styles.filter(style => style.tag === tag).slice(0, 4)
   ),
   textStacks: [...textStacks],
   loadedFamilies: [...document.fonts].filter(face => face.status === 'loaded').map(face => face.family),
   paragraph: ranked(paragraphs)[0] || null,
   body: document.body ? {family: getComputedStyle(document.body).fontFamily, weight: getComputedStyle(document.body).fontWeight, style: getComputedStyle(document.body).fontStyle} : null,
   moodColours: brandColours,
   colours: brandColours.slice(0, 16),
   buttons: ranked(buttons).slice(0, 12)
  }
 };
}
