'use strict';

let sitemap = null;

function sitemapOrigin() {
 const url = new URL(baseURL());
 if (url.hostname === 'import.invalid') throw Error('Enter a website URL first.');
 return url.origin;
}

function sameOriginURL(value, base, origin) {
 try {
  const url = new URL(value, base);
  if (url.origin !== origin || url.username || url.password) return null;
  url.hash = '';
  return url.href;
 } catch { return null; }
}

async function readSitemap(origin) {
 const pending = [origin + '/sitemap.xml'];
 const checked = new Set();
 const pages = new Set();
 let failed = 0;
 while (pending.length) {
  const url = pending.pop();
  if (checked.has(url)) continue;
  checked.add(url);
  try {
   const response = await request(url, 'blob');
   if (!sameOriginURL(response.url, url, origin)) throw Error('Sitemap redirects to another origin.');
   const first = new Uint8Array(await response.value.slice(0, 2).arrayBuffer());
   const xml = first[0] === 31 && first[1] === 139 ?
    await new Response(response.value.stream().pipeThrough(new DecompressionStream('gzip'))).text() :
    await response.value.text();
   const root = new DOMParser().parseFromString(xml, 'application/xml').documentElement;
   if (!['urlset','sitemapindex'].includes(root.localName) || root.querySelector('parsererror')) {
    throw Error('The URL did not return a valid XML sitemap.');
   }
   const isIndex = root.localName === 'sitemapindex';
   for (const entry of root.children) {
    if (entry.localName !== (isIndex ? 'sitemap' : 'url')) continue;
    const loc = [...entry.children].find(node => node.localName === 'loc');
    if (!loc) continue;
    const target = sameOriginURL(loc.textContent.trim(), url, origin);
    if (!target) continue;
    if (isIndex) pending.push(target);
    else pages.add(target);
   }
  } catch (error) {
   if (checked.size === 1) throw error;
   failed++;
  }
 }
 return {origin, pages: [...pages], failed};
}

function recordSiteImage(raw, base, label) {
 if (!raw) return;
 const url = resolve(raw, base);
 if (!url || (url.startsWith('data:') && !/^data:image\//i.test(url))) return;
 if (!state.siteImages.has(url)) state.siteImages.set(url, {url, label});
}

function collectCSSImages(style, base) {
 for (const prop of ['background-image','background','mask-image','content','list-style-image','border-image-source']) {
  for (const url of urls(style.getPropertyValue(prop))) recordSiteImage(url, base, 'CSS image');
 }
}

async function collectSitePage(url, origin) {
 const response = await request(url);
 if (!sameOriginURL(response.url, url, origin)) throw Error('Page redirects to another origin.');
 const template = document.createElement('template');
 template.innerHTML = response.value;
 const page = template.content;
 const base = resolve(page.querySelector('base[href]')?.getAttribute('href') || response.url, response.url) || response.url;
 for (const node of page.querySelectorAll('img, picture source, link[as="image"], svg image, svg use')) {
  for (const attr of ['src','data-src','href','xlink:href']) {
   const value = node.getAttribute(attr);
   if (value && !value.startsWith('#')) recordSiteImage(value, base, node.getAttribute('alt'));
  }
  for (const attr of ['srcset','data-srcset','imagesrcset']) {
   const set = (node.getAttribute(attr) || '').trim();
   for (const match of set.matchAll(/(?:^|,\s*)((?:data:\S+|[^\s,]+))\s*(?:\d+(?:\.\d+)?[wx])?(?=\s*(?:,|$))/gi)) {
    recordSiteImage(match[1].replace(/,+$/, ''), base, node.getAttribute('alt'));
   }
  }
 }
 for (const node of page.querySelectorAll('[style]')) collectCSSImages(node.style, base);
 for (const node of page.querySelectorAll('svg')) {
  if (node.ownerSVGElement || (node.querySelector('use') && !node.querySelector('symbol'))) continue;
  // Sanitise detached SVG before creating a downloadable copy.
  node.querySelectorAll('script, foreignObject, style, animate, set').forEach(child => child.remove());
  for (const child of [node, ...node.querySelectorAll('*')]) {
   for (const attr of [...child.attributes]) {
    if (/^on/i.test(attr.name) || attr.localName === 'style' ||
        (attr.localName === 'href' && !attr.value.startsWith('#') &&
         !(child.localName === 'image' && /^data:image\/(?:png|jpeg|gif|webp|avif|bmp|tiff?)[;,]/i.test(attr.value))) ||
        (/url\(/i.test(attr.value) && !/^url\(['"]?#/.test(attr.value))) child.removeAttributeNode(attr);
   }
  }
  node.setAttribute('xmlns','http://www.w3.org/2000/svg');
  const svg = new XMLSerializer().serializeToString(node);
  if (!state.siteImages.has(svg)) state.siteImages.set(svg, {svg, label:'Inline vector', vector:true});
 }
 for (const node of page.querySelectorAll('style')) await readCSS(node.textContent, base);
 const preloadedFonts = [];
 for (const node of page.querySelectorAll('link[href]')) {
  const target = resolve(node.getAttribute('href'), base);
  if (!target) continue;
  const rel = node.rel.toLowerCase().split(/\s+/);
  if (rel.includes('stylesheet') || (rel.includes('preload') && node.getAttribute('as') === 'style')) await fetchCSS(target);
  else if (node.getAttribute('as') === 'font' || extRE.test(target)) preloadedFonts.push(target);
 }
 for (const target of preloadedFonts) addFont(target);
}

$('checkSitemap').onclick = async () => {
 if (state.busy) return;
 const status = $('sitemapStatus');
 $('scanSite').hidden = true;
 sitemap = null;
 try {
  const origin = sitemapOrigin();
  await grantAccess();
  busy(true);
  status.textContent = 'Checking /sitemap.xml…';
  sitemap = await readSitemap(origin);
  const count = sitemap.pages.length;
  status.textContent = count ? count + ' pages found. Reads published HTML and CSS.' : 'No same-origin pages found in the sitemap.';
  if (sitemap.failed) status.textContent += ' ' + sitemap.failed + ' child sitemaps could not be read.';
  $('scanSite').hidden = !count;
 } catch (error) { status.textContent = error.message; }
 finally { busy(false); }
};

$('scanSite').onclick = async () => {
 if (!sitemap || state.busy) return;
 try {
  if (sitemapOrigin() !== sitemap.origin) throw Error('Check the sitemap for this website first.');
  clearPageAssets();
  const {origin, pages} = sitemap;
  await run(async () => {
   state.siteImages = new Map();
   $('imageStatus').textContent = 'Finding image URLs in sitemap pages. File checks start after page discovery.';
   let completed = 0;
   let failed = 0;
   try {
    for (const page of pages) {
     $('sitemapStatus').textContent = 'Scanning page ' + (completed + 1) + ' of ' + pages.length + '…';
     try { await collectSitePage(page, origin); }
     catch (error) { failed++; log(page + ': ' + error.message); }
     completed++;
    }
    const images = [...state.siteImages.values()];
    $('sitemapStatus').textContent = (completed - failed) + ' of ' + pages.length + ' pages read. ' + images.length + ' unique images found.';
    void showPageImages(images, false);
   } finally { state.siteImages = null; }
  });
 } catch (error) { $('sitemapStatus').textContent = error.message; }
};

$('url').addEventListener('input', () => {
 $('scanSite').hidden = true;
 $('sitemapStatus').textContent = '';
 sitemap = null;
});
