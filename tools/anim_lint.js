#!/usr/bin/env node
/* 动画全量确定性体检：对站点 anim/*.html 逐个做沙箱执行与契约校验。
 *
 * 用法: node anim_lint.js <站点根目录> <408|math>
 * stdout 只输出 JSON：{site,total,ok,bad:[{id,issues:[...]}],stats:{...}}
 * 诊断走 stderr。
 *
 * 检查项：
 *  - 占位页/过小文件
 *  - AW.init 存在（2019-09 自包含金标准除外）
 *  - 引擎引用路径与站点匹配（408=../../assets/，math=../assets/）
 *  - 无外部 http(s) 请求（xmlns/svg 命名空间除外）
 *  - 沙箱执行：AW.init 捕获 + build/render 全步运行无异常
 *  - 步数 5–18；末步 done:true；每步（除首步）有 log；title/subtitle 齐全
 *  - result 结论卡（big/html 非空）
 *  - 选择题：结论卡/末步 log 中包含答案字母（answer 一致性弱校验）
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = process.argv[2];
const site = process.argv[3] || '408';
if (!root || !['408', 'math'].includes(site)) {
  console.error('usage: node anim_lint.js <root> <408|math>'); process.exit(2);
}
const EXPECT_PREFIX = site === '408' ? '../../assets/' : '../assets/';
const animDir = path.join(root, 'anim');
const legacyOK = (h) => h.includes('KMP') && h.includes('2019-09');

function elStub() {
  const el = {
    dataset: {}, style: {}, children: [], innerHTML: '', textContent: '',
    offsetWidth: 0, scrollHeight: 0, scrollTop: 0, src: '', href: '', value: '',
    setAttribute() {}, getAttribute() { return ''; },
    appendChild(c) { this.children.push(c); return c; },
    removeChild() {}, remove() {}, insertBefore(c) { return c; },
    addEventListener() {}, removeEventListener() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
    closest() { return null; }, contains() { return false; },
    getBoundingClientRect() { return { top: 0, left: 0, width: 0, height: 0 }; },
    classList: { add() {}, remove() {}, toggle() { return false; }, contains() { return false; } },
    focus() {}, click() {},
  };
  Object.defineProperty(el, 'firstChild', { get() { return el.children[0] || null; } });
  return el;
}
function makeDoc() {
  return {
    body: elStub(), documentElement: elStub(), fullscreenElement: null,
    querySelector: () => elStub(),
    querySelectorAll: () => [],
    getElementById: () => elStub(),
    createElement: () => elStub(),
    createElementNS: () => elStub(),
    addEventListener() {}, removeEventListener() {},
    exitFullscreen() {},
  };
}
function makeSandbox(extra) {
  const doc = makeDoc();
  const sandbox = {
    document: doc,
    renderMathInElement() {},
    katex: { render() {}, renderToString() { return ''; } },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    setInterval: () => 0, clearInterval() {}, setTimeout: () => 0,
    requestAnimationFrame: () => 0, alert() {}, confirm() { return false; },
    location: { href: '', search: '', reload() {} },
    navigator: { userAgent: 'lint' },
    console: { log() {}, warn() {}, error() {} },
    history: { pushState() {}, replaceState() {} },
    performance: { now: () => 0 },
    Math, JSON, Object, Array, String, Number, Boolean, RegExp, Date,
    parseInt, parseFloat, isNaN, isFinite, Promise, Error, TypeError,
    Map, Set, Symbol, isNaN: isNaN,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  Object.assign(sandbox, extra || {});
  return vm.createContext(sandbox);
}

let captured = null;
function fakeAW() {
  const AW = {
    cfg: null,
    el: () => elStub(),
    cellRow: () => elStub(),
    shiftTo() {},
    init(cfg) { captured = cfg; AW.cfg = cfg; },
  };
  return AW;
}

function extractScripts(html) {
  const out = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    if (/\bsrc\s*=/i.test(m[1])) continue;
    out.push(m[2]);
  }
  return out;
}

function lintFile(id, file, answerInfo) {
  const issues = [];
  const html = fs.readFileSync(file, 'utf-8');
  const size = Buffer.byteLength(html);
  if (size < 1500) issues.push('占位页或过小(' + size + 'B)');
  if (site === '408' && legacyOK(html)) {
    return { id, issues: size < 3000 ? ['金标准文件过小(' + size + 'B)'] : [] };
  }
  if (!html.includes('AW.init')) issues.push('缺少 AW.init');
  // 引擎引用路径
  const engineRef = html.match(/(?:\.\.\/)+assets\/anim-engine\.js/);
  if (!engineRef) issues.push('未引用 anim-engine.js');
  else {
    const used = engineRef[0];
    if (used !== EXPECT_PREFIX + 'anim-engine.js') issues.push('引擎路径应为 ' + EXPECT_PREFIX + ' 实为 ' + used);
  }
  // 外部请求
  const ext = html.match(/https?:\/\/[^"'\s)]+/g) || [];
  const badExt = ext.filter((u) => !/w3\.org/.test(u));
  if (badExt.length) issues.push('外部请求: ' + badExt.slice(0, 2).join(','));
  // 沙箱执行
  captured = null;
  const scripts = extractScripts(html);
  const AW = fakeAW();
  const sb = makeSandbox({ AW, renderMathAfterSnap() {} });
  try {
    for (const s of scripts) vm.runInContext(s, sb, { timeout: 5000 });
  } catch (e) {
    issues.push('执行异常: ' + String(e && e.message).slice(0, 120));
    return { id, issues };
  }
  const cfg = captured;
  if (!cfg) { issues.push('AW.init 未被调用'); return { id, issues }; }
  // 契约
  if (!cfg.title) issues.push('缺 title');
  if (!cfg.subtitle) issues.push('缺 subtitle');
  const snaps = Array.isArray(cfg.snaps) ? cfg.snaps : [];
  if (snaps.length < 5 || snaps.length > 18) issues.push('步数 ' + snaps.length + ' 不在 5–18');
  for (let i = 1; i < snaps.length; i++) {
    if (!snaps[i] || typeof snaps[i].log !== 'string' || !snaps[i].log.trim()) {
      issues.push('第 ' + (i + 1) + ' 步缺 log'); break;
    }
  }
  const last = snaps[snaps.length - 1];
  if (!last || last.done !== true) issues.push('末步缺 done:true');
  if (!cfg.result || !cfg.result.big || !cfg.result.html) issues.push('缺 result 结论卡');
  // build/render 全步运行
  try {
    const stage = elStub();
    const E = Object.assign({ stage }, cfg);
    if (typeof cfg.build === 'function') cfg.build.call(E, stage);
    snaps.forEach((sn, i) => {
      if (typeof cfg.render === 'function') cfg.render.call(E, stage, sn, i, true);
    });
  } catch (e) {
    issues.push('build/render 运行错误: ' + String(e && e.message).slice(0, 120));
  }
  // 答案一致性（选择题弱校验：结论卡或末步 log 含答案字母）
  if (answerInfo && answerInfo.type === '选择题' && answerInfo.letter && cfg.result) {
    const hay = String(cfg.result.big || '') + String(cfg.result.html || '') +
      String((last && last.log) || '');
    if (!hay.includes(answerInfo.letter)) issues.push('结论未包含答案字母 ' + answerInfo.letter);
  }
  return { id, issues };
}

function main() {
  const animDirAbs = path.resolve(root, 'anim');
  const files = fs.readdirSync(animDirAbs).filter((f) => f.endsWith('.html')).sort();
  // 题目答案映射
  const answers = {};
  try {
    for (const yf of fs.readdirSync(path.join(root, 'data', 'questions'))) {
      if (!yf.endsWith('.json')) continue;
      let d = JSON.parse(fs.readFileSync(path.join(root, 'data', 'questions', yf), 'utf-8'));
      const qs = Array.isArray(d) ? d : (d.questions || []);
      for (const q of qs) {
        if (q.type === '选择题' || q.type === 'choice') answers[q.id] = { letter: q.answerLetter, type: '选择题' };
      }
    }
  } catch (e) { console.error('[warn] 答案映射: ' + e.message); }

  const bad = [];
  let ok = 0;
  const stat = { missingEngine: 0, steps: 0, done: 0, result: 0, runtime: 0, answer: 0, ext: 0, other: 0 };
  for (const f of files) {
    const id = f.replace(/\.html$/, '');
    let r;
    try {
      r = lintFile(id, path.join(animDirAbs, f), answers[id]);
    } catch (e) {
      r = { id, issues: ['lint 异常: ' + String(e && e.message).slice(0, 120)] };
    }
    if (r.issues.length === 0) { ok++; continue; }
    bad.push({ id, issues: r.issues });
    for (const iss of r.issues) {
      if (/引擎路径|anim-engine/.test(iss)) stat.missingEngine++;
      else if (/步数/.test(iss)) stat.steps++;
      else if (/done/.test(iss)) stat.done++;
      else if (/result|结论卡/.test(iss)) stat.result++;
      else if (/运行错误|执行异常/.test(iss)) stat.runtime++;
      else if (/答案字母/.test(iss)) stat.answer++;
      else if (/外部请求/.test(iss)) stat.ext++;
      else stat.other++;
    }
  }
  console.log(JSON.stringify({
    site, total: files.length, ok, badCount: bad.length, bad,
    stats: stat,
  }));
}

main();
