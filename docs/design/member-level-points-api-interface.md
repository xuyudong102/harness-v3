# 积分 & 会员等级权益 — 接口全景（v2）

> **版本**：v2.0（概要索引）  
> **日期**：2026-07-14  
> **负责域**：积分 + 会员等级权益  
> **状态**：DRAFT（待产品/技术交底确认）

> **详细字段级契约（v3）** → [`member-level-points-api-contract.md`](./member-level-points-api-contract.md)（单文件，约 2300 行）  
> 含每个接口的完整入参/出参表、校验规则、错误码、JSON 示例、MQ 载荷定义。

## 关联 PRD

| 文档 | 链接 |
|------|------|
| 会员等级权益模块（卖家后台配置） | https://zfnyunshang.feishu.cn/docx/RN5XdgrDWoVwxDxtb44czLmxnlf |
| C端商城管理后台 会员管理二期 | https://zfnyunshang.feishu.cn/wiki/Il1Rw80XMiWfKyk7hqkc5Fr7nvd |
| 我的积分 小程序 | https://zfnyunshang.feishu.cn/docx/JjxmdsbyhoR3s5xGjhyc6Hnrn8c |
| 我的积分 WEB | https://zfnyunshang.feishu.cn/docx/W1IYdf9d1oyGrFxzdgdcZgRNnNg |
| 小程序 会员积分与等级展示 | https://zfnyunshang.feishu.cn/wiki/RNuPwGxEsiklYukqLpKctcGanub |
| WEB 会员积分与等级展示 | https://zfnyunshang.feishu.cn/wiki/EzrBwjshPi0vnMktgxJc3MvknNd |

---

## 一、参数约定（全局）

### 1.1 上下文隐式参数（接口文档不列出）

| 参数 | 获取方式 | 适用场景 |
|------|---------|---------|
| `userId`（当前登录用户） | 架构/SecurityContext | C 端 `/api/**` 全部 |
| `operatorId`（当前操作人） | 架构/SecurityContext | 卖家后台写操作 |
| `tenantId`（当前商城/租户） | 架构/SecurityContext | 卖家后台配置类、C 端（若单租户可省略） |

### 1.2 仍需显式传递的参数

| 参数 | 传递方式 | 适用场景 |
|------|---------|---------|
| `{userId}` 路径参数 | URL 路径 | B 端查/改**指定会员**（非当前登录人） |
| `userId` / `userIds[]` | Request Body / Query | `/internal/**` 内部服务调用（无 C 端登录态） |
| `targetUserId` | 禁止与路径重复 | 统一用路径 `{userId}`，body 不再重复 |

### 1.3 鉴权与归属校验

- C 端：所有读写的积分/等级/订单数据必须校验「资源归属当前登录用户」
- B 端：操作指定会员需具备对应权限点 + 租户隔离
- Internal：调用方服务鉴权 + 显式传 `userId`

---

## 二、你需要写的接口

### 2.1 卖家后台 — 等级与权益配置（A 组）

