# context-awareness 上下文感知

> **Skill 类型**: 系统插件  
> **版本**: 1.0.0  
> **优先级**: P4-5 (P1)  
> **维度**: D1-Identity  
> **创建时间**: 2026-05-12  
> **触发词**: 上下文、环境感知、项目检测、时间感知、context、awareness、当前环境

---

## 功能概述

四维上下文感知（环境/项目/时间/对话），动态行为策略调整，让Agent理解当前工作环境。

## 上下文维度

| 维度 | 检测内容 |
|------|---------|
| 环境 | OS、Shell、工作目录、Node版本、CPU/内存 |
| 项目 | 项目名、类型(node/python/web/rust)、Git状态 |
| 时间 | 时段(凌晨/上午/下午/晚上)、星期、是否周末 |
| 对话 | 会话轮次、任务类型、焦点领域 |

## 行为策略

| 场景 | 策略 |
|------|------|
| 深夜(22-6点) | 简洁回复、自动确认 |
| 长会话(>20轮) | 提示休息、上下文压缩 |
| 周末 | 轻松风格 |
| 新项目 | 探索模式 |

## 任务路由建议

| 时段 | 任务类型 | 推荐模型 |
|------|---------|---------|
| 深夜 | any | qwen2.5:1.5b (轻量) |
| 白天 | coding/analysis | qwen3:4b-opt (主力) |
| 白天 | simple | qwen2.5:1.5b (默认) |

## CLI命令

```bash
node context-awareness.js scan
node context-awareness.js summary
node context-awareness.js enrich "写一个排序函数"
node context-awareness.js strategy
node context-awareness.js suggest
node context-awareness.js route code_generation
```

## Node.js API

```javascript
const CA = require('context-awareness');
const ca = new CA();

// 全维扫描
const ctx = ca.scanAll();

// 丰富提示词
const enriched = ca.enrichPrompt('帮我写一个函数');

// 策略推荐
const strategy = ca.getRecommendedStrategy();
// { verbosity: 'concise', autoConfirm: true }
```

## 数据存储

```
~/.workbuddy/context-awareness/
└── snapshots/       # 上下文快照
```

## 版本历史

| 日期 | 版本 | 更新内容 |
|------|------|---------|
| 2026-05-12 | 1.0.0 | 初始版本 - 四维上下文感知 |
