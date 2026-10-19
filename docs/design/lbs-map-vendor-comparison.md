# LBS 地图方案对比 — 腾讯 vs 高德（小程序 + Web）

> **版本**：v1.0  
> **日期**：2026-07-20  
> **适用端**：微信小程序、Web  
> **约束**：**不使用距离矩阵**；多地址「最近」采用自研直线距离（Redis GEO / 服务端计算）  
> **状态**：DRAFT（供选型与评审）

---

## 1. 背景与目标

| 需求 | 说明 |
|------|------|
| 多地址与当前位置「最近」 | 在多个候选点（如门店、自提点）中找出离用户最近者并排序 |
| 地图与导航 | 列表/详情展示地图；支持页内路线或调起系统地图导航 |
| 双端 | 同一套后端能力，小程序与 Web 分别接入地图 SDK / 端能力 |

**不在本文范围**：距离矩阵（腾讯 `/ws/distance/v1/matrix` 及同类多对多批量路网算路）。

---

## 2. 总体架构

```text
┌─────────────────────────────────────────────────────────────────┐
│ A. 多地址最近（排序）  → Redis GEO 或 Java 直线距离（Haversine）   │  0 次路径/距离 WebService
├─────────────────────────────────────────────────────────────────┤
│ B. 门店/地址坐标       → 地理编码（入库/变更时，低频）              │
├─────────────────────────────────────────────────────────────────┤
│ C. 用户当前位置        → 端上定位（wx.getLocation / JS 定位）     │
├─────────────────────────────────────────────────────────────────┤
│ D. 选中门店详情        → 单次路径规划或单次距离测量（可选）         │
├─────────────────────────────────────────────────────────────────┤
│ E. 一键导航            → wx.openLocation / 地图 App URI           │  通常 0 次 WebService
└─────────────────────────────────────────────────────────────────┘
```

### 2.1 数据流

1. **门店**：DB 持久化 `lng`、`lat`（**GCJ-02**）；地址变更时调用 **一次** 地理编码，并同步 **Redis GEO**（按租户分 key，如 `store:geo:{tenantId}`）。
2. **用户**：小程序 / Web 获取定位后，将 `userLng`、`userLat` 传后端。
3. **最近列表**：后端 `GEORADIUS ... WITHDIST COUNT K ASC`，或使用项目内 `NumberUtils` 等直线距离工具排序。
4. **详情/导航**：仅对 **当前选中的 1 个** 终点调用驾车/步行 **路径规划**（或高德 **距离测量** 单对），用于展示 ETA、页内折线；勿对 N 个候选各调一次。
5. **Key 安全**：WebService **仅服务端**调用；小程序/Web 使用各自 Key（域名/合法域名白名单）。

### 2.2 与地图厂商的分工

| 层级 | 实现 |
|------|------|
| 直线最近、Top-K | Redis GEO / Java（与腾讯/高德无关） |
| 地址 → 坐标 | 所选厂商 Geocoder |
| 单店路网距离/时间、页内路线 | 所选厂商 Direction 或距离测量 |
| 调起导航 | 端能力（坐标已是 GCJ-02） |

### 2.3 Redis GEO 注意点

- 写入顺序为 **经度、纬度**（Redis 惯例）。
- 返回距离为 **球面直线米数**，与「导航距离」不一致，文案需区分「直线距离 / 导航距离」。
- 门店增删改需与 DB **同步** GEO 成员。

---

## 3. 涉及接口清单

### 3.1 后端 WebService（腾讯 vs 高德）

| 能力 | 腾讯位置服务 | 高德 Web 服务 |
|------|--------------|---------------|
| 地址 → 坐标 | `GET /ws/geocoder/v1`（address） | `GET /v3/geocode/geo` |
| 坐标 → 地址 | `GET /ws/geocoder/v1`（location） | `GET /v3/geocode/regeo` |
| 坐标系转换（GPS→GCJ-02） | `GET /ws/coord/v1/translate` | `GET /v3/assistant/coordinate/convert` |
| IP 定位兜底 | `GET /ws/location/v1/ip` | `GET /v3/ip` |
| 驾车路线 | `/ws/direction/v1/driving` | `/v3/direction/driving` |
| 步行路线 | `/ws/direction/v1/walking` | `/v3/direction/walking` |
| 骑行路线 | `/ws/direction/v1/bicycling` | `/v3/direction/bicycling` |
| 公交换乘 | `/ws/direction/v1/transit` | `/v3/direction/transit/integrated` |
| 两点距离（单对，非矩阵） | 一次 Direction 读 distance/duration；或 `GET /ws/distance/v1` 一对多中的单对场景 | `GET /v3/distance`（type：0 直线 / 1 驾车 / 3 步行等） |
| 静态地图（可选） | `GET /ws/staticmap/v2` | 静态地图（计入基础 LBS） |
| POI 搜索 / 输入提示（可选） | `/ws/place/v1/search`、`/ws/place/v1/suggestion` | 关键字/周边等（**基础搜索**配额，与 LBS 分开） |
| **距离矩阵（本文不用）** | `/ws/distance/v1/matrix` | — |

