// Build a compact half-letter checklist card from a full checklist JSON plus a card sidecar.
const PDFDocument=require('pdfkit');
const fs=require('fs'),path=require('path');
// Usage: node cards/make-card.js cards/N100FP-card.json out.pdf
const [,, sidecarPath, outPath]=process.argv;
const side=JSON.parse(fs.readFileSync(sidecarPath,'utf8'));
const main=JSON.parse(fs.readFileSync(path.resolve(path.dirname(sidecarPath),side.source),'utf8'));
const strip=t=>t.replace(/\s+#$/,'');
const norm=p=>p.replace(/^# /,'');
const srcPath=path.resolve(path.dirname(sidecarPath),side.source);
let srcDate;
try{srcDate=require('child_process').execFileSync('git',['log','-1','--format=%cs','--',srcPath],{cwd:path.dirname(srcPath),encoding:'utf8'}).trim();}catch(e){}
if(!srcDate)srcDate=fs.statSync(srcPath).mtime.toISOString().slice(0,10);
let srcRev='';
try{srcRev=require('child_process').execFileSync('git',['rev-list','--count','HEAD','--',srcPath],{cwd:path.dirname(srcPath),encoding:'utf8'}).trim();}catch(e){}
const STAMP=process.env.BUILD_STAMP||('Local build '+new Date().toISOString().slice(0,16).replace('T',' ')+'Z');
const DRAFT=process.env.CHECKLIST_DRAFT!=='0';
const provenance=(srcRev?'Rev '+srcRev+' ('+srcDate+')':'Checklist dated '+srcDate)+' · '+STAMP;
const lists={};
for(const g of main.groups)for(const c of g.checklists)lists[strip(c.title)]=c.items;
const problems=[],unlinked=[];let linked=0;
function resolve(spec){
  if(spec.startsWith('!')){unlinked.push(spec.slice(1));return spec.slice(1);}
  const [ref,short]=spec.split(' => ');
  const m=ref.match(/^(.*?)\|(.*?)(?:~(\d+))?$/);
  if(!m){problems.push('bad spec '+spec);return spec;}
  const [,cl,prompt,nStr]=m;const n=nStr?+nStr:1;
  const items=lists[cl]||lists[Object.keys(lists).find(k=>k.startsWith(cl))];
  if(!items){problems.push(`NO CHECKLIST "${cl}" for ${spec}`);return short||prompt;}
  const hits=items.filter(i=>norm(i.prompt)===prompt);
  if(hits.length<n){problems.push(`NO ITEM "${cl}|${prompt}" occurrence ${n}`);return short||prompt;}
  const it=hits[n-1];linked++;
  const src=(it.prompt+' '+(it.expectation||'')).replace(/,/g,'');
  if(short){
    for(const num of (short.match(/\d+(?:\.\d+)?/g)||[])){
      if(!src.includes(num))problems.push(`NUMBER ${num} in "${short}" not in source "${it.prompt} = ${it.expectation||''}"`);
    }
    return short;
  }
  return norm(it.prompt)+(it.expectation?' – '+it.expectation:'');
}
const COL={blue:'#1f4e9c',green:'#2e7d32',orange:'#c26a00',red:'#b3261e',purple:'#6a3d9a',yellow:'#c9a100'};
const W=396,H=612,M=14,G=5,FS=6.5,LH=1.0;
const doc=new PDFDocument({size:[W,H],margins:{top:0,bottom:0,left:0,right:0},autoFirstPage:false});
doc.pipe(fs.createWriteStream(outPath));
function fit(x,y,w,block,limit,label){
  doc.font('Helvetica-Bold').fontSize(6.4);
  doc.rect(x,y,w,9.5).fill(COL[block.color]||'#333');
  doc.fillColor('#fff').text(block.head,x+2,y+1.9,{width:w-4,lineBreak:false});
  y+=11.5;
  doc.font('Helvetica').fontSize(FS).fillColor('#000');
  for(const spec of block.lines){
    const t=resolve(spec);
    const h=doc.heightOfString(t,{width:w-2});
    if(y+h<H-2)doc.text(t,x+1,y,{width:w-2});
    y+=h+LH;
  }
  if(y>limit)problems.push(`OVERFLOW ${label} ${block.head}: y=${y.toFixed(0)} > ${limit}`);
  return y+3;
}
function cols(arr,top,limit,n,label){
  const w=(W-2*M-(n-1)*G)/n;
  arr.forEach((blocks,i)=>{let y=top;for(const b of blocks)y=fit(M+i*(w+G),y,w,b,limit,label+' c'+(i+1));});
}
function header(t,sub){
  doc.rect(0,0,W,16).fill('#12233f');
  doc.fillColor('#fff').font('Helvetica-Bold').fontSize(9).text(t,M,4,{lineBreak:false,continued:DRAFT});
  if(DRAFT)doc.fillColor('#ff9a3c').text('   DRAFT',{lineBreak:false});
  doc.fillColor('#fff').font('Helvetica').fontSize(6).text((srcRev?'Rev '+srcRev+' · ':'Checklist dated ')+srcDate,W-M-110,5.5,{width:110,align:'right',lineBreak:false});
  doc.fillColor('#666').font('Helvetica').fontSize(5).text('Source: '+provenance+(DRAFT?' · DRAFT: not for operational use':''),M,H-7.5,{width:W-2*M,align:'right',lineBreak:false});
  doc.y=18.5;
  doc.font('Helvetica').fontSize(5.6).fillColor('#222').text(sub,M,18.5,{width:W-2*M});
}
// FRONT
doc.addPage();
header(side.title,side.subtitle);
const BAND=side.bandHeight||175,colTop=32,colLimit=H-M-BAND;
cols(side.front,colTop,colLimit,4,'front');
// bottom band: speeds (auto from V Speeds checklist), boxes
let by=colLimit+4;
doc.moveTo(M,by-2).lineTo(W-M,by-2).lineWidth(.5).strokeColor('#999').stroke();
const spKey=Object.keys(lists).find(k=>k.startsWith(side.speedsChecklist));
const sp=lists[spKey];
if(!sp)problems.push('no speeds checklist');
else{
  const w3=(W-2*M-2*G)/3;
  const groups=[];let cur=null;
  for(const it of sp){
    if(it.type==='ITEM_TITLE'){cur={head:it.prompt,lines:[]};groups.push(cur);}
    else if(it.type==='ITEM_PLAINTEXT'){if(!cur){cur={head:'',lines:[]};groups.push(cur);}cur.lines.push(it.prompt);}
  }
  // side.speeds (optional): curated, linked speed lines. Otherwise: auto from the V Speeds list.
  // flat list (no section titles): split evenly across the 3 columns
  let colsG;
  if(side.speeds){
    const L=side.speeds.map(resolve),k=Math.ceil(L.length/3);
    colsG=[0,1,2].map(i=>[{head:'',lines:L.slice(i*k,(i+1)*k)}]);
  }else if(groups.length===1&&!groups[0].head){
    const L=groups[0].lines,k=Math.ceil(L.length/3);
    colsG=[0,1,2].map(i=>[{head:'',lines:L.slice(i*k,(i+1)*k)}]);
  }else{
    const total=groups.reduce((a,g)=>a+g.lines.length+1.6,0);
    colsG=[[],[],[]];let acc=0;
    for(const g of groups){const idx=Math.min(2,Math.floor(acc/(total/3)+0.0001));colsG[idx].push(g);acc+=g.lines.length+1.6;}
  }
  doc.font('Helvetica-Bold').fontSize(6.4).fillColor('#12233f').text((side.speedsTitle||spKey).toUpperCase(),M,by,{lineBreak:false});
  const top=by+9;let maxY=top;
  colsG.forEach((gs,i)=>{
    let y=top;const x=M+i*(w3+G);
    for(const g of gs){
      if(g.head){doc.font('Helvetica-Bold').fontSize(5.9).fillColor('#444').text(g.head,x,y,{width:w3,lineBreak:false});y+=7.4;}
      doc.font('Helvetica').fontSize(6.1).fillColor('#000');
      for(const l of g.lines){const h=doc.heightOfString(l,{width:w3});doc.text(l,x,y,{width:w3});y+=h+0.8;}
      y+=2;
    }
    maxY=Math.max(maxY,y);
  });
  by=maxY+2;
  const bw=(W-2*M-G)/2;
  const bx=side.boxes[0];
  doc.rect(M,by,bw,H-M-by).lineWidth(.6).strokeColor(COL[bx.color]||'#333').stroke();
  fit(M+2,by+2,bw-4,bx,H-M,'box');
  // second box (e.g. power settings) comes from the sidecar
  const pw=side.boxes[1];
  const px=M+bw+G;
  doc.rect(px,by,bw,H-M-by).lineWidth(.6).strokeColor(COL[pw.color]||'#333').stroke();
  fit(px+2,by+2,bw-4,pw,H-M,'box2');
}
// BACK
doc.addPage();
header(side.backTitle||'EMERGENCY AND ABNORMAL','FLY THE PLANE first. Memory items only. Use the full checklist and Owner\'s Manual when time allows.');
cols(side.back,32,H-M-70,3,'back');
// data strip
const dy=H-M-62;
doc.moveTo(M,dy-2).lineTo(W-M,dy-2).lineWidth(.5).strokeColor('#999').stroke();
fit(M,dy,W-2*M,{head:side.backData.head,color:'blue',lines:side.backData.lines},H,'data');
doc.end();
console.log('linked lines:',linked,'| unlinked literals:',unlinked.length);
unlinked.forEach(u=>console.log('  UNLINKED:',u));
console.log(problems.length?('PROBLEMS:\n  '+problems.join('\n  ')):'No problems.');
if(problems.length)process.exitCode=1;
