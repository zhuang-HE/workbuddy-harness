# Skill Analyzer (D3 技能层)

> WorkBuddy Agent 技能分析器 - 九维架构 D3 层

## 核心功能

- **技能扫描**: 自动发现和分析 Skills 目录下的所有 Skill
- **质量评分**: 多维度质量评估 (A/B/C/D 级)
- **使用热力图**: 追踪 Skill 使用频率和成功率
- **依赖分析**: 构建 Skill 依赖图谱，检测循环依赖
- **死技能检测**: 识别长期未使用的 Skill
- **语义路由**: 基于自然语言的 Skill 智能推荐
- **触发词进化**: 自动分析并建议触发词优化

## 语义路由

### 路由算法

| 匹配维度 | 权重 | 说明 |
|----------|------|------|
| 触发词匹配 | 40% | 精确匹配触发词 |
| 关键词匹配 | 30% | 技能关键词与查询匹配 |
| 描述匹配 | 20% | 技能描述与查询匹配 |
| 使用频率 | 10% | 近期使用加成 |

### 匹配类型

| 类型 | 阈值 | 置信度 |
|------|------|--------|
| exact | ≥0.8 | high |
| strong | ≥0.6 | high |
| partial | ≥0.4 | medium |
| weak | ≥0.3 | low |

## API

### scan(force)
扫描 Skills 目录，构建 Skill 索引

### route(query, options)
语义路由，推荐最匹配的 Skill

### recordUsage(skillId, context)
记录 Skill 使用情况

### scoreSkills()
质量评分

### findDeadSkills(days)
查找死技能

### getDependencyTree(skillId)
获取依赖树

### findCircularDeps()
检测循环依赖

### suggestTriggerEvolution(skillId)
建议触发词进化

### applyTriggerEvolution(skillId, changes)
应用触发词变更

### generateReport()
生成分析报告

## 使用示例

```javascript
const SkillAnalyzer = require('./index.js');
const sa = new SkillAnalyzer();

// 扫描技能
sa.scan();

// 语义路由
const results = sa.route('帮我审查代码安全问题');
console.log(results);
// [
//   { skillId: 'code-review', name: '代码审查', score: 0.85, confidence: 'high' },
//   { skillId: 'security-scan', name: '安全扫描', score: 0.72, confidence: 'medium' }
// ]

// 批量路由
const batch = sa.routeBatch(['代码审查', '性能分析', '写PPT']);

// 触发词进化
const suggestion = sa.suggestTriggerEvolution('code-review');
if (suggestion) {
  sa.applyTriggerEvolution('code-review', suggestion.suggestions);
}

// 生成报告
const report = sa.generateReport();
```

## CLI

```bash
node index.js scan              # 扫描技能
node index.js route <query>    # 路由查询
node index.js score             # 质量评分
node index.js dead             # 死技能
node index.js stats            # 路由统计
node index.js report           # 生成报告
```
