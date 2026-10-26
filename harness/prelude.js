/* =====================================================================
 *  HKL LCD PIDS — offline harness prelude
 *  ---------------------------------------------------------------------
 *  Mock of the JCM 2.x scripting runtime on top of real Java AWT.
 *  The script under test is executed unchanged in Rhino; this prelude
 *  supplies GraphicsTexture / Texture / Resources / TextUtil / data
 *  wrappers, then __harnessRun() renders one frame to a real PNG.
 * ===================================================================== */

var __HARNESS = (function () {

    var File = java.io.File;
    var Files = java.nio.file.Files;
    var BufferedImage = java.awt.image.BufferedImage;
    var ImageIO = javax.imageio.ImageIO;
    var JColor = java.awt.Color;
    var JFont = java.awt.Font;
    var JHints = java.awt.RenderingHints;
    var JAffine = java.awt.geom.AffineTransform;

    var DIR = String(__HARNESS_DIR);
    var fontDir = new File(DIR, "fonts");

    var FONT_FILES = {
        "Noto Sans CJK TC Medium": new File(fontDir, "noto-sans-cjk-tc-medium.otf"),
        "Noto Sans": new File(fontDir, "noto-sans-cjk-tc-medium.otf"),
        "Noto Sans SemiBold": new File(fontDir, "NotoSans-SemiBold.ttf"),
        "Noto Serif": new File(fontDir, "noto-sans-cjk-tc-medium.otf")
    };

    var fontCache = {};
    var texCounter = 0;
    var textures = [];
    var drawCalls = [];
    var state = { now: 0, tick: 0, uploads: 0 };
    var scenario = null;

    function readText(path) {
        var bytes = Files.readAllBytes(new File(path).toPath());
        return new java.lang.String(bytes, java.nio.charset.StandardCharsets.UTF_8);
    }

    function loadFont(file) {
        var f = JFont.createFont(JFont.TRUETYPE_FONT, file);
        return f.deriveFont(JFont.PLAIN, 1.0);
    }

    /* ------------------------------ Resources ------------------------------ */

    var Resources = {
        id: function (s) { return String(s); },
        idr: function (s) { return String(s); },
        getAddonVersion: function (x) { return "2.2.0"; },
        hasSystemFont: function (name) { return FONT_FILES[String(name)] != null; },
        getSystemFont: function (name) {
            var n = String(name);
            if (fontCache[n] != null) return fontCache[n];
            var f = null;
            if (FONT_FILES[n] != null) {
                f = loadFont(FONT_FILES[n]);
            } else {
                f = new JFont(n, JFont.PLAIN, 1);
            }
            fontCache[n] = f;
            return f;
        },
        getFontRenderContext: function () {
            return new java.awt.font.FontRenderContext(null, true, false);
        },
        read: function () { return null; },
        readBufferedImage: function (id) {
            try {
                var f = new java.io.File("assets/jsblock/textures/pids/hklcd/sp1900.png");
                if (!f.exists()) return null;
                return javax.imageio.ImageIO.read(f);
            } catch (e) { return null; }
        },
        exist: function () { return false; }
    };

    /* ------------------------------ TextUtil ------------------------------ */

    function cjkParts(src) {
        if (src == null) return "";
        var s = String(src);
        var i = s.indexOf("||");
        if (i >= 0) s = s.substring(0, i);
        var parts = s.split("|");
        var out = "";
        for (var k = 0; k < parts.length; k++) {
            if (isCjkString(parts[k])) out += (out === "" ? "" : " ") + parts[k];
        }
        return out;
    }

    function nonCjkParts(src) {
        if (src == null) return "";
        var s = String(src);
        var i = s.indexOf("||");
        if (i >= 0) s = s.substring(0, i);
        var parts = s.split("|");
        var out = "";
        for (var k = 0; k < parts.length; k++) {
            if (!isCjkString(parts[k])) out += (out === "" ? "" : " ") + parts[k];
        }
        return out;
    }

    function extraParts(src) {
        if (src == null) return "";
        var s = String(src);
        var i = s.indexOf("||");
        return i < 0 ? "" : s.substring(i + 2);
    }

    var TextUtil = {
        cycleString: function (s) { return cycleString(s, 60); },
        cycleString2: function (s, d) { return cycleString(s, d); },
        getCjkParts: function (s) { return cjkParts(s); },
        getNonCjkParts: function (s) { return nonCjkParts(s); },
        getExtraParts: function (s) { return extraParts(s); },
        getNonExtraParts: function (s) {
            var s2 = String(s == null ? "" : s);
            var i = s2.indexOf("||");
            return i < 0 ? s2 : s2.substring(0, i);
        },
        getNonCjkAndExtraParts: function (s) {
            var extra = extraParts(s).trim();
            return nonCjkParts(s).trim() + (extra === "" ? "" : "|" + extra);
        },
        isCjk: function (s) { return isCjkString(s); }
    };

    function cycleString(s, dur) {
        if (s == null) return "";
        var parts = String(s).split("|");
        if (parts.length === 0) return "";
        var d = (dur == null || dur <= 0) ? 60 : dur;
        var idx = Math.floor(state.tick / d) % parts.length;
        /* mimic JCM: TextUtilJS.cycleString returns java.lang.String */
        return new java.lang.String(parts[idx]);
    }

    function isCjkString(s) {
        if (s == null) return false;
        for (var i = 0; i < s.length; i++) {
            var c = s.charCodeAt(i);
            if ((c >= 0x2E80 && c <= 0x9FFF) || (c >= 0xF900 && c <= 0xFAFF) ||
                (c >= 0xFE30 && c <= 0xFE4F) || (c >= 0xFF00 && c <= 0xFF60)) return true;
        }
        return false;
    }

    /* ------------------------------- Timing ------------------------------- */

    var Timing = {
        currentTimeMillis: function () { return state.now; },
        elapsed: function () { return 0; },
        delta: function () { return 0; }
    };

    /* --------------------------- GraphicsTexture --------------------------- */

    function GraphicsTexture(w, h) {
        this.width = w;
        this.height = h;
        this.bufferedImage = new BufferedImage(w, h, BufferedImage.TYPE_INT_ARGB);
        this.graphics = this.bufferedImage.createGraphics();
        this.identifier = "harness:dynamic/tex" + (++texCounter);
        this.uploads = 0;
        textures.push(this);
    }
    GraphicsTexture.prototype.upload = function () {
        this.uploads++;
        state.uploads++;
    };
    GraphicsTexture.prototype.close = function () { this.closed = true; };

    /* -------------------------------- Texture ------------------------------- */

    function makeTextureChain() {
        var call = { kind: "texture", texture: null, x: 0, y: 0, w: 0, h: 0, color: 0xFFFFFF };
        var chain = {
            texture: function (id) { call.texture = String(id); return chain; },
            color: function (c) { call.color = c; return chain; },
            pos: function (x, y) { call.x = x; call.y = y; return chain; },
            size: function (w, h) { call.w = w; call.h = h; return chain; },
            uv: function () { return chain; },
            zOrder: function () { return chain; },
            naturalLight: function () { return chain; },
            matrices: function () { return chain; },
            renderType: function () { return chain; },
            draw: function () { drawCalls.push(call); return undefined; }
        };
        return chain;
    }

    var Texture = { create: function () { return makeTextureChain(); } };

    /* -------------------------------- data -------------------------------- */

    function JList(arr) { this._a = arr || []; }
    JList.prototype.size = function () { return this._a.length; };
    JList.prototype.get = function (i) {
        return (i >= 0 && i < this._a.length) ? this._a[i] : null;
    };
    JList.prototype.isEmpty = function () { return this._a.length === 0; };
    JList.prototype.iterator = function () { return this._a; };

    function mkStation(def) {
        if (def == null) return null;
        var st = {
            id: Number(def.id || 0),
            name: String(def.name || ""),
            getName: function () { return this.name; },
            getId: function () { return this.id; }
        };
        return st;
    }

    function mkPlatform(def) {
        var p = {
            stationId: Number(def.stationId || 0),
            stationName: String(def.stationName || ""),
            platformId: Number(def.platformId || def.stationId || 0),
            getStationId: function () { return p.stationId; },
            getStationName: function () { return p.stationName; },
            getPlatformId: function () { return p.platformId; },
            getDestination: function () { return p.stationName; }
        };
        return p;
    }

    function mkRoute(def) {
        var plats = [];
        var list = def.platforms || [];
        for (var i = 0; i < list.length; i++) plats.push(mkPlatform(list[i]));
        var pj = new JList(plats);
        var route = {
            _def: def,
            getPlatforms: function () { return pj; },
            getColor: function () { return Number(def.color || 0); },
            getName: function () { return String(def.name || ""); },
            getId: function () { return Number(def.id || 0); },
            getCircularState: function () { return String(def.circular || "NONE"); }
        };
        return route;
    }

    function mkArrival(def, routes) {
        var route = routes[def.routeKey] || null;
        var arrivalAt = state.now + Number(def.arrivalInMs || 0);
        var departureAt = state.now + Number(def.departureInMs == null ? def.arrivalInMs : def.departureInMs);
        var a = {
            destination: function () { return String(def.destination != null ? def.destination : ""); },
            arrivalTime: function () { return arrivalAt; },
            departureTime: function () { return departureAt; },
            deviation: function () { return Number(def.deviation || 0); },
            realtime: function () { return def.realtime !== false; },
            departureIndex: function () { return 0; },
            terminating: function () { return def.terminating === true; },
            route: function () { return route; },
            routeId: function () { return route == null ? -1 : route.getId(); },
            routeName: function () { return String(def.routeName != null ? def.routeName : (route == null ? "" : route.getName())); },
            routeNumber: function () { return String(def.routeNumber != null ? def.routeNumber : ""); },
            routeColor: function () { return Number(def.routeColor != null ? def.routeColor : (route == null ? 0 : route.getColor())); },
            circularState: function () { return "NONE"; },
            platform: function () { return null; },
            platformId: function () { return Number(def.platformId || 0); },
            platformName: function () { return String(def.platformName || ""); },
            carCount: function () { return Number(def.carCount || 4); },
            cars: function () { return new JList([]); }
        };
        return a;
    }

    function mkArrivals(defs, routes) {
        var items = [];
        var list = defs || [];
        for (var i = 0; i < list.length; i++) items.push(mkArrival(list[i], routes));
        var w = {
            get: function (i) { return (i >= 0 && i < items.length) ? items[i] : null; },
            mixedCarLength: function () { return false; },
            platforms: function () { return new JList([]); },
            forEach: function (fn) { for (var i = 0; i < items.length; i++) fn(items[i]); },
            size: function () { return items.length; }
        };
        return w;
    }

    function mkPids(doc) {
        var routes = {};
        if (doc.routes) {
            for (var k in doc.routes) {
                if (Object.prototype.hasOwnProperty.call(doc.routes, k)) {
                    routes[k] = mkRoute(doc.routes[k]);
                }
            }
        }
        var station = mkStation(doc.station);
        var arrivals = mkArrivals(doc.arrivals, routes);
        var pids = {
            type: String(doc.type || "lcd_pids"),
            width: Number(doc.size[0]),
            height: Number(doc.size[1]),
            rows: Number(doc.rows || 4),
            isRowHidden: function (i) { return !!(doc.hidden && doc.hidden[i]); },
            getCustomMessage: function (i) { return (doc.customMessages && doc.customMessages[i]) || ""; },
            getTargetPlatformIds: function () { return new JList(doc.platformIds || []); },
            isPlatformNumberHidden: function () { return false; },
            isPlatformAutoDetected: function () { return true; },
            blockPos: function () { return { x: 0, y: 0, z: 0 }; },
            isKeyBlock: function () { return true; },
            station: function () { return station; },
            arrivals: function () { return arrivals; }
        };
        return pids;
    }

    /* ------------------------------- runner ------------------------------- */

    function harnessRun(scenarioPath, outPath) {
        var text = readText(scenarioPath);
        scenario = JSON.parse(text);

        state.now = Number(scenario.now || 0);
        if (!state.now) state.now = java.lang.System.currentTimeMillis();
        state.tick = Number(scenario.tick || 0);
        if (scenario.scriptInput) {
            for (var sk in scenario.scriptInput) {
                if (Object.prototype.hasOwnProperty.call(scenario.scriptInput, sk)) SCRIPT_INPUT[sk] = scenario.scriptInput[sk];
            }
        }
        state.uploads = 0;
        textures.length = 0;
        drawCalls.length = 0;

        var pids = mkPids(scenario);

        var sound = { playSound: function () { }, stopSound: function () { } };
        var renderMgr = {
            draw: function () { },
            drawModel: function () { },
            queue: function () { }
        };
        var ctx = {
            getRenderManager: function () { return renderMgr; },
            getSoundManager: function () { return sound; },
            setDebugInfo: function () { },
            setAutoZOrdering: function () { },
            setZOrderStep: function () { },
            draw: function () { }
        };

        var scriptState = {};
        var err = null;
        try {
            create(ctx, scriptState, pids);
            render(ctx, scriptState, pids);
        } catch (e) {
            err = String(e);
            if (e != null && e.rhinoException != null) err += "\n" + e.rhinoException;
            if (e != null && e.stack != null) err += "\n" + e.stack;
        }

        var tex = scriptState.tex;
        if (tex == null && textures.length > 0) tex = textures[textures.length - 1];
        if (tex == null) {
            throw new Error("no GraphicsTexture was created. script error: " + err);
        }

        var out = new File(outPath);
        var parent = out.getParentFile();
        if (parent != null) parent.mkdirs();
        ImageIO.write(tex.bufferedImage, "png", out);

        var meta = {
            scriptError: err,
            recordedError: scriptState.err == null ? null : String(scriptState.err),
            uploads: tex.uploads,
            texture: { w: tex.width, h: tex.height },
            pids: { w: pids.width, h: pids.height, type: pids.type },
            drawCalls: drawCalls,
            fonts: fontCache
        };
        var metaFile = new File(outPath + ".json");
        var fw = new java.io.FileWriter(metaFile);
        fw.write(JSON.stringify(meta));
        fw.close();

        if (err != null) throw new Error("script error: " + err);
        if (scriptState.err != null) throw new Error("script recorded error: " + scriptState.err);
        return "rendered " + tex.width + "x" + tex.height + " uploads=" + tex.uploads;
    }

    return {
        run: harnessRun,
        state: state,
        textures: textures,
        drawCalls: drawCalls,
        GraphicsTexture: GraphicsTexture,
        Texture: Texture,
        Resources: Resources,
        TextUtil: TextUtil,
        Timing: Timing,
        QuadDrawCall: { create: function () { return { draw: function () { } }; } }
    };
})();

var GraphicsTexture = __HARNESS.GraphicsTexture;
var Texture = __HARNESS.Texture;
var Resources = __HARNESS.Resources;
var TextUtil = __HARNESS.TextUtil;
var Timing = __HARNESS.Timing;
var QuadDrawCall = __HARNESS.QuadDrawCall;
var SCRIPT_INPUT = {};
var print = function () { };

function __harnessRun(scenarioPath, outPath) {
    return __HARNESS.run(scenarioPath, outPath);
}
