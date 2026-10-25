# HKR LCD PIDS

用 **JCM（Joban Client Mod）Scripted PIDS Preset** 复刻 **LPS 服务器**「花越线（Hana-Koshi Line）」
站台上的 **LCD PIDS** 显示屏。

- 原作（LPS 服务器版式）：**Forest_E233**
- 复刻 / 代码：**ChihayaAnonQWQ**
- 开源协议：**MIT**

不是翻牌显示器 —— 这是白底 / 蓝色时钟牌 / 大号目的地 / 竖排站名 / 线路条的
LCD 风格屏。

![preview](preview.png)

---

## 1. 功能

| 视图 | 触发条件 | 内容 |
| --- | --- | --- |
| **四行到站列表** | 普通状态（默认先显示） | 4 班车：种别徽章 + 目的地 + 月台圆圈 + 剩余分钟；中英按游戏 tick 轮播 |
| **路线图** | 普通状态下与列表交替 | 时钟牌 / 种别 / 大目的地 / 月台 + 剩余时间 / 本站之后各站的竖排站名 / 线路条与站点圆点 |
| **进站警示** | 最近一班车距进站 ≤ 60 秒 | 黄色面板 + 警示三角 + 两行警示语 + 底部信息条 |
| **关门提示** | 距开出 ≤ 10 秒 | 中英双语「請勿靠近車門 / Please stand back from the train doors」+ 底部信息条 |
| **空态** | 没有任何到站数据 | 「沒有列車服務 / No Train Service」 |

其它细节：

- 时钟牌显示**现实时间**与 UTC 偏移；天气图标使用 JCM 内置贴图（晴 / 雨 / 雷），由 `MinecraftClient.worldIsRaining()/worldIsThundering()` 自动切换。
- 右上角固定文案 `Displayed in DEP. Time / 表示時間為 開出時間`。
- 路线图站名：**中文逐字竖排**；拉丁文**旋转 90° 自下而上**（与实拍一致）。
- 车种、颜色、线路号规则见第 5 节。
- 任意 PIDS 尺寸自适应；推荐 LCD PIDS（133×72）与 RV PIDS（136×76）。
- 内容签名机制：画面没变就不重画、不重传纹理，静止时几乎不耗性能。

---

## 2. 环境与安装

| 项 | 要求 |
| --- | --- |
| Minecraft | 1.19.4 ~ 1.21 |
| MTR | 4.x |
| JCM | 2.2 或更高（需要 Scripted PIDS 支持） |

安装：

1. 把 `HKR-LCD-PIDS.zip` 放进 `.minecraft/resourcepacks/`（或服务器资源包）。
2. 启用资源包。
3. 放置 PIDS 方块，在 PIDS 配置界面里选择预设 **HKR LCD PIDS**。

> 这是**客户端资源包**。如果服务器通过 `server-resource-pack` 下发，也可以正常工作。

---

## 3. HOME 参数：本站台与停靠月台通告

PIDS 在 8–20 秒这段会在**路线图**和**停靠月台通告**之间二选一，判定完全由 `HOME`（本站台）决定：

| 首班车停的站台 | 显示 |
| --- | --- |
| 与 `HOME` 指定的站台相同 | **路线图**（从下一站到终点） |
| 是 PIDS 订阅列表里的**其他**站台 | **停靠月台通告**（本班列車將停靠在 X 號月台） |
| 不載客 / 终到 | 不載客通告（优先于上面两种） |

### 3.1 HOME 不是月台号

- `HOME` 是 **`pids.getTargetPlatformIds()` 列表里的序号**，不是显示屏上那个月台号（如 6）。
- 这个列表就是 PIDS GUI 里配置/自动检测到的站台 ID 列表，**顺序即列表顺序**。
- 例：列表是 `[3 号月台, 6 号月台]`
  - `HOME=1` → 3 号月台算本站台：3 号的车走路线图，6 号的车走通告；
  - `HOME=2` → 反过来。

### 3.2 游戏内设置（推荐）

在 PIDS GUI 的「自定义消息」任意一行写：

