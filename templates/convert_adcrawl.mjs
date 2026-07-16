#!/usr/bin/env node
/*
 * ADクロール(アドクロール)エクスポート → まるっと競合分析くん CSV へ変換
 *
 * 使い方:
 *   node convert_adcrawl.mjs <週ラベル> <競合名> <brand.csv> <creative.csv> <landing_page.csv> > out.csv
 *
 * 出力:
 *   CR行(サマリー)  … brand から 総CR/新規CR/媒体内訳
 *   CR行(主要訴求)  … creative を タイトル文 で集計し 表示回数(7日増) 上位
 *   LP行            … landing_page を 遷移先URL で集計し 表示回数 上位
 *  値のASCIIカンマは全角/スラッシュへ置換。出力はBOM付きUTF-8。
 */
import { readFileSync } from "fs";

const WEEK = process.argv[2] || "ADクロール取込";
const COMP = process.argv[3] || "競合";
const [BRAND, CREATIVE, LP] = process.argv.slice(4);

function parseCSV(text){
  text = text.replace(/^﻿/,"").replace(/\r\n/g,"\n").replace(/\r/g,"\n");
  const rows=[]; let f="",row=[],q=false;
  for(let i=0;i<text.length;i++){const c=text[i];
    if(q){ if(c==='"'){ if(text[i+1]==='"'){f+='"';i++;} else q=false; } else f+=c; }
    else { if(c==='"')q=true; else if(c===","){row.push(f);f="";} else if(c==="\n"){row.push(f);rows.push(row);row=[];f="";} else f+=c; }
  }
  if(f.length||row.length){row.push(f);rows.push(row);}
  return rows.filter(r=>!(r.length===1&&r[0].trim()===""));
}
function table(file){
  const rows=parseCSV(readFileSync(file,"utf8"));
  const head=rows[0].map(h=>h.trim());
  const idx=Object.fromEntries(head.map((h,i)=>[h,i]));
  return { rows:rows.slice(1), g:(r,name)=> (name in idx)? (r[idx[name]]??"").trim() : "" };
}
const esc = v => String(v==null?"":v).replace(/,/g,"／").replace(/\n/g," ");
const num = v => { const x=parseInt(String(v).replace(/[^0-9-]/g,""),10); return isNaN(x)?0:x; };
const clip = (s,n)=> s.length>n ? s.slice(0,n)+"…" : s;
const jp = v => v>=10000 ? `約${Math.round(v/1000)/10}万回` : `${v}回`; // 340495 -> 約34万回

const out=[];
const HEAD="週,カテゴリ,競合,媒体,重要度,日付,タイトル,先週,今週,AIメモ,入札上昇,入札下落,ネクストアクション,社外価値,ID,指標名,指標値";

/* --- CRサマリー (brand) --- */
if (BRAND){
  const {rows,g}=table(BRAND);
  const r=rows[0];
  if(r){
    const media=[["GDN","CR数(GDN)"],["Yahoo","CR数(Yahoo)"],["Facebook","CR数(Facebook)"],
      ["Instagram","CR数(Instagram)"],["LINE","CR数(LINE)"],["YouTube","CR数(Youtube)"],
      ["SmartNews","CR数(SmartNews)"],["Microsoft","CR数(Microsoft)"],["TikTok","CR数(TikTok)"]]
      .map(([n,c])=>[n,num(g(r,c))]).filter(x=>x[1]>0).sort((a,b)=>b[1]-a[1]);
    const topMedia=media.slice(0,5).map(x=>x[0]);
    const now=`総CR${num(g(r,"CR数"))}本（画像${num(g(r,"CR数(画像のみ)"))}／動画${num(g(r,"CR数(動画のみ)"))}／カルーセル${num(g(r,"CR数(カルーセルのみ)"))}）・新規CR${num(g(r,"新規CR数"))}本・LP${num(g(r,"LP数"))}本（新規LP${num(g(r,"新規LP数"))}）`;
    const memo=`ADクロール取込。表示回数${jp(num(g(r,"表示回数")))}。媒体内訳(CR数): ${media.slice(0,6).map(x=>`${x[0]} ${x[1]}`).join("／")}。出稿期間 ${g(r,"初回出稿日")}〜${g(r,"最新出稿日")}。(出典: ADクロール)`;
    out.push([WEEK,"CR",COMP,topMedia.join(";"),"高",g(r,"最新出稿日"),"クリエイティブ出稿の全体像","",now,memo,"","","","","CR-summary","表示回数",String(num(g(r,"表示回数")))]);
  }
}

/* --- CR主要訴求 (creative: タイトル文で集計) --- */
if (CREATIVE){
  const {rows,g}=table(CREATIVE);
  const by={};
  for(const r of rows){
    const t=g(r,"タイトル文").trim(); if(!t) continue;
    (by[t] ||= {imp7:0,cnt:0,media:new Set(),last:"",lead:""});
    const o=by[t];
    o.imp7+=num(g(r,"表示回数(7日増)")); o.cnt++;
    const m=g(r,"媒体"); if(m) o.media.add(m);
    const d=g(r,"最新出稿日"); if(d>o.last)o.last=d;
    if(!o.lead) o.lead=g(r,"リード文");
  }
  const top=Object.entries(by).sort((a,b)=>b[1].imp7-a[1].imp7).slice(0,7);
  for(const [t,o] of top){
    const memo=`ADクロール取込。表示回数(7日増)${o.imp7}・${o.cnt}クリエイティブ・${o.media.size}媒体`
      + (o.lead?`。リード: ${clip(o.lead,40)}`:"")+`。(出典: ADクロール)`;
    out.push([WEEK,"CR",COMP,[...o.media].slice(0,4).join(";"),"中",o.last,
      "主要クリエイティブ訴求: "+clip(t,26),"",t,memo,"","","","",`CR-${t}`,"表示回数(7日増)",String(o.imp7)]);
  }
}

/* --- LP (landing_page: 遷移先URLで集計) --- */
if (LP){
  const {rows,g}=table(LP);
  const by={};
  for(const r of rows){
    const url=g(r,"遷移先URL").trim(); if(!url) continue;
    (by[url] ||= {title:"",desc:"",cr:0,imp:0,media:new Set(),last:""});
    const o=by[url];
    if(!o.title) o.title=g(r,"LPタイトル");
    if(!o.desc) o.desc=g(r,"description");
    o.cr=Math.max(o.cr,num(g(r,"CR数"))); o.imp=Math.max(o.imp,num(g(r,"LP表示回数")));
    const m=g(r,"媒体"); if(m) o.media.add(m);
    const d=g(r,"LP最新出現日")||g(r,"最新出稿日"); if(d>o.last)o.last=d;
  }
  const top=Object.entries(by).sort((a,b)=>b[1].imp-a[1].imp).slice(0,6);
  for(const [url,o] of top){
    const memo=`ADクロール取込。CR数${o.cr}・LP表示回数${jp(o.imp)}・${o.media.size}媒体`
      +(o.desc?`。説明: ${clip(o.desc,50)}`:"")+`。(出典: ADクロール)`;
    out.push([WEEK,"LP",COMP,[...o.media].slice(0,4).join(";"),"中",o.last,
      "誘導LP: "+clip(o.title||url,26),"",url,memo,"","","","",`LP-${url}`,"LP表示回数",String(o.imp)]);
  }
}

const lines=[HEAD, ...out.map(r=>r.map(esc).join(","))];
process.stdout.write("﻿"+lines.join("\n")+"\n");
console.error(`ADクロール変換完了: ${out.length} 行`);
