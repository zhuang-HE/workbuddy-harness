# memory-graph 记忆关系图谱

> **版本**: 1.0.0 | **优先级**: P4-10 (P2) | **维度**: D2-Memory  
> **触发词**: 记忆图谱、记忆去重、关系发现、主动召回、memory graph

## 功能
在 memory-decay 衰减管理基础上，增加记忆去重、关系图谱、主动召回三大能力。

- **智能去重**: 内容哈希 + 关键词重叠(>60%)自动合并
- **关系发现**: tag_overlap/keyword_overlap/same_type 三种边类型
- **主动召回**: 关键词匹配(50%)+重要性(20%)+时间衰减(15%)+关联记忆(15%)
- **聚类分析**: 连通分量发现知识簇

## CLI
```bash
node memory-graph.js demo           # 加载示例数据
node memory-graph.js add "内容"      # 添加(自动去重)
node memory-graph.js recall "查询"   # 主动召回
node memory-graph.js clusters       # 聚类分析
node memory-graph.js stats          # 图谱统计
node memory-graph.js viz            # Mermaid可视化
```
