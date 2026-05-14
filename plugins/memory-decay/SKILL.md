# memory-decay 记忆衰减管理

> **Skill 类型**: 系统插件
> **版本**: 1.1.0 (四层压缩增强)
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

## 四层压缩系统 v2 (P1增强)
| 层级 | 功能 | 关键参数 |
|------|------|---------|
| L1 滑动窗口 | 保留最近N轮对话 | windowSize=20 |
| L2 分层摘要 | 旧内容压缩为摘要 | groupSize=10 |
| L3 重要性评分 | 基于衰减+类型打分 | threshold=2 |
| L4 Token预算 | 严格控制总Token | maxTokens=8000 |

## CLI命令
```bash
node memory-decay.js add "用户偏好TypeScript"
node memory-decay.js compress
node memory-decay.js compress4layer   # 四层压缩测试
node memory-decay.js weights
node memory-decay.js curve
node memory-decay.js report
node memory-decay.js model exponential
```

## 版本历史
| 2026-05-12 | 1.0.0 | 初始版本：3种衰减模型、6级重要性、3种压缩策略 |
| 2026-05-14 | 1.1.0 | 新增四层压缩系统：滑动窗口+分层摘要+重要性评分+Token预算 |
