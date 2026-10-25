/* =====================================================================
 *  HKR LCD PIDS  —  JCM Scripted PIDS Preset
 *  ---------------------------------------------------------------------
 *  适用：Joban Client Mod (JCM) 2.x  +  MTR 4
 *  文件：assets/jsblock/scripts/hklcd.js
 *
 *  复刻对象：花越线（Hana-Koshi Line）站台上的 LCD PIDS
 *    · 路线图视图：时钟牌 / 种别徽章 / 大目的地 / 竖排站名 / 旅行时间气泡
 *    · 四行到站列表（中英轮播）
 *    · 进站警示（黄色面板）
 *    · 关门提示
 *    · 空状态
 *
 *  实现：用 AWT Graphics2D 把整屏画进一张 GraphicsTexture（8x 超采样），
 *        再用一个 Texture 绘制调用铺满 PIDS 屏幕。
 *
 *  三条硬性约束（沿用同线路翻牌版的踩坑记录）：
 *    1. Resources.getSystemFont() 返回的字体只能用 deriveFont() 派生。
 *    2. deriveFont 一律用两参 (int style, float size)，避免重载歧义。
 *    3. 所有坐标先换算成设备像素并取整，再传给 AWT。
 * ===================================================================== */

/* ★ JCM 沙箱不会自动提供 Color / Font / RenderingHints 等 AWT 类，
   必须先 importPackage；否则到 setHints() 才炸，而且错误屏也会因为
   Color 未定义再次炸掉 → 屏幕全黑。翻牌版同样这么写。 */
importPackage(java.awt);
importPackage(java.awt.geom);

/* ============================ 可调参数 ============================ */

/* 超采样倍率：纹理 = pids.width × SS。8 = 1064×576（133×72 的 LCD PIDS）。
   画面没变化就不重画、不重传纹理，静止时几乎不耗性能。 */
const SS = 8;

/* 设计基准分辨率（JCM 的 LCD PIDS 内容区 133×72）。
   其它尺寸的 PIDS 会等比缩放并居中。 */
const DW = 133, DH = 72;

/* 状态切换阈值（毫秒） */
const ARRIVING_WARN_MS = 60000;   // 距进站 ≤ 60s → 进站警示
const DOOR_CLOSING_MS  = 10000;   // 距开出 ≤ 10s → 关门提示

/* 显示循环：站台/编组每 2 秒切换；通告页中英各 6 秒 */
const VIEW_PERIOD_MS = 15000;
const PHASE_MS = 2000;
const ANNOUNCE_LANG_MS = 6000;
const CYCLE_MS = 4 * PHASE_MS + 2 * ANNOUNCE_LANG_MS; // 20000

/* 通告页强制语言（空 = 跟随游戏 tick） */
var LANG_OVERRIDE = "";

/* PIDS 的“本站台”在 getTargetPlatformIds() 里的索引（多个月台时用） */
const HOME_PLATFORM_INDEX = 0;

/* 语言轮播：交给 TextUtil.cycleString 处理（JCM 固定 60 tick ≈ 3 秒一段）。
   这里只控制「一起切换」的文本。 */
const LANG_FORCE = "";            // "" = 跟随游戏；"zh"/"en" 可强制单语（调试用）

/* ============================ 配色 ============================ */
/* 实拍里整块屏会被世界光照压暗并偏蓝；这里取「贴图本身」的颜色，
   进游戏后与实拍观感一致。所有颜色都可以按需改。 */

const C_BODY    = 0xF2F3F5;   // 屏幕主体（近白）
const C_HEAD    = 0xEFF0F2;   // 顶部时钟条（近白）
const C_BAND    = 0xDFE0E2;   // 第二行信息带 / 警示页底部条（浅灰）
const C_ROW_A   = 0xE2E3E5;   // 四行列表：深色行
const C_ROW_B   = 0xEEEFF1;   // 四行列表：浅色行
const C_WHITE   = 0xFFFFFF;
const C_INK     = 0x1B1B1B;   // 主文字
const C_SUB     = 0x3F444C;   // 小字 / 注释
const C_CLOCK   = 0x1E3A72;   // 时钟牌深蓝
const C_SUN     = 0xF5C51B;   // 日/月图标
const C_YELLOW  = 0xE8C22A;   // 进站警示面板
const C_GREEN   = 0xE08A3C;   // 车辆数框（官服橙色）
const C_RULE    = 0xB9BCC2;   // 顶条与信息带之间的灰线
const C_RED     = 0xC93A2B;   // 警示三角
const C_BADGE   = 0x3C3C3C;   // 种别徽章兜底（各停）

/* ======================= 种别徽章（车种识别） =======================
 * 顺序即优先级，必须【从快到慢】排。
 * 英文里 "Limited Express" 含 "Express"、"Special Rapid" 含 "Rapid"，
 * 快的排在慢的后面就会被抢走。
 * 匹配方式：区域文本里【包含】任一关键字即命中，不区分大小写。 */

const SERVICE_OVERRIDE = [
    { name: ["特急", "特別急行", "特别急行", "Ltd. Exp.", "Limited Exp.", "Limited Express"], color: "D32F2F" },
    { name: ["準急", "准急", "Semi Exp.", "Semi-Exp.", "Semi Express"],                     color: "27AE60" },
    { name: ["特快", "Special Rapid", "Spec. Rapid", "Spec.Rapid"],                         color: "453EA5" },
    { name: ["通快", "Com.Rapid", "Com Rapid", "Commuter Rapid"],                           color: "0E9E9E" },
    { name: ["急行", "Ex.press", "Express", "Exp."],                                        color: "E67E22" },
    { name: ["快速", "Rapid Service", "Rapid"],                                             color: "215DB3" },
    { name: ["各停", "各站停车", "各站停車", "各站", "站站停", "每站停", "普通", "Local"],   color: "3C3C3C" }
];

const BADGE_EN = {
    "特急": "Spec. press",
    "準急": "Semi Exp.",
    "特快": "Special Rapid",
    "通快": "Com. Rapid",
    "急行": "Ex. press",
    "快速": "Rapid",
    "各停": "Local"
};

const SERVICE_IGNORE_EXTRA = [
    "上行", "下行", "上行方向", "下行方向",
    "東行", "西行", "南行", "北行", "东行",
    "顺时针", "逆时针", "順時針", "逆時針",
    "up", "down", "eastbound", "westbound", "northbound", "southbound",
    "clockwise", "anticlockwise", "counterclockwise"
];

/* ======================= 旅行时间估算配置 =======================
 * API 不提供站间运行时间，所以这里按车种写死一张表。
 * 数字 = 从该路线【首站】起算的累计分钟数（与实拍一致）。
 * 找不到对应车种时，用 DEFAULT_TRAVEL 的规则兜底。
 * ★ 这是估算值，页脚也照原版写了 "may vary slightly"。 */

const TRAVEL_PROFILES = [
    { keys: ["各停", "Local"],                      mins: [2, 4, 10, 11, 14, 19, 21, 23] },
    { keys: ["快速", "Rapid"],                      mins: [5, 8, 10, 13] },
    { keys: ["特急", "Spec.press", "Limited Exp."], mins: [6, 12] },
    { keys: ["準急", "Semi Exp.", "Semi-Exp."],     mins: [4, 8, 13, 18] },
    { keys: ["通快", "Com.Rapid", "Commut"],        mins: [3, 6, 9, 12] },
    { keys: ["急行", "Ex.press", "Express"],        mins: [4, 8, 12] },
    { keys: ["特快", "Special Rapid", "Spec. Rapid"], mins: [3, 6, 9] }
];
const DEFAULT_TRAVEL_FIRST = 2;  // 兜底：第一站
const DEFAULT_TRAVEL_STEP  = 3;  // 兜底：之后每站 +3 分钟

/* ============================ 字体 ============================ */

const F_CJK = "Noto Sans CJK TC Medium";
const F_LAT = "Noto Sans SemiBold";

/* ============================ 内部常量 ============================ */

const HEADER_H   = 12.6;   // 顶部浅色区高度
const CLOCK_H    = 12.6;   // 时钟牌（蓝色药丸）高度 = 顶条高度，下沿贴信息带
const BAND_Y0    = 12.6;   // 第二行信息带
const BAND_Y1    = 29.2;
const MAP_Y0     = 29.2;   // 路线图主体
const LINE_Y     = 66.2;   // 线路条中线
const LINE_TH    = 5.0;
const BUBBLE_R   = 3.9;
const TERM_R     = 4.7;    // 终点气泡更大
const NAME_BOTTOM = 62.4;  // 竖排站名底部基线
const MAP_L      = 12.0;   // 第一个站的中心
const MAP_R      = 113.6;  // 最后一个站的中心
const FOOTER_R   = 131.0;

const F_LEFT = 0, F_CENTER = 1, F_RIGHT = 2;

/* ============================ 变换 ============================ */

const T = { k: 1, ox: 0, oy: 0 };

function setupTransform(state, pids) {
    /* 横向、纵向分别铺满画布：RV PIDS 是 136x76，设计基准 133x72。
       等比缩放会在上下留白（实拍里是白线 + 整体偏下），所以分开缩放。 */
    T.kx = state.W / DW;
    T.ky = state.H / DH;
    T.k = (T.kx + T.ky) / 2;
    T.ox = 0;
    T.oy = 0;
}

function px(x) { return Math.round(x * T.kx + T.ox); }
function py(y) { return Math.round(y * T.ky + T.oy); }

/* ============================ 入口函数 ============================ */

function create(ctx, state, pids) {
    state.W = Math.max(1, Math.round(Number(pids.width) * SS));
    state.H = Math.max(1, Math.round(Number(pids.height) * SS));
    state.err = null;
    state.sig = null;
    state.mode = null;
    state.t0 = nowMs();

    state.tex = new GraphicsTexture(state.W, state.H);
    try {
        setupTransform(state, pids);
        state.fonts = makeFonts();
        fillBackground(state);
    } catch (e) {
        state.err = errText(e);
        try { drawErrorScreen(state); } catch (e2) { }
    }
    try { state.tex.upload(); } catch (e3) { }
}

