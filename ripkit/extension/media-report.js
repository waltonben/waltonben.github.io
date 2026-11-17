'use strict';

let mediaGeneration = 0;

function element(tag, text, className) {
 const node = document.createElement(tag);
 if (text != null) node.textContent = text;
 if (className) node.className = className;
 return node;
}

function formatBytes(bytes) {
 if (bytes < 1024) return bytes + ' B';
 if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
 return (bytes / 1048576).toFixed(1) + ' MB';
}

function imageFilename(asset, index, type) {
 let name = asset.symbolName || '';
 if (!name && asset.url && /^https?:/.test(asset.url)) {
  try { name = decodeURIComponent(new URL(asset.url).pathname.split('/').pop()); } catch {}
 }
 const ext = {jpeg:'jpg','svg+xml':'svg','vnd.microsoft.icon':'ico','x-icon':'ico'}[type] || type;
 const suffix = /^[a-z0-9]+$/i.test(ext) ? ext : 'img';
 name = name.replace(/[^\w. -]/g, '_').replace(/^\.+/, '').slice(0, 120);
 if (/\.(avif|bmp|gif|ico|jpe?g|png|svg|webp|tiff?)$/i.test(name)) {
  return name.replace(/\.[^.]+$/, '.' + suffix);
 }
 return (name || (asset.vector ? 'vector-' : 'image-') + (index + 1)) + '.' + suffix;
}

async function resizeSVGForDownload(blob, knownDimensions) {
 const namespace = 'http://www.w3.org/2000/svg';
 const doc = new DOMParser().parseFromString(await blob.text(), 'image/svg+xml');
 const original = doc.documentElement;
 if (original.localName !== 'svg' || original.namespaceURI !== namespace) {
  throw Error('Could not resize an invalid SVG.');
 }
 const dimensions = knownDimensions || await intrinsicImageDimensions(blob);
 // Chrome reports the intrinsic viewport in whole pixels. Prefer explicit
 // pixel dimensions, including fractions, when they agree with that viewport.
 const pixels = name => {
  const value = original.getAttribute(name)?.trim();
  return /^(?:\d+(?:\.\d+)?|\.\d+)(?:px)?$/i.test(value || '') ? parseFloat(value) : 0;
 };
 const width = pixels('width');
 const height = pixels('height');
 const explicit = width > 0 && height > 0 && (!dimensions ||
  (Math.abs(width - dimensions[0]) < 1 && Math.abs(height - dimensions[1]) < 1));
 const [originalWidth,originalHeight] = explicit ? [width,height] : dimensions || [];
 if (!(originalWidth > 0 && originalHeight > 0)) throw Error('Could not determine the SVG dimensions.');
 const outer = doc.createElementNS(namespace,'svg');
 outer.setAttribute('width','100');
 outer.setAttribute('height',String(100 * originalHeight / originalWidth));
 outer.setAttribute('viewBox','0 0 ' + originalWidth + ' ' + originalHeight);
 // Keep the original viewport inside the scaled wrapper, including its
 // viewBox, letterboxing, percentage coordinates and stylesheet context.
 doc.replaceChild(outer,original);
 outer.append(original);
 original.setAttribute('x','0');
 original.setAttribute('y','0');
 original.setAttribute('width',String(originalWidth));
 original.setAttribute('height',String(originalHeight));
 return new Blob([new XMLSerializer().serializeToString(doc)],{type:'image/svg+xml'});
}

function downloadMedia(url, name) {
 const link = element('a');
 link.href = url;
 link.download = name;
 document.body.append(link);
 link.click();
 link.remove();
}

