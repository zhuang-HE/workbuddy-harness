# skill-analyzer 技能分析器

> **版本**: 1.1.0 | **优先级**: P4-11 (P2) | **维度**: D3-Skills
> **触发词**: 技能分析、质量评分、依赖图、死技能、skill analyzer、语义搜索、向量索引

WorkBuddy插件系统技能分析器，提供**质量评分**、**依赖图谱**、**使用热力图**、**死技能检测**和**动态向量索引**五大核心能力。

## 核心功能

| 模块 | 功能 | 说明 |
|------|------|------|
| **质量评分** | 0-100分综合评分 | 触发词+描述+版本+文档+脚本+复杂度+时效 |
| **依赖图谱** | DAG构建+循环检测 | 解析SKILL.md references字段 |
| **使用热力图** | hot/warm/cold/dead | 基于60天使用记录 |
| **死技能检测** | 60天未使用标记 | 建议清理或优化 |
| **向量索引** | 语义搜索+混合匹配 | Ollama本地嵌入，1536d向量 |

## v1.1 动态向量索引（对标OpenHarness）

### 功能特性

| 功能 | 说明 |
|------|------|
| **向量嵌入** | Ollama本地计算，使用`nomic-embed-text`模型 |
| **语义搜索** | 基于余弦相似度，理解语义上下文 |
| **混合匹配** | 关键词(30%) + 向量(70%) 综合评分 |
| **热更新** | 增量更新向量索引，无需全量重建 |

### 技术规格

- **嵌入模型**: `nomic-embed-text` (Ollama本地)
- **向量维度**: 1536d
- **相似度算法**: 余弦相似度
- **阈值设置**: 可配置（默认0.5）

### 对比升级

| 维度 | v1.0 (之前) | v1.1 (现在) |
|------|-----------|--------------|
| 匹配方式 | 关键词匹配 | 关键词+向量语义 |
| 准确性 | 依赖触发词精确 | 理解语义上下文 |
| OpenHarness对齐 | ❌ | ✅ |

## 安装

```bash
# 克隆仓库
git clone https://github.com/zhuang-HE/workbuddy-harness.git
cd workbuddy-harness/plugins/skill-analyzer

# 确保Ollama运行中
ollama serve

# 拉取嵌入模型
ollama pull nomic-embed-text
```

## CLI 命令

### 基础命令

```bash
# 扫描技能目录
node index.js scan

# 质量评分排序
node index.js score

# 死技能列表
node index.js dead

# 依赖关系
node index.js deps [skillId]

# 循环依赖检测
node index.js cycles

# 完整分析报告
node index.js report
```

### v1.1 向量索引命令

```bash
# 构建向量索引
node index.js vector:build

# 语义搜索
node index.js vector:search "分析股票数据"

# 混合搜索（关键词+向量）
node index.js hybrid:search "帮我写代码审查"
```

## API 使用

### 基础用法

```javascript
const SkillAnalyzer = require('./index.js');
const sa = new SkillAnalyzer();

// 扫描技能
sa.scan();
console.log(`Found ${sa.skills.length} skills`);

// 质量评分
const scores = sa.scoreSkills();
console.log('Top 5:', scores.slice(0, 5));

// 死技能检测
const dead = sa.findDeadSkills();
console.log('Dead skills:', dead);

// 依赖循环检测
const cycles = sa.findCircularDeps();
if (cycles.length > 0) console.log('⚠️ Circular deps:', cycles);
```

### v1.1 向量搜索

```javascript
// 构建向量索引
await sa.buildVectorIndex();
// 输出: [VectorIndex] Building index for 29 skills...

// 语义搜索
const result = await sa.semanticMatch('分析股票走势', { topK: 5, threshold: 0.5 });
// 返回: { success: true, results: [{ skillId, name, similarity, matchType }] }

// 混合搜索
const hybrid = await sa.hybridMatch('帮我写代码审查', { topK: 5 });
// 返回: { success: true, results: [{ keywordScore, vectorScore, combinedScore, matchSources }] }

// 增量更新
await sa.updateVectorIndex(['skill-id-1', 'skill-id-2']);
```

### 响应格式

**semanticMatch 响应**
```json
{
  "success": true,
  "query": "分析股票数据",
  "totalMatches": 3,
  "results": [
    {
      "skillId": "stock-analyst",
      "name": "stock-analyst",
      "description": "股票技术面分析...",
      "triggers": ["K线形态", "缠论", "买卖点"],
      "similarity": 0.87,
      "matchType": "exact"
    }
  ]
}
```

**hybridMatch 响应**
```json
{
  "success": true,
  "query": "帮我写代码审查",
  "totalCandidates": 29,
  "results": [
    {
      "skillId": "code-review",
      "name": "code-review",
      "keywordScore": 0.8,
      "vectorScore": 0.72,
      "combinedScore": 0.74,
      "matchSources": ["keyword", "vector"]
    }
  ]
}
```

## 质量评分体系

### 评分维度（满分100）

| 维度 | 最高分 | 说明 |
|------|--------|------|
| 触发词 | +20 | 触发词数量（>5额外+5） |
| 描述 | +10 | description长度>20 |
| 版本 | +5 | 非0.0.0版本号 |
| 参考文档 | +8 | references目录存在 |
| 脚本 | +5 | scripts目录存在 |
| 文件大小 | +7 | 2-30KB正常，过小扣分 |
| 复杂度 | +5 | complexity字段存在 |
| 更新时效 | +5/-10 | 30天内+5，180天外-10 |

### 等级划分

| 等级 | 分数范围 | 建议 |
|------|----------|------|
| A | 90-100 | 优秀，保持 |
| B | 75-89 | 良好，可优化 |
| C | 60-74 | 及格，需改进 |
| D | 0-59 | 不及格，建议重写 |

## 目录结构

```
skill-analyzer/
├── index.js      # 主模块（CommonJS类导出）
├── SKILL.md      # Skill定义文档
└── README.md     # 本文件
```

## 配置

```javascript
const sa = new SkillAnalyzer({
  configDir: '~/.workbuddy/skill-analyzer',  // 配置目录
  skillsDir: '~/.workbuddy/skills'            // 技能目录
});
```

### 缓存文件

- `state.json` - 使用记录和依赖关系
- `vector-index.json` - 向量索引缓存

## 版本历史

| 日期 | 版本 | 变更 |
|------|------|------|
| 2026-05-14 | 1.1.0 | **新增动态向量索引**: embedText/semanticMatch/hybridMatch/updateVectorIndex |
| 2026-05-12 | 1.0.0 | 初始版本: 质量评分、依赖图谱、热力图、死技能检测 |

## License

MIT
