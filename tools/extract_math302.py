#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
extract_math302.py — 数学二(302) 真题 2009–2026 抽取脚本
=========================================================

数据源
------
主源   : PondFish-me/fish.888.moe  (GitHub Pages 静态站仓库)
         数据文件 data/数学二/数学二_{year}.json, 经 raw.githubusercontent.com 拉取,
         默认分支通过 GitHub API 自动探测(失败时回退 main)。
交叉核对: TsekaLuk/Kaoyan-Math2-Papers
         其 solutions/*.md(真题 OCR) 含官方「本题满分 X 分」标记, 用于考证解答题
         每题分值(见 SOLUTION_POINTS_KNOWN 注释); 仓库本身无结构化题库, 不参与题目抓取。

输出
----
data/questions/{year}.json : 每年一份, questions[i] 字段固定为
    id / year / number / type / points / stem / options / answer /
    refAnalysis / wrongOptions / tags
data/meta.json             : {"years": [...], "total": N}
images/                    : 题面/解析引用的图片(本地化, 引用路径改写为 images/<原名>)
stdout                     : 恰好一行 JSON {"total":N,"perYear":{"2009":23,...}}
诊断/告警                   : 全部走 stderr

可重入
------
已存在的 data/questions/{year}.json(在 --years 范围内)默认整年跳过,
不再联网; --force 可强制重建。图片文件已存在时跳过下载。

用法
----
    python3 tools/extract_math302.py                  # 全量 2009–2026
    python3 tools/extract_math302.py --years 2021-2026
    python3 tools/extract_math302.py --force --years 2009
    python3 tools/extract_math302.py --points-override my_points.json
    python3 tools/extract_math302.py --no-images      # 只抽数据不下载图

仅用 Python 标准库, 无第三方依赖。
"""

import argparse
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

# ---------------------------------------------------------------------------
# 常量与配置
# ---------------------------------------------------------------------------

MAIN_REPO = "PondFish-me/fish.888.moe"
MAIN_BRANCH_FALLBACK = "main"
CROSS_REPO = "TsekaLuk/Kaoyan-Math2-Papers"  # 分值考证来源(见 SOLUTION_POINTS_KNOWN)

RAW_BASE = "https://raw.githubusercontent.com"
API_BASE = "https://api.github.com"

# 数学二在主源中的年度文件路径(中文目录, 抓取时做 URL 编码)
YEAR_DATA_PATH = "data/数学二/数学二_{year}.json"

DEFAULT_YEAR_START, DEFAULT_YEAR_END = 2009, 2026

# 题型归一化: 原库 2009–2019/2022–2025 把部分解答题标成「证明题」,
# 按官方卷面它们属解答题大题(计解答分), 统一并入「解答题」。
TYPE_MAP = {
    "选择题": "选择题",
    "填空题": "填空题",
    "解答题": "解答题",
    "证明题": "解答题",   # 官方卷面归解答题, 计解答分
}

# 官方分值结构(卷面满分 150):
#   2009–2020: 选择 8×4=32, 填空 6×4=24, 解答(含证明)9 题共 94
#   2021–2026: 选择 10×5=50, 填空 6×5=30, 解答 6 题共 70
# 选择/填空每题分值是确定的; 解答题只给定卷面总分, 每题分值考证见下表。
OBJECTIVE_POINTS = {  # -> (选择题每题分, 填空题每题分)
    "old": 4,  # 2009–2020
    "new": 5,  # 2021 起
}
SOLUTION_TOTALS = {"old": 94, "new": 70}


def era_of(year):
    return "new" if year >= 2021 else "old"


# 解答题每题分值考证表。来源: TsekaLuk/Kaoyan-Math2-Papers 的 solutions/*.md
# 中官方「(N)(本题满分 X 分)」标记, 2026-11-15 抓取核对。
# 该 OCR 源对与数学一重复的题常写「同试卷一第X题」而不带分值, 故部分年份不完整;
# 缺失题号按确定性规则补齐(见 solution_points_for_year), 保证每年解答总分 = 94/70。
SOLUTION_POINTS_KNOWN = {
    2009: {15: 9, 16: 10, 17: 10, 18: 10, 19: 10, 20: 12},                    # 缺 21–23
    2010: {17: 10, 18: 10, 19: 11, 20: 10, 21: 10, 23: 11},                   # 缺 15,16,22
    2011: {15: 10, 16: 11, 18: 10, 20: 11},                                   # 缺 17,19,21–23
    2012: {15: 10, 17: 10, 18: 10, 19: 11, 21: 11},                           # 缺 16,20,22,23
    2013: {15: 10, 16: 10, 17: 10, 19: 11, 20: 11, 21: 11},                   # 缺 18,22,23
    2014: {16: 10, 17: 10, 19: 10, 20: 11, 21: 11},                           # 缺 15,18,22,23
    2015: {16: 10, 17: 11, 18: 10, 19: 11, 20: 10, 21: 10, 22: 11},           # 缺 15,23
    2016: {15: 10, 16: 10, 17: 10, 18: 10, 19: 10, 20: 11, 21: 11, 22: 11},   # 缺 23
    2017: {15: 10, 20: 11, 21: 11},                                           # 缺 16–19,22,23(多与数一共用)
    2018: {16: 10, 17: 10, 20: 11},                                           # 缺 15,18,19,21–23
    2019: {15: 10, 16: 10, 17: 10, 18: 10, 19: 10, 20: 11, 21: 11, 22: 11},   # 缺 23
    2020: {15: 10, 16: 10, 17: 10, 18: 10, 19: 10, 20: 11, 21: 11, 22: 11, 23: 11},  # 完整, 合计 94
    2021: {17: 10, 18: 12, 19: 12, 21: 12, 22: 12},                           # 缺 20(补齐=12)
    2022: {17: 10, 18: 12, 19: 12, 20: 12, 22: 12},                           # 缺 21(补齐=12)
    2023: {17: 10, 18: 12, 19: 12, 20: 12, 21: 12, 22: 12},                   # 完整, 合计 70
    2024: {18: 12, 19: 12, 20: 12, 21: 12, 22: 12},                           # 缺 17(补齐=10)
    # 2025/2026 交叉源尚无解析, 按 2021–2024 已验证结构(首题 10 分、其余 12 分)推定;
    # 如拿到官方分册可用 --points-override 覆盖。
    2025: {17: 10, 18: 12, 19: 12, 20: 12, 21: 12, 22: 12},
    2026: {17: 10, 18: 12, 19: 12, 20: 12, 21: 12, 22: 12},
}

# 主题词抽取: 从解析(refAnalysis)按优先级匹配第一个命中的主题词。
# 抽不出则 tags 为空数组。顺序即优先级: 考查主题在前, 解题工具词(泰勒/洛必达)
# 靠后, 避免工具词抢先误标(如间断点题的解析里常出现洛必达)。
TAG_RULES = [
    (r"二重积分|二次积分", "二重积分"),
    (r"反常积分|广义积分", "反常积分"),
    (r"变限积分|变上限积分|积分上限函数", "变限积分"),
    (r"中值定理", "中值定理"),
    (r"微分方程|特征方程|特征根|降阶|可分离变量|积分曲线|常系数", "微分方程"),
    (r"渐近线", "渐近线"),
    (r"间断点|连续性|可去间断|跳跃间断|连续与可导", "连续与间断"),
    (r"旋转体|弧长|旋转曲面|旋转.*体积|截面|水压力|压力|做功", "定积分应用"),
    (r"曲率", "曲率"),
    (r"极坐标", "极坐标"),
    (r"拐点|凹凸", "凹凸性与拐点"),
    (r"极值|最值|单调", "极值与单调性"),
    (r"偏导|全微分|多元函数", "多元函数微分"),
    (r"不定积分|原函数", "不定积分"),
    (r"定积分", "定积分"),
    (r"分部积分", "分部积分"),
    (r"隐函数", "隐函数求导"),
    (r"相关变化率", "相关变化率"),
    (r"切线|相切|法线", "切线与法线"),
    (r"无穷小", "无穷小比较"),
    (r"泰勒|麦克劳林", "泰勒展开"),
    (r"洛必达", "洛必达法则"),
    (r"不等式", "不等式证明"),
    (r"极限", "极限"),
    (r"至少存在一点|存在点?\s*ξ|存在\s*ξ|构造辅助函数", "中值定理"),
    (r"导数定义|可导|可微", "导数与可微"),
    # 线性代数(数学二 2009–2020 卷含线代部分)
    (r"二次型|正定|规范形|惯性指数|合同", "二次型"),
    (r"线性方程组|基础解系|增广矩阵|方程组.*通解", "线性方程组"),
    (r"特征值|特征向量|相似|对角化|正交", "特征值与对角化"),
    (r"秩|线性相关|线性无关|向量组|线性表示", "向量组的秩"),
    (r"伴随|可逆|逆矩阵|初等变换|行列式|过渡矩阵|矩阵", "矩阵运算"),
    # 主源个别年份混入概率题(如实抽取, 标签顺带标出)
    (r"概率|分布|期望|随机变量|密度函数", "概率统计"),
]

# 图片引用: 原库有 assets/figures/<name> 与(历史遗留的)根相对 /figures/<name> 两种写法,
# assets/figures/_map.json 把 /figures/<name> 映射到 assets/figures/<name>。
# 统一改写为 images/<name>。
IMG_TOKEN_RE = re.compile(
    r"(?P<pre>/?assets/|/)?figures/(?P<name>[A-Za-z0-9][A-Za-z0-9._\-]*\.(?:png|jpe?g|svg|gif|webp))",
    re.IGNORECASE,
)
IMG_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._\-]*$")

CHOICE_LETTERS = ("A", "B", "C", "D")


def log(msg):
    """诊断信息统一走 stderr。"""
    print(f"[math302] {msg}", file=sys.stderr)


# ---------------------------------------------------------------------------
# 网络层
# ---------------------------------------------------------------------------

_HTTP_UA = "math302-extract/1.0 (+https://github.com/PondFish-me/fish.888.moe)"


def http_get(url, timeout, binary=True, retries=2):
    """GET 一个 URL, 返回 bytes(或按需 decode), 失败抛异常。带简单重试。"""
    last_err = None
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": _HTTP_UA})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                data = resp.read()
            return data if binary else data.decode("utf-8")
        except (urllib.error.URLError, urllib.error.HTTPError, OSError, TimeoutError) as e:
            last_err = e
            if attempt < retries:
                time.sleep(1.5 * (attempt + 1))
    raise last_err


def detect_default_branch(timeout):
    """GitHub API 探测主源默认分支; 失败回退 main 并告警。"""
    url = f"{API_BASE}/repos/{MAIN_REPO}"
    try:
        meta = json.loads(http_get(url, timeout, binary=False))
        branch = meta.get("default_branch")
        if branch:
            return branch
        log(f"探测默认分支: 响应无 default_branch, 回退 {MAIN_BRANCH_FALLBACK}")
    except Exception as e:  # noqa: BLE001 — 网络/解析失败都要回退
        log(f"探测默认分支失败({e}), 回退 {MAIN_BRANCH_FALLBACK}")
    return MAIN_BRANCH_FALLBACK


def year_data_url(branch, year):
    path = YEAR_DATA_PATH.format(year=year)
    encoded = "/".join(urllib.parse.quote(seg, safe="") for seg in path.split("/"))
    return f"{RAW_BASE}/{MAIN_REPO}/{branch}/{encoded}"


def figure_url(branch, name):
    return f"{RAW_BASE}/{MAIN_REPO}/{branch}/assets/figures/{urllib.parse.quote(name)}"


# ---------------------------------------------------------------------------
# 图片本地化
# ---------------------------------------------------------------------------

def rewrite_images(text, branch, images_dir, timeout, download=True):
    """把 text 中 figures 引用改写为 images/<name>; 需要时下载图片。

    下载失败时保留原引用(远程路径)并告警, 不中断整年抽取。
    返回 (改写后的文本, 本次新下载/命中的图片名列表)。
    """
    used, touched = [], []

    def _sub(m):
        name = m.group("name")
        if not IMG_NAME_RE.match(name):
            return m.group(0)
        used.append(name)
        local_rel = f"images/{name}"
        local_path = images_dir / name
        if not local_path.exists():
            if download:
                try:
                    data = http_get(figure_url(branch, name), timeout)
                    local_path.write_bytes(data)
                    touched.append(name)
                except Exception as e:  # noqa: BLE001 — 单图失败不中断
                    log(f"图片下载失败 {name}: {e}; 保留远程引用")
                    return m.group(0)
            else:
                return m.group(0)
        return local_rel

    rewritten = IMG_TOKEN_RE.sub(_sub, text or "")
    return rewritten, touched


# ---------------------------------------------------------------------------
# 分值
# ---------------------------------------------------------------------------

def solution_points_for_year(year, numbers, log_ctx):
    """返回 {题号: 分值}。已知考证 + 确定性补齐, 保证合计 = SOLUTION_TOTALS[era]。

    补齐规则: 缺失题号按升序, base = 剩余分 // 缺失数, 余数分摊给最后 extra 个
    缺失题号(各 +1)。每次补齐都写 stderr 诊断, 明确标出哪些分值是规则推定。
    """
    total = SOLUTION_TOTALS[era_of(year)]
    known = {n: p for n, p in SOLUTION_POINTS_KNOWN.get(year, {}).items() if n in numbers}
    dropped = set(SOLUTION_POINTS_KNOWN.get(year, {})) - set(known)
    if dropped:
        log_ctx(f"分值表含本题不存在的题号 {sorted(dropped)}, 已忽略")
    missing = sorted(n for n in numbers if n not in known)
    if missing:
        rem = total - sum(known.values())
        base, extra = divmod(rem, len(missing))
        if base <= 0:
            log_ctx(f"警告: 剩余解答分 {rem} 不足分配给 {len(missing)} 题, 补齐结果可能为 0 分")
        for i, n in enumerate(missing):
            pts = max(base + (1 if i >= len(missing) - extra else 0), 0)
            known[n] = pts
            log_ctx(f"解答题 {n} 分值={pts} (规则补齐: 交叉源 OCR 缺该题分值标记)")
    got = sum(known.get(n, 0) for n in numbers)
    if got != total:
        log_ctx(f"警告: 解答题分值合计 {got} != 官方 {total}, 请核对")
    return known


def load_points_override(path):
    """--points-override: JSON {"2014": {"15": 10, ...}, ...}, 优先级最高。"""
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    return {int(y): {int(n): int(p) for n, p in m.items()} for y, m in raw.items()}


# ---------------------------------------------------------------------------
# 归一化
# ---------------------------------------------------------------------------

def extract_tag(analysis):
    for pat, tag in TAG_RULES:
        if re.search(pat, analysis or ""):
            return tag
    return None


def normalize_question(raw, year, points_map, branch, images_dir, timeout, download, log_ctx):
    number = int(raw["index"])
    src_type = (raw.get("type") or "").strip()
    qtype = TYPE_MAP.get(src_type)
    if qtype is None:
        log_ctx(f"未知题型 {src_type!r}(题 {number}), 按「解答题」处理")
        qtype = "解答题"

    def rw(text):
        return rewrite_images(text, branch, images_dir, timeout, download)[0]

    stem = rw(raw.get("stem") or "")
    answer_raw = raw.get("answer")
    options_out, wrong_out = [], []

    if qtype == "选择题":
        opts = raw.get("options") or {}
        if not opts:
            log_ctx(f"选择题 {number} 缺 options, 输出空数组")
        for letter in sorted(opts):
            options_out.append({"letter": str(letter), "html": rw(str(opts[letter] or ""))})
        wrong = raw.get("wrong_options") or {}
        for letter in sorted(wrong):
            wrong_out.append({"letter": str(letter), "html": rw(str(wrong[letter] or ""))})
        answer = str(answer_raw or "").strip().upper()
        if answer not in CHOICE_LETTERS:
            log_ctx(f"选择题 {number} 答案 {answer_raw!r} 不是 A–D, 原样保留")
            answer = str(answer_raw or "")
    else:
        options_out, wrong_out = [], []
        answer = rw(str(answer_raw or ""))
        if not answer:
            log_ctx(f"{qtype} {number} 原库 answer 为空(结论见 refAnalysis), 保留空串")

    analysis = rw(raw.get("analysis") or "")
    if not analysis:
        log_ctx(f"题 {number} 原库 analysis 为空, refAnalysis 为空串")

    tag = extract_tag(analysis)
    if qtype == "解答题":
        points = points_map[number]           # 含证明题(已并入解答题)
    else:
        points = OBJECTIVE_POINTS[era_of(year)]  # 选择/填空每题分值固定
    return {
        "id": f"m2-{year}-{number:02d}",
        "year": year,
        "number": number,
        "type": qtype,
        "points": points,
        "stem": stem,
        "options": options_out,
        "answer": answer,
        "refAnalysis": analysis,
        "wrongOptions": wrong_out,
        "tags": [tag] if tag else [],
    }


def normalize_year(year, payload, branch, images_dir, timeout, download, log_ctx):
    questions = payload.get("questions") or []
    if not questions:
        raise ValueError("questions 为空")
    declared = payload.get("count")
    if isinstance(declared, int) and declared != len(questions):
        log_ctx(f"声明 count={declared} 与实际 {len(questions)} 不符, 以实际为准")

    numbers = sorted(int(q["index"]) for q in questions)
    sol_numbers = sorted(
        q["index"] for q in questions if TYPE_MAP.get((q.get("type") or "").strip(), "解答题") == "解答题"
    )
    points_map = solution_points_for_year(year, sol_numbers, log_ctx)

    out = []
    for raw in sorted(questions, key=lambda q: int(q["index"])):
        q = normalize_question(raw, year, points_map, branch, images_dir, timeout, download, log_ctx)
        out.append(q)

    total_points = sum(q["points"] for q in out)
    if total_points != 150:
        log_ctx(f"警告: 全卷分值合计 {total_points} != 150, 请核对")
    return {"year": year, "count": len(out), "questions": out}


# ---------------------------------------------------------------------------
# 主流程
# ---------------------------------------------------------------------------

def parse_years(spec):
    years = set()
    for part in spec.split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            a, b = part.split("-", 1)
            years.update(range(int(a), int(b) + 1))
        else:
            years.add(int(part))
    return sorted(y for y in years if DEFAULT_YEAR_START <= y <= DEFAULT_YEAR_END)


def main(argv=None):
    ap = argparse.ArgumentParser(description="抽取数学二 2009–2026 真题(主源 fish.888.moe)")
    ap.add_argument("--years", default=f"{DEFAULT_YEAR_START}-{DEFAULT_YEAR_END}",
                    help="年份, 如 2009-2026 或 2021,2023")
    ap.add_argument("--branch", default=None, help="主源分支(默认自动探测)")
    ap.add_argument("--force", action="store_true", help="已存在的年份文件强制重建")
    ap.add_argument("--no-images", action="store_true", help="不下载图片, 保留远程引用")
    ap.add_argument("--points-override", default=None,
                    help='JSON 文件: {"年份": {"题号": 分}} 覆盖解答题推定分值')
    ap.add_argument("--timeout", type=int, default=30, help="单次 HTTP 超时秒数")
    args = ap.parse_args(argv)

    root = Path(__file__).resolve().parent.parent          # /Users/a24/jiaoben/math302
    questions_dir = root / "data" / "questions"
    images_dir = root / "images"
    for d in (questions_dir, images_dir, root / "data" / "explain", root / "anim",
              root / "assets", root / "tools"):
        d.mkdir(parents=True, exist_ok=True)

    years = parse_years(args.years)
    if not years:
        log(f"--years 解析结果为空, 有效范围 {DEFAULT_YEAR_START}-{DEFAULT_YEAR_END}")
        print(json.dumps({"total": 0, "perYear": {}}, ensure_ascii=False))
        return 1

    overrides = load_points_override(args.points_override) if args.points_override else {}

    branch = args.branch or detect_default_branch(args.timeout)
    log(f"主源 {MAIN_REPO} 分支 {branch}; 交叉核对源 {CROSS_REPO} 仅用于分值考证")

    download = not args.no_images
    per_year, ok_years = {}, []

    for year in years:
        out_path = questions_dir / f"{year}.json"

        def log_ctx(msg, _y=year):
            log(f"{_y}: {msg}")

        # 可重入: 已有年份数据则跳过(损坏的文件除外)
        if out_path.exists() and not args.force:
            try:
                existing = json.loads(out_path.read_text(encoding="utf-8"))
                n = len(existing.get("questions") or [])
                per_year[year] = n
                ok_years.append(year)
                log_ctx(f"已存在 data/questions/{year}.json, 跳过")
                continue
            except (ValueError, OSError) as e:
                log_ctx(f"现有文件损坏({e}), 重建")

        url = year_data_url(branch, year)
        try:
            payload = json.loads(http_get(url, args.timeout, binary=False))
        except Exception as e:  # noqa: BLE001 — 单年失败不中断其余年份
            log_ctx(f"拉取失败 {url}: {e}")
            continue

        year_obj = normalize_year(year, payload, branch, images_dir,
                                  args.timeout, download, log_ctx)
        # 分值覆盖(--points-override)优先级最高
        if year in overrides:
            ov = overrides[year]
            for q in year_obj["questions"]:
                if q["number"] in ov and q["type"] == "解答题":
                    q["points"] = ov[q["number"]]
            log_ctx(f"应用 --points-override: {sorted(ov.items())}")
        year_obj["questions"].sort(key=lambda q: q["number"])
        out_path.write_text(json.dumps(year_obj, ensure_ascii=False, indent=2) + "\n",
                            encoding="utf-8")
        per_year[year] = year_obj["count"]
        ok_years.append(year)
        n_img = sum(1 for q in year_obj["questions"]
                    for _ in re.finditer(r"images/", q["stem"] + q["refAnalysis"]
                                         + json.dumps(q["options"])))
        log_ctx(f"写入 {len(year_obj['questions'])} 题, 分值合计 "
                f"{sum(q['points'] for q in year_obj['questions'])}, 图片引用 {n_img} 处")

    # meta.json 与 stdout 的 perYear: 以磁盘上实际存在的年份数据为准(含此前
    # 运行已产出、本轮跳过的年份), 保证 total 与 perYear 口径一致
    years_on_disk = sorted(
        int(p.stem) for p in questions_dir.glob("*.json")
        if p.stem.isdigit() and DEFAULT_YEAR_START <= int(p.stem) <= DEFAULT_YEAR_END
    )
    total, per_year = 0, {}
    for y in years_on_disk:
        try:
            n = len((json.loads((questions_dir / f"{y}.json").read_text(encoding="utf-8"))
                     .get("questions") or []))
            per_year[y] = n
            total += n
        except (ValueError, OSError) as e:
            log(f"读取 {y}.json 统计失败: {e}")
    meta = {"years": years_on_disk, "total": total}
    (root / "data" / "meta.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    failed = [y for y in years if y not in ok_years]
    if failed:
        log(f"以下年份未产出: {failed}")
    if not years_on_disk:
        log("没有任何年份产出, data/meta.json 为空结构")
        print(json.dumps({"total": 0, "perYear": {}}, ensure_ascii=False))
        return 1

    print(json.dumps({"total": total,
                      "perYear": {str(y): per_year[y] for y in sorted(per_year)}},
                     ensure_ascii=False, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    sys.exit(main())
