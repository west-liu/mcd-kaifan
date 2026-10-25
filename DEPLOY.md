# 部署说明

开饭参谋有两种形态，选哪种取决于你要不要**实时调麦当劳 MCP**。

| 形态 | 是否实时调 MCP | 需要服务器 | 状态 |
|---|---|---|---|
| 静态单文件（`dist/开饭参谋.html`） | 否，用预抓快照 | 不需要 | 已上线 GitHub Pages |
| **边缘代理（`worker/`）** | **是** | 不需要（Cloudflare 免费额度） | 代码已就绪，待部署 |
| Node 服务（`server.js` + `public/`） | **是**，每次开饭现拉菜单并官方核价 | 需要 | 本地已跑通 |

浏览器无法直连 MCP（麦当劳接口不返回 CORS 头：OPTIONS 预检 403，POST 也不带 `Access-Control-Allow-Origin`），
所以「实时版」必须有个服务端做转发。要服务器就用 Node 版，不想养服务器就用边缘代理 —— 页面加个
`?api=https://xxx.workers.dev` 就能从快照模式切到实时 MCP 模式。

**支付（下单付款）只有后两种形态支持**：静态单文件版没有后端，能出方案和核价，但不能下单付款。

> 边缘代理的部署步骤见 [`worker/README.md`](worker/README.md)。

---

## 方式一：静态版（已部署，零成本）

- 作品：https://west-liu.github.io/mcd-kaifan/
- 自动演示：https://west-liu.github.io/mcd-kaifan/demo.html

数据来自 `public/snapshot.json`（105 个餐品 + 158 条营养，抓自官方 MCP）。算法代码与实时版同源，结论一致，但价格不会随门店/时段变化。

---

## 方式二：服务器 Docker（实时调 MCP + 支付可用）

支付不是自己接的通道：`create-order` 返回麦当劳官方 `payH5Url`，前端把它画成二维码，
再每 3 秒轮询 `query-order` 拿取餐码。所以**支付必须在有服务端的那一层**，纯静态 Pages 出不了支付。

```bash
git clone https://github.com/west-liu/mcd-kaifan.git
cd mcd-kaifan

cat > .env <<'EOF'
MCD_TOKEN=你的Token
DEFAULT_CITY=广州
ENABLE_ORDER=1
DEMO_PASS=换一个别人猜不到的口令
EOF

docker build -t mcd-kaifan .
docker run -d --name kaifan -p 5173:5173 --env-file .env --restart unless-stopped mcd-kaifan
```

访问 `http://服务器IP:5173`，前后端同源，不需要 `?api=` 参数。

### 上 HTTPS（支付建议）

麦当劳的支付页是 https，站点也用 https 更稳（二维码在微信/支付宝里扫码打开不踩混合内容）：

```nginx
server {
  listen 443 ssl;
  server_name kaifan.example.com;
  ssl_certificate     /etc/letsencrypt/live/kaifan.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/kaifan.example.com/privkey.pem;
  location / {
    proxy_pass http://127.0.0.1:5173;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
  }
}
```

证书用 `certbot --nginx -d kaifan.example.com` 一条命令签。

### 支付链路自检

页面点「让 MCP 真下单」→ 二次确认 → 弹出口令框（首次）→ 弹出官方支付二维码 + 15 分钟倒计时。
付款成功后轮询会把状态改成「付款成功 · 取餐码 XXXX」；不付则 15 分钟后自动取消。


## 方式三：服务器裸跑 Node（无 Docker）

```bash
node -v          # 需 >= 18（用到内置 fetch）
npm start        # 等价于 node server.js，读 .env
```

生产建议加 pm2 与反向代理：

```bash
npm i -g pm2
pm2 start server.js --name kaifan
pm2 save && pm2 startup
```

Nginx 片段（同时给 HTTPS）：

```nginx
location / {
  proxy_pass http://127.0.0.1:5173;
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
}
```

---

## 方式四：本机临时对外（给队友演示，5 分钟）

```bash
node server.js                     # 本地 5173
ssh -R 80:localhost:5173 nokey@localhost.run   # 拿到一个 https 公网地址
```

隧道地址是一次性的，重启就变，不适合当交付链接。

---

## 部署后自检

```bash
curl http://localhost:5173/api/health
# 期望：{"ok":true,...,"orderEnabled":true,"passRequired":true}
```

口令是否生效（应返回 401）：

```bash
curl -s -X POST http://localhost:5173/api/order \
  -H "Content-Type: application/json" -d '{"confirm":true}'
# 期望：{"ok":false,"passRequired":true,"error":"需要演示口令才能下单"}
```

带口令但 `confirm=false`（应停在二次确认，不建单）：

```bash
curl -s -X POST http://localhost:5173/api/order \
  -H "Content-Type: application/json" -H "x-demo-pass: 你的口令" -d '{"confirm":false}'
# 期望：{"ok":false,"error":"需要二次确认才会下单"}  ← 说明口令已通过
```

方案与官方核价：

```bash
curl -s -X POST http://localhost:5173/api/plan \
  -H "Content-Type: application/json" \
  -d '{"headcount":4,"budget":150,"prefs":[[],["nobeef"],[],[]],"way":"pickup"}'
# 期望：三套方案 pricedBy 均为 "mcd-calculate-price"
```

`pricedBy` 出现 `local-estimate` 说明 MCP 调用没走通，检查 Token 与网络出口。

## 安全提醒

- `MCD_TOKEN` 是你个人麦当劳账号的凭证，拿到它等于能替你下单、领券、看地址。别提交进仓库，别推到前端。
- `ENABLE_ORDER=1` 才会开真实下单；**公网务必同时设置 `DEMO_PASS`**，否则任何人打开链接都能用你的账号下真单、占库存。
- 口令只在浏览器本地保存（`localStorage` 的 `kf_pass`），首次下单时弹窗输入一次，之后自动带上 `x-demo-pass` 头。
- 口令不要放在网址里（会进访问日志和分享链接），只在下单弹窗里给评审。
- 想彻底关掉支付就设 `ENABLE_ORDER=0`，页面仍能出方案和核价。
- `.env` 已在 `.gitignore` 里，不要把 Token 提交进仓库。
