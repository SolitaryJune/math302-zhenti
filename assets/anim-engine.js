/* 408 真题 · 动画公共引擎（与 kmp demo 同款交互：步进/自动播放/日志/序号带/结果卡）
 *
 * 用法（anim/{id}.html 内）：
 *   AW.init({
 *     title: '标题', subtitle: '副标题（可含 <code>）',
 *     counterLabel: '已比较',            // 计数 chip 文案（默认「步数」）
 *     snaps: [...],                     // 每步一个快照对象（见下）
 *     build:   (stage) => {...},        // 可选：建立持久 DOM（算法类动画）
 *     render:  (stage, sn, i, dir) => {...}, // 可选：每步更新（不给则默认 stage.innerHTML = sn.html）
 *     result:  { big: '10 次', html: '结论说明…' },  // 可选：到达末步时弹出的结果卡
 *   });
 *
 * snaps[i] 字段（全部可选，按需给）：
 *   cls: 'ok'|'miss'|'shift'|'done'|'step'   —— 状态栏与日志配色
 *   tag: '相等 ✓'                            —— 状态栏彩色小标签文案
 *   log: '第 3 次比较：…'                     —— 日志一行 + 状态栏正文
 *   count: 3                                 —— 计数 chip 数值
 *   ribbon: {k:3, ok:true}                   —— 序号带点亮一个圆点（ok→✓绿，否则✗红）
 *   done: true                               —— 标记为最终步（引擎停播）
 */