function render(ctx, state, pids) {
    if (state.tex == null) return;

    var sig;
    try {
        sig = stateSignature(pids, state);
    } catch (e) {
        sig = "err:" + nowMs();
    }

    if (sig !== state.sig) {
        try {
            setupTransform(state, pids);
            setHints(state.tex.graphics);
            fillBackground(state);
            drawAll(state.tex.graphics, state, pids);
            state.err = null;
        } catch (e) {
            state.err = errText(e);
            try { drawErrorScreen(state); } catch (e2) { }
        }
        try { state.tex.upload(); } catch (e3) { }
        state.sig = sig;
    }

    /* 绘制调用必须每帧提交（JCM 每轮脚本执行后清空上一轮） */
    Texture.create("HKR LCD PIDS")
        .texture(state.tex.identifier)
        .size(pids.width, pids.height)
        .draw(ctx);

    /* 警示页：SP1900 logo（带淡入） + 红色三角，独立纹理叠层 */
    if (state.mode === "warn" && state.warnIcon != null) {
        var fadeT = nowMs() % 5000;
        var fadeA = fadeT < 600 ? fadeT / 600 : 1.0;
        var aByte = Math.round(fadeA * 255) & 0xFF;
        var argb = (aByte << 24) | 0x00FFFFFF;
        Texture.create("HKR LCD PIDS sp1900")
            .texture("jsblock:textures/pids/hklcd/sp1900.png")
            .pos(state.warnIcon.x, state.warnIcon.y)
            .size(state.warnIcon.w, state.warnIcon.h)
            .color(argb)
            .draw(ctx);
        Texture.create("HKR LCD PIDS warn triangle")
            .texture("jsblock:textures/pids/hklcd/warn_triangle.png")
            .pos(state.warnTri.x, state.warnTri.y)
            .size(state.warnTri.w, state.warnTri.h)
            .draw(ctx);
    }

    /* 天气图标：JCM 内置贴图（jsblock:textures/block/pids/weather_*.png） */
    if (state.weatherRect != null) {
        Texture.create("HKR LCD PIDS weather")
            .texture(weatherPath())
            .pos(state.weatherRect.x, state.weatherRect.y)
            .size(state.weatherRect.w, state.weatherRect.h)
            .draw(ctx);
    }
}

function dispose(ctx, state, pids) {
    if (state.tex != null) {
        try { state.tex.close(); } catch (e) { }
        state.tex = null;
    }
}

/* ============================ 状态判定 ============================ */

function getNow(pids) {
    return nowMs();
}

function decideMode(arrivals, now) {
    var a = arrivals == null ? null : arrivals.get(0);
    if (a == null) return { mode: "empty", a: null, eta: 0, dep: 0 };

    var eta = num(a.arrivalTime()) - now;
    var dep = num(a.departureTime()) - now;

    /* 必须已经到站（eta<=0），并且距开出 ≤10 秒才切关门提示；
       否则晚点列车会在还没进站时就提前切走。 */
    if (eta <= 0 && dep > 0 && dep <= DOOR_CLOSING_MS) return { mode: "door", a: a, eta: eta, dep: dep };
    /* 进站中 */
    if (eta > 0 && eta <= ARRIVING_WARN_MS) return { mode: "warn", a: a, eta: eta, dep: dep };
    /* 到站了但还没到关门窗口：仍按普通视图显示（"Departing Now"） */
    return { mode: "normal", a: a, eta: eta, dep: dep };
}

function forcedView() {
    try {
        if (typeof SCRIPT_INPUT !== "undefined" && SCRIPT_INPUT != null && SCRIPT_INPUT.view) {
            var v = String(SCRIPT_INPUT.view);
            if (v === "list" || v === "map") return v;
        }
    } catch (e) { }
    return "";
}

function forcedPhaseSec() {
    try {
        if (typeof SCRIPT_INPUT !== "undefined" && SCRIPT_INPUT != null && SCRIPT_INPUT.phaseSec != null) {
            var n = Number(SCRIPT_INPUT.phaseSec);
            if (isFinite(n) && n >= 0) return n;
        }
    } catch (e) { }
    return -1;
}

function cycleT(now, state) {
    var f = forcedPhaseSec();
    if (f >= 0) return (f * 1000) % CYCLE_MS;
    /* 用绝对时间取相位：同一站台的多块屏会同步切换 */
    var t = now % CYCLE_MS;
    if (t < 0) t += CYCLE_MS;
    return t;
}

/* 0-2s 站台列表 / 2-4s 编组列表 / 4-6s 站台 / 6-8s 编组
   8-14s 停靠月台通告(中) / 14-20s 停靠月台通告(英)
   通告期间也是每 2 秒在站台/编组间切换 */
function normalPhase(now, state) {
    var t = cycleT(now, state);
    var seg = Math.floor(t / PHASE_MS); // 0..9
    if (seg < 4) {
        return { kind: "list", formation: (seg % 2 === 1), lang: "", key: "L" + (seg % 2) };
    }
    var isZh = seg < 7;
    var k = isZh ? seg - 4 : seg - 7;
    return {
        kind: "announce",
        formation: (k % 2 === 1),
        lang: isZh ? "zh" : "en",
        key: "A" + (isZh ? "z" : "e") + (k % 2)
    };
}

/* ============================ 内容签名 ============================ */

function stateSignature(pids, state) {
    var now = nowMs();
    var arrivals = pids.arrivals();
    var dm = decideMode(arrivals, now);
    var mode = dm.mode;

    var parts = ["v1", pids.width, pids.height, mode, langPhase()];
    var d = new Date(Number(now));
    parts.push(d.getHours() + ":" + d.getMinutes());
    parts.push(isDay(d) ? "D" : "N");
    parts.push(weatherPath());

    if (mode === "normal") {
        var ph = normalPhase(now, state);
        parts.push(ph.key);
        if (dm.a != null) parts.push(isHomePlatform(dm.a, pids) ? "H" : "O");
        var fv = forcedView();
        if (fv !== "") parts.push("v" + fv);
    }

    /* 前四班车：所有可能影响画面的字段 + 量化后的倒计时 */
    var i, a, eta;
    for (i = 0; i < 4; i++) {
        a = arrivals.get(i);
        if (a == null) { parts.push("-"); continue; }
        eta = num(a.arrivalTime()) - now;
        parts.push(safeStr(a.routeNumber()) + "\u0001" + safeStr(a.routeName()) + "\u0001"
            + safeStr(a.destination()) + "\u0001" + safeStr(a.platformName()) + "\u0001"
            + num(a.routeColor()) + "\u0001" + num(a.carCount()) + "\u0001"
            + (a.realtime() ? 1 : 0) + "\u0001" + (a.terminating() ? 1 : 0) + "\u0001"
            + Math.floor(eta / 60000) + "\u0001" + Math.floor(eta / 1000));
    }

    /* 路线图内容 */
    var mapInfo = null;
    try { mapInfo = buildMapInfo(arrivals, pids); } catch (eMap) { mapInfo = null; }
    state.mapInfo = mapInfo;
    if (mapInfo != null) {
        parts.push("M" + mapInfo.color + "\u0001" + mapInfo.stations.length);
        for (i = 0; i < mapInfo.stations.length; i++) {
            parts.push(mapInfo.stations[i].name + "\u0002" + mapInfo.times[i]);
        }
    } else {
        parts.push("M0");
    }

    if (mode === "warn" || mode === "door") {
        parts.push("S" + Math.floor(dm.eta / 1000) + "\u0001" + Math.floor(dm.dep / 1000));
    }

    return parts.join("\u0003");
}

function langPhase() {
    if (LANG_OVERRIDE === "zh") return "zh";
    if (LANG_OVERRIDE === "en") return "en";
    if (LANG_FORCE === "zh") return "zh";
    if (LANG_FORCE === "en") return "en";
    /* ★ 必须 String() 一次：TextUtil.cycleString 返回 Java String 对象，
       直接拿去 isCjkStr() 会因为没有 .length 属性而被误判成英文。 */
    return String(TextUtil.cycleString("zh|en"));
}

/* ============================ 主绘制 ============================ */

function drawAll(g, state, pids) {
    var F = state.fonts;
    var now = nowMs();
    var arrivals = pids.arrivals();
    var dm = decideMode(arrivals, now);
    var d = new Date(Number(now));

    state.mode = dm.mode;

    if (dm.mode === "empty") {
        drawEmpty(g, F, state);
    } else if (dm.mode === "warn") {
        drawWarning(g, F, dm.a, dm.eta, dm.dep, state);
    } else if (dm.mode === "door") {
        drawDoor(g, F, dm.a, dm.eta, dm.dep, state);
    } else {
        var ph = normalPhase(now, state);
        var fv = forcedView();
        var info = state.mapInfo;
        if (info == null) info = buildMapInfo(arrivals, pids);

        if (fv === "list") {
            drawListView(g, F, arrivals, now, state, ph.formation);
        } else if (fv === "map") {
            drawMapView(g, F, dm.a, dm.eta, info, state, ph.formation);
        } else if (ph.kind === "list") {
            drawListView(g, F, arrivals, now, state, ph.formation);
        } else if (!isOutOfService(dm.a) && isHomePlatform(dm.a, pids)) {
            /* 本月台到站 → 路线图（不載客列车除外） */
            drawMapView(g, F, dm.a, dm.eta, info, state, ph.formation);
        } else {
            /* 其他月台到站 → 停靠月台通告 */
            LANG_OVERRIDE = ph.lang;
            try {
                drawAnnounceView(g, F, dm.a, dm.eta, ph.formation, state);
            } finally {
                LANG_OVERRIDE = "";
            }
        }
    }

    /* 时钟条最后画：说明文字会压在信息带上沿（与实拍一致） */
    drawHeader(g, F, d, state);
}

/* ---------------------------- 背景 ---------------------------- */

function fillBackground(state) {
    var g = state.tex.graphics;
    g.setColor(col(C_BODY));
    g.fillRect(0, 0, state.W, state.H);
}

/* ---------------------------- 顶部时钟条 ---------------------------- */

function drawHeader(g, F, d, state) {
    /* 顶部浅色区：时钟牌只占左边一块，右边留给说明文字 */
    fRect(g, 0, 0, DW, HEADER_H, C_HEAD);
    /* 顶条底部灰线：先画线，再画蓝牌，蓝牌自然把线盖住 */
    fRect(g, 0, HEADER_H - 0.34, DW, HEADER_H, C_RULE);

    var hh = pad2(d.getHours());
    var mm = pad2(d.getMinutes());
    var timeStr = hh + ":" + mm;
    var timeW = textWidth(g, timeStr, F.clock);
    var utcX = 2.8 + timeW + 0.9;
    var divX = utcX + 3.9;
    var iconX = divX + 1.8;
    var pillX = iconX + 9.8;

    /* 时钟牌：左缘伸出屏幕外，右侧圆角 */
    fRound(g, -6, 0, pillX, CLOCK_H, 5.5, C_CLOCK);

    drawText(g, timeStr, 2.8, baselineForCenter(g, F.clock, CLOCK_H / 2 - 0.4), F.clock, C_WHITE, F_LEFT);

    drawText(g, "UTC", utcX, 5.1, F.utc, C_WHITE, F_LEFT);
    drawText(g, utcOffset(d), utcX, 8.2, F.utc, C_WHITE, F_LEFT);

    strokeLine(g, divX, 4.3, divX, 9.0, 0.3, 0x8FA6CF);

    /* 天气图标：用 JCM 自带贴图，作为独立的 Texture 绘制调用提交（见 render()）。
       这里只记录它在 PIDS 坐标系里的位置/大小。 */
    state.weatherRect = {
        x: px(iconX) / SS,
        y: py(2.8) / SS,
        w: (px(iconX + 6.4) - px(iconX)) / SS,
        h: (py(2.8 + 6.4) - py(2.8)) / SS
    };

    drawHeaderNote(g, F);
}

