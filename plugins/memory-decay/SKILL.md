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
| 2026-05-17 | 1.2.0 | 导出衰减算法 API，供 memory-consolidation 等外部 Skill 复用 |

## 衰减算法 API (v1.2.0)

本插件导出的核心算法可供其他 Skill 通过 `require()` 复用：

### calculateDecay(importance, halfLifeHours, elapsedHours)
计算指定记忆的衰减后重要性。

**参数**:
- `importance` (Number): 初始重要性 (1-5)
- `halfLifeHours` (Number): 半衰期（小时），如 CRITICAL=Infinity, HIGH=720, MEDIUM=168, LOW=48, TRANSIENT=12
- `elapsedHours` (Number): 已过时间（小时）

**返回**:
```javascript
{
  currentImportance: Number,    // 衰减后重要性
  percentRetained: Number,      // 保留百分比 (0-100)
  willBeForgotten: Boolean,     // 是否将被遗忘 (currentImportance < 0.3)
  level: String                 // CRITICAL|HIGH|MEDIUM|LOW|TRANSIENT
}
```

**公式**: `currentImportance = importance × e^(-ln(2) × elapsedHours / halfLifeHours)`

**示例**:
```javascript
const MemoryDecay = require('./plugins/memory-decay/index.js');
const md = new MemoryDecay();

// 计算一条 MEDIUM(3) 重要性、半衰期168小时的记忆在48小时后的衰减
const decay = md.calculateDecay('mem_001');
// => { currentImportance: 2.46, percentRetained: 82, willBeForgotten: false, level: 'MEDIUM' }
```

### fourLayerCompression(memories, options)
四层压缩引擎，控制内存 Token 预算。

**参数**:
- `memories` (Array): 记忆对象数组 `[{content, importance, turnsAgo, ...}]`
- `options` (Object):
  - `maxTokens` (Number): 最大 Token 预算，默认 8000
  - `windowSize` (Number): L1 滑动窗口大小，默认 20
  - `summaryThreshold` (Number): L2 摘要阈值，默认 30
  - `importanceThreshold` (Number): L3 重要性阈值，默认 2
  - `preserveRecent` (Number): 最近保留条数，默认 10

**返回**: `{ kept: [...], compressed: [...], stats: { totalTokens, usedTokens, freedTokens } }`

### classifyImportance(content, type)
根据内容类型自动分类重要性。

**内容类型权重**:
| 类型 | 权重 | 重要性 |
|------|------|--------|
| `user_preference` | 1.0 | HIGH (4) |
| `technical_decision` | 0.95 | HIGH (4) |
| `project_convention` | 0.90 | MEDIUM (3) |
| `task_state` | 0.80 | MEDIUM (3) |
| `conversation_detail` | 0.50 | LOW (2) |
| `casual_chat` | 0.20 | TRANSIENT (1) |

