# 数学二真题档案

自建的**考研数学二（302）历年真题**复习站，纯静态、无登录、无后端，托管于 GitHub Pages。
UI 与交互沿用同款档案室主题的 408 真题档案站（`/Users/a24/jiaoben/408-zhenti`）。

## 内容规模

- 2009–2026 共 **18 套真题**（2009–2020：选择 8 + 填空 6 + 解答 9；2021 起：选择 10 + 填空 6 + 解答 6，满分 150）
- 每题配**原创文字讲解**（`data/explain/{题号}.md`，允许 `$..$` / `$$..$$` 数学式）
- 每题配一个**HTML 交互动画**（`anim/{题号}.html`，统一引擎 `assets/anim-engine.js` + 本地 KaTeX）
- 数学公式全部由**本地内嵌 KaTeX 0.16.11**（`assets/katex/`）渲染，站点不加载任何外部 CDN

## 题型交互

- **选择题**：A–D 点选 → 「提交答案」即时判分 → 重做（同 408 版）
- **填空题**：题面 → 「查看参考答案」显示文本答案 → 满分/部分分/零分自评
- **解答题**：题面 → 「查看参考答案」（`answer` 为空时回退显示 `refAnalysis`）→ 按问对照自评
- 答题卡按当年题型分组（选择 X 题 / 填空 Y 题 / 解答 Z 题，从当年数据动态统计）；
  交卷判分按题型给出「答对/满分」统计

## 功能

- **单题模式**：作答判分 + 文字讲解 + 动画演示（可全屏）三个面板，KaTeX 公式渲染
- **整卷模式**：全卷连续作答 + 计时器（正/倒计时，180 分钟）+ **答题卡** + 考试模式 + 交卷判分
- **本地错题本**：答错/零分自评自动记录，localStorage 保存（键前缀 `b302.`，与 408 站互不干扰）
- **按知识点浏览**：知识点标签与考频
- **全文搜索**：纯前端，支持题干与知识点标签匹配、按题型过滤

## 数据来源与版权声明

- 题目内容来自全国硕士研究生统一考试数学（二）**历年公开真题**；
- 题库数据整理自公开网络资源 [fish.888.moe](https://github.com/PondFish-me/fish.888.moe)
  （`tools/extract_math302.py` 抓取与归一化；解答题分值用
  [TsekaLuk/Kaoyan-Math2-Papers](https://github.com/TsekaLuk/Kaoyan-Math2-Papers) 的官方满分标记交叉考证）；
- 文字讲解与 HTML 交互动画均为**本站原创**（`refAnalysis` 只作对答案权威依据，不整段照抄）；
- KaTeX 由 [KaTeX](https://katex.org/)（MIT License）vendor 至 `assets/katex/`；
- 若有版权问题请联系仓库主处理。

## 本地运行 / 构建

```bash
# 全站为纯静态文件，任意静态服务器即可
python3 -m http.server 8000
# 打开 http://127.0.0.1:8000/

# 1. 抓取/更新题库（原始数据，产出 data/questions/*.json、data/meta.json、images/）
python3 tools/extract_math302.py

# 2. 为每题编写讲解与动画（子任务按 tools/MATH_ANIM_GUIDE.md 契约产出）
#    data/explain/m2-{年份}-{两位}.md 与 anim/m2-{年份}-{两位}.html

# 3. 门禁校验（stdout 只输出 {"total":N,"ok":N,"bad":[...]}）
python3 tools/validate_math302.py

# 4. 重新生成站点页面（改了 data/ 后在服务器执行）
python3 tools/build_site.py
```

## 目录结构

```
├── index.html              首页（年份导航）
├── year/{year}/            整卷答题页 × 18
├── question/{id}/          单题页 × 总题数（id 形如 m2-2019-05）
├── knowledge/              知识点导航
├── wrongbook/              错题本（localStorage）
├── search/                 全文搜索
├── anim/{id}.html          每题交互动画
├── assets/
│   ├── style.css / app.js  站点样式与交互（408 版适配：题型 kicker、b302 存储、
│   │                       题型分组答题卡、搜索 data.questions 契约）
│   ├── anim.css / anim-engine.js   动画引擎（与 408 版完全相同，原样复制）
│   └── katex/              本地 KaTeX 0.16.11（css/js/auto-render + 60 个字体）
├── data/
│   ├── questions/{year}.json   题库数据 {"year","count","questions":[...]}
│   ├── explain/{id}.md         每题原创讲解（$..$ / $$..$$ 数学式）
│   └── meta.json               {"years":[...], "total":N}
├── images/                 真题配图（题面/解析引用，构建时改写相对路径）
└── tools/
    ├── extract_math302.py          题库抓取与归一化
    ├── build_site.py               站点生成器
    ├── validate_math302.py         讲解/动画门禁校验
    ├── MATH_ANIM_GUIDE.md          动画+讲解生成规范（子任务必读）
    ├── anim_math_algo_template.html      算法/过程类动画模板（KaTeX 版）
    └── anim_math_concept_template.html   概念/推理链类动画模板（KaTeX 版）
```

## 与 408 版的主要差异（工程备忘）

- 数据契约：年文件为 `{"year","count","questions":[...]}` 对象；字段 `stem/options/
  answer/refAnalysis`（408 为 `stemHtml/refAnswerHtml/answerLetter`），无 `subject`
  与 `videoUrl` —— kicker 显示**题型**，学习区只有讲解与动画两个面板
- `md2html` 对 `$..$` / `$$..$$` 数学式原样透传（行内码优先保护、数学式只做 HTML
  实体转义，`$` 与反斜杠命令不被破坏；孤立表格行死循环修复保持）
- 单题页与整卷页底部注入本地 KaTeX auto-render（delimiters 含 `$` 与 `$$`，
  `throwOnError:false`）
- 修复了 408 版 essay 流程引用不存在的 `.ref-answer` 元素导致「查看参考答案」
  点击报错的问题（`app.js` 改为直接展开 `.answer-placeholder`）
- 动画模板引用 `../assets/katex/…`（anim/ 与 tools/ 同为一级目录，两处均可预览；
  `../../assets/…` 会逃出站点根导致 404，故未按该字面路径引用）