/* 右上两行说明：
   · “Displayed in / 表示時間為” 灰色，“DEP. Time / 開出時間” 深蓝色（同左上时钟牌）
   · 两行各自缩放到同一宽度，左右都对齐
   · 整块垂直居中在顶部时钟条内 */
function drawHeaderNote(g, F) {
    var NOTE_W = 20.8;
    var y1 = 5.2, y2 = 8.2;

    var a = "Displayed in ", b = "DEP. Time";
    var wa0 = textWidth(g, a, F.noteLat), wb0 = textWidth(g, b, F.noteLatB);
    var sc = clampScale(NOTE_W / (wa0 + wb0));
    var fa = scaleFont(F.noteLat, sc), fb = scaleFont(F.noteLatB, sc);
    var wa = textWidth(g, a, fa), wb = textWidth(g, b, fb);
    var x0 = FOOTER_R - (wa + wb);
    drawText(g, a, x0, y1, fa, C_SUB, F_LEFT);
    drawText(g, b, x0 + wa, y1, fb, C_CLOCK, F_LEFT);

    var c1 = "表示時間為 ", c2 = "開出時間";
    var wc1_0 = textWidth(g, c1, F.noteCjk), wc2_0 = textWidth(g, c2, F.noteCjk);
    var sc2 = clampScale(NOTE_W / (wc1_0 + wc2_0));
    var fc1 = scaleFont(F.noteCjk, sc2), fc2 = scaleFont(F.noteCjk, sc2);
    var wc1 = textWidth(g, c1, fc1), wc2 = textWidth(g, c2, fc2);
    var xc = FOOTER_R - (wc1 + wc2);
    drawText(g, c1, xc, y2, fc1, C_SUB, F_LEFT);
    drawText(g, c2, xc + wc1, y2, fc2, C_CLOCK, F_LEFT);
}

function clampScale(sc) {
    if (!(sc > 0) || !isFinite(sc)) return 1;
    return Math.max(0.72, Math.min(1.45, sc));
}

function scaleFont(font, sc) {
    return font.deriveFont(font.getStyle(), font.getSize2D() * sc);
}

/* ---------- JCM 天气图标 ---------- */
var WEATHER_CACHE = { path: "", img: null };

function weatherPath() {
    try {
        if (typeof MinecraftClient !== "undefined") {
            if (MinecraftClient.worldIsThundering()) return "jsblock:textures/block/pids/weather_thunder.png";
            if (MinecraftClient.worldIsRaining()) return "jsblock:textures/block/pids/weather_rainy.png";
        }
    } catch (e) { }
    return "jsblock:textures/block/pids/weather_sunny.png";
}


/* ---------------------------- 四行到站列表 ---------------------------- */

function drawListView(g, F, arrivals, now, state, formation) {
    /* 顶部条已画；四行从 BAND_Y0 铺到底 */
    var rowH = (DH - HEADER_H) / 4;
    for (var i = 0; i < 4; i++) {
        var y0 = HEADER_H + i * rowH;
        fRect(g, 0, y0, DW, y0 + rowH, (i % 2 === 0) ? C_ROW_A : C_ROW_B);
    }

    for (var k = 0; k < 4; k++) {
        var a = arrivals.get(k);
        if (a == null) continue;
        var y = HEADER_H + k * rowH;
        drawListRow(g, F, a, y, rowH, now, formation);
    }
}

function drawListRow(g, F, a, y0, rowH, now, formation) {
    var svc = resolveService(a);
    var badgeColor = svc.color != null ? svc.color : num(a.routeColor());

    var pmTxt = safeStr(a.platformName());
    var pmW = 0;
    if (!formation && pmTxt !== "" && !isPlatformHidden(a)) {
        pmW = platformBadgeW(g, pmTxt, F.rowPlatNum, 4.2);
    }
    var destLimit = formation ? 93.6 : (pmW > 0 ? (99.6 + 4.2 - pmW) - 1.5 : 94.6);

    var oos = isOutOfService(a);
    if (!oos) {
        /* 徽章 */
        var bh = rowH - 3.2;
        var by = y0 + 1.6;
        fRound(g, 1.4, by, 26.4, by + bh, 1.7, badgeColor);
        drawBadgeText(g, F, svc, 1.4, by, 26.4, bh, F.rowBadgeCjk, F.rowBadgeLat);

        /* 目的地 */
        var dest = cycleText(a.destination());
        var destFont = isCjkStr(dest) ? F.rowDestCjk : F.rowDestLat;
        var base = baselineForCenter(g, destFont, y0 + rowH * 0.5);
        drawFitMixed(g, dest, 27.6, base, destLimit - 27.6, F.rowDestLat, F.rowDestCjk, C_INK, F_LEFT);
    } else {
        /* 不載客：不画徽章，文字从目的地位置开始 */
        var ot = oosLabel();
        var of = isCjkStr(ot) ? F.rowOosCjk : F.rowOosLat;
        drawText(g, ot, 27.6, baselineForCenter(g, of, y0 + rowH * 0.5), of, C_INK, F_LEFT);
    }

    if (formation) {
        /* 编组页：车箱数框（4 car / 4 卡） */
        var cars = num(a.carCount());
        if (cars > 0) {
            var bx0 = 95.2, bx1 = 106.4;
            var by0 = y0 + 2.3, by1 = y0 + rowH - 2.3;
            g.setColor(col(C_GREEN));
            g.setStroke(new java.awt.BasicStroke(Math.max(1, Math.round(0.5 * T.k))));
            g.drawRoundRect(px(bx0), py(by0), Math.max(1, px(bx1) - px(bx0)),
                Math.max(1, py(by1) - py(by0)), Math.round(2.2 * T.k), Math.round(2.2 * T.k));
            drawText(g, String(cars), (bx0 + bx1) / 2, by1 - 3.3, F.rowCarNum, C_INK, F_CENTER);
            var carUnit = cycleText("卡|car", true);
            var cuf = isCjkStr(carUnit) ? F.rowCarUnitCjk : F.rowCarUnitLat;
            drawText(g, carUnit, (bx0 + bx1) / 2, by1 - 0.7, cuf, C_INK, F_CENTER);
        }
    } else {
        /* 站台页：月台圆圈 / 长号码药丸 */
        drawPlatformBadge(g, F, a, y0 + rowH * 0.5, 4.2, F.rowPlatNum, 99.6);
    }

    /* 剩余时间：按“开出时间”计算；>15 分钟显示开出时刻 HH:MM */
    var eta = num(a.departureTime()) - now;
    var mins = clampMins(Math.ceil(eta / 60000));
    var rightEdge = FOOTER_R;
    if (eta < 60000) {
        var secs = Math.max(0, Math.ceil(eta / 1000));
        var unitS = cycleText("秒|sec", true);
        var ufS = isCjkStr(unitS) ? F.rowEtaUnitCjk : F.rowEtaUnitLat;
        var uwS = textWidth(g, unitS, ufS);
        var numS = String(secs);
        var nfS = secs >= 10 ? F.rowEtaNumSmall : F.rowEtaNum;
        var nwS = textWidth(g, numS, nfS);
        var baseS = baselineForCenter(g, nfS, y0 + rowH * 0.5);
        drawText(g, numS, rightEdge - uwS - nwS - 0.9, baseS, nfS, C_INK, F_LEFT);
        drawText(g, unitS, rightEdge - uwS, baseS, ufS, C_INK, F_LEFT);
    } else if (mins > 15) {
        var tat = new Date(Number(num(a.departureTime())));
        var clockStr = pad2(tat.getHours()) + ":" + pad2(tat.getMinutes());
        var cf = F.rowClock;
        var cw = textWidth(g, clockStr, cf);
        var cbase = baselineForCenter(g, cf, y0 + rowH * 0.5);
        drawText(g, clockStr, rightEdge - cw, cbase, cf, C_INK, F_LEFT);
    } else {
        var unitLat = cycleText("分鐘|min", true);
        var unit = unitFor(unitLat, mins);
        var uf = isCjkStr(unit) ? F.rowEtaUnitCjk : F.rowEtaUnitLat;
        var uw = textWidth(g, unit, uf);
        var numStr = String(mins);
        var nf = mins >= 10 ? F.rowEtaNumSmall : F.rowEtaNum;
        var nw = textWidth(g, numStr, nf);
        var etaBase = baselineForCenter(g, nf, y0 + rowH * 0.5);
        drawText(g, numStr, rightEdge - uw - nw - 0.9, etaBase, nf, C_INK, F_LEFT);
        drawText(g, unit, rightEdge - uw, etaBase, uf, C_INK, F_LEFT);
    }
}

/* ---------------------------- 路线图视图 ---------------------------- */

function drawMapView(g, F, a, eta, info, state, formation) {
    /* 第二行信息带 */
    fRect(g, 0, BAND_Y0, DW, BAND_Y1, C_BAND);

    var svc = resolveService(a);
    var badgeColor = svc.color != null ? svc.color : num(a.routeColor());

    /* 种别徽章（宽度随文字与语言变化） */
    var bandCY = (BAND_Y0 + BAND_Y1) / 2;
    if (isOutOfService(a)) {
        var ot = oosLabel();
        var of = isCjkStr(ot) ? F.oosHeadCjk : F.oosHeadLat;
        drawText(g, ot, 22.0, baselineForCenter(g, of, bandCY), of, C_INK, F_LEFT);
    } else {
        var probe = badgePick(g, F, svc);
        var bh = 13.2;
        var by = bandCY - bh / 2;
        var bw = drawServiceBadge(g, F, svc, 1.4, by, bh, badgeColor);

        /* 目的地 */
        var dest = cycleText(a.destination());
        var destFont = isCjkStr(dest) ? F.destCjk : F.destLat;
        var destBase = baselineForCenter(g, destFont, (BAND_Y0 + BAND_Y1) / 2);
        var destX = 1.4 + bw + 2.8;
        var pmW = 0;
        if (!formation) {
            var pmTxt = safeStr(a.platformName());
            if (pmTxt !== "" && !isPlatformHidden(a)) pmW = platformBadgeW(g, pmTxt, F.circNumBig, 5.9);
        }
        var destRight = formation ? 88.8 : (pmW > 0 ? (99.2 + 5.9 - pmW) - 1.5 : 90.8);
        var destMax = destRight - destX;
        drawFitMixed(g, dest, destX, destBase, destMax, F.destLat, F.destCjk, C_INK, F_LEFT);
    }

    /* 右侧：站台/编组每 2 秒切换；按开出时间显示 */
    var depMs = num(a.departureTime()) - nowMs();
    if (formation) {
        drawCarBox(g, F, a, depMs, bandCY);
        if (depMs <= 0) drawDepartingNow(g, F, depMs, bandCY);
        else drawEtaOnly(g, F, a, depMs, bandCY);
    } else {
        drawPlatformCircle(g, F, a, bandCY);
        if (depMs <= 0) drawDepartingNow(g, F, depMs, bandCY);
        else drawEtaOnly(g, F, a, depMs, bandCY);
    }

    /* 路线图主体 */
    fRect(g, 0, MAP_Y0, DW, DH, C_BODY);
    drawRouteMap(g, F, info, state);

    /* 时间气泡已移除，页脚估算说明一并去掉 */
}