| 写法 | 含义 |
| --- | --- |
| `HOME=1` | 列表第 **1** 个站台是本站台（**从 1 开始**） |
| `HOME=2` | 列表第 **2** 个站台是本站台 |
| `HOME=0` | 使用脚本默认值 `HOME_PLATFORM_INDEX` |
| `HOME=-1` | **没有本站台**：所有车都显示停靠月台通告（测试/预览用） |
| 不写 | 使用脚本默认值（默认 0，即列表第 1 个站台） |

改完关掉 GUI 即可生效；如果没刷新，重开一次 PIDS 界面或 `F3+T`。

### 3.3 脚本里的默认值

`assets/jsblock/scripts/hklcd.js` 顶部：

```js
const HOME_PLATFORM_INDEX = 0;   // 0-based；只在没有 HOME 自定义消息时使用
```

注意脚本常量是 **0 开始**，游戏内 `HOME=n` 是 **1 开始**，两者不要混。

### 3.4 常见问题

- **为什么一直看不到“停靠月台通告”？**
  PIDS 只订阅了 1 个站台时，所有到站数据都来自这个站台，必然等于 HOME，所以永远走路线图。这是数据决定的，不是脚本坏了。
  要看通告：PIDS 站台列表加多个站台；或先写 `HOME=-1` 强制预览。
- **`HOME=2` 是不是只显示 2 号月台的提示？**
  不是。它只是把**列表第 2 项**设为本站台；通告显示的是这班车**实际**要停的月台。
- **列表顺序在哪看？**
  PIDS GUI 的站台列表顺序；不确定就逐个试 `HOME=1/2/3`，哪个站台的车显示路线图，哪个就是本站台。
- **改了 HOME 没反应？**
  确认自定义消息写在任意一行、格式是 `HOME=数字`；多平台 PIDS 才需要设置，单平台设置没有意义。

---

## 4. 可在脚本顶部改的参数

打开 `assets/jsblock/scripts/hklcd.js`，最上面是配置区：

| 常量 | 默认 | 说明 |
| --- | --- | --- |
| `SS` | `8` | 超采样倍率；纹理 = `pids.width × 8`。嫌性能不够可降到 4 |
| `ARRIVING_WARN_MS` | `60000` | 进站警示阈值 |
| `DOOR_CLOSING_MS` | `10000` | 关门提示阈值 |
| `VIEW_PERIOD_MS` | `15000` | 旧版列表 / 路线图切换周期（保留常量，不再用于主循环） |
| `PHASE_MS` | `2000` | 站台 / 编组每 2 秒切换 |
| `ANNOUNCE_LANG_MS` | `6000` | 停靠月台通告每种语言 6 秒 |
| `LANG_FORCE` | `""` | 调试用；`"zh"` / `"en"` 可强制单语 |
| `C_*` | 见脚本 | 全部配色 |
| `SERVICE_OVERRIDE` | 见脚本 | 车种文字与颜色 |
| `TRAVEL_PROFILES` | 见脚本 | 旧版时间气泡估算表（已不显示，保留配置项） |
| `HOME_PLATFORM_INDEX` | `0` | 脚本默认的本站台下标（**0 开始**）；游戏内可用自定义消息 `HOME=n` 覆盖（**1 开始**，`0`=默认，`-1`=没有本站台）。**完整说明见第 3 节** |

---

## 5. 车种怎么填（MTR 侧）

### 4.1 只从「线路号」读车种

脚本优先读 **路线号码（Route Number）**，为空才退回 **路线名称**。
推荐把线路号写成 `中文|English`：

```
各停|Local
快速|Rapid
特急|Spec.press
準急|Semi Exp.
特快|Special Rapid
通快|Com.Rapid
急行|Ex.press
```

也可以把车种写在线路名后面，用 `||` 分隔备注：

```
花越线|Hana-Koshi Line||快速|Rapid
```

### 4.2 内置车种表

