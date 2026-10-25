# MCP 接入说明

本项目**全部核心能力均来自麦当劳官方 MCP**，没有任何 mock 数据、没有写死的价目表。

- **MCP Server：** `https://mcp.mcd.cn`（麦当劳 MCP 开放平台）
- **接入协议：** MCP over Streamable HTTP，JSON-RPC 2.0
- **认证方式：** `Authorization: Bearer <Token>`（Token 在 [open.mcd.cn/mcp](https://open.mcd.cn/mcp) 手机号登录后在控制台激活领取）
- **客户端实现：** `mcp.js`，零第三方依赖，用 Node 内置 `fetch` 完成 `initialize` → `notifications/initialized` → `tools/call` 握手与调用

---

## 实际使用的 Tool

| Tool | 用途 | 在项目中解决什么问题 |
| --- | --- | --- |
| `query-nearby-stores` | 查可点餐门店 | 让用户按城市/关键词选门店，拿到真实 `storeCode` |
| `query-meals` | 拉取门店实时菜单 | 唯一数据源。拿到 127 个在售餐品及 `currentPrice` / `originalPrice`，再按名称规则归类为主食/小食/饮品/甜品/分享餐，并剔除周边、玩具、酱包 |
| `query-meal-detail` | 餐品详情（组合餐子项） | 组合套餐在营养表里查不到，用它把 `rounds[].choices` 拆成子项，逐项累加热量 |
| `list-nutrition-foods` | 官方营养数据（158 条） | 给每套方案算真实热量（kcal），让"轻卡减脂"方案有硬数据支撑 |
| `calculate-price` | **官方算价** | 把候选单丢回麦当劳算价引擎，拿真实应付价、原价、优惠金额与逐项小计 |
| `create-order` | 创建订单 | 用户二次确认后，创建真实的到店自取订单 |
| `available-coupons` | 卡包优惠券 | 结果页展示麦麦省券面，告诉用户手上有什么 |
| `auto-bind-coupons` | 一键领券 | 一键领取当前所有可领券 |
| `campaign-calendar` | 营销活动日历 | 结果页展示"今天店里有什么新鲜事" |
| `delivery-query-addresses` | 查配送地址 | 外送场景入口：拿到 `addressId` |
| `delivery-query-stores` | 查可配送门店 | `beType=2` + `addressId` → 外送门店与 **`beCode`**（外送必传） |

---

## 调用流程

一次「摆一桌」的完整链路：

```
用户：3 人 / ¥90 / 第1位减脂 / 第3位不吃牛肉
  │
  ├─① query-nearby-stores ──→ 门店列表 → storeCode
  │
  ├─② query-meals ──────────→ 127 个在售餐品 → 归类成 主食/小食/饮品/甜品/分享餐
  │
  ├─③ list-nutrition-foods ─→ 158 条营养表（缓存 6h）
  │
  ├─④ 搭配引擎 ─────────────→ 生成 3 套候选（吃得均衡 / 最省钱 / 轻卡减脂）
  │     · 全桌硬约束：不吃牛肉 / 不吃辣 / 不吃炸物
  │     · 个人诉求：减脂 / 素食 / 不要酱 / 去冰（只影响本人那一份）
  │     · 预算约束：主食留 70% 人均，给小食饮品留余地
  │
  ├─⑤ calculate-price ──────→ 3 套并行核价（每套一次）
  │     └─ 逐项校验：官方小计 vs 菜单价，差异 > ¥0.6 即判定异常
  │            └─ 异常？把该商品拉黑 → 回 ④ 重搭（最多 3 轮）
  │
  ├─⑥ query-meal-detail ────→ 补齐组合餐热量（拆子项累加）
  │
  ├─⑦ campaign-calendar ────→ 今日活动
  ├─⑧ available-coupons ────→ 卡包里的券
  │
  └─⑨ 用户点「让 MCP 真下单」→ create-order（二次确认）
```

---

## 取餐方式：到店自取 / 麦乐送外送

页面上可以随时切换取餐方式，切换后**菜单、核价、下单三处参数一起变**，不是只改个文案。

| 方式 | `orderType` | `beType` | 额外必传 | 说明 |
| --- | --- | --- | --- | --- |
| 到店自取 | 1 | 1 | — | `create-order` 传 `takeWayCode=take-in-store`，**不要**传 `addressId` |
| 麦乐送外送 | 2 | 2 | `addressId` + `beCode` | `beCode` 来自 `delivery-query-stores`；`query-meals` / `calculate-price` / `create-order` 都要带 |
| 得来速 DT | 1 | 5 | `beCode` | 参数已支持，UI 暂未开放（多数城市门店不支持） |

外送完整链路：

```
delivery-query-addresses ──→ addressId
        │
delivery-query-stores(beType=2, addressId) ──→ 外送门店 storeCode + beCode
        │
query-meals(orderType=2, beType=2, beCode) ──→ 外送菜单（价格与自取不同）
        │
calculate-price(orderType=2, beType=2, beCode, needTableware) ──→ 含配送费/餐袋费的应付价
        │
create-order(orderType=2, beType=2, addressId, beCode, needTableware, remark)
```

几个踩过的坑：

- **外送不传 `beCode` 直接报错**，而 `beCode` 必须先有地址才能查到，所以链路顺序不能改。
- `remark` 在官方说明里是"仅 orderType=2 场景引导用户填写"，所以「需要餐具」「无接触配送」只在切到外送时追加进备注。
- 账户里没有配送地址时，接口返回空数组。项目**不会静默退回到店自取**，而是明确提示"先加一个配送地址"——不然用户会以为下的是外送。
- 在线演示版是静态页（麦当劳 MCP 不开 CORS，浏览器无法直连），切外送时沿用自取菜单价搭配，页面上会明确标注差价与配送费另计；真实外送菜单需要跑本地版。

---

## 为什么一定要调 `calculate-price`

这是本项目最核心的一次 MCP 调用，也是它区别于"菜单过滤器"的地方。

自己把单价加起来很容易，但**加出来的数不是用户要付的数**。真实情况里：

- 组合套餐（如"双人分享餐八件套"）如果没指定子项，官方算价会按默认高价计（实测：菜单价 ¥49.9，未指定子项时算成 ¥114.5）；
- 优惠券、促销是挂在算价结果上的，自己算不出来；
- 不同门店、不同取餐方式价格不同。

所以项目做了两件事：

1. **每一套候选都走 `calculate-price`**，用官方返回的 `price`（应付）、`originalPrice`（原价）、`discount`（优惠）覆盖自算价，小票上直接印"官方核价"。
2. **反向校验 + 自动重搭**：拿官方返回的逐项 `productList[].subtotal` 和菜单价逐条比对，对不上的商品直接拉黑，重新生成方案，最多 3 轮。实测一次 3 人 ¥90 的请求会剔除 2 个算价异常的商品、第 2 轮拿到全部合格方案。

这条链路保证：**报给用户的一定是麦当劳自己认的价格。**

---

## 业务价值

| 维度 | 价值 |
| --- | --- |
| 对顾客 | 聚餐点餐从"反复问、反复改"变成 30 秒出单；忌口按人算，不再有人被忽略；热量和预算都摆在明面上 |
| 对麦当劳 | 把官方算价、营养、券、活动这些能力包成一个真正能用的场景，提高组合餐与优惠券的转化；每单都经官方核价，价格零争议 |
| 对开发者 | 提供了一个 `calculate-price` 用于**价格风控**的完整参考实现：不只是调用，而是用返回结果反向校验并自愈 |
| 对 MCP 生态 | 证明真实业务里 MCP 能承担"决策 + 校验 + 执行"闭环，而不只是取数 |

---

## 配置示例（脱敏）

见 `mcp-config.example.json`，只含环境变量占位符，不含任何真实凭证。

在 WorkBuddy 里配置同样的 Server 即可直接调用：

```json
{
  "mcpServers": {
    "mcd-mcp": {
      "type": "streamableHttp",
      "url": "https://mcp.mcd.cn",
      "headers": { "Authorization": "Bearer ${MCD_TOKEN}" },
      "timeout": 30000
    }
  }
}
```
