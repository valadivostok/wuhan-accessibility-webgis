# 公开网站部署

目标：访客通过网址直接访问，无需注册或登录。服务器同时运行页面、Node 接口和 Python 路网计算；本地电脑关机后，云端服务仍可运行。

当前提供 Docker 与 Compose 配置，尚未创建云资源或发布公网地址。需要先取得可用服务器及其公网地址。Oracle Always Free 可以作为免费云主机候选，但注册、可用容量、资源额度及空闲实例回收以官方规则为准，不保证能申请成功或一直稳定运行。

本次已通过前端生产构建及现有 14 项 Node 接口测试。本机尚未安装 Docker，容器镜像构建、Linux 运行及公网访问仍需在目标服务器验证。

- [Oracle 免费资源规则](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)
- [Oracle 注册要求](https://www.oracle.com/cloud/free/faq/)
- [Docker Engine 安装](https://docs.docker.com/engine/install/)

## 上传内容

服务器安装 Docker Engine 和 Compose 插件。将以下内容放在服务器同一个项目目录下，保留目录结构：

```text
Dockerfile
.dockerignore
compose.yaml
package.json
package-lock.json
index.html
vite.config.js
src/
public/
server/
py/accessibility.py
py/requirements-accessibility.txt
.env.example
```

`server/data/road-network.json`、`public/data/demo/water.geojson` 和公开地图瓦片均需包含。它们已由本地数据准备脚本生成，服务器不需要原始 D 盘路径或论文 PDF。不要上传本机的 node_modules、.venv、tmp、私有 .env.local。

Docker 分别构建前端和服务端运行环境，运行镜像包含 Node 22、Python 及算法依赖，使用非 root 用户运行。构建上下文采用允许列表，私有环境文件不会进入镜像。现有 Node 服务仅使用内置模块，运行阶段无需前端 node_modules。

## 启动

在服务器的项目目录执行：

```bash
cp .env.example .env.local
chmod 600 .env.local
```

编辑服务器上的 `.env.local`，填写服务端 `AMAP_WEATHER_KEY`。不要将实际 Key 写进 Dockerfile、前端源码或公开仓库。未填写时仅天气不可用，其他模块可以启动。Compose 在运行时读取此文件，不将它打包进镜像。

```bash
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 web
curl -I http://127.0.0.1:4173/
```

首次构建需要联网下载 Node、Python 依赖。健康检查确认首页可响应，并不代替路网计算、天气等功能检查。

在云平台安全组及服务器防火墙放行 TCP 4173 后，可先用 `http://服务器公网IP:4173/` 访问。此地址是 HTTP 验证入口；正式分享域名时应配置 HTTPS。端口映射默认向服务器网络接口开放，只有在准备公开站点的服务器上启动这份配置。

若端口已被占用，可使用 `GIS_HTTP_PORT=8080 docker compose up -d`，并改为访问、放行 8080 端口。

## 固定网址与 HTTPS

服务器公网 IP 变更会影响 IP 地址入口。若平台提供固定子域名，可以先使用平台地址；自己的独立域名需要另外注册并持续续费。

取得域名后，可把域名解析到服务器，使用 Caddy 或 Nginx 反向代理到本站 4173 端口并配置 HTTPS；或者按 [Cloudflare Tunnel 文档](https://developers.cloudflare.com/tunnel/get-started/) 将自己的域名映射到 `http://localhost:4173`。使用后者需要 Cloudflare 账号及其管理的域名。正式采用反向代理或隧道后，将 Compose 的端口映射改成 `127.0.0.1:4173:4173`，让公网访客统一从 HTTPS 入口进入。

Cloudflare Quick Tunnel 只能用于临时试用，网址随新隧道变化，本地运行时电脑也必须保持开机，不作为固定云端部署。

## 上线验证与更新

从另一台设备访问公网网址，检查基础图层、两种可达性模式、GeoJSON 导出和天气。较大半径的计算较慢，实际可支持的访客数量需要在所选服务器上测试；当前单个 Python 进程顺序计算，最多接受三个待处理请求，繁忙时返回提示。

更新项目后，在项目目录执行：

```bash
docker compose up -d --build
```

修改 Key 后执行 `docker compose up -d --force-recreate web`。影像缓存保存在 Docker 卷中，普通重建保留缓存；`docker compose down` 停止站点，避免使用 `down -v` 意外清空缓存。

容器会在进程退出后重启，但应用健康检查失败不会自动重启进程。服务器的 Docker 服务也需要启用开机启动。底图、天气仍依赖外部服务，上线后需在实际网络下验证可用性。