**腾讯「一对多距离」`/ws/distance/v1`（本文不用于全量最近）**

- 配额项与矩阵不同，但官方限制 **起终点直线距离 ≤ 10km**，适合同城短距 O2O，**不适合**全城多门店批量找最近。
- 本方案最近排序统一 **自研直线**，不对全量门店调用该接口。

### 3.2 微信小程序

| 能力 | 腾讯 | 高德 |
|------|------|------|
| 系统定位 | `wx.getLocation` | 同左 |
| 调起微信地图 | `wx.openLocation` | 同左 |
| 地图组件 | 原生 `<map>` + markers/polyline | 同左 |
| SDK / 插件 | 腾讯位置服务小程序 SDK、路线规划插件 | `amap-wx.js`（`AMapWX`：`getRegeo`、`getDrivingRoute` 等） |
| 推荐 | 经 **自有后端** 代理 WebService，避免 Key 暴露 | 同左 |

### 3.3 Web

| 能力 | 腾讯 | 高德 |
|------|------|------|
| 地图底图与交互 | JavaScript API GL（TMap） | JS API 2.0（AMap） |
| 浏览器定位 | SDK 定位 + 必要时坐标转换 API | `AMap.Geolocation` + 转换 API |
| 页内路线 | WebService Direction 或 SDK 封装 | `AMap.Driving` / `Walking` 或 WebService |
| 调起手机地图 App | 腾讯 URI Scheme | 高德 URI Scheme |

### 3.4 典型用户路径与 API 次数

| 用户行为 | 路径/距离 WebService | 说明 |
|----------|----------------------|------|
| 打开附近门店列表并排序 | **0** | Redis GEO / Java |
| 维护 1 个门店地址 | Geocoder **×1** | 按门店增量 |
| 展示「我在哪」文案 | 逆地理 **0～1** | 可选 |
| 门店详情「驾车约 X 分钟」 | Direction 或 distance **×1** | 仅当前选中门店 |
| 页内画路线 | 可与详情 **合并为 1 次** Direction | |
| 仅「导航」跳转 | **0** | openLocation / URI |

**反模式**：对 N 个门店各调 1 次路径规划 → 月调用量 ≈ 访问量 × N，成本与配额压力陡增。

---

## 4. 费用对比

> 盈利性 C 端商城在国内使用地图服务，通常需 **商用授权 / 技术服务许可**（约 **5 万元/年** 量级，以签约为准）。  
> 下表 **超量单价** 以各平台官网为准；政策可能调整，立项前请在控制台复核。

### 4.1 固定成本（商用）