function platformBadgeW(g, pm, font, r) {
    var tw = textWidth(g, pm, font);
    if (tw <= 2 * r * 0.95) return 2 * r;
    return tw + Math.max(2.2, r * 0.55) * 2;
}

/* 普通月台号画圆形；像 "3.1" 这种较长的号码画成药丸形，适应文字宽度 */
function drawPlatformBadge(g, F, a, cy, r, font, cx) {
    var pm = safeStr(a.platformName());
    if (pm === "" || isPlatformHidden(a)) return 0;
    var w = platformBadgeW(g, pm, font, r);
    if (w <= 2 * r + 0.01) {
        fOval(g, cx, cy, r, r, lineColor(a));
        drawText(g, pm, cx, baselineForCenter(g, font, cy), font, C_WHITE, F_CENTER);
    } else {
        /* 长号码：向右对齐到圆形原来的右缘，向左延伸成药丸 */
        var x1 = cx + r;
        var x0 = x1 - w;
        fRound(g, x0, cy - r, x1, cy + r, r, lineColor(a));
        drawText(g, pm, (x0 + x1) / 2, baselineForCenter(g, font, cy), font, C_WHITE, F_CENTER);
    }
    return w;
}

function drawPlatformCircle(g, F, a, cy) {
    drawPlatformBadge(g, F, a, cy, 5.9, F.circNumBig, 99.2);
}

function drawEtaOnly(g, F, a, eta, centerY) {
    var useSec = eta < 60000;
    var mins = clampMins(Math.ceil(eta / 60000));
    var secs = Math.max(0, Math.ceil(eta / 1000));
    var unit = useSec ? cycleText("秒|sec", true) : unitFor(cycleText("分鐘|min", true), mins);
    var uf = isCjkStr(unit) ? F.etaUnitCjk : F.etaUnitLat;
    var uw = textWidth(g, unit, uf);
    var ns = useSec ? String(secs) : String(mins);
    var nf = (useSec ? secs : mins) >= 10 ? F.etaNumSmall : F.etaNum;
    var nw = textWidth(g, ns, nf);
    var right = FOOTER_R;
    var base = baselineForCenter(g, nf, centerY);
    drawText(g, ns, right - uw - nw - 1.5, base, nf, C_INK, F_LEFT);
    drawText(g, unit, right - uw, base, uf, C_INK, F_LEFT);
}

function drawPlatformAndEta(g, F, a, eta, cy) {
    drawPlatformCircle(g, F, a, cy);
    drawEtaOnly(g, F, a, eta, cy);
}

function drawCarBox(g, F, a, eta, cy) {
    var cars = num(a.carCount());
    if (cars <= 0) return;
    var boxH = 14.0;
    var x0 = 91.6, y0 = cy - boxH / 2, x1 = 103.4, y1 = cy + boxH / 2;
    /* 绿色描边矩形 */
    g.setColor(col(C_GREEN));
    g.setStroke(new java.awt.BasicStroke(Math.max(1, Math.round(0.55 * T.k))));
    g.drawRoundRect(px(x0), py(y0), Math.max(1, px(x1) - px(x0)), Math.max(1, py(y1) - py(y0)),
        Math.round(2.4 * T.k), Math.round(2.4 * T.k));
    /* 大数字 + car */
    var numBase = y1 - 4.4;
    drawText(g, String(cars), (x0 + x1) / 2, numBase, F.carNum, C_INK, F_CENTER);
    var unit = cycleText("卡|car", true);
    var uf = isCjkStr(unit) ? F.carUnitCjk : F.carUnitLat;
    drawText(g, unit, (x0 + x1) / 2, y1 - 1.2, uf, C_INK, F_CENTER);
}

function drawDepartingNow(g, F, eta, cy) {
    var isEn = langPhase() === "en";
    var x = 104.8, w = FOOTER_R - 104.8;
    if (isEn) {
        /* 两行按整体在信息带里垂直居中 */
        var fm = g.getFontMetrics(F.statusLat);
        var lh = fm.getHeight() * 0.95 / T.ky;
        var asc = fm.getAscent() / T.ky;
        var base = cy - lh + asc;
        drawText(g, "Departing", x + w / 2, base, F.statusLat, C_INK, F_CENTER);
        drawText(g, "Now", x + w / 2, base + lh, F.statusLat, C_INK, F_CENTER);
    } else {
        drawText(g, "即將開出", x + w / 2, baselineForCenter(g, F.statusCjk, cy), F.statusCjk, C_INK, F_CENTER);
    }
}

/* ---------------------------- 路线图本体 ---------------------------- */

function drawRouteMap(g, F, info, state) {
    if (info == null || info.stations.length === 0) return;

    var n = info.stations.length;
    var st = info.stations;

    /* 线路条：从屏幕左缘到最后一个站，圆头 */
    var xs = [];
    var i;
    for (i = 0; i < n; i++) {
        xs.push(n === 1 ? (MAP_L + MAP_R) / 2 : MAP_L + (MAP_R - MAP_L) * i / (n - 1));
    }
    g.setColor(col(info.color));
    g.setStroke(new java.awt.BasicStroke(Math.max(2, Math.round(LINE_TH * T.k)),
        java.awt.BasicStroke.CAP_ROUND, java.awt.BasicStroke.JOIN_ROUND));
    g.drawLine(px(0), py(LINE_Y), px(xs[n - 1]), py(LINE_Y));

    /* 站名（先画，气泡压在上面） */
    for (i = 0; i < n; i++) {
        drawStationName(g, F, st[i].name, xs[i], NAME_BOTTOM);
    }

    /* 站点圆点（不显示时间） */
    for (i = 0; i < n; i++) {
        var isTerm = (i === n - 1);
        var r = isTerm ? 2.6 : 2.0;
        fOval(g, xs[i], LINE_Y, r, r, C_WHITE);
        g.setColor(col(info.color));
        g.setStroke(new java.awt.BasicStroke(Math.max(2, Math.round(0.8 * T.k))));
        g.drawOval(px(xs[i] - r), py(LINE_Y - r), Math.max(1, px(xs[i] + r) - px(xs[i] - r)),
            Math.max(1, py(LINE_Y + r) - py(LINE_Y - r)));
    }
}

/* 竖排站名：中文逐字竖排；拉丁文旋转 90°（自下而上，底部对齐线路） */
function drawStationName(g, F, name, cx, bottom) {
    if (name == null || name === "") return;

    var top = MAP_Y0 + 1.2;
    var maxTop = 34.6;

    if (isCjkStr(name)) {
        var chars = [];
        var i;
        for (i = 0; i < name.length; i++) {
            var ch = name.charAt(i);
            if (ch === " " || ch === "　") continue;
            chars.push(ch);
        }
        if (chars.length === 0) return;

        var fs = F.nameCjk.getSize2D() / T.k;
        var step = 4.75;
        var base = NAME_BOTTOM;
        if (chars.length > 1 && (base - maxTop) / (chars.length - 1) < step) {
            step = (base - maxTop) / (chars.length - 1);
        }
        var font = F.nameCjk;
        if (step < 4.2) {
            font = font.deriveFont(java.awt.Font.BOLD, font.getSize2D() * Math.max(0.78, step / 4.2));
            fs = font.getSize2D() / T.k;
        }
        for (i = chars.length - 1; i >= 0; i--) {
            drawText(g, chars[i], cx, base, font, C_INK, F_CENTER);
            base -= step;
        }
    } else {
        var f = F.nameLat;
        g.setFont(f);
        g.setColor(col(C_INK));
        var fm = g.getFontMetrics(f);
        var textW = fm.stringWidth(String(name));
        var maxW = py(NAME_BOTTOM - top);
        if (textW > maxW && maxW > 10) {
            var sc = maxW / textW;
            f = f.deriveFont(java.awt.Font.BOLD, f.getSize2D() * sc);
            g.setFont(f);
            fm = g.getFontMetrics(f);
            textW = fm.stringWidth(String(name));
        }
        /* 旋转 -90° 后字形在基线左侧，水平补偿让整列居中在线路上方 */
        var dx = (fm.getAscent() - fm.getDescent()) / 2 / T.kx;
        var saved = g.getTransform();
        g.translate(px(cx + dx), py(NAME_BOTTOM));
        g.rotate(-Math.PI / 2.0);
        g.drawString(String(name), 0, 0);
        g.setTransform(saved);
    }
}

/* ---------------------------- 进站警示 ---------------------------- */

function drawWarning(g, F, a, eta, dep, state) {
    var y0 = HEADER_H, y1 = 56.9;

    /* 黄色面板 */
    fRect(g, 0, y0, DW, y1, C_YELLOW);

    /* 图标改为独立纹理叠层（JCM Texture 通道，保留 PNG alpha）：
       这里只记录位置，真正的绘制调用在 render() 里提交。 */
    state.warnIcon = {
        x: px(12.5) / SS,
        y: py(23.5) / SS,
        w: (px(37.0) - px(12.5)) / SS,
        h: (py(48.0) - py(23.5)) / SS
    };
    var tw = 12.0, th = 11.0, tcx = 15.0, tcy = 42.0;
    state.warnTri = {
        x: px(tcx - tw / 2) / SS,
        y: py(tcy - th / 2) / SS,
        w: (px(tcx + tw / 2) - px(tcx - tw / 2)) / SS,
        h: (py(tcy + th / 2) - py(tcy - th / 2)) / SS
    };

    /* 两行警示语：中英各自成对，跟随语言轮播 */
    var l1 = cycleText("列車即將進站|Train Arriving", true);
    var isCjk = isCjkStr(l1);
    if (isCjk) {
        drawText(g, "列車即將進站", 54.0, 32.0, F.warnCjk, C_INK, F_LEFT);
        drawText(g, "請勿站越黃線", 54.0, 47.0, F.warnCjk, C_INK, F_LEFT);
    } else {
        /* 官服英语版：Train Arriving / Please stand behind / 斜体衬线 the yellow line */
        drawText(g, "Train Arriving", 54.0, 28.2, F.warnLat1, C_INK, F_LEFT);
        drawText(g, "Please stand behind", 54.0, 39.4, F.warnLat2, C_INK, F_LEFT);
        drawText(g, "the yellow line", 54.0, 47.2, F.warnItalic, C_INK, F_LEFT);
    }

    /* 底部信息条 */
    drawBottomBar(g, F, a, eta, dep, 56.9);
}

