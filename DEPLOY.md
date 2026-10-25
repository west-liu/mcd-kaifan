# 部署说明

开饭参谋有两种形态，选哪种取决于你要不要**实时调麦当劳 MCP**。

| 形态 | 是否实时调 MCP | 需要服务器 | 状态 |
|---|---|---|---|
| 静态单文件（`dist/开饭参谋.html`） | 否，用预抓快照 | 不需要 | 已上线 GitHub Pages |
| Node 服务（`server.js` + `public/`） | **是**，每次开饭现拉菜单并官方核价 | 需要 | 本地已跑通 |

浏览器无法直连 MCP（麦当劳接口不返回 CORS 头），所以「实时版」必须有个后端做转发 —— 这就是需要服务器的地方。

---

## 方式一：静态版（已部署，零成本）

- 作品：https://west-liu.github.io/mcd-kaifan/
- 自动演示：https://west-liu.github.io/mcd-kaifan/demo.html

数据来自 `public/snapshot.json`（105 个餐品 + 158 条营养，抓自官方 MCP）。算法代码与实时版同源，结论一致，但价格不会随门店/时段变化。

---

## 方式二：服务器 Docker（实时调 MCP）

```bash
git clone https://github.com/west-liu/mcd-kaifan.git
cd mcd-kaifan

echo "MCD_TOKEN=你的Token" > .env
echo "DEFAULT_CITY=广州"   >> .env
echo "ENABLE_ORDER=0"      >> .env   # 公网部署强烈建议关掉真实下单

docker build -t mcd-kaifan .
docker run -d --name kaifan -p 5173:5173 --env-file .env --restart unless-stopped mcd-kaifan
```

访问 `http://服务器IP:5173`。

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
# 期望：{"ok":true,...}

curl -s -X POST http://localhost:5173/api/plan \
  -H "Content-Type: application/json" \
  -d '{"headcount":4,"budget":150,"prefs":[[],["nobeef"],[],[]],"way":"pickup"}'
# 期望：三套方案 pricedBy 均为 "mcd-calculate-price"
```

`pricedBy` 出现 `local-estimate` 说明 MCP 调用没走通，检查 Token 与网络出口。

## 安全提醒

- `ENABLE_ORDER=1` 时 `/api/order` 会调用 MCP `create-order` 生成**真实麦当劳订单**（真扣钱、占库存）。公网部署请保持 `0`，或至少加一层访问控制。
- `.env` 已在 `.gitignore` 里，不要把 Token 提交进仓库。