async function splitSVGSprite(blob) {
 const ns = 'http://www.w3.org/2000/svg';
 const doc = new DOMParser().parseFromString(await blob.text(),'image/svg+xml');
 const root = doc.documentElement;
 if (root.localName !== 'svg' || root.namespaceURI !== ns) return [];
 for (const node of [...root.querySelectorAll('*')]) {
  if (node.namespaceURI !== ns || /^(script|foreignObject|iframe|style|animate.*|set)$/i.test(node.localName)) node.remove();
 }
 const safePaint = value => !/url\(/i.test(value.replace(/url\(\s*['"]?#[\w:.-]+['"]?\s*\)/gi,''));
 for (const node of [root,...root.querySelectorAll('*')]) {
  for (const attr of [...node.attributes]) {
   if (/^on/i.test(attr.localName) || attr.name === 'xml:base' || !safePaint(attr.value) ||
       (attr.localName === 'href' && !attr.value.startsWith('#') &&
        !(node.localName === 'image' && /^data:image\/(?:png|jpeg|gif|webp|avif);base64,/i.test(attr.value)))) {
    node.removeAttributeNode(attr);
   }
  }
 }
 const symbols = [...root.querySelectorAll('symbol[id]')];
 const ids = new Map([...root.querySelectorAll('[id]')].map(node => [node.id,node]));
 const serializer = new XMLSerializer();
 return symbols.map(symbol => {
  const svg = doc.createElementNS(ns,'svg');
  for (const name of ['viewBox','width','height','preserveAspectRatio']) {
   const value = symbol.getAttribute(name) || (name === 'viewBox' ? root.getAttribute(name) : null);
   if (value) svg.setAttribute(name,value);
  }
  const box = svg.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
  if (box?.length === 4 && box[2] > 0 && box[3] > 0) {
   if (!svg.hasAttribute('width')) svg.setAttribute('width',box[2]);
   if (!svg.hasAttribute('height')) svg.setAttribute('height',box[3]);
  }
  const defs = doc.createElementNS(ns,'defs');
  const artwork = doc.createElementNS(ns,'g');
  for (const name of ['fill','stroke','color','fill-rule','opacity']) {
   if (root.hasAttribute(name)) svg.setAttribute(name,root.getAttribute(name));
  }
  for (const attr of symbol.attributes) {
   if (!['id','viewBox','width','height','preserveAspectRatio','x','y'].includes(attr.name)) {
    artwork.setAttributeNS(attr.namespaceURI,attr.name,attr.value);
   }
  }
  for (const child of symbol.childNodes) artwork.append(child.cloneNode(true));
  const seen = new Set([symbol.id,...[...artwork.querySelectorAll('[id]')].map(node=>node.id)]);
  const pending = [artwork];
  while (pending.length) {
   const current = pending.pop();
   for (const node of [current,...current.querySelectorAll('*')]) {
    for (const attr of node.attributes) {
     const refs = [...attr.value.matchAll(/url\(\s*['"]?#([\w:.-]+)['"]?\s*\)/gi)].map(match=>match[1]);
     if (attr.localName === 'href' && attr.value.startsWith('#')) refs.push(attr.value.slice(1));
     for (const id of refs) {
      if (seen.has(id) || !ids.has(id)) continue;
      const dependency = ids.get(id).cloneNode(true);
      seen.add(id);
      for (const child of dependency.querySelectorAll('[id]')) seen.add(child.id);
      defs.append(dependency);
      pending.push(dependency);
     }
    }
   }
  }
  if (defs.childElementCount) svg.append(defs);
  svg.append(artwork);
  return {svg:serializer.serializeToString(svg),label:symbol.id,symbolName:symbol.id,vector:true};
 });
}

async function inspectSVG(blob) {
 const root = new DOMParser().parseFromString(await blob.text(), 'image/svg+xml').documentElement;
 if (root.localName !== 'svg') return {blob, type:'svg+xml', detail:''};
 const images = [...root.querySelectorAll('image')];
 const embedded = images.flatMap(image => {
  const href = image.getAttribute('href') || image.getAttributeNS('http://www.w3.org/1999/xlink','href') || '';
  const match = /^data:image\/(png|jpeg|gif|webp|avif|bmp|tiff?)[;,]/i.exec(href);
  return match ? [{href, type:match[1].toLowerCase()}] : [];
 });
 if (!embedded.length) return {blob, type:'svg+xml', detail:''};
 const typeNames = [...new Set(embedded.map(item => item.type.toUpperCase()))];
 const vectors = [...root.querySelectorAll('path,rect,circle,ellipse,line,polygon,polyline,text,use,foreignObject')];
 if (embedded.length === 1 && images.length === 1 &&
     !vectors.some(node => !node.closest('defs,clipPath,mask,pattern,symbol'))) {
  const item = embedded[0];
  try {
   const raster = await (await fetch(item.href)).blob();
   if (raster.size) return {blob:raster, type:item.type, detail:' · Embedded in SVG', extracted:true};
  } catch {}
 }
 return {blob, type:'svg+xml', detail:' · Contains embedded ' + typeNames.join(', ')};
}

let imageCards = [];
let imageView = 'all';
let imageListReady = false;
let imageListTruncated = false;

function matchesImageView(entry, view) {
 return view === 'all' || (view === 'logos' ? entry.isSVG : !entry.isSVG);
}

function compareImages(a,b) {
 return Number(b.isSVG) - Number(a.isSVG) || b.bytes - a.bytes || a.index - b.index;
}

const IMAGE_ROW_HEIGHT = 336;
const IMAGE_GAP = 16;
const previewURLs = [];
let visibleImages = [];
let imageFrame = null;
let currentWindow = '';

function createImageCard(entry) {
 const {asset,index,type,detail,extracted,file} = entry;
 const card = element('article', null, 'card image-card');
 const preview = element('div', 'Loading preview…', 'image-preview');
 const image = element('img');
 image.alt = asset.label || 'Image preview';
 image.loading = 'lazy';
 image.decoding = 'async';
 const dimensions = dims => (dims ? dims.join(' × ') + ' px' : 'Dimensions unavailable') +
  ' · ' + formatBytes(file.blob.size) + ' · ' +
  ({'svg+xml':'SVG',jpeg:'JPEG'}[type] || type.toUpperCase()) + detail;
 const info = element('p', dimensions(extracted ? null : asset.dimensions), 'meta');
 image.onload = () => { info.textContent = dimensions(!extracted && asset.vector && asset.dimensions ?
  asset.dimensions : [image.naturalWidth,image.naturalHeight]); };
 image.onerror = () => { preview.textContent = 'Preview unavailable'; };
 const url = URL.createObjectURL(file.blob);
 previewURLs.push(url);
 preview.replaceChildren(image);
 image.src = url;
 const button = element('button',entry.isSVG ? 'Save SVG' : 'Save image');
 button.onclick = async () => {
  if (!entry.isSVG) { downloadMedia(url,file.name); return; }
  button.disabled = true;
  try {
   const resized = URL.createObjectURL(await resizeSVGForDownload(file.blob,file.dimensions));
   downloadMedia(resized,file.name);
   setTimeout(() => URL.revokeObjectURL(resized),60000);
  } catch (error) { $('imageZipStatus').textContent = error.message; }
  finally { button.disabled = false; }
 };
 card.append(preview,element('h3',asset.label?.trim().slice(0,100) || 'Image ' + (index + 1)),info,button);
 return card;
}

function renderImageWindow() {
 imageFrame = null;
 const viewport = $('imageViewport');
 viewport.hidden = visibleImages.length === 0;
 const width = viewport.clientWidth;
 if (!width && visibleImages.length) return;
 const columns = Math.max(1, Math.min(5, Math.floor((width + IMAGE_GAP) / (240 + IMAGE_GAP))));
 const rows = Math.ceil(visibleImages.length / columns);
 const firstRow = Math.min(Math.max(0,rows - 1),Math.max(0,Math.floor(viewport.scrollTop / IMAGE_ROW_HEIGHT) - 2));
 const endRow = Math.min(rows,firstRow + Math.min(Math.floor(100 / columns),Math.ceil(viewport.clientHeight / IMAGE_ROW_HEIGHT) + 5));
 const from = firstRow * columns;
 const to = Math.min(visibleImages.length,endRow * columns);
 const key = columns + ':' + from + ':' + to;
 if (key === currentWindow) return;
 currentWindow = key;
 const grid = $('imageResults');
 grid.style.gridTemplateColumns = 'repeat(' + columns + ', minmax(0,1fr))';
 grid.replaceChildren();
 for (const url of previewURLs.splice(0)) URL.revokeObjectURL(url);
 grid.append(...visibleImages.slice(from,to).map(createImageCard));
 $('imageBefore').style.height = firstRow * IMAGE_ROW_HEIGHT + 'px';
 $('imageAfter').style.height = ((rows - endRow) * IMAGE_ROW_HEIGHT + (endRow < rows ? IMAGE_GAP : 0)) + 'px';
}

function scheduleImageWindow() {
 if (imageFrame === null) imageFrame = requestAnimationFrame(renderImageWindow);
}

$('imageViewport').addEventListener('scroll',scheduleImageWindow,{passive:true});
new ResizeObserver(scheduleImageWindow).observe($('imageViewport'));

function selectImageView(view) {
 imageView = view;
 for (const button of $('imageViews').querySelectorAll('button')) {
  button.setAttribute('aria-pressed',String(button.dataset.imageView === view));
 }
 visibleImages = imageCards.filter(entry => matchesImageView(entry,view));
 $('imageViewport').scrollTop = 0;
 currentWindow = '';
 renderImageWindow();
 if (!imageListReady) return;
 const noun = view === 'logos' ? 'logos' : view === 'images' ? 'images' : 'image files';
 $('imageStatus').textContent = (visibleImages.length ? visibleImages.length + ' ' + noun + ' available. Scroll to browse.' :
  'No ' + noun + ' available.') + (imageListTruncated ? ' The scan reached its asset or element limit.' : '');
}

$('imageViews').addEventListener('click',event => {
 const view = event.target.closest('button[data-image-view]')?.dataset.imageView;
 if (view) selectImageView(view);
});

function clearPageAssets() {
 mediaGeneration++;
 imageCards = [];
 imageListReady = false;
 selectImageView('all');
 $('imageDownload').disabled = true;
 $('imageDownload').value = '';
 $('imageProgressPanel').hidden = true;
 $('imageZipStatus').textContent = '';
 $('imageResults').replaceChildren();
 $('imageStatus').textContent = 'Scan a webpage to discover its images and vectors.';
 $('brandReport').replaceChildren();
 $('brandStatus').textContent = 'Scan a webpage to generate its brand report.';
 $('exportBrand').disabled = true;
}

function simplePathArtwork(root, source) {
 // This shortcut applies only to self-contained path icons with explicit paint.
 if (!root.hasAttribute('viewBox') || /var\(|url\(|\d(?:em|rem|ex|ch)\b/i.test(source)) return null;
 const nodes = [root, ...root.querySelectorAll('*')];
 const shapes = nodes.filter(node => ['path','circle'].includes(node.localName));
 if (!shapes.length || nodes.some(node => !['svg','g','path','circle'].includes(node.localName) ||
     (node !== root && node.localName === 'svg'))) return null;
 const attributes = new Set(['viewBox','width','height','xmlns','class','focusable','aria-hidden','style','d','fill','cx','cy','r']);
 if (nodes.some(node => [...node.attributes].some(attr => !attributes.has(attr.name) ||
     (node !== root && ['width','height','viewBox'].includes(attr.name))))) return null;
 const declarations = nodes.map(node => new Map((node.getAttribute('style') || '').split(';').flatMap(rule => {
  const colon = rule.indexOf(':');
  return colon < 0 ? [] : [[rule.slice(0,colon).trim(),rule.slice(colon+1).trim()]];
 })));
 const unused = new Set(['color','font-family','font-size','font-weight','stop-color','stop-opacity']);
 const paint = new Set(['fill','fill-opacity','fill-rule','stroke','stroke-width','stroke-opacity','stroke-linecap','stroke-linejoin','opacity']);
 if (declarations.some(style => [...style.keys()].some(key => !unused.has(key) && !paint.has(key)) ||
     style.get('stroke') !== 'none')) return null;
 if (shapes.some(shape => !/^(?:#[\da-f]+|rgba?\([\d., %]+\)|none)$/i.test(
  declarations[nodes.indexOf(shape)].get('fill') || ''))) return null;
 if (nodes.some(node => [...node.attributes].some(attr =>
  /currentcolor/i.test(attr.value) && attr.name !== 'fill'))) return null;
 const clone = root.cloneNode(true);
 const copies = [clone,...clone.querySelectorAll('*')];
 copies.forEach((node,index) => {
  for (const attr of ['class','focusable','aria-hidden']) node.removeAttribute(attr);
  const style = declarations[index];
  for (const key of unused) style.delete(key);
  if (!['path','circle'].includes(node.localName)) {
   style.delete('fill');
   node.removeAttribute('fill');
  }
  node.setAttribute('style',[...style].sort(([a],[b]) => a.localeCompare(b)).map(([key,value])=>key+':'+value).join(';'));
 });
 // The caller appends the viewport ratio, so differently shaped canvases stay separate.
 clone.removeAttribute('width');
 clone.removeAttribute('height');
 return new XMLSerializer().serializeToString(clone);
}

async function identifySVG(blob, dimensions) {
 const source = await blob.text();
 const root = new DOMParser().parseFromString(source,'image/svg+xml').documentElement;
 let artwork = source;
 if (root.localName === 'svg') {
  const pixels = value => /^\d+(?:\.\d+)?(?:px)?$/.test(value || '') ? parseFloat(value) : 0;
  const width = pixels(root.getAttribute('width'));
  const height = pixels(root.getAttribute('height'));
  const viewBox = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  dimensions ||= width && height ? [width,height] : null;
  const simpleArtwork = width && height ? simplePathArtwork(root,source) : null;
  if (simpleArtwork) {
   artwork = width / height + ':' + simpleArtwork;
  // With a viewBox, proportionate changes to the outer size preserve the artwork.
  } else if (width && height && viewBox.length === 4 && viewBox[2] > 0 && viewBox[3] > 0 &&
      Math.abs(width * viewBox[3] - height * viewBox[2]) < 0.000001) {
   artwork = source.replace(/<svg(?=[\s>])(?:[^"'<>]|"[^"]*"|'[^']*')*>/, tag =>
    tag.replace(/("[^"]*"|'[^']*')|\s+(?:width|height)\s*=\s*(?:"[^"]*"|'[^']*')/g,
     (match,quoted) => quoted || ''));
  }
 }
 const digest = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(artwork));
 return {key:new Uint8Array(digest).join(','),artwork,dimensions};
}

function svgPixelArea(dimensions) {
 return dimensions ? dimensions[0] * dimensions[1] : 0;
}

function isSinglePixel(dimensions) {
 return dimensions?.[0] === 1 && dimensions[1] === 1;
}

async function intrinsicImageDimensions(blob) {
 const url = URL.createObjectURL(blob);
 const image = new Image();
 try {
  image.src = url;
  await image.decode();
  return [image.naturalWidth,image.naturalHeight];
 } catch {
  return null;
 } finally {
  image.removeAttribute('src');
  URL.revokeObjectURL(url);
 }
}

async function showPageImages(assets, truncated) {
 const generation = mediaGeneration;
 imageListReady = false;
 imageListTruncated = truncated;
 $('imageStatus').textContent = assets.length ? 'Images appear as files are retrieved.' : '';
 const progress = $('imageProgress');
 const progressText = $('imageProgressText');
 $('imageProgressPanel').hidden = assets.length === 0;
 progress.max = Math.max(assets.length,1);
 progress.value = 0;
 let checked = 0;
 let duplicates = 0;
 let sprites = 0;
 const spriteSources = new Set();
 assets = [...assets];
 const seenSVGs = new Map();
 const updateProgress = () => {
  progress.max = Math.max(assets.length,1);
  progress.value = checked;
  const skipped = checked - imageCards.length - duplicates - sprites;
  const percent = assets.length ? Math.floor(checked / assets.length * 100) : 100;
  progressText.textContent = checked + ' of ' + assets.length + ' image files checked (' + percent + '%) · ' +
   imageCards.length + ' ready · ' + duplicates + ' duplicates · ' + skipped + ' skipped';
 };
 updateProgress();
 let cursor = 0;
 async function loadNext() {
  while (generation === mediaGeneration && cursor < assets.length) {
   const index = cursor++;
   const asset = assets[index];
   try {
    let source = asset.url;
    if (source && /^https?:/.test(source)) {
     const url = new URL(source);
     const hasFragment = Boolean(url.hash);
     url.hash = '';
     if (hasFragment) source = url.href;
     if (spriteSources.has(source)) { duplicates++; continue; }
    }
    let blob = asset.svg ? new Blob([asset.svg], {type:'image/svg+xml'}) : (await request(source, 'blob')).value;
    if (generation !== mediaGeneration) return;
    if (!blob.size) throw Error('Empty image file.');
    const mime = blob.type.split(';')[0];
    const inferred = asset.url?.match(/\.(avif|bmp|gif|ico|jpe?g|png|svg|webp|tiff?)(?:[?#]|$)/i)?.[1]?.toLowerCase();
    let type = mime.startsWith('image/') ? mime.slice(6) : inferred || '';
    if (!type || (type !== 'svg' && type !== 'svg+xml' && /^(text\/|application\/(html|json))/i.test(mime))) throw Error('The URL did not return an image.');
    let detail = '';
    let extracted = false;
    let identity;
    if (type === 'svg' || type === 'svg+xml') {
     if (!asset.symbolName) {
      const symbols = await splitSVGSprite(blob);
      if (generation !== mediaGeneration) return;
      if (symbols.length) {
       if (source && spriteSources.has(source)) { duplicates++; continue; }
       if (source) spriteSources.add(source);
       for (const symbol of symbols) assets.push(symbol);
       sprites++;
       continue;
      }
     }
     identity = await identifySVG(blob,asset.dimensions);
     if (generation !== mediaGeneration) return;
     ({blob,type,detail,extracted = false} = await inspectSVG(blob));
     if (generation !== mediaGeneration) return;
    }
    const isSVG = type === 'svg+xml' || type === 'svg';
    const imageType = {svg:'svg+xml',jpg:'jpeg',ico:'x-icon'}[type] || type;
    const mimeType = 'image/' + imageType;
    if (blob.type !== mimeType) blob = blob.slice(0,blob.size,mimeType);
    const captured = extracted ? null : identity?.dimensions || asset.dimensions;
    if (isSinglePixel(captured)) continue;
    // Captured SVG dimensions are sufficient for the exported vector canvas.
    const intrinsic = isSVG && captured ? null : await intrinsicImageDimensions(blob);
    if (generation !== mediaGeneration) return;
    if (isSinglePixel(intrinsic)) continue;
    const file = {name:imageFilename(asset,index,type),blob,dimensions:intrinsic || captured};
    const entry = {asset:{label:asset.label,dimensions:identity?.dimensions || asset.dimensions,vector:asset.vector},
     index,isSVG,bytes:blob.size,file,type,detail,extracted};
    if (identity) {
     const matches = seenSVGs.get(identity.key) || [];
     const existing = matches.find(item => item.artwork === identity.artwork);
     if (existing) {
      duplicates++;
      if (svgPixelArea(entry.asset.dimensions) > svgPixelArea(existing.entry.asset.dimensions)) {
       Object.assign(existing.entry,entry);
       currentWindow = '';
       scheduleImageWindow();
      }
      continue;
     }
     matches.push({artwork:identity.artwork,entry});
     seenSVGs.set(identity.key,matches);
    }
    imageCards.push(entry);
    if (matchesImageView(entry,imageView)) visibleImages.push(entry);
    scheduleImageWindow();
   } catch {
    // A failed fetch or unusable response leaves the asset out of every view.
   } finally {
    if (generation === mediaGeneration) {
     checked++;
     updateProgress();
    }
   }
  }
 }
 await Promise.all(Array.from({length: Math.min(5, assets.length)}, loadNext));
 if (generation !== mediaGeneration) return;
 imageCards.sort(compareImages);
 const download = $('imageDownload');
 download.disabled = imageCards.length === 0;
 download.options[2].disabled = !imageCards.some(entry => entry.isSVG);
 download.options[3].disabled = !imageCards.some(entry => !entry.isSVG);
 imageListReady = true;
 const previousTop = $('imageViewport').scrollTop;
 selectImageView(imageView);
 $('imageViewport').scrollTop = previousTop;
 scheduleImageWindow();
}

function reportTable(headers, rows) {
 const wrap = element('div', null, 'table-scroll');
 const table = element('table');
 const head = table.createTHead().insertRow();
 for (const title of headers) head.append(element('th', title));
 const body = table.createTBody();
 for (const values of rows) {
  const row = body.insertRow();
  for (const value of values) {
   const cell = row.insertCell();
   if (value instanceof Node) cell.append(value);
   else cell.textContent = value;
  }
 }
 wrap.append(table);
 return wrap;
}

function colourChip(value) {
 const chip = element('span', null, 'colour-chip');
 const dot = element('span', null, 'swatch');
 if (CSS.supports('color', value)) dot.style.backgroundColor = value;
 const rgb = value.match(/^rgb\((\d+), (\d+), (\d+)\)$/);
 const label = rgb ? '#' + rgb.slice(1).map(v => Number(v).toString(16).padStart(2, '0')).join('').toUpperCase() : value;
 chip.append(dot, element('span', label));
 return chip;
}

function renderBrandReport(brand) {
 const report = $('brandReport');
 const source = element('header', null, 'report-header');
 source.append(element('p', 'WEBSITE BRAND REPORT', 'eyebrow'),
  element('h1', brand.title || new URL(brand.url).hostname),
  element('p', brand.url), element('p', new Date(brand.capturedAt).toLocaleString() +
    ' · Viewport ' + brand.viewport.join(' × ') + ' px', 'meta'));
 report.replaceChildren(source);
 const detected = new Set(brand.typography.map(style => style.tag));
 const absent = ['H1','H2','H3','H4','H5','H6'].filter(tag => !detected.has(tag));
 report.append(buildMoodBoard(brand));
 report.append(element('h2', 'Typography'),
  reportTable(['Element','Font family stack','Size','Weight','Line height','Colour','Count'],
   brand.typography.map(t => [t.tag,t.family,t.size,t.weight,t.lineHeight,colourChip(t.colour),t.count])));
 if (absent.length) report.append(element('p', 'Headings not found in this scan: ' + absent.join(', ') + '.', 'meta'));
 report.append(element('h2','Observed colour palette'),
  reportTable(['Colour','Usage','Count'], brand.colours.map(c => [colourChip(c.value), c.usage,c.count])));
 report.append(element('h2','Button styles'));
 if (brand.buttons.length) {
  const ranked = brand.buttons;
  const primary = ranked.find(b => b.role === 'Primary') || ranked.find(b => !b.role);
  const secondary = ranked.find(b => b.role === 'Secondary') ||
   ranked.find(b => b !== primary && !b.role && (!primary ||
    b.background !== primary.background || b.colour !== primary.colour || b.border !== primary.border));
  report.append(reportTable(['Role','Fill','Text','Border','Count'], ranked.map(b => [
   b.role || (b === primary ? 'Primary (inferred)' : b === secondary ? 'Secondary (inferred)' : 'Other'),
   colourChip(b.background),colourChip(b.colour),colourChip(b.border),b.count
  ])));
  if (!primary || !secondary) report.append(element('p', (!primary ? 'Primary' : 'Secondary') + ' button style not identified.', 'meta'));
 } else report.append(element('p','No buttons were identified.'));
 report.append(element('p','Styles reflect the page at the captured viewport. The palette is ranked by observed usage. Button roles use class or variant labels where present and frequency otherwise. Font stacks show the CSS families and fallbacks declared by the page.', 'report-note'));
 $('brandStatus').textContent = '';
 $('exportBrand').disabled = false;
}

function selectMainTab(selected) {
 for (const tab of document.querySelectorAll('[role="tab"]')) {
  const active = tab === selected;
  tab.setAttribute('aria-selected', active);
  tab.tabIndex = active ? 0 : -1;
  $(tab.getAttribute('aria-controls')).hidden = !active;
 }
}

const mainTabs = [...document.querySelectorAll('[role="tab"]')];
mainTabs.forEach((tab, index) => {
 tab.onclick = () => selectMainTab(tab);
 tab.onkeydown = event => {
  const offset = {ArrowLeft:-1, ArrowRight:1}[event.key];
  if (offset == null && !['Home','End'].includes(event.key)) return;
  event.preventDefault();
  const next = mainTabs[event.key === 'Home' ? 0 : event.key === 'End' ? mainTabs.length - 1 :
   (index + offset + mainTabs.length) % mainTabs.length];
  selectMainTab(next);
  next.focus();
 };
});
$('exportBrand').onclick = () => {
 const original = document.title;
 const host = new URL($('brandReport').querySelector('.report-header h1 + p').textContent).hostname;
 document.title = host + ' - Brand Report';
 document.body.classList.add('print-brand');
 try { window.print(); }
 finally { document.body.classList.remove('print-brand'); document.title = original; }
};

$('imageDownload').onchange = async () => {
 const generation = mediaGeneration;
 const dropdown = $('imageDownload');
 const view = dropdown.value;
 dropdown.value = '';
 if (!view) return;
 const status = $('imageZipStatus');
 const used = new Set();
 const files = imageCards.filter(entry => matchesImageView(entry,view)).map(({file,isSVG}) => {
  const extension = file.name.match(/\.[^.]+$/)?.[0] || '';
  return {...file, isSVG, name:uniqueZipName(file.name.slice(0, file.name.length - extension.length),extension,used)};
 });
 if (!files.length) return;
 dropdown.disabled = true;
 status.textContent = 'Preparing image ZIP…';
 try {
  const archive = {all:'RipKit-Images.zip',logos:'RipKit-Logos.zip',images:'RipKit-Raster-Images.zip'}[view];
  for (const file of files) {
   if (file.isSVG) file.blob = await resizeSVGForDownload(file.blob,file.dimensions);
  }
  if (generation !== mediaGeneration) return;
  await downloadZip(files,archive);
  if (generation === mediaGeneration) status.textContent = files.length + ' images downloaded.';
 } catch (error) {
  if (generation === mediaGeneration) status.textContent = error.message;
 } finally {
  if (generation === mediaGeneration) dropdown.disabled = false;
 }
};