/* SP1900 正面车头（矢量，随淡入 alpha 绘制） */
function drawSp1900(g, F, alpha) {
    var old = g.getComposite();
    try {
        g.setComposite(java.awt.AlphaComposite.getInstance(java.awt.AlphaComposite.SRC_OVER, alpha));
    } catch (eC) { }

    /* 按提供的 SP1900 图标重绘：圆润黑色车头 + 一条白色横带 + 两只白头灯 */
    fRound(g, 8.0, 22.4, 26.0, 40.6, 6.2, 0x1E1E1E);
    fRound(g, 9.4, 28.8, 24.6, 33.8, 1.9, 0xF2F2F2);
    fOval(g, 11.4, 36.8, 1.6, 1.6, 0xFFFFFF);
    fOval(g, 22.6, 36.8, 1.6, 1.6, 0xFFFFFF);

    g.setComposite(old);
}

function drawWarningTriangle(g, F, cx, cy, w, h) {
    /* 白色圆角三角 + 红色描边 + 黑色感叹号。用 Path2D 避免 int[] 重载问题。 */
    var x0 = cx - w / 2, x1 = cx + w / 2;
    var yTop = cy - h / 2, yBot = cy + h / 2;
    var p = new java.awt.geom.Path2D.Double();
    p.moveTo(px(cx), py(yTop + 0.4));
    p.lineTo(px(x1 - 0.35), py(yBot - 0.35));
    p.lineTo(px(x0 + 0.35), py(yBot - 0.35));
    p.closePath();

    g.setColor(col(C_WHITE));
    g.fill(p);
    g.setColor(col(C_RED));
    g.setStroke(new java.awt.BasicStroke(Math.max(2, Math.round(0.9 * T.k)),
        java.awt.BasicStroke.CAP_ROUND, java.awt.BasicStroke.JOIN_ROUND));
    g.draw(p);

    drawText(g, "!", cx, cy + h * 0.28, F.warnMark, C_INK, F_CENTER);
}

/* ---------------------------- 关门提示 ---------------------------- */

function drawDoor(g, F, a, eta, dep, state) {
    var y0 = HEADER_H, y1 = 56.9;
    fRect(g, 0, y0, DW, y1, C_BODY);

    /* 中文大字 + 英文两行，一起显示（实拍如此） */
    drawText(g, "請勿靠近車門", DW / 2, 34.4, F.doorCjk, C_INK, F_CENTER);
    drawText(g, "Please stand back", DW / 2, 43.2, F.doorLat, C_INK, F_CENTER);
    drawText(g, "from the train doors", DW / 2, 50.2, F.doorLat, C_INK, F_CENTER);

    drawBottomBar(g, F, a, eta, dep, 56.9);
}

/* ---------------------------- 空状态 ---------------------------- */

function drawEmpty(g, F, state) {
    drawText(g, "沒有列車服務", DW / 2, 36.0, F.emptyCjk, C_INK, F_CENTER);
    drawText(g, "No Train Service", DW / 2, 45.0, F.emptyLat, C_INK, F_CENTER);
    drawText(g, "請稍候", DW / 2, 54.0, F.emptySub, C_SUB, F_CENTER);
}

/* ---------------------------- 停靠月台通告页 ---------------------------- */

function drawAnnounceView(g, F, a, eta, formation, state) {
    fRect(g, 0, BAND_Y0, DW, BAND_Y1, C_BAND);
    fRect(g, 0, MAP_Y0, DW, DH, C_BODY);

    var bandCY = (BAND_Y0 + BAND_Y1) / 2;
    var svc = resolveService(a);
    var badgeColor = svc.color != null ? svc.color : num(a.routeColor());

    if (isOutOfService(a)) {
        var ot = oosLabel();
        var of = isCjkStr(ot) ? F.oosHeadCjk : F.oosHeadLat;
        drawText(g, ot, 22.0, baselineForCenter(g, of, bandCY), of, C_INK, F_LEFT);
    } else {
        var probe = badgePick(g, F, svc);
        var bh = 13.2;
        var by = bandCY - bh / 2;
        var bw = drawServiceBadge(g, F, svc, 1.4, by, bh, badgeColor);
        var dest = cycleText(a.destination());
        var destFont = isCjkStr(dest) ? F.destCjk : F.destLat;
        var pmTxt2 = safeStr(a.platformName());
        var pmW2 = 0;
        if (!formation && pmTxt2 !== "" && !isPlatformHidden(a)) pmW2 = platformBadgeW(g, pmTxt2, F.circNumBig, 5.9);
        var destRight2 = formation ? 88.4 : (pmW2 > 0 ? (99.2 + 5.9 - pmW2) - 1.5 : 90.6);
        drawFitMixed(g, dest, 1.4 + bw + 2.8, baselineForCenter(g, destFont, bandCY),
            destRight2 - (1.4 + bw + 2.8), F.destLat, F.destCjk, C_INK, F_LEFT);
    }

    var depAnn = num(a.departureTime()) - nowMs();
    if (formation) drawCarAndEta(g, F, a, depAnn, bandCY);
    else drawPlatformAndEta(g, F, a, depAnn, bandCY);

    if (isOutOfService(a)) {
        /* 不載客：正文固定中英双行 */
        drawText(g, "本班列車不提供載客，請勿上車", DW / 2, 46.0, F.oosBodyCjk, C_INK, F_CENTER);
        drawText(g, "This train is not in service. Please alight.", DW / 2, 56.0, F.oosBodyLat, C_INK, F_CENTER);
        return;
    }

    var pn = safeStr(a.platformName());
    if (pn === "") pn = "?";
    var isZh = langPhase() === "zh";

    if (isZh) {
        drawText(g, "本班列車將停靠在", DW / 2, 42.6, F.annCjk, C_INK, F_CENTER);
        var cy = 56.8, r = 7.0 * 1.7;
        var pnW = platformBadgeW(g, pn, F.annPlatBig, r);
        var cw = textWidth(g, "號月台", F.annCjkBig);
        var total = pnW + 2.4 + cw;
        var x0 = (DW - total) / 2;
        if (pnW <= 2 * r + 0.01) {
            fOval(g, x0 + pnW / 2, cy, r, r, lineColor(a));
        } else {
            fRound(g, x0, cy - r, x0 + pnW, cy + r, r, lineColor(a));
        }
        drawText(g, pn, x0 + pnW / 2, baselineForCenter(g, F.annPlatBig, cy), F.annPlatBig, C_WHITE, F_CENTER);
        drawText(g, "號月台", x0 + pnW + 2.4, 62.0, F.annCjkBig, C_INK, F_LEFT);
    } else {
        drawText(g, "This train will arrive at", DW / 2, 41.6, F.annLat, C_INK, F_CENTER);
        var cy2 = 56.8, r2 = 7.0 * 1.7;
        var pw = textWidth(g, "Platform", F.annLatBig);
        var pnW2 = platformBadgeW(g, pn, F.annPlatBig, r2);
        var total2 = pw + 2.4 + pnW2;
        var x02 = (DW - total2) / 2;
        drawText(g, "Platform", x02, 62.0, F.annLatBig, C_INK, F_LEFT);
        var px0 = x02 + pw + 2.4;
        if (pnW2 <= 2 * r2 + 0.01) {
            fOval(g, px0 + pnW2 / 2, cy2, r2, r2, lineColor(a));
        } else {
            fRound(g, px0, cy2 - r2, px0 + pnW2, cy2 + r2, r2, lineColor(a));
        }
        drawText(g, pn, px0 + pnW2 / 2, baselineForCenter(g, F.annPlatBig, cy2), F.annPlatBig, C_WHITE, F_CENTER);
    }
}

/* 信息带里的“车箱数 + 剩余分钟”组合（通告页编组子页用） */
function drawCarAndEta(g, F, a, eta, cy) {
    drawCarBox(g, F, a, eta, cy);
    var mins = clampMins(Math.ceil(eta / 60000));
    var unit = unitFor(cycleText("分鐘|min", true), mins);
    var uf = isCjkStr(unit) ? F.etaUnitCjk : F.etaUnitLat;
    var uw = textWidth(g, unit, uf);
    var ns = String(mins);
    var nf = mins >= 10 ? F.etaNumSmall : F.etaNum;
    var nw = textWidth(g, ns, nf);
    var right = FOOTER_R;
    var base = baselineForCenter(g, nf, cy);
    drawText(g, ns, right - uw - nw - 1.5, base, nf, C_INK, F_LEFT);
    drawText(g, unit, right - uw, base, uf, C_INK, F_LEFT);
}

/* ---------------------------- 底部信息条 ---------------------------- */

function drawBottomBar(g, F, a, eta, dep, y0) {
    fRect(g, 0, y0, DW, DH, C_BAND);
    var svc = resolveService(a);
    var badgeColor = svc.color != null ? svc.color : num(a.routeColor());

    var barCY = (y0 + DH) / 2;
    if (isOutOfService(a)) {
        var ot = oosLabel();
        var of = isCjkStr(ot) ? F.oosHeadCjk : F.oosHeadLat;
        drawText(g, ot, 22.0, baselineForCenter(g, of, barCY), of, C_INK, F_LEFT);
    } else {
        var probe = badgePick(g, F, svc);
        var bh = 12.8;
        var by = barCY - bh / 2;
        var bw = drawServiceBadge(g, F, svc, 1.4, by, bh, badgeColor);

        var dest = cycleText(a.destination());
        var destX = 1.4 + bw + 3.0;
        var destFont = isCjkStr(dest) ? F.destCjk : F.destLat;
        var pmTxtB = safeStr(a.platformName());
        var pmWB = 0;
        if (pmTxtB !== "" && !isPlatformHidden(a)) pmWB = platformBadgeW(g, pmTxtB, F.circNumBig, 5.1);
        var destRightB = pmWB > 0 ? (99.2 + 5.1 - pmWB) - 1.5 : 91.4;
        drawFitMixed(g, dest, destX, baselineForCenter(g, destFont, (y0 + DH) / 2),
            destRightB - destX, F.destLat, F.destCjk, C_INK, F_LEFT);
    }

    /* PIDS 显示的是开出时间（DEP. Time） */
    var left = dep > 0 ? dep : eta;
    var doorNow = (dep <= 0) || (eta <= 0 && dep > 0 && dep <= DOOR_CLOSING_MS);
    drawPlatformBadge(g, F, a, barCY, 5.1, F.circNumBig, 99.2);

    /* 关门阶段（已到站/即将开出）显示 Departing Now，而不是 0/1 分钟 */
    if (doorNow) {
        drawDepartingNow(g, F, dep, barCY);
        return;
    }
    var useSecB = left < 60000;
    var mins = clampMins(Math.ceil(left / 60000));
    var secsB = Math.max(0, Math.ceil(left / 1000));
    var unit = useSecB ? cycleText("秒|sec", true) : unitFor(cycleText("分鐘|min", true), mins);
    var uf = isCjkStr(unit) ? F.etaUnitCjk : F.etaUnitLat;
    var uw = textWidth(g, unit, uf);
    var ns = useSecB ? String(secsB) : String(mins);
    var nf = (useSecB ? secsB : mins) >= 10 ? F.etaNumSmall : F.etaNum;
    var nw = textWidth(g, ns, nf);
    var right = FOOTER_R;
    var etaBase = baselineForCenter(g, nf, barCY);
    drawText(g, ns, right - uw - nw - 1.5, etaBase, nf, C_INK, F_LEFT);
    drawText(g, unit, right - uw, etaBase, uf, C_INK, F_LEFT);
}

