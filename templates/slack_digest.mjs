#!/usr/bin/env node
/*
 * まるっと競合分析くん — 週次Slackダイジェスト送信
 *
 * CSVから「最新週の変化点サマリー」を組み立て、Slack Incoming Webhook へ投稿する。
 * 週次GitHub Action(weekly-collect.yml)の最後に実行する想定。
 *
 * 使い方:
 *   SLACK_WEBHOOK_URL=https://hooks.slack.com/... \
 *   DASHBOARD_URL=https://claude.ai/code/artifact/xxxx \
 *   node slack_digest.mjs [csvパス]
 *
 * ・SLACK_WEBHOOK_URL が未設定なら投稿せず、組み立てた本文を標準出力に出す(ドライラン)。
 * ・値の取り込みは まるっと競合分析くん の21列スキーマ準拠。
 */
import { readFileSync } from "fs";

const CSV  = process.argv[2] || "templates/mec-h_sumitomo.csv";
const HOOK = process.env.SLACK_WEBHOOK_URL || "";
const DASH = process.env.DASHBOARD_URL
  || "https://claude.ai/code/artifact/a83bcbed-5149-487d-adc7-854e6ceb66ab";

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

const rows = parseCSV(readFileSync(CSV,"utf8"));
const head = rows[0].map(h=>h.trim());
const idx  = Object.fromEntries(head.map((h,i)=>[h,i]));
const g = (r,name)=> (name in idx) ? (r[idx[name]]||"").trim() : "";
const data = rows.slice(1).map(r=>({
  week:g(r,"週"), cat:g(r,"カテゴリ"), comp:g(r,"競合"), sev:g(r,"重要度"),
  date:g(r,"日付"), title:g(r,"タイトル"), now:g(r,"今週"), memo:g(r,"AIメモ"),
  sig:g(r,"シグナル"), metric:parseInt((g(r,"指標値")||"0").replace(/[^0-9-]/g,""),10)||0,
}));

// --- 最新週を決定（週ラベル先頭の日付で降順ソート） ---
const dateOf = w => { const m=String(w).match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/); return m?`${m[1]}${m[2].padStart(2,"0")}${m[3].padStart(2,"0")}`:"00000000"; };
const weeks  = [...new Set(data.map(d=>d.week))].sort((a,b)=>dateOf(b).localeCompare(dateOf(a)));
const latest = weeks[0] || "";
const cur    = data.filter(d=>d.week===latest);

if(!cur.length){ console.error("対象週のデータがありません。投稿をスキップします。"); process.exit(0); }

// --- 集計 ---
const count = cat => cur.filter(d=>d.cat===cat).length;
const cnt = { CR:count("CR"), TD:count("TD"), KW:count("KW"), LP:count("LP"), NEWS:count("ニュース") };
const total = cnt.CR+cnt.TD+cnt.KW+cnt.LP+cnt.NEWS;
const alerts = cur.filter(d=>d.sev==="高").length;

// KWシグナル
const sigRows = cur.filter(d=>d.cat==="KWシグナル");
const sc = {new:0,down:0,opp:0}; sigRows.forEach(s=>{ if(sc[s.sig]!=null) sc[s.sig]++; });
const sigTop = [...sigRows].sort((a,b)=>b.metric-a.metric)[0];

// CR主要訴求
const crThemes = cur.filter(d=>d.cat==="CR"&&!/出稿の全体像|summary/i.test(d.title)&&d.metric>0)
  .sort((a,b)=>b.metric-a.metric).slice(0,3);

// ニュース
const news = cur.filter(d=>d.cat==="ニュース").slice(0,3);

// LP作成候補（competitorのLPタイプ）— 件数のみ
const lpN = cnt.LP;

// --- Slack Block Kit 本文 ---
const comp = cur[0].comp || "住友不動産";
const clip = (s,n)=> (s||"").length>n ? s.slice(0,n)+"…" : (s||"");
const bar = `━━━━━━━━━━━━━━━`;

const lines = [];
lines.push(`📊 *変化点サマリー*　（対象週: ${latest}｜競合: ${comp}）`);
lines.push(`今週の検知は *${total}件*　（要対応 ${alerts}件）`);
lines.push(`　🖼 CR ${cnt.CR}　🔤 TD ${cnt.TD}　🔑 KW ${cnt.KW}　📄 LP ${cnt.LP}　📰 ニュース ${cnt.NEWS}`);

if(sigRows.length){
  lines.push("");
  lines.push(`🎯 *KWシグナル*　🆕新規 ${sc.new}　📉負け始め ${sc.down}　🎯好機 ${sc.opp}`);
  if(sigTop) lines.push(`　最大コスト: *${clip(sigTop.title,28)}*（¥${sigTop.metric.toLocaleString("en-US")}）`);
}
if(crThemes.length){
  lines.push("");
  lines.push(`🖼 *CR主要訴求*（表示回数順）`);
  crThemes.forEach(c=>lines.push(`　• ${clip(c.title.replace(/^主要クリエイティブ訴求:\s*/,""),34)}`));
}
if(news.length){
  lines.push("");
  lines.push(`📰 *ニュース*`);
  news.forEach(nw=>lines.push(`　• ${clip(nw.now||nw.title,44)}${nw.date?`（${nw.date}）`:""}`));
}

const payload = {
  text: `🔭 まるっと競合分析くん｜週次ダイジェスト（${latest}）`,   // 通知・フォールバック用
  blocks: [
    { type:"header", text:{ type:"plain_text", text:"🔭 まるっと競合分析くん｜週次ダイジェスト", emoji:true } },
    { type:"context", elements:[{ type:"mrkdwn", text:`東地チーム ・ 三菱地所ハウスネット様 ・ 競合ウォッチ` }] },
    { type:"section", text:{ type:"mrkdwn", text: lines.join("\n") } },
    { type:"actions", elements:[
      { type:"button", text:{ type:"plain_text", text:"📊 ダッシュボードを開く", emoji:true }, url:DASH, style:"primary" }
    ]},
    { type:"context", elements:[{ type:"mrkdwn", text:`自動投稿 ・ ${bar}` }] },
  ],
};

// --- 送信 ---
if(!HOOK){
  console.error("※ SLACK_WEBHOOK_URL 未設定のためドライラン（投稿しません）。以下が送信予定の本文です:\n");
  console.log(lines.join("\n"));
  console.error("\n--- payload(JSON) ---");
  console.error(JSON.stringify(payload,null,2));
  process.exit(0);
}

const res = await fetch(HOOK, {
  method:"POST",
  headers:{ "Content-Type":"application/json" },
  body: JSON.stringify(payload),
});
if(!res.ok){
  console.error(`Slack投稿失敗: ${res.status} ${await res.text()}`);
  process.exit(1);
}
console.error(`Slack投稿完了（対象週: ${latest}／検知${total}件）`);
