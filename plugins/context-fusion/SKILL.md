# Context Fusion (D6 融合层)

> WorkBuddy Agent 上下文融合系统 - 九维架构 D6 层

## 核心功能

- **多源上下文整合**: 融合 skill、memory、session 等多源信息
- **上下文优先级排序**: 基于重要性、时效性、相关性智能排序
- **跨会话上下文复用**: 历史会话知识提取与复用
- **上下文压缩**: 智能压缩冗余信息，保留核心

## 架构

```
ContextFusion
├── sources: Map<source, ContextSource>
├── priority: PriorityEngine
├── cache: ContextCache
└── fusion: FusionEngine
```

## 上下文来源

| 来源 | 优先级 | 说明 |
|------|--------|------|
| system | 100 | 系统级上下文（不可覆盖） |
| skill | 80 | 当前激活 Skill 的上下文 |
| memory | 60 | 长期记忆提取 |
| session | 40 | 当前会话历史 |
| recent | 20 | 最近对话片段 |

## API

### fuse(contexts, options)
融合多个上下文来源

### prioritize(contexts)
对上下文按优先级排序

### compress(context, budget)
压缩上下文到指定 Token 预算

### extractFromHistory(sessionId)
从历史会话提取相关上下文

### getContextSummary()
获取当前上下文摘要

## 使用示例

```javascript
const ContextFusion = require('./index.js');
const cf = new ContextFusion();

// 初始化
await cf.init();

// 融合多源上下文
const fused = await cf.fuse([
  { source: 'system', content: '你是一个AI助手', priority: 100 },
  { source: 'skill', content: '当前执行代码审查', priority: 80 },
  { source: 'memory', content: '用户偏好Python', priority: 60 },
  { source: 'session', content: '正在审查登录模块', priority: 40 }
], { budget: 4000 });

// 压缩上下文
const compressed = await cf.compress(fused, { budget: 2000 });
```

## 融合策略

### 1. 优先级覆盖
高优先级内容覆盖低优先级冲突内容

### 2. 时效性加权
近期内容获得更高权重

### 3. 相关性匹配
基于当前任务相关性动态调整权重

### 4. 去重合并
合并重复内容，保留最新版本
