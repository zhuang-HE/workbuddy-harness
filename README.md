# WorkBuddy Harness

> 🏗️ AI Agent 九维基础设施框架 — 成熟度 93%

## 简介

**WorkBuddy Harness** 是一套为 AI Agent 设计的系统化基础设施框架。它将 Agent 的能力体系拆解为 **9 个架构维度**，每个维度配备专用插件，形成从身份认知、记忆管理、任务调度到安全防护、评测反馈、多Agent协作的完整闭环。

在传统 AI Agent 开发中，工程师往往将注意力集中在「让模型变聪明」上，而忽略了 Agent 作为一个持续运行的软件系统所需的工程化支撑。本项目的核心洞察是：**Agent 的能力上限不取决于模型本身，而取决于它的基础设施（Harness）有多完善。**

本项目在已有 WorkBuddy 系统的基础上，将 9 个维度的成熟度从 **55% 提升至 93%**，新增了 **11 个核心插件**、**21 个自动化 Hooks**、**30 条基准评测用例**，以及一套实时健康仪表板。

---

## 核心理念：为什么要做 Harness？

### 问题：AI Agent 的"木桶效应"

一个 AI Agent 的能力不是由最强维度决定的，而是由最弱维度决定的。以下场景你一定熟悉：

| 现象 | 根因维度 | 缺失能力 |
|------|---------|---------|
| Agent 每次都像"失忆"一样从头开始 | D2 记忆层 | 缺乏持久化记忆与衰减管理 |
| 复杂任务执行到一半就乱掉 | D5 调度层 | 缺乏任务分解与依赖管理 |
| 不知道 Agent 到底做得好不好 | D8 评测层 | 缺乏量化评测体系 |
| 危险命令被直接执行 | D7 安全层 | 缺乏运行时安全守护 |
| 多个 Agent 互相踩脚 | D9 协作层 | 缺乏多Agent编排 |
| 会话越长越"笨" | D2 记忆层 | 缺乏上下文衰减压缩 |
| 学了经验但下次用不上 | D4 学习层 | 缺乏自动学习闭环 |

### 解法：九维一体，缺一不可

WorkBuddy Harness 将 Agent 工程化需求归纳为 9 个维度，并为每个维度提供即插即用的插件：

```
        D1 身份层 (Identity)
             ↓
        D2 记忆层 (Memory)
             ↓
   ┌─────────────────────────┐
   │  D3 Skill层 · D4 学习层  │
   │  D5 调度层 · D6 融合层  │
   │  D7 安全层 · D8 评测层  │
   │  D9 多Agent协作层       │
   └─────────────────────────┘
```

---

## 架构全景

```
┌──────────────────────────────────────────────────────────────────┐
│                     WorkBuddy Harness v3.1                         │
│                     九维 AI Agent 基础设施                          │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│  D1 身份层 ──── context-awareness (90%)                           │
│  D2 记忆层 ──── memory-decay (93%)                                │
│  D3 技能层 ──── 53+ Skills + 语义路由 + 触发词自进化 (93%)        │
│  D4 学习层 ──── learning-loop (90%)                               │
│  D5 调度层 ──── task-orchestrator (88%)                          │
│  D6 融合层 ──── fusion-router + fusion-sync-enhancer (85%)       │
│  D7 安全层 ──── runtime-guardian (85%)                            │
│  D8 评测层 ──── eval-framework (85%)                              │
│  D9 协作层 ──── multi-agent-orchestrator (85%)                    │
│                                                                   │
│  ═══════════════════════════════════════════════════════════════  │
│  11 插件 · 21 Hooks · 30 基准用例 · 8 团队模板 · 实时仪表板       │
└──────────────────────────────────────────────────────────────────┘
```

---

## 快速开始

### 环境要求

- Node.js ≥ 18
- WorkBuddy Code 运行环境

### 安装 Harness 插件

```bash
# 克隆仓库
git clone https://github.com/zhuang-HE/workbuddy-harness.git
cd workbuddy-harness

# 安装插件到 WorkBuddy
cp -r plugins/* ~/.workbuddy/plugins/

# 应用 Hooks 配置
cp hooks/hooks.json ~/.workbuddy/hooks/

# 加载基准评测数据
cp benchmarks/agent-benchmark-v1.json ~/.workbuddy/eval-framework/datasets/
```