| 编号 | 方法 | 路径 | 入参（显式） | 出参 | 消费方 | 备注 |
|------|------|------|-------------|------|--------|------|
| A01 | GET | `/admin/member/level/list` | 无 | 等级列表（sort/名称/图标/阈值） | 卖家后台 | 按 sort 升序 |
| A02 | GET | `/admin/member/level/{levelId}` | 路径 levelId | 等级详情 | 卖家后台 | |
| A03 | PUT | `/admin/member/level/{levelId}` | 名称、图标、阈值 | success | 卖家后台 | 排序不可改；联动权益展示 |
| A04 | GET | `/admin/member/level/upgrade-rule` | 无 | 升级规则、刷新时间 | 卖家后台 | |
| A05 | PUT | `/admin/member/level/upgrade-rule` | 规则类型、月/日/时/分 | success | 卖家后台 | 默认 1/1 00:00 |
| A06 | GET | `/admin/member/benefit/pool/list` | 无 | 系统默认+自定义权益 | 卖家后台 | 自定义上限 100 |
| A07 | POST | `/admin/member/benefit` | 权益基础+卡片信息 | benefitId | 卖家后台 | 新增自定义权益 |
| A08 | GET | `/admin/member/benefit/{benefitId}` | 路径 benefitId | 权益详情 | 卖家后台 | |
| A09 | PUT | `/admin/member/benefit/{benefitId}` | 权益字段 | success | 卖家后台 | |
| A10 | PUT | `/admin/member/benefit/{benefitId}/status` | enabled | success | 卖家后台 | 停用同步移除等级绑定 |
| A11 | DELETE | `/admin/member/benefit/{benefitId}` | — | success | 卖家后台 | 仅自定义权益 |
| A12 | GET | `/admin/member/level/{levelId}/benefits` | 路径 levelId | 已绑定权益列表 | 卖家后台 | 含等级内启用状态 |
| A13 | POST | `/admin/member/level/{levelId}/benefits` | benefitIds[] | success | 卖家后台 | 从权益池添加 |
| A14 | PUT | `/admin/member/level-benefit/{id}/status` | enabled | success | 卖家后台 | 折扣：控制展示+下单 |
| A15 | DELETE | `/admin/member/level-benefit/{id}` | — | success | 卖家后台 | 解除绑定 |
| A16 | PUT | `/admin/member/level-benefit/sort` | 排序列表 | success | 卖家后台 | 拖动排序 |
| A17 | GET | `/admin/member/level/{levelId}/discount/skus` | productName、spuOrSkuCode、分页 | SPU/SKU 树+折扣率 | 卖家后台 | 依赖商品模块 H01 |
| A18 | PUT | `/admin/member/level/{levelId}/discount/skus` | SKU 折扣（批量/单条） | success | 卖家后台 | 1–100 整数，即时生效 |
| A19 | GET | `/admin/member/level/{levelId}/discount/history` | skuId | 修改历史 | 卖家后台 | 修改人/前后折扣/时间 |
| A20 | GET | `/admin/member/rule-poster` | 无 | mobile/web 海报 URL | 卖家后台 | |
| A21 | PUT | `/admin/member/rule-poster` | mobilePosterUrl、webPosterUrl | success | 卖家后台 | 各 1 张，≤10M |

### 2.2 卖家后台 — 积分规则 & 积分商品（B 组）

> PRD 引用但未在你方 6 份文档内完整展开；默认归本域，待 Q01/Q02 确认。

| 编号 | 方法 | 路径 | 入参（显式） | 出参 | 消费方 | 备注 |
|------|------|------|-------------|------|--------|------|
| B01 | GET | `/admin/points/rule` | 无 | 发放公式、有效期策略、刷新规则 | 卖家后台 | |
| B01 | PUT | `/admin/points/rule` | 规则配置体 | success | 卖家后台 | |
| B02 | GET | `/admin/points/products` | 分页、筛选 | 积分商品列表 | 卖家后台 | |
| B03 | POST | `/admin/points/products` | 商品完整字段 | productId | 卖家后台 | |
| B04 | GET | `/admin/points/products/{productId}` | 路径 productId | 商品详情 | 卖家后台 | |
| B05 | PUT | `/admin/points/products/{productId}` | 商品字段 | success | 卖家后台 | |
| B06 | DELETE | `/admin/points/products/{productId}` | — | success | 卖家后台 | |
| B07 | PUT | `/admin/points/products/{productId}/status` | 上下架状态 | success | 卖家后台 | |
| B08 | GET | `/admin/member/benefit/explain` | category（可选） | 权益说明配置 | 卖家后台 | C 端需要；卖家 PRD 无菜单，待 Q04 |
| B09 | PUT | `/admin/member/benefit/explain` | 分类、标题、正文、图、排序 | success | 卖家后台 | |