/* ============================ 种别徽章 ============================ */

/* 按当前语言与文字宽度决定徽章尺寸（实拍里中文徽章更宽更高） */
/* 6.8：英文名超出徽章宽度时，在第一个空格处折成两行；第二行缩进；
   折完还放不下就逐级缩字号。中文单行。 */
function wrapBadgeEn(g, font, text, maxW, indent) {
    var tw = textWidth(g, text, font);
    if (tw <= maxW) return [{ text: text, dx: 0 }];
    var sp = text.indexOf(" ");
    if (sp > 0) {
        var a = text.substring(0, sp);
        var b = text.substring(sp + 1);
        /* 只要有空格就折成两行，放不下由调用方缩字号；这样短名字
           （Local/Rapid 等）仍保持原来的一行大字号，不受影响。 */
        return [{ text: a, dx: 0 }, { text: b, dx: indent }];
    }
    return [{ text: text, dx: 0 }];
}

function drawBadgeContent(g, F, svc, x0, y0, w, h, bfCjk, bfLat) {
    var isEn = langPhase() === "en";
    var txt = isEn ? svc.en : svc.zh;
    if (txt === "") txt = svc.zh !== "" ? svc.zh : svc.en;
    if (txt === "") return;

    var cjk = isCjkStr(txt);
    var base = cjk ? bfCjk : bfLat;
    var padX = w * 0.10;
    var avail = w - padX * 2;
    var indent = Math.max(padX * 1.4, 4.2);
    var lines = cjk ? [{ text: txt, dx: 0 }] : wrapBadgeEn(g, base, txt, avail, indent);

    var f = base;
    var scale = 1.0;
    var it, i;
    for (it = 0; it < 8; it++) {
        var widest = 0;
        for (i = 0; i < lines.length; i++) {
            var ww = textWidth(g, lines[i].text, f) + lines[i].dx;
            if (ww > widest) widest = ww;
        }
        var fm = g.getFontMetrics(f);
        var lh = fm.getHeight() * 0.95 / T.ky;
        if (widest <= avail && lh * lines.length <= h * 0.98) break;
        scale -= 0.07;
        if (scale < 0.55) scale = 0.55;
        f = base.deriveFont(base.getStyle(), base.getSize2D() * scale);
    }

    var fm2 = g.getFontMetrics(f);
    var lh2 = fm2.getHeight() * 0.95 / T.ky;
    var asc = fm2.getAscent() / T.ky;
    var totalH = lh2 * lines.length;
    var baseY = y0 + (h - totalH) / 2 + asc;
    for (i = 0; i < lines.length; i++) {
        drawText(g, lines[i].text, x0 + padX + lines[i].dx, baseY + lh2 * i, f, C_WHITE, F_LEFT);
    }
}

function badgePick(g, F, svc) {
    var isEn = langPhase() === "en";
    var txt = isEn ? svc.en : svc.zh;
    if (txt === "") txt = svc.zh !== "" ? svc.zh : svc.en;
    var cjk = isCjkStr(txt);
    var font = cjk ? F.badgeCjk : F.badgeLat;
    /* 中英文统一成同一个尺寸（按用户要求：都用英文侧的大小） */
    return { text: txt, font: font, cjk: cjk, w: 24.6 };
}

function drawServiceBadge(g, F, svc, x0, y0, h, color) {
    var b = badgePick(g, F, svc);
    fRound(g, x0, y0, x0 + b.w, y0 + h, 1.7, color);
    drawBadgeContent(g, F, svc, x0, y0, b.w, h, F.badgeCjk, F.badgeLat);
    return b.w;
}

function drawBadgeText(g, F, svc, x0, y0, x1, h, cjkFont, latFont) {
    drawBadgeContent(g, F, svc, x0, y0, x1 - x0, h, cjkFont, latFont);
}

/* ============================ 路线图数据 ============================ */

function buildMapInfo(arrivals, pids) {
    var a = arrivals == null ? null : arrivals.get(0);
    if (a == null) return null;

    var route = null;
    try { route = a.route(); } catch (e) { route = null; }
    if (route == null) return null;

    var plats = null;
    try { plats = route.getPlatforms(); } catch (e2) { plats = null; }
    if (plats == null) return null;

    var n = listSize(plats);
    if (n <= 0) return null;

    var all = [];
    var i, p, nm;
    for (i = 0; i < n; i++) {
        p = listGet(plats, i);
        if (p == null) continue;
        nm = safeStr(p.getStationName());
        if (nm === "") continue;
        all.push({ name: cleanBilingual(nm), stationId: num(p.getStationId()), stationName: nm });
    }
    if (all.length === 0) return null;

    /* 从「本站」之后开始截取：屏幕显示的是开出后要去的站。
       实拍页脚写着 "Estimated travel time to the stations"，车在站台时
       列表从下一站开始。找不到本站就退回整条路线。 */
    var startIdx = 0;
    var cur = stationIndex(all, pids);
    if (cur < 0) {
        /* 站名/ID 对不上时，用这班车的月台所在站兜底 */
        var pst = null;
        try { pst = a.platform(); } catch (ePl) { pst = null; }
        if (pst != null) {
            var pnm = "";
            try { pnm = safeStr(pst.getStationName()); } catch (ePnm) { pnm = ""; }
            if (pnm !== "") {
                for (i = 0; i < all.length; i++) {
                    if (stripExtra(all[i].stationName) === stripExtra(pnm)) { cur = i; break; }
                }
            }
        }
    }
    if (cur >= 0 && cur < all.length - 1) startIdx = cur + 1;

    var stations = [];
    for (i = startIdx; i < all.length; i++) stations.push({ name: all[i].name });
    if (stations.length === 0) {
        for (i = 0; i < all.length; i++) stations.push({ name: all[i].name });
    }

    var times = travelTimesFor(a, stations.length);
    var color = num(a.routeColor());
    if (color === 0) color = num(route.getColor());
    if (color === 0) color = 0xFB8696;
    return { stations: stations, times: times, color: color };
}

function stationIndex(all, pids) {
    var st = null;
    try { st = pids.station(); } catch (e) { st = null; }
    if (st == null) return -1;

    var sid = -1;
    try { sid = num(st.getId()); } catch (e1) { sid = -1; }
    if (sid <= 0) { try { sid = num(st.id); } catch (e2) { sid = -1; } }
    if (sid > 0) {
        for (var i = 0; i < all.length; i++) {
            if (all[i].stationId === sid) return i;
        }
    }
    /* 站点 ID 对不上时按名称兜底 */
    var nm = "";
    try { nm = safeStr(st.getName()); } catch (e3) { nm = ""; }
    if (nm === "") { try { nm = safeStr(st.name); } catch (e4) { nm = ""; } }
    if (nm !== "") {
        for (var k = 0; k < all.length; k++) {
            if (all[k].stationName === nm) return k;
            if (stripExtra(all[k].stationName) === stripExtra(nm)) return k;
        }
    }
    return -1;
}

function travelTimesFor(a, n) {
    var src = (safeStr(a.routeNumber()) + "|" + safeStr(a.routeName())).toLowerCase();
    var i, k, prof, hit;
    for (i = 0; i < TRAVEL_PROFILES.length; i++) {
        prof = TRAVEL_PROFILES[i];
        hit = false;
        for (k = 0; k < prof.keys.length; k++) {
            if (src.indexOf(String(prof.keys[k]).toLowerCase()) >= 0) { hit = true; break; }
        }
        if (hit) return fitTimes(prof.mins, n);
    }
    var def = [];
    for (i = 0; i < n; i++) def.push(DEFAULT_TRAVEL_FIRST + i * DEFAULT_TRAVEL_STEP);
    return def;
}

function fitTimes(src, n) {
    var out = [];
    var i, last, step;
    for (i = 0; i < n; i++) {
        if (i < src.length) out.push(src[i]);
        else {
            last = out[out.length - 1];
            step = out.length >= 2 ? (out[out.length - 1] - out[out.length - 2]) : DEFAULT_TRAVEL_STEP;
            if (step <= 0) step = DEFAULT_TRAVEL_STEP;
            out.push(last + step);
        }
    }
    return out;
}

/* ============================ 种别识别 ============================ */

function serviceLabelSource(a) {
    var num = safeStr(a.routeNumber()).trim();
    if (num !== "") return num;
    return safeStr(a.routeName()).trim();
}

function stripExtra(s) {
    var i = s.indexOf("||");
    return i < 0 ? s : s.substring(0, i);
}

function extraPart(s) {
    var i = s.indexOf("||");
    return i < 0 ? "" : s.substring(i + 2);
}

function splitBilingual(s) {
    var out = [], cur = "", i;
    for (i = 0; i < s.length; i++) {
        if (s.charAt(i) === "|") { out.push(cur); cur = ""; }
        else cur += s.charAt(i);
    }
    out.push(cur);
    return out;
}

function cjkPart(s) {
    var parts = splitBilingual(s), out = "", k;
    for (k = 0; k < parts.length; k++) {
        if (isCjkStr(parts[k])) out += parts[k];
    }
    return out.replace(/\s/g, "");
}

function nonCjkPart(s) {
    var parts = splitBilingual(s), out = "", k;
    for (k = 0; k < parts.length; k++) {
        if (!isCjkStr(parts[k])) out += parts[k];
    }
    return out.trim();
}

