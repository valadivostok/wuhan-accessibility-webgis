# 武汉市可达性演示平台

Vue 3 + Vite + MapLibre GL，OpenLayers 用于设施统计和分析几何。演示图层来自本机 `D:\GIS学习\研究方向\GISdata`，原始文件保持不变。

## 运行

```bash
npm install
npm run dev
```

默认地址为 http://localhost:5173/。已生成的数据位于 `public/data/demo/`，开发服务和构建产物均直接读取这些文件，无需向浏览器开放外部磁盘目录。部署时一并保留 `dist/data/demo/`。

## 更新演示数据

```bash
python -m pip install -r py/requirements-demo.txt
npm run prepare:data
```

更换目录：

```bash
python py/prepare_demo_data.py --source "D:/GIS学习/研究方向/GISdata" --output public/data/demo
```

转换脚本要求 Fiona、Shapely、PyProj，检查输入为 EPSG:4326，按照 OSM 的“武汉市 / admin_level5”行政边界裁剪湖北数据，再简化和输出 GeoJSON。源数据更新后重新转换；转换结束后刷新页面。`manifest.json` 记录原始文件、坐标系、数据时点、分类规则、图层数量和统计口径。

## 已接入

- 武汉市行政边界、道路路网、水域、土地利用、建筑轮廓和设施点位。
- 图层开关和“查看武汉全域”；道路从 11 级、建筑从 14 级显示。
- 8 类设施的全市 OSM 记录数量、分类筛选和点击查看名称及 OSM 来源。改变起点不会移动设施。
- 附近有名称的真实设施，时间按直线距离和当前速度估算。
- 本地路网等时圈（模式一）：输入 1–60 分钟，选择步行、骑行或驾车，生成阈值内的嵌套等时圈和可达路段，支持导出 GeoJSON。
- 计算圈内设施数量及其相对全市同类记录的占比；修改起点、时间或速度会清除旧结果，重新生成后更新统计。
- 全市 OSM 土地利用面记录的面积占比，按 WGS84 椭球面积计算。

## 数据口径

“全市概况”独立展示本地武汉基础地理数据：OSM 市界几何面积、六类已接入图层记录数、全市设施类别构成、用地记录面积占比、坐标范围及来源日期。市界面积由原始行政边界按 WGS84 椭球面积核算，属于该数据集的几何面积。总览不随分析起点或等时圈结果改变；等时圈面积、圈内设施及出行时间等统计保留在分析视图中。总览地图点击设施可查看记录信息，起点设置在分析视图中进行。

来源为本地 Geofabrik 湖北省 OSM 数据，原始 README 标注时点为 `2026-10-23T20:20:51Z`。© OpenStreetMap contributors，采用 [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/)；在线影像及底图另显示各自来源。

设施分类包括轨道车站、公交站、商业设施、学校、医疗设施、公园绿地、餐饮和住宿。分类依据原始 `fclass`，完整映射见清单。轨道车站包括铁路及有轨电车设施，不能解读为地铁站总数。面设施取裁剪几何的内部代表点；按 OSM 类型、ID 和类别去重，实体的点/面重复和 OSM 漏采仍可能存在，记录数不代表官方设施普查总量。

土地利用按记录面积之和统计，可能存在重叠和未覆盖区域，不能解释为武汉全域完整土地覆盖构成。尚未接入 CLCD 栅格、GDB 或人口数据。等时圈的道路时间由本地路网求解，圈面为采样时间场近似；设施数表示落入近似圈面的记录数，不保证每个设施入口已通过路网验证。右侧“附近设施时间估算”仍按直线距离估算，标签独立说明。

## 武汉实时天气

“全市概况”左侧的“基本地情”下方显示武汉实况气温、天气现象、今日预报温度范围与数据发布时间。今日范围取高德当天日间/夜间预报的较低值和较高值，不代表今日已观测到的极值。页面每 10 分钟刷新一次，切回页面时也会更新；高德实际发布时点以卡片显示时间为准。

天气由服务端 `/api/weather/wuhan` 调用高德官方 Web 服务，实况与预报分别查询，缓存 10 分钟并合并并发请求。网络异常时明确提示；如能使用最近一小时内的缓存，会标注为上次观测，跨日后不会沿用昨日温度范围。

