# workbuddy.md — 用腾讯 WorkBuddy 开发「开饭参谋」的对话记录

> 本文件用于参与麦当劳程序员创意开发大赛的 **WorkBuddy 专项奖励**申报，
> 记录项目在 WorkBuddy 中的完整开发过程。

- **开发时间**：2026-10-25
- **开发环境**：腾讯 WorkBuddy（Craft 模式，Windows）
- **项目**：开饭参谋 —— 基于麦当劳 MCP 的团餐搭配助手

---

## 一、需求澄清：从「做个麦当劳作品」到「解决一个真问题」

**用户诉求**（原话要点）：用麦当劳 MCP 做一个 AI 作品，形式不限；参考命题里提到套餐推荐、麦门省钱助手、聚餐一键点单、按热量和口味配套餐。

**我的判断**：命题里的方向很多，但真正高频且痛的是**聚餐**——人多、忌口杂、还要卡预算。单点麦当劳不难，难的是"一单满足所有人"。于是把范围收窄成：

> 报人数、报预算、报忌口 → 30 秒摆好一桌。

**WorkBuddy 中的作用**：我把已有原型（同目录下的早期版本，`server.js` + `public/index.html`）读进上下文，判断它已完成「菜单过滤 + 贪心搭配」，但只用了 2 个 MCP 工具、价格是本地加总的。据此确定了改造方向，而不是从零重写。

---

## 二、摸清 MCP 到底能干什么（tools/list）

在 WorkBuddy 里用 Node 直接打 `tools/list`，拿到 **35 个工具**的完整清单。这一步决定了作品能做到什么程度。

关键发现：

| 工具 | 价值 |
| --- | --- |
| `calculate-price` | 官方算价，能拿应付价/原价/优惠 —— 这是原版没用上的核心能力 |
| `list-nutrition-foods` | 158 条官方营养数据，热量不再是编的 |
| `query-meal-detail` | 组合餐的子项结构，可拆开算热量 |
| `available-coupons` / `auto-bind-coupons` | 券的查询与一键领取 |
| `campaign-calendar` | 今日活动 |
| `create-order` | 真下单 |

**决策**：把作品从"菜单过滤器"升级为"能核价、能算热量、能下单的完整链路"。

---

## 三、踩到的坑与解决过程

### 坑 1：MCP 返回不是干净的 JSON

`content.text` 里混着面向大模型的说明文字，真正的业务数据在后面。
**解决**：优先读 `result.structuredContent`（官方给的结构化结果），读不到再从文本里用括号配平抠 `{"success"...}`。写在 `mcp.js` 的 `callRaw()` 里。

### 坑 2：营养接口返回的是一张定长文本表

```
[160]{productName,nutritionDescription,energyKj,energyKcal,protein,fat,carbohydrate,sodium,calcium}:
  猪柳麦满分,null,1288,308,16,16,24,781,213
```
**解决**：写 `parseNutrition()` 按行解析成 Map，并对菜单名做三级匹配——精确 → 去掉「三件套/套餐/随心配」等后缀 → 最长包含匹配。

### 坑 3（最关键）：分享餐算价对不上

自算 ¥49.9 的「全明星双人分享餐八件套」，交给官方 `calculate-price` 变成了 **¥114.5**。原因是这类组合餐需要指定 `roundList` 子项，没指定就按默认高价计。

我试了 5 种 `roundList` 写法（单个 choice + round.quantity / qty=1 / 带 roundId / 带 id / 重复填满 quantity），**服务端全部返回「服务器发生了未知的问题」**，格式始终没猜对。

**换思路**：既然猜不出子项格式，就**不猜了，改为让官方算价反过来校验我**——

```
生成方案 → calculate-price 核价
  → 逐项比对「官方 subtotal」与「菜单价」
  → 差异 > ¥0.6 判定异常 → 把该商品拉黑 → 重新生成（最多 3 轮）
```

结果：3 人 ¥90 的请求，第 1 轮剔除 2 个异常商品，第 2 轮 3 套方案全部通过官方核价。
**这反而成了作品最有说服力的部分**：报给用户的价格，是麦当劳自己认的价格。

### 坑 4：新品在营养表里没有

「龙焰鸡腿堡」「酥脆无双套餐」等新品查不到热量，直接显示 `null` 会误导。
**解决**：查不到时调 `query-meal-detail` 拿组合餐子项，逐项匹配营养表后累加（`nutritionFor()`）。仍查不到的，界面标注「N/M 项有官方数据」，不假装知道。

### 坑 5：`.env` 加载时机

`lib/mcd.js` 在 `require` 时就实例化 `MCPClient(process.env.MCD_TOKEN)`，而 `.env` 加载写在后面 —— Token 是 `undefined`。
**解决**：把 `loadDotEnv()` 提到所有业务 `require` 之前。

### 坑 6：切换方案 tab 后附加信息消失、AI 点评停止轮询

前端重建 DOM 后缓存标志没重置。
**解决**：`renderResult()` 开头重置 `extraLoaded`，并在切回主推方案且点评未回来时重新 `startPoll()`。

---

## 四、在 WorkBuddy 里完成的改造清单

| 模块 | 改动 |
| --- | --- |
| `mcp.js` | 重写：`structuredContent` 优先、`callRaw` 保留原文、`listTools`、更稳的 SSE 解析 |
| `lib/mcd.js` | 新增：营养表解析与三级匹配、组合餐详情与热量拆解、官方算价、券、活动、下单 |
| `lib/planner.js` | 重写：三套策略（均衡/省钱/轻卡）、忌口分「全桌硬约束」与「个人诉求」、主食按人均预算留余地、同价位轮转避免重复 |
| `server.js` | 新增：`planWithValidation()` 算价校验与自愈循环、`enrichKcal()`、健康检查、券、活动、下单路由 |
| `public/index.html` | 重写：方案对比 tab、官方核价小票（原价/应付/省了多少）、热量、门店选择弹层、券与活动区、真下单二次确认 |

用到的 MCP 工具从 **2 个增加到 9 个**。

---

## 五、验证记录

```
GET  /api/health   → toolsAvailable: 35，7 个关键工具全部就位
POST /api/plan     → store: 麦当劳广州天源路餐厅
                     priceRounds: 2，excludedByPriceCheck: 2
                     3 套方案 pricedBy: mcd-calculate-price
                     吃得均衡 ¥88.8 / 最省钱 ¥81.8 / 轻卡减脂 ¥87.9（省 ¥4）
GET  /api/campaigns → 今日活动 8 条（麦当劳 × PEACEMINUSONE、蓝莓爆爆珠麦旋风…）
GET  /api/coupons   → 卡包 3 张券
```

---

## 六、说明

- 本项目使用腾讯 WorkBuddy 开发，全过程在 WorkBuddy 中完成需求分析、接口探测、编码、调试与文档撰写。
- 作品中不含真实 Token、密钥或个人信息，配置文件仅使用环境变量占位符。
- 作品为参赛者独立开发，非麦当劳官方产品。
