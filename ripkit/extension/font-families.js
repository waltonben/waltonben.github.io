'use strict';

const previewQueue = [];
let activePreviews = 0;

function queueFontPreview(item) {
 return new Promise(resolve => {
  previewQueue.push({item, resolve});
  startFontPreviews();
 });
}

function startFontPreviews() {
 while (activePreviews < 6 && previewQueue.length) {
  const {item, resolve} = previewQueue.shift();
  activePreviews++;
  loadFont(item).finally(() => {
   activePreviews--;
   resolve();
   startFontPreviews();
  });
 }
}

function weightLabel(item) {
 const value = item.meta.weight || '400';
 return (value === 'normal' ? '400' : value === 'bold' ? '700' : value) +
  (item.meta.style && item.meta.style !== 'normal' ? ' ' + item.meta.style : '');
}

function groupFontCards() {
 const families = new Map();
 for (const item of state.fonts.values()) {
  const key = item.meta.family ? 'family:' + item.meta.family.toLowerCase() : item.url;
  if (!families.has(key)) families.set(key, []);
  families.get(key).push(item);
 }
 const results = $('results');
 for (const items of families.values()) {
  const title = items[0].meta.family || items[0].title.textContent;
  const family = element('article', null, 'card font-family');
  const variants = new Map();
  for (const item of items) {
   const range = /^(\d+)\s+(\d+)$/.exec(item.meta.weight || '');
   const steps = range ? [Number(range[1]), Number(range[2]),
    ...Array.from({length:9}, (_,i)=>(i+1)*100).filter(weight => weight > Number(range[1]) && weight < Number(range[2]))
   ] : [null];
   for (const weight of steps) {
    const label = weight === null ? weightLabel(item) :
     String(weight) + (item.meta.style && item.meta.style !== 'normal' ? ' ' + item.meta.style : '');
    const previous = variants.get(label);
    if (!previous || (!previous.item.face && item.face)) variants.set(label, {item, weight});
   }
   item.card.classList.add('family-variant');
   item.title.hidden = true;
  }
  const weights = [...variants.keys()].sort((a,b) => (parseInt(a) - parseInt(b)) || a.localeCompare(b));
  const picker = element('select');
  picker.setAttribute('aria-label', title + ' weight');
  for (const weight of weights) {
   const option = element('option', weight);
   option.value = weight;
   picker.append(option);
  }
  picker.value = variants.has('400') ? '400' : weights[0];
  const preview = element('div');
  const update = () => {
   const {item: variant, weight} = variants.get(picker.value);
   if (weight !== null) variant.sample.style.fontWeight = String(weight);
   variant.sample.textContent = $('preview').value;
   variant.sample.style.fontSize = $('size').value + 'px';
   preview.replaceChildren(variant.card);
  };
  picker.onchange = update;
  update();
  const zip = element('button','Download font family ZIP');
  const status = element('p',null,'meta');
  status.setAttribute('role','status');
  zip.onclick = () => saveFamilyZip(title, items, zip, status);
  family.append(element('h3',title), picker, preview, zip, status);
  results.append(family);
 }
 for (const item of state.fonts.values()) {
  if (item.card.parentElement === results) item.card.remove();
 }
 $('count').textContent = families.size;
 $('allFonts').disabled = families.size === 0;
}

const crcTable = Uint32Array.from({length:256}, (_,index) => {
 let value = index;
 for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
 return value >>> 0;
});

function crc32(bytes) {
 let crc = 0xffffffff;
 for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
 return (crc ^ 0xffffffff) >>> 0;
}

async function makeFontZip(files) {
 if (files.length > 65535) throw Error('Too many files for one ZIP.');
 const downloadedAt = new Date();
 // ZIP stores local wall-clock time with two-second resolution.
 const dosTime = (downloadedAt.getHours() << 11) | (downloadedAt.getMinutes() << 5) |
  Math.floor(downloadedAt.getSeconds() / 2);
 const dosDate = ((downloadedAt.getFullYear() - 1980) << 9) |
  ((downloadedAt.getMonth() + 1) << 5) | downloadedAt.getDate();
 const encoder = new TextEncoder();
 const localParts = [];
 const directory = [];
 let offset = 0;
 let directorySize = 0;
 for (const {name, blob} of files) {
  const encoded = encoder.encode(name);
  const size = blob.size;
  if (offset + size + 30 + encoded.length > 0xffffffff) throw Error('This ZIP exceeds 4 GB.');
  const crc = crc32(new Uint8Array(await blob.arrayBuffer()));
  const local = new DataView(new ArrayBuffer(30));
  const central = new DataView(new ArrayBuffer(46));
  local.setUint32(0, 0x04034b50, true);
  local.setUint16(4, 20, true);
  local.setUint16(6, 0x800, true);
  local.setUint16(10, dosTime, true);
  local.setUint16(12, dosDate, true);
  local.setUint32(14, crc, true);
  local.setUint32(18, size, true);
  local.setUint32(22, size, true);
  local.setUint16(26, encoded.length, true);
  central.setUint32(0, 0x02014b50, true);
  central.setUint16(4, 20, true);
  new Uint8Array(central.buffer, 6, 24).set(new Uint8Array(local.buffer, 4, 24));
  central.setUint32(42, offset, true);
  localParts.push(local.buffer, encoded, blob);
  directory.push(central.buffer, encoded);
  offset += 30 + encoded.length + size;
  directorySize += 46 + encoded.length;
 }
 if (offset + directorySize + 22 > 0xffffffff) throw Error('This ZIP exceeds 4 GB.');
 const end = new DataView(new ArrayBuffer(22));
 end.setUint32(0, 0x06054b50, true);
 end.setUint16(8, files.length, true);
 end.setUint16(10, files.length, true);
 end.setUint32(12, directorySize, true);
 end.setUint32(16, offset, true);
 return new Blob([...localParts,...directory,end.buffer], {type:'application/zip'});
}