### 2.3 卖家后台 — 会员运营 & 审批（C 组）

| 编号 | 方法 | 路径 | 入参（显式） | 出参 | 消费方 | 备注 |
|------|------|------|-------------|------|--------|------|
| C01 | GET | `/admin/member/{userId}/level-status` | 路径 userId | 等级+进度+补偿标记 | 会员详情/列表 | 与 D01 口径一致 |
| C02 | GET | `/admin/member/{userId}/points/summary` | 路径 userId | 余额、累计获取/消耗 | 会员详情 | |
| C03 | GET | `/admin/member/{userId}/points/ledger` | 路径 userId、分页 | 积分明细 | 会员详情 | limit=5 用于最近条 |
| C04 | POST | `/admin/member/{userId}/points/adjustment` | adjustType、amount、reason | approvalId | 会员详情/列表 | 路径指定会员；进审批 |
| C05 | POST | `/admin/points/adjustment/{approvalId}/withdraw` | 路径 approvalId | 状态 | 发起人 | 仅待审批；校验操作人 |
| C06 | GET | `/admin/points/adjustment/history` | userId、status、时间范围、分页 | 审批历史 | 查看历史弹窗 | |
| C07 | GET | `/admin/points/adjustment/pending-count` | 无 | count | 主页/汇总 | 按租户+权限过滤 |
| C08 | GET | `/admin/points/adjustment/handle-url` | 无 | url | 审批汇总跳转 | |
| C09 | POST | `/admin/points/adjustment/{approvalId}/approve` | action(通过/驳回)、rejectReason | 结果 | 审批页 | **若审批归邓兆翠则本域不写** |
| C10 | POST | `/admin/member/{userId}/level/compensate` | 路径 userId；body: targetLevelId、reason | 新等级 | 调高等级 | **本期直接生效，无审批** |
| C11 | GET | `/admin/member/{userId}/level/change-log` | 路径 userId、分页 | 等级变动台账 | 等级变动明细 | |
| C12 | POST | `/admin/points/redeem/verify` | verificationCode | 订单状态、useDate | 商家后台 | 码校验+改 completed |
| C13 | POST | `/admin/points/redeem/orders/{orderId}/cancel` | 路径 orderId、reason | 退积分+释库存 | 商家后台 | **本期不实现，预留** |