(function(){
  var DELAYS = [1400, 1000, 700, 450, 250];
  /* 舞台内容自适应：内容小于舞台时整体放大（上限 2.5×），超出时缩小（下限 0.75×），
     缩到下限仍放不下则顶对齐并交还滚动条 */
  var MIN_SCALE = 0.75, MAX_SCALE = 2.5;
  var E = {};

  /* 把舞台内容缩放到刚好放进可视区，并交由 CSS 网格（unsafe center）居中。
     放大/缩小后视觉上始终居中；缩放触底（0.75×）仍放不下时：
     收缩外壳到舞台宽（内部滚动区恢复自身滚动条、保持原字号），顶对齐并交还滚动条 */
  function fitStage(){
    var st = E.stage, fit = E.fit;
    if(!st || !fit || !st.isConnected) return;
    var cw = st.clientWidth, ch = st.clientHeight;
    if(!cw || !ch) return;
    fit.style.transform = 'none';
    fit.style.maxWidth = 'none';
    var dims = measureContent(fit), wA = dims.w, hA = dims.h;
    var s = scaleFor(cw, ch, wA, hA);
    if(s <= MIN_SCALE + 1e-9 && (wA > cw + 1 || hA > ch + 1)){
      // 触底仍放不下：外壳钳到舞台宽，内部滚动区自己滚（保持 100% 字号），按外壳尺寸重算
      fit.style.maxWidth = cw + 'px';
      dims = measureContent(fit);
      wA = dims.w; hA = dims.h;
      s = scaleFor(cw, ch, wA, hA);
    }
    fit.style.transform = (Math.abs(s - 1) < 1e-9) ? '' : 'scale(' + s + ')';
    var over = (wA * s > cw + 1) || (hA * s > ch + 1);
    st.classList.toggle('aw-alignstart', over);
    fit.style.transformOrigin = over ? 'top center' : 'center center';
    // 视觉已放下 → 关滚动条（transform 的布局溢出会造成幻影滚动条）；触底 → 交还滚动条
    st.style.overflowX = over ? 'auto' : 'hidden';
    st.style.overflowY = over ? 'auto' : 'hidden';
  }
  /* 内容自然尺寸：外壳盒 + .aw-scroll 滚动溢出 + 可见子孙的视觉并集
     （捕捉 transform 平移/负 margin 造成的左/上溢出；svg 子元素被其视口裁剪、
       display:none / visibility:hidden / opacity:0 不渲染，均不计入） */
  function measureContent(fit){
    var w = Math.max(fit.offsetWidth, fit.scrollWidth);
    var h = Math.max(fit.offsetHeight, fit.scrollHeight);
    var scs = fit.querySelectorAll('.aw-scroll');
    for(var i = 0; i < scs.length; i++){
      w = Math.max(w, scs[i].scrollWidth);
      h = Math.max(h, scs[i].scrollHeight);
    }
    var fr = fit.getBoundingClientRect();
    var minL = fr.left, minT = fr.top, maxR = fr.right, maxB = fr.bottom;
    var all = fit.querySelectorAll('*');
    for(var j = 0; j < all.length; j++){
      var k = all[j];
      var tag = k.tagName;
      if(tag === 'svg' || tag === 'SVG') continue;
      var cs;
      try { cs = getComputedStyle(k); } catch(e){ continue; }
      if(cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') continue;
      var r = k.getBoundingClientRect();
      if(!r.width && !r.height) continue;
      if(r.left < minL) minL = r.left;
      if(r.top < minT) minT = r.top;
      if(r.right > maxR) maxR = r.right;
      if(r.bottom > maxB) maxB = r.bottom;
    }
    return { w: Math.max(w, Math.ceil(maxR - minL)), h: Math.max(h, Math.ceil(maxB - minT)) };
  }
  function scaleFor(cw, ch, w, h){
    var s = Math.min(cw / w, ch / h);
    if(!isFinite(s) || s <= 0) s = 1;
    return Math.max(MIN_SCALE, Math.min(MAX_SCALE, s));
  }

  function $(id){ return document.getElementById(id); }
  function el(tag, cls, html){
    var d = document.createElement(tag);
    if(cls) d.className = cls;
    if(html != null) d.innerHTML = html;
    return d;
  }

  function render(cur, animate){
    var sn = E.snaps[cur];
    if(!animate){ E.stage.classList.add('notrans'); }
    if(E.render){ E.render(E.fit, sn, cur, animate); }
    else if(sn.html != null){ E.fit.innerHTML = sn.html; }
    if(!animate){ void E.stage.offsetWidth; E.stage.classList.remove('notrans'); }

    E.count.innerHTML = E.counterLabel + ' <span>' + (sn.count != null ? sn.count : cur) + '</span>';
    if(cur === 0 && !sn.log){
      E.status.textContent = E.introText;
    } else {
      var cls = sn.cls || 'step';
      var tag = sn.tag ? '<span class="tag t-' + cls + '">' + sn.tag + '</span>' : '';
      E.status.innerHTML = tag + (sn.log || '');
    }
    // 日志
    if(cur === 0){
      E.log.innerHTML = '<div class="aw-log-line aw-log-empty">（尚未开始）</div>';
      E.ribbon.innerHTML = '<span style="font-size:12.5px;color:#94a3b8">随演示逐个点亮…</span>';
    } else {
      var empty = E.log.querySelector('.aw-log-empty');
      if(empty) empty.remove();   // 真实日志出现后清掉占位框
      var d = el('div', 'aw-log-line ' + (sn.cls || 'step'), sn.log || '');
      E.log.appendChild(d);
      E.log.scrollTop = E.log.scrollHeight;
      if(sn.ribbon){
        var c = el('div', 'aw-chip pop ' + (sn.ribbon.ok ? 'ok' : 'miss'));
        c.innerHTML = (sn.ribbon.ok ? '✓' : '✗') + '<em>第' + sn.ribbon.k + '</em>';
        var placeholder = E.ribbon.querySelector('span');
        if(placeholder) placeholder.remove();
        E.ribbon.appendChild(c);
      }
    }
    if(sn.done && E.result){
      E.big.textContent = E.result.big;
      E.desc.innerHTML = E.result.html;
      E.resultBox.classList.add('show');
    }
    if(cur >= E.snaps.length - 1) stopPlay();
    fitStage();
  }

  function goto(t, animate){
    t = Math.max(0, Math.min(E.snaps.length - 1, t));
    if(t === E.cur && E.built) return; // 已在该步（末步重复点击），不重复渲染
    E.built = true;
    var jump = Math.abs(t - E.cur) > 1;
    E.cur = t;
    if(E.cur === 0){
      // 重置：清空日志并整体重画
      if(E.build) E.build(E.fit);
      render(0, false);
      E.log.innerHTML = '<div class="aw-log-line aw-log-empty">（尚未开始）</div>';
      E.ribbon.innerHTML = '<span style="font-size:12.5px;color:#94a3b8">随演示逐个点亮…</span>';
      E.resultBox.classList.remove('show');
      return;
    }
    render(E.cur, animate && !jump);
  }

  function stopPlay(){
    if(E.timer){ clearInterval(E.timer); E.timer = null; }
    E.playBtn.textContent = '▶ 播放';
  }
  function togglePlay(){
    if(E.timer){ stopPlay(); return; }
    if(E.cur >= E.snaps.length - 1) goto(0, false);
    E.playBtn.textContent = '⏸ 暂停';
    E.timer = setInterval(function(){
      if(E.cur >= E.snaps.length - 1) stopPlay();
      else goto(E.cur + 1);
    }, DELAYS[+E.speed.value - 1]);
  }

  /* ---- 题目头自动注入：按自身 URL 从题库拉取题干/选项/答案 ---- */
  function loadQuestionHeader(root){
    try {
      var m = (location.pathname || '').match(/anim\/([A-Za-z0-9._-]+)\.html/);
      if (!m) return;
      var id = m[1];
      var ym = id.match(/(\d{4})/);
      if (!ym) return;
      fetch('../data/questions/' + ym[1] + '.json').then(function(r){
        return r.ok ? r.json() : Promise.reject(new Error('http ' + r.status));
      }).then(function(d){
        var qs = Array.isArray(d) ? d : (d.questions || []);
        var q = null;
        for (var i = 0; i < qs.length; i++) if (qs[i].id === id) { q = qs[i]; break; }
        if (!q) return;
        var fixImg = function(h){
          var s = String(h || '');
          s = s.replace(/(\/?content-images\/)/g, '../images/');
          s = s.replace(/(["'\s(])((?!\.\.\/)images\/)/g, '$1../images/');
          return s;
        };
        var opts = '';
        if (q.options && q.options.length) {
          opts = '<div class="aw-qopts">' + q.options.map(function(o){
            return '<div class="aw-qopt"><span class="aw-qletter">' + o.letter +
              '</span><span class="aw-qtext">' + fixImg(o.html || '') + '</span></div>';
          }).join('') + '</div>';
        }
        var tags = (q.tags || []).map(function(t){ return '<span class="aw-qtag">' + t + '</span>'; }).join(' ');
        var ansTxt = q.answerLetter ? ('<b>' + q.answerLetter + '</b>') :
          (q.answer && q.answer !== '略'
            ? '<b>' + (/[\\^_{}]/.test(String(q.answer)) ? '$' + String(q.answer).slice(0, 60) + '$' : String(q.answer).slice(0, 40)) + '</b>'
            : '见下方结论卡');
        var box = document.createElement('details');
        box.className = 'aw-question';
        // 高屏（全屏/大窗）默认折叠题目卡，把高度让给可视化舞台
        box.open = !(window.innerHeight >= 860);
        box.innerHTML = '<summary>📋 题目与选项 · ' + id + '（全屏时也在）</summary>' +
          '<div class="aw-qbody">' +
          '<div class="aw-qstem">' + fixImg(q.stemHtml || q.stem || '') + '</div>' + opts +
          '<div class="aw-qmeta">参考答案：' + ansTxt + (tags ? '　' + tags : '') + '</div>' +
          '</div>';
        root.insertBefore(box, root.firstChild);
        if (window.renderMathInElement) {
          try {
            window.renderMathInElement(box, {
              delimiters: [{ left: '$$', right: '$$', display: true }, { left: '$', right: '$', display: false }],
              throwOnError: false,
            });
          } catch (e) {}
        }
      }).catch(function(){ /* file:// 打开或离线时静默跳过 */ });
    } catch (e) {}
  }

  function init(cfg){
    E.cfg = cfg;
    E.snaps = cfg.snaps;
    E.render = cfg.render || null;
    E.build = cfg.build || null;
    E.result = cfg.result || null;
    E.counterLabel = cfg.counterLabel || '步数';
    E.cur = 0; E.timer = null;

    var root = document.querySelector('.aw');
    root.innerHTML =
      '<h1>' + (cfg.title || '') + '</h1>' +
      '<div class="sub">' + (cfg.subtitle || '') + '</div>' +
      '<div class="aw-grid">' +
          '<div class="aw-main">' +
          '<div class="aw-card aw-stage-card">' +
            '<div class="aw-stage" id="awStage"><div class="aw-fit" id="awFit"></div></div>' +
            '<div class="aw-status" id="awStatus"></div>' +
            '<div class="aw-hint">快捷键：← 上一步　→ 下一步　空格 播放/暂停</div>' +
          '</div>' +
        '</div>' +
        '<aside class="aw-side">' +
          '<div id="awResult" class="aw-result"><div class="big"></div><div class="desc"></div></div>' +
          '<div class="aw-card aw-controls">' +
            '<button id="awReset" class="warn">⏮ 重置</button>' +
            '<button id="awPrev">◀ 上一步</button>' +
            '<button id="awPlay" class="primary">▶ 播放</button>' +
            '<button id="awNext">下一步 ▶</button>' +
            '<button id="awEnd" class="warn">⏭ 看结果</button>' +
            '<div class="aw-speed"><span>慢</span><input type="range" id="awSpeed" min="1" max="5" value="3" step="1"><span>快</span></div>' +
            '<div class="aw-counter" id="awCount"></div>' +
          '</div>' +
          '<div class="aw-card aw-sidecard">' +
            '<div class="aw-panel-title" id="awRibbonTitle">序号（✓ 对 / ✗ 错）</div>' +
            '<div class="aw-ribbon" id="awRibbon"></div>' +
            '<div class="aw-panel-title" style="margin-top:12px">过程日志</div>' +
            '<div id="awLog"></div>' +
          '</div>' +
        '</aside>' +
      '</div>';
    loadQuestionHeader(root);

    E.stage = $('awStage'); E.fit = $('awFit'); E.status = $('awStatus'); E.log = $('awLog');
    E.ribbon = $('awRibbon'); E.count = $('awCount'); E.resultBox = $('awResult');
    E.big = E.resultBox.querySelector('.big'); E.desc = E.resultBox.querySelector('.desc');
    E.speed = $('awSpeed'); E.playBtn = $('awPlay');
    E.introText = cfg.intro || '点击「▶ 播放」或「下一步」开始演示。';
    if(cfg.ribbonTitle) $('awRibbonTitle').textContent = cfg.ribbonTitle;

    $('awNext').onclick = function(){ stopPlay(); goto(E.cur + 1); };
    $('awPrev').onclick = function(){ stopPlay(); goto(E.cur - 1); };
    $('awReset').onclick = function(){ stopPlay(); goto(0, false); };
    $('awEnd').onclick = function(){ stopPlay(); goto(E.snaps.length - 1, false); };
    E.playBtn.onclick = togglePlay;
    E.speed.oninput = function(){ if(E.timer){ stopPlay(); togglePlay(); } };
    document.addEventListener('keydown', function(e){
      if(e.key === 'ArrowRight'){ stopPlay(); goto(E.cur + 1); }
      else if(e.key === 'ArrowLeft'){ stopPlay(); goto(E.cur - 1); }
      else if(e.key === ' '){ e.preventDefault(); togglePlay(); }
    });
    window.addEventListener('resize', function(){
      clearTimeout(E._rzT); E._rzT = setTimeout(fitStage, 80);
    });
    window.addEventListener('load', fitStage);

    goto(0, false);
  }

  /* ---- 题面常用的渲染小工具 ---- */

  // 一行字符格：chars=['a','b',...], classes=['ok','hit','miss',...]（可含 ''）,
  // ptrMap={3:'i=3'} → 第 3 格上方显示指针
  function cellRow(chars, classes, ptrMap, idxStart){
    var row = el('div', 'aw-cells');
    chars.forEach(function(ch, i){
      var col = el('div', 'aw-col');
      col.appendChild(el('div', 'aw-ptr', (ptrMap && ptrMap[i + 1]) || ''));
      col.appendChild(el('div', 'aw-box' + (classes && classes[i] ? ' ' + classes[i] : ''), String(ch)));
      col.appendChild(el('div', 'aw-idx', String((idxStart || 1) + i)));
      row.appendChild(col);
    });
    return row;
  }

  // 把 wrapper 平移到第 idx 格（pitch = 格宽 + 间距，默认 48）
  function shiftTo(wrapperEl, idx, pitch){
    wrapperEl.style.transform = 'translateX(' + ((idx - 1) * (pitch || 48)) + 'px)';
  }

  window.AW = { init: init, el: el, cellRow: cellRow, shiftTo: shiftTo };
})();
