# 麦当劳 MCP 边缘代理（Cloudflare Worker）

## 为什么要它

浏览器**不能直连** `https://mcp.mcd.cn`，实测两条证据：

```
OPTIONS https://mcp.mcd.cn           → 403 Forbidden（且无 Access-Control-Allow-Origin）
POST    https://mcp.mcd.cn           → 200 OK，但响应头里依然没有 Access-Control-Allow-Origin
```

没有 CORS 头，浏览器会把响应丢掉；带 `Authorization` 的 POST 还会先触发 OPTIONS 预检，直接 403。
所以**任何网页产品想接麦当劳 MCP，中间必须有一层服务端**。这层 Worker 就是最轻的那一层。

它做三件事：

1. 服务端持有 / 转发 Bearer Token —— 浏览器永远看不到 Token
2. MCP 的 Streamable HTTP + JSON-RPC → 前端熟悉的 `/api/*` REST
3. 补上 CORS 头，让 GitHub Pages 上的静态页能跨域调它

## 接口

| 路径 | 说明 | 走的 MCP 工具 |
|---|---|---|
| `GET /api/health` | 连通性自检，返回可用工具数与是否开放下单 | `tools/list` |
| `POST /api/plan` | 搭三套方案并逐单官方核价 | `query-nearby-stores` → `query-meals` → `list-nutrition-foods` → `calculate-price` |
| `GET /api/store?city=` | 默认门店 | `query-nearby-stores` |
| `GET /api/stores?city=&keyword=` | 门店搜索 | `query-nearby-stores` |
| `GET /api/campaigns` | 今日活动 | `campaign-calendar` |
| `GET /api/coupons` | 卡包券 | `available-coupons` |
| `POST /api/coupons/claim` | 一键领券 | `auto-bind-coupons` |
| `GET /api/addresses` | 配送地址 | `delivery-query-addresses` |
| `POST /api/order` | 真实下单（默认关闭） | `create-order`，返回 `payH5Url` |
| `GET /api/order/:id` | 订单状态 / 取餐码 | `query-order` |
| `POST /api/mcp` | 调试用：任意工具转发 `{tool, args}` | 任意 |

## 部署（两种方式，选一）

### A. Wrangler CLI

```bash
cd worker
npx wrangler login
npx wrangler secret put MCD_TOKEN     # 粘贴你的 Token，不会进仓库
npx wrangler deploy
```

部署完会拿到 `https://kaifan-mcp-proxy.<你的子域>.workers.dev`。

### B. 不装 CLI：粘贴到 Dashboard

1. Cloudflare Dashboard → Workers & Pages → Create → Create Worker
2. 把 `bundle.js` 全文粘进编辑器 → Deploy
3. Settings → Variables → 加一个 **Secret** `MCD_TOKEN`，再加普通变量 `DEFAULT_CITY=广州`、`DEFAULT_STORE=1400359`、`ENABLE_ORDER=0`

## 前端接上去

静态页地址后面加一个参数即可（值会记进 localStorage，之后不用重复带）：

```
https://west-liu.github.io/mcd-kaifan/?api=https://kaifan-mcp-proxy.xxx.workers.dev
```

页面会自动探测 `/api/health`：通了就走实时 MCP（价格标「官方价 · calculate-price」），不通就退回内置快照。

## 安全 — 必读

`MCD_TOKEN` 是**你个人麦当劳账号的凭证**，拿到它等于能替你下单、领券、看地址。

- 公网 Worker 务必保持 `ENABLE_ORDER=0`（默认就是）。开了就等于任何人能用你的账号点真餐。
- 想让别人试用但不想交出你的 Token，把 `MCD_TOKEN` 留空，让访客在请求头带自己的：
  `x-mcd-token: 他的Token`。Worker 的 CORS 已经放行这个头。
- `wrangler.toml` 里只放无敏感信息的 vars，Token 走 Secret，不要提交进 git。

## 本地验证

```bash
node tools/build-worker.js    # 生成 worker/bundle.js
node tools/test-worker.js     # 用 Node 模拟 Worker 环境，真调一次 MCP
```

`test-worker.js` 会打印 health / store / plan 三个接口的真实返回，
`/api/plan` 里 `pricedBy=mcd-calculate-price` 就说明官方核价链路是通的。