> C04 详细契约见 [`member-level-points-api-contract.md`](./member-level-points-api-contract.md#c04-发起积分修正)。

### 2.4 C 端 — 会员等级与权益展示（D 组）

| 编号 | 方法 | 路径 | 入参（显式） | 出参 | 消费方 | 备注 |
|------|------|------|-------------|------|--------|------|
| D01 | GET | `/api/member/level/status` | 无 | 见 §2.4.1 | 我的页卡片/WEB 权益管理 | 核心接口 |
| D02 | GET | `/api/member/level/list` | 无 | 五档等级 Chips | 等级页 Tab | |
| D03 | GET | `/api/member/level/{levelId}/benefits` | 路径 levelId | 权益模块卡片 | 等级页 | 按排序 |
| D04 | GET | `/api/member/benefit/explain` | category | 说明内容 | 权益说明页 | |
| D05 | GET | `/api/member/benefit/explain/categories` | 无 | 分类列表 | 权益说明页 | |
| D06 | GET | `/api/member/rule/poster` | platform(mobile/web) | 海报 URL | 规则说明 | |
| D07 | GET | `/api/member/rule/summary` | 无 | 规则摘要 40–120 字 | WEB Hero 区 | 配置来源待 Q09 |

#### 2.4.1 D01 出参字段

```text
currentLevel:      { id, name, icon }
currentPoints:     Integer
nextLevel:         { id, name } | null     // 满级为 null
targetPoints:      Integer
gapPoints:         Integer | null          // 满级不返回
progress:          { current, target, percent }  // 区间最小值固定 0
isMaxLevel:        Boolean
displayMode:       GROWTH | MAX_LEVEL
manualCompensated: Boolean
pointsSummary:     { totalEarned, totalSpent }   // 仅 WEB 权益管理需要，小程序可不返回
```

### 2.5 C 端 — 我的积分（E 组）

| 编号 | 方法 | 路径 | 入参（显式） | 出参 | 消费方 | 备注 |
|------|------|------|-------------|------|--------|------|
| E01 | GET | `/api/points/summary` | 无 | balance、pendingCount、expiryReminder | P1/V1 | 下拉刷新 |
| E02 | GET | `/api/points/expiring` | 无 | 近 3 月将过期批次 | 到期提醒 | |
| E03 | GET | `/api/points/ledger` | type(in/out)、pageNo、pageSize | 流水列表 | 明细区 | |
| E04 | GET | `/api/points/ledger/{ledgerId}` | 路径 ledgerId | 明细详情 | P6/V6 | 校验归属 |
| E05 | GET | `/api/points/products` | pageNo、pageSize | 兑换商品列表 | P2/V2 | sort+库存排序 |
| E06 | GET | `/api/points/products/{productId}` | 路径 productId | 商品详情+库存 | P3/V3 | 列表轻量，详情全量字段 |
| E07 | POST | `/api/points/redeem` | productId、quantity | orderId | 兑换确认 | 幂等；见错误码 |
| E08 | GET | `/api/points/redeem/orders` | pageNo、pageSize | 兑换订单列表 | P4/V4 | pending>completed |
| E09 | GET | `/api/points/redeem/orders/{orderId}` | 路径 orderId | 详情+核销码+快照入口 | P5/V5 | 校验归属 |
| E10 | GET | `/api/points/redeem/orders/{orderId}/snapshot` | 路径 orderId | 兑换时点商品快照 | 快照页 | |
| E11 | WS | `/api/points/redeem/orders/{orderId}/status` | 路径 orderId | 核销态变更 | 订单详情 | WEB 实时刷新；待 Q18 |

#### 2.5.1 E07 错误码

| 错误码 | 场景 | 用户感知 |
|--------|------|---------|
| 40001 | 积分不足 | 按钮置灰 / toast |
| 40002 | 库存不足 | toast + 刷新详情 |
| 40003 | 账号冻结（WEB） | toast 联系客服 |

### 2.6 内部接口 — 供其他模块调用（F 组）

> 内部接口**必须显式传 userId**，无登录上下文。

| 编号 | 方法 | 路径 | 入参（显式） | 出参 | 消费方 | 备注 |
|------|------|------|-------------|------|--------|------|
| F01 | GET | `/internal/member/discount/sku` | userId、skuId | rate、discountPrice、enabled | 商品详情/结算 | 未启用=无折扣 |
| F02 | POST | `/internal/member/discount/skus/batch` | userId、skuIds[] | Map\<skuId, discount\> | 购物车/列表 | |
| F03 | POST | `/internal/member/users/batch-status` | userIds[] | 等级+积分+修正中标记 | 会员列表 | 万级≤1s；待 Q19 |
| F04 | GET | `/internal/member/{userId}/level` | 路径 userId | levelId、name、icon | 订单买家快照 | 替换旧 memberLevel 整数 |
| F05 | GET | `/internal/account/{userId}/can-deactivate` | 路径 userId | hasPendingRedeemOrder | 账号注销 | |
| F06 | POST | `/internal/points/approval/callback` | userId、approvalId、delta | — | 审批通过后 | 触发等级重算 |

### 2.7 事件 / 定时任务（G 组，非 HTTP）

| 编号 | 名称 | 触发 | 处理逻辑 | 备注 |
|------|------|------|---------|------|
| G01 | 消费返积分 | 订单 MQ | 计算积分→加余额→写流水→站内信 | 时机待 Q06 |
| G02 | 退款不发/重算 | 退款 MQ | 不发放或按剩余实付重算 | |
| G03 | 积分变动 | 积分账户变更 | 刷新展示进度；必要时触发升级 | 兑换不即时降级 |
| G04 | 年度刷新 | 定时 1/1 00:00 | 按剩余积分重判；清除手动补偿 | |
| G05 | 等级升级 | 积分达阈值 | 写等级变动台账 | |
| G06 | MQ 死信补偿 | 消费失败 | 7 天内人工补发 | 运维告警 |

#### G01 订阅事件（待 Q06 确认主题名）

| 候选主题 | 载荷要点 |
|---------|---------|
| `order.completed` | orderNo、userId、tenantId、payAmount、status |
| `order.afterSaleExpired` | orderNo、userId、剩余实付 |

---

## 三、其他人需要给你提供的接口

### 3.1 商品模块

| 编号 | 能力 | 你传入 | 你需要拿到 | 用途 |
|------|------|--------|-----------|------|
| H01 | SPU/SKU 分页查询 | productName(模糊)、spuOrSkuCode(精确)、分页 | SPU 树：封面、名称、SKU 编码、规格、销售价、上下架 | A17 折扣配置 |
| H02 | SKU 销售价批量查询 | skuIds[] | skuId → salePrice | 折后价、结算 |
| H03 | 新 SKU 上架事件（可选） | — | skuId、spuId | 初始化等级默认折扣；待 Q13 |

### 3.2 订单 / 交易模块

| 编号 | 能力 | 你传入 | 你需要拿到 | 用途 |
|------|------|--------|-----------|------|
| H04 | 订单完成 MQ | — | orderNo、userId、tenantId、payAmount(实付不含券)、status | G01 发积分 |
| H05 | 订单退款 MQ | — | orderNo、refundAmount、refundType | G02 |
| H06 | 售后期届满事件（若独立） | — | orderNo、剩余实付 | 发积分时机（Q06） |
| H07 | 下单链路 | userId（调 F04） | — | 你提供 F04 给交易 |

### 3.3 用户 / 账号模块

| 编号 | 能力 | 你传入 | 你需要拿到 | 用途 |
|------|------|--------|-----------|------|
| H08 | 用户基础信息批量 | userIds[] | 昵称、手机号等 | 会员列表/详情展示 |
| H09 | 登录态解析 | token（网关层） | 当前 userId、tenantId | 全接口；你消费不暴露 |
| H10 | 注销前置校验 | userId（调 F05） | — | 你提供 F05 |

### 3.4 文件 / OBS

| 编号 | 能力 | 你传入 | 你需要拿到 | 用途 |
|------|------|--------|-----------|------|
| H11 | 图片上传 | 文件流 | CDN URL | 等级图标、权益图、海报 |

### 3.5 站内消息

| 编号 | 能力 | 你传入 | 你需要拿到 | 用途 |
|------|------|--------|-----------|------|
| H12 | 消息投递 | 模板 + payload | 投递结果 | 积分到账、兑换、核销 |

### 3.6 审批汇总（若积分审批不归本域）

| 编号 | 能力 | 你传入 | 你需要拿到 | 用途 |
|------|------|--------|-----------|------|
| H13 | 积分调整待审批数 | tenantId（上下文） | count | 主页待审批；**若 C07 归你则删除** |
| H14 | 积分审批处理页 URL | tenantId | url | 审批汇总跳转；**若 C08 归你则删除** |

### 3.7 权限模块

| 编号 | 能力 | 说明 |
|------|------|------|
| H15 | 权限点鉴权 | 等级管理查看/编辑、权益管理、发起积分修正、调高等级、核销等 |

---

## 四、你需要提供给其他人的接口

### 4.1 → C 端前端（小程序 + WEB）

| 接口组 | 编号 | 说明 |
|--------|------|------|
| 会员等级权益展示 | D01–D07 | 我的页卡片、等级页、满级页、权益说明、规则海报 |
| 我的积分 | E01–E11 | 余额、流水、兑换商城、兑换订单、核销态 |

**参数约定**：当前登录 userId 从架构获取，前端不传。

### 4.2 → 卖家管理后台（曾素情）

| 接口组 | 编号 | 说明 |
|--------|------|------|
| 等级权益配置 | A01–A21、B08–B09 | 用户管理下菜单 |
| 会员运营 | C01–C13 | 会员列表/详情、修正、调高、核销 |
| 积分规则/商品 | B01–B07 | 若归本域 |
| 待审批聚合 | C07–C08 | 主页待办+汇总 |

**参数约定**：被操作会员用路径 `{userId}`；操作人从架构获取。

### 4.3 → 交易 / 商品 / 结算

| 编号 | 消费方传入 | 你返回 |
|------|-----------|--------|
| F01 | userId、skuId | 折扣率、折后价、enabled |
| F02 | userId、skuIds[] | Map |
| F04 | userId | levelId、name、icon |

### 4.4 → 账号模块

| 编号 | 消费方传入 | 你返回 |
|------|-----------|--------|
| F05 | userId | hasPendingRedeemOrder |

### 4.5 → 会员列表（批量）

| 编号 | 消费方传入 | 你返回 |
|------|-----------|--------|
| F03 | userIds[] | 等级名/图标、当前积分、是否修正中 |

### 4.6 → 审批 / 主页待办

| 提供内容 | 编号 | 格式 |
|---------|------|------|
| 积分调整待审批 | C07 | `{ type: "积分调整", count, handleUrl }` |
| 审批通过回调 | F06 | 内部 POST |

### 4.7 → 消息模块（事件驱动，非 HTTP）

| 场景 | 触发 | Payload 要点 |
|------|------|-------------|
| 积分到账 | G01 | addPoints、totalPoints |
| 兑换成功 | E07 | orderId、points |
| 核销完成 | C12 | orderId、useDate |
| 积分退回（预留） | C13 | refundedPoints |

---

## 五、核心业务规则（实现必读）

### 5.1 等级判定

```text
展示等级 = max(积分自然等级, 手动补偿等级)
自然等级 = 当前积分命中的最高阈值档
升级：积分达阈值 → 实时升级
消费积分：余额减少，等级不即时降（消费保级）
年度刷新（默认 1/1 00:00）：按剩余积分重判，清除手动补偿
进度条区间：最小值固定 0，非「当前等级门槛~下一等级门槛」
满级：currentPoints == targetPoints，进度 100%，不展示差额
```

### 5.2 权益双层启用

| 层级 | 位置 | 作用 |
|------|------|------|
| 权益池启用 | 权益池管理 | 控制能否被等级绑定；停用则所有等级移除 |
| 等级内启用 | 等级权益管理 | 专属折扣：控制 C 端展示 + 下单折扣；自定义权益：仅控制展示 |

### 5.3 积分与兑换

| 规则 | 说明 |
|------|------|
| pendingCount | 按**订单条数**，非 SKU 份数；分次核销仍算 1 条 |
| 兑换事务 | 锁积分→校验→扣积分→扣库存→建单(PD+6位码)→写流水；幂等 |
| 积分有效期 | 批次模型；配置变更只影响新积分 |
| 本期不做 | 积分退回 C13、refunded 订单态 |

### 5.4 C 端入口拆分

| 入口 | 覆盖 |
|------|------|
| 我的页「会员积分卡片」 | 等级/成长/权益（D 组）；不含积分明细、兑换 |
| 「我的积分」 | 余额/流水/兑换（E 组） |

---

## 六、待确认问题

### 6.1 归属 / 范围

| 编号 | 问题 | 影响 |
|------|------|------|
| Q01 | 积分管理后台（规则、调整审批页、全量明细）归本域还是邓兆翠？ | C04–C09、B01、H13/H14 |
| Q02 | 积分商品后台配置 PRD 在哪？是否归本域？ | B02–B07、E05/E06 |
| Q03 | 积分详情承接页（WEB 权益管理跳转）是否单独 PRD？ | WB-05 |
| Q04 | 权益说明配置是否有独立卖家菜单？ | B08–B09 |

### 6.2 文档冲突

| 编号 | 问题 | 建议 |
|------|------|------|
| Q05 | 调高等级是否走审批？清单 F2.9 vs 正文直接生效 | 以正文 4.1.5 为准 |
| Q06 | 积分发放：「已完成即发」vs「过退货有效期才发」 | 产品统一后发 MQ 口径 |
| Q07 | 进度条 targetPoints 取下一等级门槛还是封顶值 | MP-Q02 / WB-Q02 |
| Q08 | 满级是否统一 isMaxLevel 字段 | MP-Q03 / WB-Q03 |

### 6.3 产品设计

| 编号 | 问题 |
|------|------|
| Q09 | WEB 规则摘要文案谁配置？ |
| Q10 | 权益说明/模块是否富文本、按等级差异化？ |
| Q11 | 规则海报：新页 / 弹层 / WebView？ |
| Q12 | 钻石会员积分超门槛后是否永远满级展示？ |
| Q13 | 新 SKU 上架后各等级折扣默认值？是否自动进表？ |
| Q14 | 单用户兑换上限是否在商品后台配置？ |
| Q15 | 分次核销本期是否支持？ |

### 6.4 技术实现

| 编号 | 问题 |
|------|------|
| Q16 | 现有 memberLevel 整数与新等级体系如何迁移？ |
| Q17 | 积分有效期批次模型表结构 |
| Q18 | 核销态推送 WebSocket 还是长轮询？ |
| Q19 | F03 单次 userIds 上限与分批策略 |
| Q20 | 服务异常时 C 端兜底展示口径 |
| Q25 | B 端 userId 统一路径 vs body（建议仅路径） |

### 6.5 本期范围

| 编号 | 问题 | 参考结论 |
|------|------|---------|
| Q21 | 积分退回 C13 本期是否做？ | V1.3 暂不实现 |
| Q22 | 小程序等级展示与「我的积分」是否完全分离？ | 是 |
| Q23 | 账号冻结 40003 本期是否做？ | WEB 有，小程序无 |
| Q24 | 主页会员数据对账误差 0 的口径与频率？ | 效果验收 |

---

## 七、建议联调顺序

```text
Phase 1  A01–A21 + D02/D03/D06        等级权益配置 + C 端读配置
Phase 2  B01 + 等级引擎 + D01         依赖积分余额
Phase 3  H01/H02 → A17/A18 + F01/F02  折扣配置 + 结算
Phase 4  E01–E10 + C12                兑换+核销闭环
Phase 5  H04/H05 → G01/G02            消费返积分
Phase 6  C01–C11 + F03                卖家会员运营
Phase 7  确认 Q01/Q05/Q06 后          审批链 + 待审批聚合
```

---

## 八、数量汇总

| 类别 | 数量 |
|------|------|
| 本域 HTTP 接口 | 约 58 |
| 事件/定时任务 | 6 |
| 依赖外部能力 | 15 项 |
| 待确认 | 25 项 |

---

## 变更记录

| 版本 | 日期 | 变更 |
|------|------|------|
| v1.0 | 2026-07-14 | 初版：6 份 PRD 梳理 |
| v2.0 | 2026-07-14 | userId/operatorId/tenantId 改从架构上下文获取；C 端/API 文档净入参 |
| v3.0 | 2026-07-14 | 新增详细契约；C04 路径统一 |
| v3.1 | 2026-07-14 | 详细契约合并为 [`member-level-points-api-contract.md`](./member-level-points-api-contract.md) 单文件 |
