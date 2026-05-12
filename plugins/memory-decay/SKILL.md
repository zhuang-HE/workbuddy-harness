# memory-decay 记忆衰减管理

> **Skill 类型**: 系统插件  
> **版本**: 1.0.0  
> **优先级**: P4-6 (P1)  
> **维度**: D2-Memory  
> **创建时间**: 2026-05-12  
> **触发词**: 记忆衰减、上下文压缩、遗忘曲线、token压缩、memory decay、compression

## 功能概述
管理长对话中的信息衰减，基于重要性分类实现智能压缩，解决长期会话上下文膨胀问题。

## 衰减模型
| 模型 | 公式 | 特点 |
|------|------|------|
| exponential | w × e^(-rate × age) | 前期快速衰减，后期平缓 |
| linear | w × (1 - rate × age) | 线性递减 |
| step | 阶梯式 (10/30/60轮) | 阶段性衰减 |

## 重要性分类
| 类型 | 初始权重 | 衰减速度 |
|------|---------|---------|
| 用户偏好 | 1.0 | 极慢 |
| 技术决策 | 0.95 | 慢 |
| 任务状态 | 0.85 | 中 |
| 代码片段 | 0.75 | 中 |
| 对话细节 | 0.5 | 快 |
| 闲聊 | 0.3 | 极快 |

## 压缩策略
- importance: 优先保留高权重消息
- recency: 优先保留最近消息  
- hybrid: 权重和时效混合排序

## CLI命令
```bash
node memory-decay.js add "用户偏好TypeScript"
node memory-decay.js compress
node memory-decay.js weights
node memory-decay.js curve
node memory-decay.js report
node memory-decay.js model exponential
```

## 版本历史
| 2026-05-12 | 1.0.0 | 初始版本：3种衰减模型、6级重要性、3种压缩策略 |