在项目根目录的私有 `.env.local` 中配置 `AMAP_WEATHER_KEY`（示例字段见 `.env.example`），或通过同名服务端环境变量设置。使用高德 **Web 服务类型** Key，修改后重启服务。开发、预览与 `npm start` 都支持天气接口；部署时保留服务端文件并配置密钥，仅上传 `dist` 的静态部署不能调用本地代理。真实 Key 不使用 `VITE_` 前缀，不写入浏览器构建文件，`.env.local` 已加入忽略规则。

接口说明：[高德天气查询](https://lbs.amap.com/api/webservice/guide/api/weatherinfo)。

## 可达性算法：模式一

初次安装及数据准备（Windows PowerShell，项目根目录）：

```powershell
# 如尚未建立虚拟环境：python -m venv .venv
.venv\Scripts\python.exe -m pip install -r py/requirements-accessibility.txt
npm run prepare:network
npm run dev
```

进入“可达性分析”，点击地图或设施设置起点，输入分钟数，选择出行方式和速度，点击“生成等时圈”。结果图例最大时间等于输入值；中间时间为 5、10、15、20、30 分钟中小于输入值的部分。“导出 GeoJSON”保存 EPSG:4326 圈面、可达道路和计算元数据。起点名称只是标签，定位由地图点击确定。

`npm run prepare:network -- --source "D:/GIS学习/研究方向/GISdata"` 从原始、未经展示简化的道路 Shapefile 构图，保留武汉市界外 5 km 的道路上下文。生成 `server/data/road-network.json` 和 `public/data/accessibility/metadata.json`，不修改原始数据。当前包含 126,885 个节点、174,992 条拓扑边；数据更新后重新执行准备命令并重启服务。

开发、预览和 `npm start` 均提供 `POST /api/accessibility/isochrones`。Python 进程按需启动并缓存路网；默认使用项目 `.venv`，可通过 `GIS_PYTHON` 指定解释器。服务部署需同时保留 `server/`、`py/`、路网文件及 `public/data/demo/water.geojson`，安装 Python 依赖。仅部署 `dist/` 不能运行本地路网求解。

```json
{"origin":[114.395,30.52],"minutes":15,"mode":"walk","speedKmh":5}
```

响应为 GeoJSON FeatureCollection，`features` 是各时段近似圈面，`reachableRoads` 是最大阈值内截断后的路段，`metadata` 记录接入距离、初始接驳时间、网格分辨率、路网长度、访问节点数及来源。无附近可连接道路、起点位于武汉外、非法参数、服务未安装等情况会返回明确错误，不返回替代模拟圈。

算法推导、论文对应关系、精度口径及限制见 [模式一算法说明](docs/accessibility-mode1.md)。验证：`npm run test:accessibility`、`npm test`、`npm run build`。

## 可达性算法：模式二（半径内时间分区）

在分析参数中选择“模式二 · 半径约束”，输入如 `5 km` 的分析半径，再生成圈内时间分区。半径表示起点周围的空间范围；圈内区域按真实路网到达时间着色，时间可以超过 60 分钟。路网绕行可经过圆外再返回，最终分区、道路和统计范围均裁剪到圆内与武汉市界的交集。

圈边界以白色虚线显示；彩色分区互不重叠，灰色表示没有可用路网时间，包括未连通、无法接驳、已映射水域等情况，不能将灰色直接解释为绝对无法进入。默认 30 m 采样，路外接驳仍限 90 m，范围较大时自动调整采样分辨率。半径支持 0.1–20 km。

```json
{"origin":[114.395,30.52],"constraint":"radius","radiusKm":5,"mode":"walk","speedKmh":5}
```

同一个接口保留模式一请求兼容性，省略 `constraint` 时默认时间约束。模式二不需要 `minutes`：对本地网络中连通的道路求最短时间，再为半径内格心赋值，自动生成包含 5、15、30 分钟的时间分段；需要时扩展到 60、90 分钟及覆盖所有有效采样的末级时间。返回的 `features` 是累计等时圈，`timeBands` 是互不重叠的时间分区，`studyArea`、`radiusBoundary`、`unclassifiedArea` 分别给出有效分析区、完整圆边界和无路网时间区域。元数据记录半径、实际分辨率、有效/未分类面积和最大采样时间。

模式二导出的 GeoJSON 主 `features` 为时间分区，属性包含 `minMinutes`、`minutes` 和 `areaKm2`，可直接在 GIS 软件按时间分类；累计等时圈、分析区及道路作为额外成员保留。设施图表仍按各分钟阈值累计统计，不能将其解释为经过设施入口路径验证的数量。

## 构建

公开网站部署已提供 `Dockerfile` 和 `compose.yaml`，同时运行前端、天气代理及 Python 可达性服务。操作与域名配置见 [部署说明](docs/deployment.md)。实际公网地址需在取得服务器或托管账号后配置。

```bash
npm run build
npm run preview
```

## 三维建筑展示

地图默认开启 WebGL 三维视图。3D 模式下按住鼠标右键，上下拖动控制俯仰（0–70°），左右拖动控制旋转；左键拖动平移、滚轮缩放。右上侧支持 2D / 3D 切换和建筑高度调节，重置按钮恢复默认相机。2D 模式禁用俯仰与右键旋转。

建筑使用本地 OSM 真实轮廓，楼高为稳定生成的示意值，不代表实测高度。建筑从 14 级显示，图层目录可关闭建筑。

## 加载性能

道路、水域、用地、建筑和市界通过本地 MVT 矢量瓦片按视野加载，在 Worker 中解析并由 GPU 渲染；浏览器不再整体加载全市几何。设施点位仍完整加载，保证分类、附近设施和等时圈统计口径一致。地图交互初始化不等待在线底图服务。

更新 GeoJSON 后运行 `npm run prepare:tiles` 生成 `public/data/demo/tiles/`，部署时保留该目录。`npm run prepare:data` 会自动生成瓦片。若开发服务已启动，首次生成瓦片后重启开发服务，以更新静态文件目录缓存。

## 开源底图

右上角“地图切换”表单只有“影像图”和“矢量图”两个选项，选择后立即切换，默认矢量图。矢量图使用 OpenStreetMap 标准底图，影像图使用 Esri World Imagery 卫星影像，两者分别显示来源标注。影像服务与 OSM 开源数据的许可不同。

卫星瓦片由同站点的 `/api/imagery/{z}/{x}/{y}.jpg` 按需转发，本地服务读取完整 JPEG，校验后缓存至 `tmp/satellite-tiles/`。离开视野的请求会被取消，共享请求仍有其他客户端使用时会继续下载，避免旧视野的任务阻塞当前地图。

影像模式使用 `public/data/satellite-overview/` 中覆盖武汉及周边的卫星概览作为底层（运行 `npm run prepare:overview` 可补齐），高清瓦片到达后叠加显示；加载中或失败时保留卫星画面，不混入矢量底色。界面按当前视野计算高清加载进度，并对失败瓦片进行有限重试。卫星概览清晰度有限，不会被标记为高清加载完成。

开发服务和 `npm run preview` 均带此接口；生产使用 `npm run build` 后执行 `npm start`，默认 `127.0.0.1:4173`（可设置 `HOST`、`PORT`）。只上传 `dist` 到静态托管时，需要另行配置此接口，或通过 `VITE_IMAGERY_TILE_URL` 指定可用的影像瓦片地址。

矢量模式在线请求失败时，保留本地道路、水域和用地矢量并提示当前状态。切换底图保留相机位置、缩放、俯仰、旋转和分析图层。本地矢量数据覆盖武汉市，不含完整地名标注。

标准底图从 `https://tile.openstreetmap.org/{z}/{x}/{y}.png` 按当前视野请求，遵守浏览器缓存，不提供批量下载。部署可通过 `VITE_OSM_TILE_URL` 设置自托管或获授权的 OSM 瓦片地址。OpenStreetMap 采用 ODbL 许可，地图保留可点击的来源标注；详见 [来源与许可](https://www.openstreetmap.org/copyright) 和 [瓦片服务使用政策](https://operations.osmfoundation.org/policies/tiles/)。

