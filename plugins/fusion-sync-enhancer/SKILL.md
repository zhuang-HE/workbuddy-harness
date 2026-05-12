# fusion-sync-enhancer 融合同步增强器

> **Skill 类型**: 系统插件  
> **版本**: 1.0.0  
> **优先级**: P4-7 (P2)  
> **维度**: D6-Integration  
> **创建时间**: 2026-05-12  
> **触发词**: 融合、同步、冲突、增量同步、fusion、sync、bidirectional

---

## 功能概述

增强 Hermes-WorkBuddy 双系统融合的同步能力，支持增量同步、冲突智能解决、健康监控。

## 核心功能

| 功能 | 说明 |
|------|------|
| 增量同步 | 基于文件哈希差量检测，仅同步变更 |
| 冲突解决 | 5种策略: wb_wins/hm_wins/newest/merge/manual |
| 健康监控 | 同步延迟、冲突数、目录完整性 |
| 上下文同步 | 集成 context-awareness 同步到 HM prefill |
| Skill同步 | 跨系统 Skill 自动同步 |
| 报告生成 | Markdown格式健康报告 |

## 同步方向

| 方向 | 内容 |
|------|------|
| wb→hm | WorkBuddy记忆 → HERMES memories/ |
| hm→wb | HERMES evolution → WorkBuddy memory/ |
| both | 双向全量同步 |

## CLI命令

```bash
# 增量同步
node fusion-sync-enhancer.js sync --direction both
node fusion-sync-enhancer.js sync --dry-run

# 差异检测
node fusion-sync-enhancer.js diff --direction wb→hm

# 健康检查
node fusion-sync-enhancer.js health

# 冲突解决
node fusion-sync-enhancer.js conflicts resolve --strategy newest

# 报告
node fusion-sync-enhancer.js report

# 上下文同步
node fusion-sync-enhancer.js context-sync

# Skill同步
node fusion-sync-enhancer.js skill-sync
```

## 冲突解决策略

| 策略 | 说明 |
|------|------|
| wb_wins | WorkBuddy版本优先 |
| hermes_wins | HERMES版本优先 |
| newest | 最新修改时间优先 (默认) |
| merge | 合并双方内容 |
| manual | 手动解决 |

## 数据存储

```
~/.workbuddy/fusion-sync-enhancer/
├── state/sync-state.json    # 同步状态
├── diffs/                    # 差异记录
└── reports/                  # 同步报告
```

## 版本历史

| 日期 | 版本 | 更新内容 |
|------|------|---------|
| 2026-05-12 | 1.0.0 | 初始版本 - 增量同步+冲突解决+健康监控 |
