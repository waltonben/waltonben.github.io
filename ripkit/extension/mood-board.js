'use strict';

function rankMoodColours(entries, toHex) {
 const counts = new Map();
 for (const entry of entries) {
  const hex = toHex(entry.value);
  if (hex) counts.set(hex, (counts.get(hex) || 0) + entry.count);
 }
 const ranked = [...counts].sort((a,b) => b[1] - a[1]);
 const total = ranked.reduce((sum,[,count]) => sum + count,0);
 const groups = [];
 const rgb = hex => [1,3,5].map(index => parseInt(hex.slice(index,index+2),16));
 for (const [hex,count] of ranked) {
  const channels = rgb(hex);
  // Compare with the representative to avoid chaining distinct colours together.
  const nearby = hex === '#FFFFFF' ? null : groups.find(group =>
   group.hex !== '#FFFFFF' && group.channels.every((channel,index) =>
    Math.abs(channel - channels[index]) <= 12));
  if (nearby) nearby.count += count;
  else groups.push({hex,channels,count});
 }
 groups.sort((a,b) => b.count - a.count);
 const topColours = groups.slice(0,5);
 const palette = topColours.filter(group => group.hex !== '#FFFFFF');
 const white = topColours.find(group => group.hex === '#FFFFFF');
 if (white) palette.push(white);
 return palette.map(({hex,count}) => ({hex, percentage: total ? 100 * count / total : 0}));
}

function buildMoodBoard(brand) {
 const board = element('section',null,'mood-board');
 board.append(element('h2','Brand mood board'));
 const layout = element('div',null,'mood-layout');
 const colours = element('div',null,'mood-colours');
 colours.append(element('h3','Colour palette'));
 const swatches = element('div',null,'mood-swatches');
 const context = document.createElement('canvas').getContext('2d',{willReadFrequently:true});
 const toHex = value => {
  if (!context || !CSS.supports('color',value)) return null;
  context.clearRect(0,0,1,1);
  context.fillStyle = value;
  context.fillRect(0,0,1,1);
  const [r,g,b,a] = context.getImageData(0,0,1,1).data;
  return a === 255 ? '#' + [r,g,b].map(n=>n.toString(16).padStart(2,'0')).join('').toUpperCase() : null;
 };
 for (const {hex,percentage} of rankMoodColours(brand.moodColours || brand.colours,toHex)) {
  const swatch = element('div');
  const tile = element('div',null,'mood-swatch');
  tile.style.backgroundColor = hex;
  const share = percentage > 0 && percentage < 0.1 ? '<0.1%' :
   percentage.toLocaleString(undefined,{maximumFractionDigits:1}) + '%';
  swatch.append(tile,element('span',hex),element('small',share,'mood-share'));
  swatches.append(swatch);
 }
 colours.append(swatches.childElementCount ? swatches : element('p','No opaque colours detected.'));
 if (swatches.childElementCount) {
  colours.append(element('p','Share of detected text and background colour uses. Similar shades are combined.','meta'));
 }
 const typography = element('div',null,'mood-type');
 typography.append(element('h3','Typography'));
 const headline = brand.typography.find(item=>item.tag === 'H1');
 const body = brand.paragraph || brand.typography.find(item=>item.tag === 'Body text') || brand.body;
 for (const [label,style] of [['Headline font',headline],['Body font',body]]) {
  const group = element('div',null,'mood-font');
  group.append(element('h4',label));
  if (!style?.family) {
   group.append(element('p','No H1 font detected.'));
  } else {
   const name = firstMoodFamily(style.family);
   const weight = {'100':'Thin','200':'Extra Light','300':'Light','400':'Regular','500':'Medium','600':'Semi Bold','700':'Bold','800':'Extra Bold','900':'Black'}[style.weight] || style.weight;
   const specimen = element('div',null,'mood-specimen');
   specimen.dataset.fontStack = style.family;
   specimen.style.fontFamily = style.family;
   specimen.style.fontWeight = style.weight;
   specimen.style.fontStyle = style.style || 'normal';
   specimen.append(element('div',[name,weight,style.style === 'italic' ? 'Italic' : ''].filter(Boolean).join(' '),'mood-font-name'),
    element('div','ABCDEFGHIJKLMNOPQRSTUVWXYZ','mood-alphabet'),
    element('div','abcdefghijklmnopqrstuvwxyz 1234567890','mood-alphabet'));
   group.append(specimen);
  }
  typography.append(group);
 }
 layout.append(colours,typography);
 board.append(layout);
 return board;
}

function firstMoodFamily(stack) {
 const match = /^\s*(?:"([^"]+)"|'([^']+)'|([^,]+))/.exec(stack);
 return (match?.[1] || match?.[2] || match?.[3] || stack).trim();
}

function refreshMoodBoardFonts() {
 for (const sample of document.querySelectorAll('.mood-specimen')) {
  const stack = sample.dataset.fontStack;
  const family = firstMoodFamily(stack).toLowerCase();
  const weight = Number(sample.style.fontWeight) || 400;
  const style = sample.style.fontStyle;
  const matches = [...state.fonts.values()].filter(item => item.face && item.meta.family?.toLowerCase() === family);
  const distance = item => {
   const [start,end=start] = (item.face.weight || '400').split(/\s+/).map(value =>
    value === 'normal' ? 400 : value === 'bold' ? 700 : Number(value));
   return ((item.face.style || 'normal') === style ? 0 : 1000) + Math.max(start-weight,weight-end,0);
  };
  matches.sort((a,b)=>distance(a)-distance(b));
  // Include subset faces of the same weight and style so their character ranges can cooperate.
  const aliases = matches.filter(item=>distance(item)===distance(matches[0])).map(item=>'"'+item.face.family+'"');
  sample.style.fontFamily = [...aliases,stack].join(', ');
 }
}