| 车种 | 中文 | 英文 | 颜色 |
| --- | --- | --- | --- |
| 特急 | 特急 | Spec. press | `D32F2F` 红 |
| 準急 | 準急 | Semi Exp. | `27AE60` 绿 |
| 特快 | 特快 | Special Rapid | `453EA5` 紫 |
| 通快 | 通快 | Com. Rapid | `0E9E9E` 蓝绿 |
| 急行 | 急行 | Ex. press | `E67E22` 橙 |
| 快速 | 快速 | Rapid | `215DB3` 蓝 |
| 各停 | 各停 | Local | `3C3C3C` 深灰 |

匹配规则：关键字**包含**即命中、不区分大小写，顺序**从快到慢**。
想精确指定文字/颜色，往 `SERVICE_OVERRIDE` 里加：

```js
{ number: "507", zh: "各停", en: "Local", color: "00A650" }
```

### 4.3 颜色兜底

车种表没指定颜色时，徽章与线路条使用 **MTR 路线颜色**（`routeColor()`）。

---

## 6. 路线图不显示旅行时间

JCM / MTR 的脚本 API **不提供站间运行时间**：`ArrivalResponse` 只有本站的到站/开出时刻，
`SimplifiedRoute` 只有站序，`Platform.routes` 在客户端为空，拿不到 MTR 内部的段运行时长。
因此路线图**不再显示时间气泡**，只保留：

- 线路条（MTR 路线颜色）+ 站点圆点；
- 本站之后各站的竖排站名；
- 头部的种别、目的地、月台和剩余时间。

`TRAVEL_PROFILES` 仍留在脚本里供参考，但不再参与绘制。

---

## 7. 验证（开发用）

本包附带一套离线验证工具（不包含在发布 zip 里）：

```
harness/
  RhinoPids.java     真实 Rhino 1.9.1 + 真实 Java AWT 离屏渲染
  prelude.js         模拟 JCM API（GraphicsTexture / Texture / Resources / TextUtil / PIDS 数据）
  scenarios/*.json   26 个场景（中英 / 列表 / 路线图 / 警示 / 关门 / 空态 / 夜间 / 缺数据 / 多尺寸…）
  run.sh             一键跑全部场景
assets/jsblock/scripts/hklcd.js
validate.py          静态检查 + 全场景渲染 + 像素抽查
```

运行：

```bash
# 需要 JDK 11+（Rhino 1.9.1）；本机使用 Zulu 21
java -cp "harness;../rhino/rhino-1.9.1.jar" RhinoPids \
     harness/prelude.js assets/jsblock/scripts/hklcd.js \
     harness/scenarios/map_local_cn.json harness/out/map_local_cn.png

python validate.py
```

说明：

- 字体使用 JCM 自带的 `Noto Sans CJK TC Medium` 与 MTR 的 `Noto Sans SemiBold`，
  离线渲染与游戏内字形/度量一致。
- `Rhino` 驱动会真实执行 `create()` / `render()`，异常会以非 0 退出，
  不会出现「验证全绿但图是错误屏」的假绿。
- 已覆盖边界分支：无到站、无路线、无月台号、0 颜色、环形路线、超长目的地、
  夜间、日间、40×20 / 90×46 / 133×72 / 136×76 / 272×152。

---

## 8. 已知限制

1. **路线图不显示旅行时间**：JCM/MTR 脚本 API 不提供站间运行时间，时间气泡已移除（见第 6 节）；头部仅保留到站倒计时。
2. 路线图从 `route.getPlatforms()` 里**本站之后**的站开始显示（本站不在画面里）；
   如果站点 ID 对不上、找不到本站，就退回显示整条路线。实拍里的 `+` 是准星，不是屏内容。
3. 语言切换跟随 JCM 的全局语言相位（`TextUtil.cycleString`，60 tick ≈ 3 秒）。
4. 目的地过长时会自动缩字号，仍放不下才截断加 `…`。
5. 脚本使用 JCM 2.2+ 的公共 API；如果某个整合包改过 API，可能需要微调。

---

## 9. 许可

MIT。见 `LICENSE`；第三方说明见 `NOTICE.md`。

实拍参考截图由 Anon 提供，仅用于还原版式与配色；本包不包含原资源包的任何素材。
MTR / JCM 及其自带字体归各自作者所有。
