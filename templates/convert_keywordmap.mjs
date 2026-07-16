#!/usr/bin/env node
/*
 * Keywordmap のリスティング広告調査エクスポート → まるっと競合分析くん CSV へ変換
 *
 * 使い方:
 *   node convert_keywordmap.mjs <週ラベル> <入力1.csv> [入力2.csv ...] > out.csv
 * 例:
 *   node convert_keywordmap.mjs "2026/07/14週（Keywordmap取込）" a.csv b.csv > mec-h_keywordmap.csv
 *
 * 変換方針:
 *  - 広告順位(前回)→(今回) の変化を KW行の 入札上昇/入札下落 に落とす
 *      前回0→今回>0 : 新規表示   / 前回>0→今回0 : 非表示化
 *      順位が小さくなる=上昇      / 大きくなる=下落  （0=圏外）
 *  - 広告主は 表示設定URL / LP URL のドメインから判定
 *  - 出力はBOM付きUTF-8。値にASCIIカンマは使わない（全角/スラッシュへ）
 */

import { readFileSync } from "fs";

const WEEK = process.argv[2] || "Keywordmap取込";
const FILES = process.argv.slice(3);
if (!FILES.length) { console.error("入力CSVを指定してください"); process.exit(1); }

const DOMAIN2NAME = [
  [/mec-h\.(com|co\.jp)/, "三菱地所ハウスネット（自社）"],
  [/rehouse|mitsui/, "三井のリハウス"],
  [/livable\.co\.jp/, "東急リバブル"],
  [/sumitomo-rd\.co\.jp/, "住友不動産"],
  [/stepon\.co\.jp/, "住友不動産ステップ"],
  [/nomu\.com|nomura/, "野村の仲介プラス"],
];
function nameOf(url){
  for (const [re,n] of DOMAIN2NAME) if (re.test(url||"")) return n;
  try { return (new URL(url)).hostname.replace(/^www\./,""); } catch { return "競合"; }
}

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
const csvEsc = v => { v=String(v==null?"":v).replace(/,/g,"／"); return v; }; // ASCIIカンマ除去
const n = v => { const x=parseInt(String(v).replace(/[^0-9-]/g,""),10); return isNaN(x)?0:x; };

// 広告主ごとに集計
const byName = {};
for (const file of FILES){
  const rows = parseCSV(readFileSync(file,"utf8"));
  const head = rows[0].map(h=>h.trim());
  const col = name => head.indexOf(name);
  const ci = {
    kw: col("キーワード"), p: col("広告順位(前回)"), c: col("広告順位(今回)"),
    vol: col("検索Vol"), cpc: col("クリック単価"), cost: col("想定集客コスト"),
    lp: col("ランディングページURL"), disp: col("表示設定URL"),
    date: col("最新取得日"), title: col("タイトル"),
  };
  for (let i=1;i<rows.length;i++){
    const r=rows[i]; if(!r[ci.kw]) continue;
    const name = nameOf(r[ci.disp]||r[ci.lp]);
    const p=n(r[ci.p]), c=n(r[ci.c]);
    let dir=null, tag=null;
    if(p===0 && c>0){ dir="up"; tag=`新規表示（→${c}位）`; }
    else if(p>0 && c===0){ dir="down"; tag=`非表示化（${p}位→圏外）`; }
    else if(p>0 && c>0 && c<p){ dir="up"; tag=`（${p}→${c}位）`; }
    else if(p>0 && c>0 && c>p){ dir="down"; tag=`（${p}→${c}位）`; }
    else continue; // 変化なし
    (byName[name] ||= {up:[],down:[],date:"",cost:0,topCost:{kw:"",v:0}});
    const o=byName[name];
    o[dir].push({ kw:r[ci.kw].trim(), tag, vol:n(r[ci.vol]), cost:n(r[ci.cost]) });
    const dt=(r[ci.date]||"").trim(); if(dt>o.date) o.date=dt;
    const cost=n(r[ci.cost]); o.cost+=cost;
    if(cost>o.topCost.v) o.topCost={kw:r[ci.kw].trim(), v:cost};
  }
}

// 出力
const HEAD="週,カテゴリ,競合,媒体,重要度,日付,タイトル,先週,今週,AIメモ,入札上昇,入札下落,ネクストアクション,社外価値";
const lines=[HEAD];
const CAP=12;
const fmt = arr => arr.sort((a,b)=>b.vol-a.vol).slice(0,CAP)
  .map(x=>`${x.kw} ${x.tag}`).join(";");
for (const [name,o] of Object.entries(byName)){
  const isSelf = name.includes("自社");
  const total=o.up.length+o.down.length;
  const extraUp=Math.max(0,o.up.length-CAP), extraDown=Math.max(0,o.down.length-CAP);
  const sev = isSelf ? "中" : (o.down.length? "高":"中");
  const man = v => `約${Math.round(v/1000)/10}万円`; // 505986 -> 約50.6万円
  const memo = `Keywordmap取込。検知KW${total}件（上昇/新規${o.up.length}・下落/非表示${o.down.length}`
    + (extraUp||extraDown?`／表示は上位${CAP}件`:"")+`）。`
    + `想定集客コスト上位: ${o.topCost.kw}（${man(o.topCost.v)}）。`
    + `(出典: Keywordmap)`;
  const row=[
    WEEK, "KW", name, "リスティング(Google/Yahoo)", sev, o.date||"取込日",
    "リスティング出稿KW・掲載順位の変化", "", "",
    memo, fmt(o.up), fmt(o.down), "", ""
  ].map(csvEsc);
  lines.push(row.join(","));
}
process.stdout.write("﻿"+lines.join("\n")+"\n");
console.error(`変換完了: ${Object.keys(byName).length} 広告主 / 出力 ${lines.length-1} 行`);