### 验证

```bash
# 运行全部插件测试
cd ~/.workbuddy/plugins
for p in task-orchestrator eval-framework multi-agent-orchestrator \
         runtime-guardian context-awareness memory-decay \
         fusion-sync-enhancer learning-loop fusion-router; do
  node test-framework/index.js run $p
done
```

---

## 插件清单

| 编号 | 插件 | 维度 | 核心能力 |
|------|------|------|---------|
| P4-1 | `task-orchestrator` | D5 调度 | 目标分解·DAG依赖·WorkerPool·指数退避重试 |
| P4-2 | `eval-framework` | D8 评测 | 五维评测·RuntimeEvalTracker·回归检测 |
| P4-3 | `multi-agent-orchestrator` | D9 协作 | 8团队模板·5角色·IPC进程 |
| P4-4 | `runtime-guardian` | D7 安全 | 12危险模式·三模式(observe/enforce/adaptive) |
| P4-5 | `context-awareness` | D1 身份 | 四维感知·动态策略·深夜简洁模式 |
| P4-6 | `memory-decay` | D2 记忆 | 指数衰减·五级重要性·自适应压缩 |
| P4-7 | `fusion-sync-enhancer` | D6 融合 | 双向增量同步·5种冲突策略 |
| P4-8 | `learning-loop` | D4 学习 | O→A→L→E→A闭环·本能进化 |
| P4-9 | `fusion-router` | D6 融合 | 11领域规则·智能分发 |
| P4-10 | `memory-graph` | D2 记忆 | 智能去重·关系图谱 |
| P4-11 | `skill-analyzer` | D3 技能 | 质量评分·依赖DAG·死技能标记 |

---

## 案例演示：一个任务的完整生命周期

以真实任务 `"分析贵州茅台走势，生成PPT报告"` 为例，展示 Harness 所有维度如何协同运作：

```
用户输入: "分析贵州茅台走势，生成PPT报告"


═══ D1 身份层 ═══
context-awareness 启动：
  ✓ 扫描环境 → Windows + Git Bash + Node.js项目
  ✓ 扫描时间 → 工作日下午，正常模式
  → 推荐Skills：stock-analyst, pptx


═══ D6 融合层 ═══
fusion-router 分析：
  ✓ "分析"+"股票"+"走势" → 量化金融，路由到 WorkBuddy
  ✓ "生成"+"PPT"+"报告" → 文档处理，路由到 WorkBuddy
  → 决策：WORKBUDDY (confidence: 72%)


═══ D5 调度层 ═══
task-orchestrator 分解：
  ✓ 复杂度评估：7/10
  ✓ 任务分解：
      Task1: 获取茅台股票数据       (依赖: 无)
      Task2: 技术分析(K线/MACD/RSI) (依赖: Task1)
      Task3: 生成分析结论            (依赖: Task2)
      Task4: 制作PPT报告             (依赖: Task3)
  → WorkerPool调度(priority=7) + RetryManager就绪(3次指数退避)


═══ D7 安全层 ═══
runtime-guardian 逐个检查：
  ✓ Bash "python get_stock.py" → 12模式扫描 → 安全 ✅
  ✓ Write "report.pptx"         → 路径黑名单检查 → 安全 ✅
  → 模式: observe (仅记录)


═══ D8 评测层 ═══
eval-framework 启动追踪：
  ✓ RuntimeEvalTracker 开始记录会话
  → 记录：任务数/工具调用/错误/安全事件


═══ D3 技能层 ═══
skill-semantic-router 匹配：
  ✓ "贵州茅台走势" → stock-analyst (置信度 0.92)
  ✓ "生成PPT报告"  → pptx (置信度 0.88)
skill-analyzer 后台：
  → stock-analyst +1, pptx +1


═══ 执行阶段 ═══
  Task1 → Tushare API 获取茅台日K线          (1次调用·成功)
  Task2 → 计算MACD/RSI/均线·识别买卖信号      (3次调用·成功)
  Task3 → 整理分析结果                        (1次调用·成功)
  Task4 → 生成带图表PPT报告                    (2次调用·成功)


═══ D2 记忆层 ═══
memory-decay + memory-graph：
  ✓ 注册记忆："用户关注贵州茅台"(HIGH)
  ✓ 注册记忆："Tushare获取股票数据"(HIGH)
  ✓ 去重检查 → 无重复
  ✓ 关系发现 → 茅台↔股票分析↔K线(tag_overlap)


═══ D4 学习层 ═══
learning-loop 五阶段闭环：
  OBSERVE → 任务=quant_analysis, 成功=True, 复杂度=7
  ANALYZE → 识别模式 "Read→Bash→Write = 量化分析"
  LEARN   → Reward=0.8 (成功+高复杂度)
  EVOLVE  → 创建Instinct "量化分析推荐工具链"
  APPLY   → 建议"下次类似任务用相同工具组合"


═══ 收尾 ═══
fusion-sync-enhancer → 增量同步 (0冲突)
eval-framework 汇总：
  ┌─────────────────────────────────┐
  │ 任务完成率:        100% (4/4)   │
  │ 工具调用:          7次            │
  │ 错误数:            0             │
  │ 综合评分:  93/100 (A级)        │
  │                                 │
  │ vs 基线(qwen3:4b): 93 vs 75    │
  │ 回归检测:          无退化 ✅     │
  └─────────────────────────────────┘


═══ 9维度参与总览 ═══
  D1 context-awareness         扫描环境·推荐技能
  D2 memory-decay+memory-graph 记忆·去重·关系图谱
  D3 skill-router+analyzer     技能匹配·使用统计
  D4 learning-loop             五阶段闭环·创建本能
  D5 task-orchestrator         分解·调度·重试
  D6 fusion-router+sync        路由·同步
  D7 runtime-guardian          安全扫描
  D8 eval-framework            全程追踪·评测·回归
  D9 multi-agent-orchestrator  未触发(复杂度<8)
```