function isDirectionExtra(extra) {
    if (extra === "") return true;
    var low = extra.toLowerCase(), k;
    for (k = 0; k < SERVICE_IGNORE_EXTRA.length; k++) {
        if (low.indexOf(String(SERVICE_IGNORE_EXTRA[k]).toLowerCase()) >= 0) return true;
    }
    return false;
}

function matchAnyKeyword(keywords, haystack) {
    if (keywords == null) return false;
    var list = (typeof keywords === "string") ? [keywords] : keywords;
    var low = haystack.toLowerCase(), k;
    for (k = 0; k < list.length; k++) {
        if (list[k] == null) continue;
        if (low.indexOf(String(list[k]).toLowerCase()) >= 0) return true;
    }
    return false;
}

function parseHex(hex) {
    var v = parseInt(String(hex).replace("#", ""), 16);
    return isNaN(v) ? null : v;
}

function resolveService(a) {
    var name = safeStr(a.routeName());
    var full = serviceLabelSource(a);
    var base = stripExtra(full);
    var extra = extraPart(full).trim();
    if (isDirectionExtra(extra)) extra = "";

    var num = safeStr(a.routeNumber()).replace(/\s/g, "");
    var haystack = name + "|" + safeStr(a.routeNumber());

    var i, rule, hit, rz, re, rc;
    for (i = 0; i < SERVICE_OVERRIDE.length; i++) {
        rule = SERVICE_OVERRIDE[i];
        hit = false;
        if (rule.number != null && String(rule.number) !== "" && String(rule.number) === num) hit = true;
        if (!hit && matchAnyKeyword(rule.name, haystack)) hit = true;
        if (!hit) continue;

        rz = rule.zh != null ? String(rule.zh) : cjkPart(extra);
        re = rule.en != null ? String(rule.en) : nonCjkPart(extra);
        if (rz === "" && re === "") { rz = cjkPart(base); re = nonCjkPart(base); }
        rc = rule.color != null ? parseHex(rule.color) : null;
        return finishService(rz, re, rc);
    }

    if (extra !== "") {
        var ez = cjkPart(extra), ee = nonCjkPart(extra);
        if (ez !== "" || ee !== "") return finishService(ez, ee, null);
    }

    var bz = cjkPart(base), be = nonCjkPart(base);
    if (bz === "" && be === "") { bz = cjkPart(num); be = nonCjkPart(num); }
    return finishService(bz, be, null);
}

function finishService(zh, en, color) {
    if (zh === "" && en === "") { zh = "各停"; en = "Local"; }
    if (zh !== "" && BADGE_EN[zh] != null) en = BADGE_EN[zh];
    return { zh: zh, en: en, color: color };
}

/* ============================ 文本工具 ============================ */

function makeFonts() {
    var cjk = Resources.getSystemFont(F_CJK);
    var lat = Resources.getSystemFont(F_LAT);
    var B = java.awt.Font.BOLD, P = java.awt.Font.PLAIN;

    return {
        clock:      mk(lat, B, 7.2),
        utc:        mk(lat, B, 1.55),
        noteLat:    mk(lat, P, 2.2),
        noteLatB:   mk(lat, B, 2.2),
        noteCjk:    mk(cjk, P, 2.5),
        badgeCjk:   mk(cjk, B, 6.8),
        badgeLat:   mk(lat, B, 6.6),
        destCjk:    mk(cjk, B, 7.8),
        destLat:    mk(lat, B, 7.0),
        circNumBig: mk(lat, B, 8.4),
        circNum:    mk(lat, B, 5.2),
        etaNum:     mk(lat, B, 12.2),
        etaNumSmall: mk(lat, B, 9.8),
        etaUnitLat: mk(lat, B, 7.2),
        etaUnitCjk: mk(cjk, P, 7.2),
        nameCjk:    mk(cjk, B, 4.5),
        nameLat:    mk(lat, B, 4.5),
        bubbleNum:  mk(lat, B, 4.8),
        bubbleNumBig: mk(lat, B, 5.4),
        termLat:    mk(lat, B, 2.4),
        termCjk:    mk(cjk, B, 2.7),
        footerLat:  mk(lat, P, 1.85),
        footerCjk:  mk(cjk, P, 2.1),
        warnCjk:    mk(cjk, B, 9.8),
        warnLat1:   mk(lat, B, 7.0),
        warnLat2:   mk(lat, B, 5.2),
        warnItalic: mk(lat, B, 4.9),
        warnMark:   mk(lat, B, 7.6),
        doorCjk:    mk(cjk, B, 11.8),
        doorLat:    mk(lat, P, 5.1),
        emptyCjk:   mk(cjk, B, 8.6),
        emptyLat:   mk(lat, P, 5.6),
        emptySub:   mk(cjk, P, 3.6),
        rowBadgeCjk: mk(cjk, B, 6.4),
        rowBadgeLat: mk(lat, B, 5.6),
        rowDestCjk: mk(cjk, B, 7.0),
        rowDestLat: mk(lat, B, 6.6),
        rowCarNum:  mk(lat, B, 8.0),
        rowCarUnitLat: mk(lat, B, 2.8),
        rowCarUnitCjk: mk(cjk, B, 3.0),
        rowPlatNum: mk(lat, B, 7.0),
        annCjk:     mk(cjk, B, 7.8),
        annCjkBig:  mk(cjk, B, 11.2),
        annLat:     mk(lat, B, 6.4),
        annLatBig:  mk(lat, B, 10.2),
        annPlat:    mk(lat, B, 10.6),
        annPlatBig: mk(lat, B, 18.0),
        rowEtaNum:  mk(lat, B, 11.6),
        rowEtaNumSmall: mk(lat, B, 9.6),
        rowClock:   mk(lat, B, 7.6),
        rowOosCjk:  mk(cjk, B, 8.2),
        rowOosLat:  mk(lat, B, 7.8),
        oosHeadCjk: mk(cjk, B, 10.2),
        oosHeadLat: mk(lat, B, 9.4),
        oosBodyCjk: mk(cjk, B, 8.4),
        oosBodyLat: mk(lat, P, 6.0),
        rowEtaUnitLat: mk(lat, B, 5.2),
        rowEtaUnitCjk: mk(cjk, B, 5.4),
        carNum:     mk(lat, B, 9.4),
        carUnitLat: mk(lat, B, 3.0),
        carUnitCjk: mk(cjk, B, 3.3),
        statusLat:  mk(lat, B, 5.2),
        statusCjk:  mk(cjk, B, 5.6)
    };
}

function mk(base, style, size) {
    return base.deriveFont(style, size * T.k);
}

function col(rgb) {
    /* ★ 必须用单参 Color(int)：三参重载在 Rhino 里会误选 Color(float,float,float) */
    return new Color(rgb & 0xFFFFFF);
}

/* 单色画文字。x 是设计单位；align 决定 x 的含义 */
function drawText(g, text, x, base, font, color, align) {
    if (text == null || text === "") return;
    g.setFont(font);
    g.setColor(col(color));
    var dx = px(x);
    if (align === F_CENTER) {
        dx = Math.round(dx - g.getFontMetrics(font).stringWidth(String(text)) / 2);
    } else if (align === F_RIGHT) {
        dx = Math.round(dx - g.getFontMetrics(font).stringWidth(String(text)));
    }
    g.drawString(String(text), dx, py(base));
}

/* 中英混排：逐字切段，各用各的字体 */
function drawMixed(g, text, x, base, latinFont, cjkFont, color, align, gap) {
    if (text == null || text === "") return;
    var s = String(text);
    var runs = splitRuns(s, latinFont, cjkFont);
    var total = 0, i;
    for (i = 0; i < runs.length; i++) total += runWidth(g, runs[i]) / T.k;

    var cx = x;
    if (align === F_CENTER) cx = x - total / 2;
    else if (align === F_RIGHT) cx = x - total;

    for (i = 0; i < runs.length; i++) {
        var r = runs[i];
        g.setFont(r.font);
        g.setColor(col(color));
        g.drawString(r.text, px(cx), py(base));
        cx += runWidth(g, r) / T.k + (gap || 0);
    }
}

function splitRuns(text, latinFont, cjkFont) {
    var out = [], cur = null, buf = "";
    var i, ch, cjk, f;
    for (i = 0; i < text.length; i++) {
        ch = text.charAt(i);
        cjk = isCjkChar(ch) && cjkFont != null;
        f = cjk ? cjkFont : latinFont;
        if (cur == null || f !== cur) {
            if (buf !== "") out.push({ text: buf, font: cur });
            cur = f; buf = "";
        }
        buf += ch;
    }
    if (buf !== "") out.push({ text: buf, font: cur });
    return out;
}

function runWidth(g, run) {
    g.setFont(run.font);
    return g.getFontMetrics(run.font).stringWidth(run.text);
}

function mixedWidth(g, text, latinFont, cjkFont) {
    if (text == null || text === "") return 0;
    var runs = splitRuns(String(text), latinFont, cjkFont);
    var w = 0;
    for (var i = 0; i < runs.length; i++) w += runWidth(g, runs[i]);
    return w / T.k;
}

/* 目的地这类长文本：超宽时先缩字号，仍放不下再截断加省略号 */
function drawFitMixed(g, text, x, base, maxW, latinFont, cjkFont, color, align) {
    if (text == null || text === "") return;
    var str = String(text);
    var w = mixedWidth(g, str, latinFont, cjkFont);
    var lf = latinFont, cf = cjkFont;
    if (w > maxW && w > 0) {
        var sc = Math.max(0.62, maxW / w);
        lf = latinFont.deriveFont(java.awt.Font.BOLD, latinFont.getSize2D() * sc);
        cf = cjkFont.deriveFont(java.awt.Font.BOLD, cjkFont.getSize2D() * sc);
        w = mixedWidth(g, str, lf, cf);
    }
    if (w > maxW) {
        while (str.length > 1 && mixedWidth(g, str + "…", lf, cf) > maxW) {
            str = str.substring(0, str.length - 1);
        }
        str = str + "…";
    }
    drawMixed(g, str, x, base, lf, cf, color, align, 0);
}

function textWidth(g, text, font) {
    if (text == null || text === "") return 0;
    g.setFont(font);
    return g.getFontMetrics(font).stringWidth(String(text)) / T.k;
}

/* 让文字的 em 盒垂直居中于 centerY，返回基线 y（设计单位） */
function baselineForCenter(g, font, centerY) {
    g.setFont(font);
    var fm = g.getFontMetrics(font);
    return centerY + (fm.getAscent() - fm.getDescent()) / 2 / T.ky;
}

/* 带字距的文字（时钟牌用） */
function trackedWidth(g, text, font, tracking) {
    if (text == null || text === "") return 0;
    g.setFont(font);
    var fm = g.getFontMetrics(font);
    var w = 0;
    for (var i = 0; i < text.length; i++) w += fm.charWidth(text.charAt(i)) + tracking * T.k;
    return w / T.k;
}

