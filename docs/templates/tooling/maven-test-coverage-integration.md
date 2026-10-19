# Maven 测试覆盖率接入指南

将 `maven-jacoco-surefire.xml` 接入业务项目 BOM，使 `mvn verify` 自动执行 JaCoCo 门禁（行 ≥ 78%，分支 ≥ 65%）。

## 适用项目

- broker：`broker-dependencies/pom.xml`
- b2cmall / 其他多模块 Maven 项目：等价 BOM 或根 `pom.xml`

## 接入步骤

### 步骤 1：BOM 增加版本属性

在 `<properties>` 中追加（版本与 `testing.mdc` 一致）：

```xml
<jacoco-maven-plugin.version>0.8.11</jacoco-maven-plugin.version>
<maven-surefire-plugin.version>3.2.2</maven-surefire-plugin.version>
```

若项目已声明 `maven-surefire-plugin.version`，升级至 3.2.x 以更好支持 JUnit 5 与 `@{argLine}`。

### 步骤 2：BOM pluginManagement 合并插件

将 `docs/templates/maven-jacoco-surefire.xml` 中 **Surefire** 与 **JaCoCo** 两段 `<plugin>` 合并进 BOM 的 `<build><pluginManagement><plugins>`。

注意：若 BOM 已有 `maven-surefire-plugin` 条目，**替换 configuration** 而非重复声明。

### 步骤 3：聚合 POM 激活插件

在运行测试的聚合 POM（如 `broker-modules-biz/pom.xml`、`broker-orch/pom.xml`）的 `<build><plugins>` 中追加：

```xml
<plugin>
    <groupId>org.apache.maven.plugins</groupId>
    <artifactId>maven-surefire-plugin</artifactId>
</plugin>
<plugin>
    <groupId>org.jacoco</groupId>
    <artifactId>jacoco-maven-plugin</artifactId>
</plugin>
```

子模块继承父 POM 后会自动参与覆盖率统计。

### 步骤 4：验证

在已接入模块目录执行：

```bash
mvn clean verify -q
```

- 通过：控制台出现 `All coverage checks have met`
- 报告：`target/site/jacoco/index.html`
- 失败：根据 `[ERROR] Rule violated for bundle` 补测试或调整范围

## 存量项目过渡策略

全仓库一次性达到 78%/65% 通常不现实。推荐两阶段：

| 阶段 | 做法 | 命令 |
|---|---|---|
| **过渡期** | 仅启用 prepare-agent + report，暂不配置 check goal | `mvn test` |
| **门禁期** | 启用 check goal（本模板默认配置） | `mvn verify` |

过渡期可在 BOM 增加 profile `coverage-report-only`（仅 report、无 check），待模块覆盖率达标后再启用 check。

## 与 harness 门禁的关系

| harness 规则 | 行为 |
|---|---|
| `test-guard.mdc` | 已接入 JaCoCo check 时，变更 Java 代码须跑 `mvn verify` |
| `testing.mdc` | 定义覆盖率目标与测试编写规范 |
| `done-verify` | 收尾第二关检查测试通过与覆盖率门禁 |

## 常见问题

**Q: Surefire 报 `argLine` 冲突？**  
A: 确保 Surefire 使用 `@{argLine}`（带 `@`），JaCoCo prepare-agent 会注入该属性。

**Q: 多模块只改了其中一个，怎么测？**  
A: `mvn verify -pl broker-module-xxx-biz -am -q`

**Q: 能否只对 Service 包做 80% 门禁？**  
A: 可在 JaCoCo `<rules>` 中增加 `<element>PACKAGE</element>` 规则；全局 BUNDLE 门槛仍建议保留 78%/65%。