function safeFileStem(value) {
 return value.replace(/[^a-z0-9_-]+/gi, '-').slice(0, 100) || 'Font';
}

function uniqueZipName(stem, extension, used) {
 let name = stem + extension;
 for (let i = 2; used.has(name.toLowerCase()); i++) name = stem + '-' + i + extension;
 used.add(name.toLowerCase());
 return name;
}

async function downloadZip(files, name) {
 const url = URL.createObjectURL(await makeFontZip(files));
 downloadMedia(url, name);
 setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function exportDesktopFont(item) {
 if (item.desktopFont) return item.desktopFont;
 const source = item.blob || (await request(item.url,'blob')).value;
 let data = await source.arrayBuffer();
 if (data.byteLength < 12) throw Error('Invalid font file.');
 const signature = new DataView(data).getUint32(0);
 if (signature === 0x774f4632) return item.desktopFont = await convertWOFF2(data);
 if (signature === 0x774f4646) data = await unpackWoff(data);
 const fmt = desktopFormat(new Uint8Array(data));
 const blob = new Blob([data],{type:'font/' + fmt});
 return item.desktopFont = {blob,fmt};
}

async function unpackWoff(data) {
 if (data.byteLength < 44) throw Error('Invalid WOFF header.');

 const view = new DataView(data);
 const count = view.getUint16(12);
 const length = view.getUint32(16);
 if (length > 64 * 1024 * 1024 || count === 0 || count > 4095 || 12 + count * 16 > length ||
     44 + count * 20 > data.byteLength) throw Error('Invalid WOFF table directory.');
 const output = new Uint8Array(length);
 const header = new DataView(output.buffer);
 const power = 2 ** Math.floor(Math.log2(count));
 header.setUint32(0,view.getUint32(4));
 header.setUint16(4,count);
 header.setUint16(6,power * 16);
 header.setUint16(8,Math.log2(power));
 header.setUint16(10,count * 16 - power * 16);
 let offset = 12 + count * 16;
 let headOffset = -1;
 for (let i = 0; i < count; i++) {
  const entry = 44 + i * 20;
  const begin = view.getUint32(entry + 4);
  const packed = view.getUint32(entry + 8);
  const length = view.getUint32(entry + 12);
  if (begin + packed > data.byteLength || offset + length > output.length || packed > length) throw Error('Invalid WOFF table.');
  let bytes = new Uint8Array(data, begin, packed);
  if (packed < length) {
   const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
   bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  }
  if (bytes.length !== length) throw Error('Invalid WOFF table length.');
  const target = 12 + i * 16;
  header.setUint32(target,view.getUint32(entry));
  header.setUint32(target + 4,view.getUint32(entry + 16));
  header.setUint32(target + 8,offset);
  header.setUint32(target + 12,length);
  output.set(bytes,offset);
  if (view.getUint32(entry) === 0x68656164 && length >= 12) headOffset = offset;
  offset += Math.ceil(length / 4) * 4;
 }
 if (headOffset < 0 || offset !== output.length) throw Error('Invalid reconstructed font.');
 header.setUint32(headOffset + 8,0);
 let checksum = 0;
 for (let i = 0; i < output.length; i += 4) checksum = (checksum + header.getUint32(i)) >>> 0;
 header.setUint32(headOffset + 8,(0xb1b0afba - checksum) >>> 0);
 return output.buffer;
}

async function saveFamilyZip(title, items, button, status) {
 button.disabled = true;
 const files = [];
 const notes = [];
 const used = new Set();
 try {
  for (const [index,item] of items.entries()) {
   status.textContent = 'Converting font ' + (index + 1) + ' of ' + items.length + '…';
   const label = (item.meta.family || item.title.textContent || 'Font') + '-' + weightLabel(item);
   try {
    const result = await exportDesktopFont(item);
    const name = uniqueZipName(safeFileStem(label), '.' + result.fmt, used);
    files.push({name,blob:result.blob});
   } catch (error) { notes.push(label + ': omitted (' + error.message + ').'); }
  }
  if (!files.length) throw Error('No desktop font files could be exported. ' + (notes[0] || ''));
  if (notes.length) files.push({name:'Download notes.txt',blob:new Blob([notes.join('\n')])});
  await downloadZip(files, safeFileStem(title) + '.zip');
  status.textContent = items.length - notes.length +
   ' desktop font files downloaded.' + (notes.length ? ' See Download notes.txt for conversion details.' : '');
 } catch (error) { status.textContent = error.message; }
 finally { button.disabled = false; }
}

$('allFonts').onclick = () => saveFamilyZip('RipKit-Fonts', [...state.fonts.values()], $('allFonts'), $('fontZipStatus'));