function drawTracked(g, text, x, base, font, color, tracking) {
    if (text == null || text === "") return;
    g.setFont(font);
    g.setColor(col(color));
    var fm = g.getFontMetrics(font);
    var cx = px(x);
    var tr = tracking * T.k;
    for (var i = 0; i < text.length; i++) {
        var ch = text.charAt(i);
        g.drawString(ch, Math.round(cx), py(base));
        cx += fm.charWidth(ch) + tr;
    }
}

/* ============================ 图形工具 ============================ */

function fRect(g, x0, y0, x1, y1, color) {
    g.setColor(col(color));
    g.fillRect(px(x0), py(y0), Math.max(1, px(x1) - px(x0)), Math.max(1, py(y1) - py(y0)));
}

function fRound(g, x0, y0, x1, y1, rad, color) {
    g.setColor(col(color));
    var arc = Math.max(1, Math.round(rad * 2 * T.k));
    g.fillRoundRect(px(x0), py(y0), Math.max(1, px(x1) - px(x0)), Math.max(1, py(y1) - py(y0)), arc, arc);
}

function fOval(g, cx, cy, rx, ry, color) {
    g.setColor(col(color));
    g.fillOval(px(cx - rx), py(cy - ry), Math.max(1, px(cx + rx) - px(cx - rx)),
        Math.max(1, py(cy + ry) - py(cy - ry)));
}

function strokeLine(g, x0, y0, x1, y1, width, color) {
    g.setColor(col(color));
    g.setStroke(new java.awt.BasicStroke(Math.max(1, Math.round(width * T.k)),
        java.awt.BasicStroke.CAP_ROUND, java.awt.BasicStroke.JOIN_ROUND));
    g.drawLine(px(x0), py(y0), px(x1), py(y1));
}

/* 太阳：空心圆 + 8 道光芒（实拍里不是实心圆） */
function drawSun(g, cx, cy, r) {
    g.setColor(col(C_SUN));
    g.setStroke(new java.awt.BasicStroke(Math.max(1, Math.round(0.5 * T.k)),
        java.awt.BasicStroke.CAP_ROUND, java.awt.BasicStroke.JOIN_ROUND));
    g.drawOval(px(cx - r), py(cy - r), Math.max(1, px(cx + r) - px(cx - r)),
        Math.max(1, py(cy + r) - py(cy - r)));
    var i, ang, x0, y0, x1, y1;
    for (i = 0; i < 8; i++) {
        ang = i * Math.PI / 4;
        x0 = cx + Math.cos(ang) * (r + 0.55);
        y0 = cy + Math.sin(ang) * (r + 0.55);
        x1 = cx + Math.cos(ang) * (r + 1.45);
        y1 = cy + Math.sin(ang) * (r + 1.45);
        g.drawLine(px(x0), py(y0), px(x1), py(y1));
    }
}

/* 月亮：一个圆 + 用底色切出月牙 */
function drawMoon(g, cx, cy, r) {
    g.setColor(col(C_SUN));
    g.fillOval(px(cx - r), py(cy - r), Math.max(1, px(cx + r) - px(cx - r)),
        Math.max(1, py(cy + r) - py(cy - r)));
    g.setColor(col(C_CLOCK));
    var ox = cx + r * 0.55, oy = cy - r * 0.25;
    g.fillOval(px(ox - r), py(oy - r), Math.max(1, px(ox + r) - px(ox - r)),
        Math.max(1, py(oy + r) - py(oy - r)));
}

/* ============================ 小工具 ============================ */

function nowMs() {
    /* JCM 没有注册 Timing 全局，所以先 typeof 判断；离线模拟器可以注入 Timing 固定时间。 */
    if (typeof Timing !== "undefined") {
        try { return Number(Timing.currentTimeMillis()); } catch (e) { }
    }
    return new Date().getTime();
}

function safeStr(v) {
    if (v == null) return "";
    try { return String(v); } catch (e) { return ""; }
}

function num(v) {
    if (v == null) return 0;
    var n = Number(v);
    return isNaN(n) ? 0 : n;
}

function listSize(l) {
    if (l == null) return 0;
    try { return Number(l.size()); } catch (e) { return 0; }
}

function listGet(l, i) {
    if (l == null) return null;
    try { return l.get(i); } catch (e) { return null; }
}

/* 终点站/不載客：terminating 或目的地写明不載客 */
function isOutOfService(a) {
    if (a == null) return false;
    var t = false;
    try { t = a.terminating(); } catch (e) { t = false; }
    if (t) return true;
    var d = safeStr(a.destination()).toLowerCase();
    if (d.indexOf("不載客") >= 0) return true;
    if (d.indexOf("not in service") >= 0) return true;
    if (d.indexOf("out of service") >= 0) return true;
    return false;
}

function oosLabel() {
    return langPhase() === "en" ? "Not in service" : "不載客";
}

/* 这班车是不是停在本 PIDS 自己的月台？
   取 getTargetPlatformIds() 的第 HOME_PLATFORM_INDEX 个作为本站；
   列表为空（自动检测）时视为本站。 */
/* 本站台：优先读 PIDS 的自定义消息（游戏内可改）。
   HOME=n 从 1 开始（1 = 列表第 1 个站台）；
   HOME=0 用脚本默认值；HOME=-1 表示没有本站台（全部走停靠月台通告）。 */
function homeIndexFromPids(pids) {
    var i, msg, m, v;
    for (i = 0; i < 4; i++) {
        try { msg = safeStr(pids.getCustomMessage(i)); } catch (e) { msg = ""; }
        m = /HOME\s*=\s*(-?\d+)/i.exec(msg);
        if (m != null) {
            v = parseInt(m[1], 10);
            if (v === -1) return -1;
            if (v >= 1) return v - 1;
            return HOME_PLATFORM_INDEX;
        }
    }
    return HOME_PLATFORM_INDEX;
}

function isHomePlatform(a, pids) {
    if (a == null) return true;
    var ids = null;
    try { ids = pids.getTargetPlatformIds(); } catch (e) { ids = null; }
    var n = listSize(ids);
    var idx = homeIndexFromPids(pids);
    if (idx < 0) return false;
    if (n <= 0) return true;
    if (idx >= n) idx = 0;
    var home = num(listGet(ids, idx));
    return num(a.platformId()) === home;
}

function pad2(n) {
    return (n < 10 ? "0" : "") + n;
}

function isDay(d) {
    var h = d.getHours();
    return h >= 6 && h < 18;
}

function utcOffset(d) {
    var off = -d.getTimezoneOffset();
    var sign = off >= 0 ? "+" : "-";
    var a = Math.abs(off);
    var h = Math.floor(a / 60);
    var m = a % 60;
    return sign + h + (m ? ":" + pad2(m) : "");
}

function isCjkChar(ch) {
    var c = String(ch).charCodeAt(0);
    return (c >= 0x2E80 && c <= 0x9FFF) || (c >= 0x3400 && c <= 0x4DBF) ||
        (c >= 0xF900 && c <= 0xFAFF) || (c >= 0xFE30 && c <= 0xFE4F) ||
        (c >= 0xFF00 && c <= 0xFF60) || (c >= 0x3000 && c <= 0x303F);
}

function isCjkStr(s) {
    if (s == null) return false;
    var str = String(s);
    for (var i = 0; i < str.length; i++) {
        if (isCjkChar(str.charAt(i))) return true;
    }
    return false;
}

/* 去掉 "||" 备注，并按当前语言轮播取一段 */
function cycleText(s, force) {
    var t = safeStr(s);
    if (t === "") return "";
    var i = t.indexOf("||");
    if (i >= 0) t = t.substring(0, i);
    if (LANG_OVERRIDE === "zh") return cjkPart(t) !== "" ? cjkPart(t) : nonCjkPart(t);
    if (LANG_OVERRIDE === "en") return nonCjkPart(t) !== "" ? nonCjkPart(t) : cjkPart(t);
    /* ★ String()：把 Java String 转成 JS 字符串（否则 isCjkStr/charAt 全部失效） */
    return String(TextUtil.cycleString(t));
}

/* 站名：去掉备注，中英轮播 */
function cleanBilingual(s) {
    return cycleText(s);
}

function splitLines(s, maxLen) {
    var out = [];
    var words = String(s).split(" ");
    var cur = "";
    for (var i = 0; i < words.length; i++) {
        var w = words[i];
        if (cur === "") cur = w;
        else if ((cur + " " + w).length <= maxLen) cur += " " + w;
        else { out.push(cur); cur = w; }
    }
    if (cur !== "") out.push(cur);
    return out;
}

function unitFor(unit, mins) {
    /* 英文统一用单数 min（不随分钟数加 s），这样数字右缘能对齐 */
    return unit;
}

function clampMins(m) {
    if (!isFinite(m) || m < 0) return 0;
    return m > 99 ? 99 : m;
}

function lineColor(a) {
    var c = num(a.routeColor());
    return c === 0 ? 0xFB8696 : c;
}

function isPlatformHidden(a) {
    /* 目前没有可靠的单班车月台隐藏 API；PIDS 级别的设置在外面用不上。 */
    return false;
}

/* ============================ 错误屏 ============================ */

function drawErrorScreen(state) {
    var g = state.tex.graphics;
    g.setColor(new Color(0x101014));
    g.fillRect(0, 0, state.W, state.H);
    g.setFont(new java.awt.Font("SansSerif", java.awt.Font.BOLD, Math.max(10, Math.round(state.H / 16))));
    g.setColor(new Color(0xFF5555));
    g.drawString("PIDS script error", Math.round(state.W * 0.05), Math.round(state.H * 0.32));
    g.setColor(new Color(0xFFFFFF));
    var msg = String(state.err == null ? "unknown" : state.err);
    if (msg.length > 56) msg = msg.substring(0, 56);
    g.drawString(msg, Math.round(state.W * 0.05), Math.round(state.H * 0.60));
}

function errText(e) {
    if (e == null) return "unknown error";
    var s = "";
    try { s = "" + e; } catch (x) { s = ""; }
    if (s === "" || s === "undefined") {
        try { s = "" + e.message; } catch (x2) { s = "unknown error"; }
    }
    return s;
}

function setHints(g) {
    g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
    g.setRenderingHint(RenderingHints.KEY_TEXT_ANTIALIASING, RenderingHints.VALUE_TEXT_ANTIALIAS_ON);
    g.setRenderingHint(RenderingHints.KEY_STROKE_CONTROL, RenderingHints.VALUE_STROKE_PURE);
    g.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY);
    g.setRenderingHint(RenderingHints.KEY_FRACTIONALMETRICS, RenderingHints.VALUE_FRACTIONALMETRICS_ON);
}