| 项目 | 腾讯 | 高德 |
|------|------|------|
| 商用准入 | [商业授权 FAQ](https://lbs.qq.com/FAQ/authorization_faq.html)：**约 5 万元/年**（公司主体） | [服务升级 / 技术服务许可](https://lbs.amap.com/upgrade)：**约 5 万元/年**（以合同为准） |
| 超额购买 | [腾讯云 LBS 控制台](https://console.cloud.tencent.com/lbs) | 控制台流量包 / 账户余额 |
| 个人开发者 | 不可作为正式商用方案；购量一般需企业 + 商业授权 | 未认证无基础 LBS 商用配额 |

### 4.2 免费 / 默认配额（企业认证参考）

| 维度 | 腾讯 WebService | 高德 |
|------|-----------------|------|
| 地理编码 / 逆地理 | 约 **300 万次/日**（`/ws/geocoder/v1`） | 并入 **基础 LBS**，企业约 **300 万次/月**（与路径、距离测量等 **共享**） |
| 路径规划（驾车/步行等） | 约 **50 万次/日**（各 direction 分项） | 基础 LBS **共享** |
| 距离一对多 `/ws/distance/v1` | 约 **50 万次/日**（本方案可不使用） | 距离测量属基础 LBS |
| 距离矩阵 | 有独立配额（**不用**） | — |
| JS 地图加载 / 在线定位 | 腾讯地图类 Key 单独统计 | **基础地图定位**：企业约 **3000 万次/月**（与 LBS **不共享**） |
| 并发 QPS（参考） | 路径类约 **200 QPS** | 基础 LBS 企业约 **30 QPS**；许可档约 **100 QPS** |

官方配额表：

- 腾讯：https://lbs.qq.com/webservice_v1/guide-quota.html  
- 高德：https://lbs.amap.com/pages/base_service_price  

### 4.3 超出月配额后的公开单价

| 计费包 | 腾讯 | 高德 |
|--------|------|------|
| 路径规划 / 距离测量 / 地理编码等 | 官网无统一「元/万次」公示，以 **腾讯云 LBS** 商品为准 | **基础 LBS**：**30 元/万次**（0～30 万/月）；30～100 万 **24 元/万次**；>100 万 **18 元/万次** |
| JS 地图加载、在线定位 | 控制台单独项 | **3 元/万次** 起（与 LBS 分开） |
| POI 搜索 | 地点搜索等企业日配额见腾讯配额页 | **基础搜索** 超限 **30 元/万次** |

### 4.4 本方案下的变动成本粗算（示例）

**假设**：最近排序全部自研直线；仅 **30%** 详情页调 **1 次** 驾车路径规划；月 **10 万** 次「附近门店」访问。

| 计费项 | 月调用量 | 说明 |
|--------|----------|------|
| 路径规划 | 约 **3 万** | 远低于高德企业 300 万 LBS 月配额 |
| 地理编码 | 新店增量 | 通常可忽略 |
| JS 地图 + 定位 | 视 PV | 高德定位配额通常充裕 |

**反例**：10 万访问 × 50 店 × 每店 1 次路径 ≈ **500 万 LBS/月** → 高德超量约 **200 万 × 30/10000 ≈ 6000 元/月**（另加年费）。

---

## 5. 厂商选型摘要

| 维度 | 腾讯 | 高德 |
|------|------|------|
| 微信小程序生态 | 插件、文档与微信衔接更顺 | 插件成熟，配置略多 |
| Web 生态 | JavaScript API GL | JS API 文档与社区更丰富 |
| 最近 N 店（本方案） | Redis/Java 直线 | 同左 |
| 单店 ETA / 页内路线 | Direction ×1 | Direction 或 `/v3/distance` |
| 批量路网最近 | 矩阵 / 一对多（**本方案不用**） | 批量距离（**本方案不用**） |
| 预算可预测性 | 年费明确；**超量需控制台/商务** | 年费 + **30 元/万次** 等可估算 |

**建议**

- 小程序权重高、希望与微信一套 → 倾向 **腾讯**。  
- 强调 **公开单价、自行测算调用成本**、Web 与后台并重 → 倾向 **高德**。  
- **只选一家** 做 WebService；直线最近层与厂商解耦，便于日后切换 Geocoder/Direction 封装。

---

## 6. 落地 Checklist

- [ ] 企业主体完成平台 **企业认证** 与 **商用授权 / 技术服务许可**  
- [ ] 申请 Key：**服务端 WebService**、**小程序**、**Web**（分 Key、分白名单）  
- [ ] 门店表字段：`longitude`、`latitude`（GCJ-02）、`geocodeStatus`、最后编码时间  
- [ ] Redis GEO 与 DB 同步策略（写穿 / 异步 / 对账任务）  
- [ ] 后端 API：`POST /stores/nearest`（入参 `userLng`、`userLat`、`limit`；出参直线 `distanceM`）  
- [ ] 详情可选：`GET /stores/{id}/route`（单次 Direction，返回 `distanceM`、`durationSec`、polyline）  
- [ ] 隐私合规：小程序《用户隐私保护指引》声明位置；Web 隐私弹窗  
- [ ] 禁止前端直连 WebService Key；禁止对 N 店循环路径规划  

---

## 7. 官方文档索引

| 用途 | 腾讯 | 高德 |
|------|------|------|
| WebService 配额 | https://lbs.qq.com/webservice_v1/guide-quota.html | https://lbs.amap.com/pages/base_service_price |
| 商用 / 许可 | https://lbs.qq.com/FAQ/authorization_faq.html | https://lbs.amap.com/upgrade |
| 路径规划 | https://lbs.qq.com/service/webService/webServiceGuide/route/webServiceRoute | https://lbs.amap.com/api/webservice/guide/api/direction/ |
| 一对多距离（参考，本方案不用于全量最近） | https://lbs.qq.com/webservice_v1/guide-distance.html | https://lbs.amap.com/api/webservice/guide/api/direction/（距离测量章节） |
| 微信小程序 | 腾讯位置服务小程序文档 / 路线规划插件 | https://lbs.amap.com/api/wx/gettingstarted |

---

## 8. 修订记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v1.0 | 2026-07-20 | 初稿：腾讯/高德对比、非矩阵方案、接口与费用 |
