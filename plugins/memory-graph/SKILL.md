# Memory Graph (D2 记忆层)

> WorkBuddy Agent 记忆关系图谱 - 九维架构 D2 层

## 核心功能

- **记忆去重**: 基于内容哈希和关键词重叠的智能去重
- **关系发现**: 自动发现记忆间的标签、关键词、类型关系
- **主动召回**: 基于上下文的相关记忆检索
- **图谱查询引擎**: 高级查询、路径分析、中心性计算
- **可视化**: Mermaid、D3.js、Graphviz、HTML 多格式支持

## 架构

```
MemoryGraph
├── nodes: Map<id, MemoryNode>
├── edges: Map<key, Edge>
├── queryCache: Map - 查询结果缓存
├── pathCache: Map - 路径查询缓存
└── stats - 使用统计
```

## 高级功能

### 图谱查询引擎

| 方法 | 功能 |
|------|------|
| `advancedQuery(query)` | 多条件组合查询 |
| `findPath(from, to)` | 两节点间最短路径 |
| `getReachable(nodeId)` | 查找可达节点 |
| `computeCentrality()` | 节点中心性分析 |

### 关系分析

| 方法 | 功能 |
|------|------|
| `analyzeInfluence(nodeId)` | 节点影响力分析 |
| `analyzeRelationships()` | 关系强度分析 |
| `findClusters()` | 发现记忆聚类 |

### 可视化

| 格式 | 用途 |
|------|------|
| `mermaid` | 文档/图表 |
| `d3` | D3.js 力导向图 |
| `graphviz` | Graphviz DOT |
| `html` | 交互式网页 |

## API

### addMemory(content, metadata)
注册新记忆，自动去重和关系发现

### recall(context, limit, options)
基于上下文召回相关记忆

### advancedQuery(query)
高级查询，支持类型/标签/重要性/年龄过滤

### findPath(sourceId, targetId)
查找两记忆间的关联路径

### computeCentrality(method)
计算节点重要性，识别核心记忆

### analyzeInfluence(nodeId)
分析节点在图谱中的影响力

### visualize(format, options)
生成多种格式的可视化

### visualizeHTML(options)
生成交互式 HTML 可视化页面

## 使用示例

```javascript
const MemoryGraph = require('./index.js');
const mg = new MemoryGraph();

// 注册记忆
mg.addMemory('用户偏好React框架', { type: 'preference', importance: 5 });
mg.addMemory('项目使用TypeScript', { type: 'technical', importance: 4 });

// 召回
const results = mg.recall('React TypeScript', 5);

// 高级查询
const query = mg.advancedQuery({
  types: ['technical', 'preference'],
  minImportance: 4,
  hasLinks: true
});

// 路径分析
const path = mg.findPath(nodeA, nodeB);

// 中心性分析
const centrality = mg.computeCentrality('degree');

// 可视化
const mermaid = mg.visualize('mermaid');
const html = mg.visualizeHTML({ fullscreen: true });
```

## CLI

```bash
node index.js demo          # 加载演示数据
node index.js add <content>  # 添加记忆
node index.js recall <query> # 召回
node index.js related <id>   # 关联节点
node index.js clusters       # 发现聚类
node index.js centrality     # 中心性分析
node index.js influence <id> # 影响力分析
node index.js path <from> <to> # 路径查找
node index.js query          # 高级查询
node index.js stats          # 统计
node index.js viz            # Mermaid可视化
node index.js html           # HTML可视化
```