> 💡 **核心洞察**：同一个任务被 11 个插件从 9 个维度同时关照——环境感知→安全防护→任务分解→评测反馈→记忆沉淀→自我进化。这不是单个模型的"裸奔执行"，而是一套完整的工程化基础设施在背后运转。

---

## 项目结构

```
workbuddy-harness/
├── plugins/                            # 11 个核心插件
│   ├── task-orchestrator/              # D5: 任务编排调度
│   ├── eval-framework/                 # D8: 评测框架
│   ├── multi-agent-orchestrator/       # D9: 多Agent协作
│   ├── runtime-guardian/               # D7: 运行时安全
│   ├── context-awareness/              # D1: 上下文感知
│   ├── memory-decay/                   # D2: 记忆衰减管理
│   ├── fusion-sync-enhancer/           # D6: 融合同步增强
│   ├── learning-loop/                 # D4: 学习闭环
│   ├── fusion-router/                 # D6: 融合智能路由
│   ├── memory-graph/                   # D2: 关系图谱
│   └── skill-analyzer/                # D3: 技能分析
├── hooks/
│   └── hooks.json                      # 21 个自动化 Hooks
├── dashboard/
│   └── harness-dashboard.html          # 实时健康仪表板
├── benchmarks/
│   └── agent-benchmark-v1.json         # 5 套件 × 30 用例
└── *.md                                # 实施报告
```

---

## 设计原则

1. **文件系统即记忆** — Agent 记忆独立于模型上下文持久化，跨会话不丢失
2. **置信度评分量化** — 经验不再是模糊的"感觉"，而是 0-100 的可计算指标
3. **触发词自进化** — Skills 自动学习用户表达习惯，无需记忆命令
4. **多系统深度融合** — WorkBuddy + 其他系统三位一体
5. **分层架构清晰** — Identity → Skills → Memory → Automation，职责分明
6. **持续审计防退化** — 每周自动化健康检查，防止系统膨胀和性能衰减

---

## 贡献指南

所有插件遵循统一规范：

```
plugin-name/
├── index.js    # CommonJS 模块，导出主类
├── SKILL.md    # 中文文档，YAML frontmatter 元数据
└── test.js     # 测试用例，供内置 test-framework 运行
```

提交 PR 前请确保：
- `node test-framework/index.js run <plugin-name>` 全部通过
- `SKILL.md` 包含完整的 CLI 命令和 API 文档
- 代码遵循现有风格（CommonJS，无外部依赖）

---

## 许可证

MIT © 2026 WorkBuddy

---

*由 CodeBuddy Code (AI Engineer) 构建 · 2026 年 5 月 12 日*
