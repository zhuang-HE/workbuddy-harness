# WorkBuddy Harness v2.0

> Agent 九维基础设施框架 — 从设计蓝图到可运行引擎

[![Version](https://img.shields.io/badge/version-2.0.0-blue)](https://github.com/zhuang-HE/workbuddy-harness)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-brightgreen)](https://nodejs.org)

## 简介

**WorkBuddy Harness** 是一套为 AI Agent 设计的系统化基础设施框架。它将 Agent 的能力体系拆解为 **9 个架构维度**，每个维度配备专用插件，形成从身份认知、记忆管理、任务调度到安全防护、评测反馈、多 Agent 协作的完整闭环。

**v2.0 重大更新**：新增 `engine/` 运行时基础设施，实现真实的 Hook Runner 引擎、Eval Runner 评测执行器和 Runtime Guardian v2.0（Windows 覆盖）。

---

## 架构全景

```
┌──────────────────────────────────────────────────────────────────┐
│                   WorkBuddy Harness v2.0                          │
│              九维 AI Agent 基础设施 + Engine Runtime              │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│  D1 身份层 ──── context-awareness (60%)                           │
│  │  环境感知·项目检测·时间感知·动态策略调整                          │
│  │                                                                │
│  D2 记忆层 ──── memory-decay + memory-git + memory-graph (70%)    │
│  │  指数衰减·四层压缩·Git版本控制·关系图谱·智能去重                  │
│  │                                                                │
│  D3 技能层 ──── skill-analyzer (50%)                              │
│  │  技能质量评分·依赖DAG·循环检测·热力图                            │
│  │                                                                │
│  D4 学习层 ──── learning-loop (55%)                               │
│  │  O→A→L→E→A五阶段闭环·本能导出                                  │
│  │                                                                │
│  D5 调度层 ──── task-orchestrator (60%)                           │
│  │  目标分解·DAG依赖图·WorkerPool·PriorityQueue·指数退避重试        │
│  │                                                                │
│  D6 融合层 ──── fusion-router + fusion-sync-enhancer (45%)        │
│  │  11领域智能路由·双向增量同步·冲突策略                            │
│  │                                                                │
│  D7 安全层 ──── runtime-guardian v2.0 (35%)                       │
│  │  42种危险模式(Win+Unix)·持久化告警·三模式·增强异常检测            │
│  │                                                                │
│  D8 评测层 ──── eval-framework + eval-runner (65%)                │
│  │  五维评测·30基准用例·A/B对比·回归检测·持久化结果                │
│  │                                                                │
│  D9 协作层 ──── multi-agent-orchestrator (50%)                    │
│  │  三省六部·10团队模板·9角色·能力矩阵匹配                          │
│  │                                                                │
│  ═══════════════════════════════════════════════════════════════  │
│  Engine: HookRunner + EvalRunner + Daemon + Guardian v2.0         │
└──────────────────────────────────────────────────────────────────┘
```

> **注意**: 以上成熟度评分基于 v2.0 深度代码审查后的真实评估。原版声称 97% 包含大量未集成模块和模拟逻辑。

---

## v2.0 新增：Engine 运行时基础设施

v2.0 最大的变化是新增了 `engine/` 目录，解决了原版最大的痛点：**hooks.json 没有执行引擎**。

### Engine 模块

| 模块 | 行数 | 功能 |
|------|------|------|
| `engine/hook-runner.js` | ~420 | 事件驱动 Hook 引擎，支持 CLI 触发 + daemon 模式，条件评估，模板变量替换 |
| `engine/eval-runner.js` | ~380 | 真实评测执行器，读取 30 条基准用例，autoScore 打分，持久化结果 |
| `engine/daemon.js` | ~200 | 文件监听守护进程，自动将 WorkBuddy 目录变化映射为 Hook 事件 |
| `engine/utils.js` | ~180 | 共享工具：ConfigManager、TemplateResolver、Logger、ExecutionHistory |
| `engine/index.js` | ~120 | 统一 CLI 入口：`harness hook/eval/daemon/guardian/health` |

### 统一 CLI

```bash
# Hook 引擎
node engine/index.js hook trigger session_start session_id=test
node engine/index.js hook list

# Eval 引擎
node engine/index.js eval run all          # 运行全部 30 条基准用例
node engine/index.js eval report            # 生成评测报告

# 安全扫描
node engine/index.js guardian scan "rm -rf /"    # Unix
node engine/index.js guardian scan "format C:"   # Windows

# 健康报告
node engine/index.js health

# Daemon 模式
node engine/index.js daemon start
```

---

## Runtime Guardian v2.0

从 272 行重写至 ~500 行，核心改进：

| 改进项 | v1.1 | v2.0 |
|--------|------|------|
| 危险模式 | 29 (Unix only) | **42** (Unix 29 + Windows 13) |
| Windows 覆盖 | 无 | format, diskpart, del /F /S, rd /S /Q, reg delete, taskkill, Set-ExecutionPolicy, icacls, net user /add, Remove-Item |
| 告警存储 | 内存 | **JSON 持久化** (alerts-store.json) |
| 异常检测 | 2 维 (频率+错误率) | **5 维** (频率+错误率+拦截率+工具多样性+模式偏离) |
| 路径黑名单 | 字符串匹配 | **Glob 通配符**支持 |
| 引擎集成 | 无 | 通过 `harness guardian` CLI 及 Hook Runner 调用 |

---

## Hooks.json v2.0

所有 17 个 Hook 从 `node -e "require(...)"` 改为 `harness` action type，由 HookRunner 引擎统一调度：

```json
{
  "id": "guardian_pre_tool_check",
  "type": "pre_tool_use",
  "actions": [
    { "type": "harness", "plugin": "runtime-guardian", "method": "preToolCheck", "args": ["{{tool_name}}", "{{args}}"] }
  ]
}
```

vs 旧版（不复用进程，每次 spawn 新 Node）：

```json
{
  "type": "execute",
  "command": "node",
  "args": ["-e", "const RG=require('...');const rg=new RG();rg.checkCommand(...)"]
}
```

---

## 项目功效

| 功效 | 说明 |
|------|------|
| **可运行的 Hook 引擎** | HookRunner 提供事件驱动执行，支持 CLI + Daemon 模式 |
| **真实评测框架** | EvalRunner 执行 30 条基准用例，结果持久化，支持回归检测 |
| **Windows+Unix 安全** | 42 种危险模式覆盖双平台，持久化告警 |
| **统一 CLI 入口** | `node engine/index.js` 一站式管理所有插件 |
| **衰减算法 API** | memory-decay 导出算法供外部 Skill 复用 |

---

## 快速开始

### 环境要求
- Node.js >= 18
- (可选) WorkBuddy Code 运行环境

### 安装

```bash
git clone https://github.com/zhuang-HE/workbuddy-harness.git
cd workbuddy-harness
```

### 验证

```bash
# 查看帮助
node engine/index.js help

# 运行健康检查
node engine/index.js health

# 运行全部评测用例
node engine/index.js eval run all

# 查看评测报告
node engine/index.js eval report

# 安全扫描
node engine/index.js guardian scan "rm -rf /"

# Hook 引擎测试
node engine/index.js hook list
node engine/index.js hook trigger session_start session_id=test
```

---

## 项目结构

```
workbuddy-harness/
├── README.md                           # 本文件
├── engine/                             # 🆕 v2.0 运行时基础设施
│   ├── index.js                        # 统一 CLI 入口
│   ├── hook-runner.js                  # Hook 执行引擎
│   ├── eval-runner.js                  # 评测执行器
│   ├── daemon.js                       # 文件监听守护进程
│   └── utils.js                        # 共享工具库
├── plugins/                            # 12 个核心插件
│   ├── task-orchestrator/              # D5: 任务编排调度
│   ├── eval-framework/                 # D8: 评测框架
│   ├── multi-agent-orchestrator/       # D9: 多Agent协作
│   ├── runtime-guardian/               # D7: 运行时安全 (v2.0)
│   ├── context-awareness/              # D1: 上下文感知
│   ├── memory-decay/                   # D2: 记忆衰减管理 (API导出)
│   ├── memory-git/                     # D2: Git版本控制
│   ├── memory-graph/                   # D2: 关系图谱
│   ├── fusion-sync-enhancer/           # D6: 融合同步
│   ├── learning-loop/                  # D4: 学习闭环
│   ├── fusion-router/                  # D6: 融合路由
│   ├── skill-analyzer/                 # D3: 技能分析
│   └── harness-coordinator/            # 统一协调器 (v3.0)
├── hooks/
│   └── hooks.json                      # 17 个自动化 Hooks (v2.0)
├── dashboard/
│   └── harness-dashboard.html          # 实时健康仪表板 (reads state.json)
├── benchmarks/
│   └── agent-benchmark-v1.json         # 5 套件 × 30 用例
└── scripts/
    ├── hermes-health-check.ps1
    └── clean-start.ps1
```

---

## Eval Runner 输出示例

```bash
$ node engine/index.js eval run all

Score: 95/100 (A) | Pass: 100%

# 套件结果
| Suite | Cases | Passed | Rate | Score | Grade |
|-------|-------|--------|------|-------|-------|
| 代码生成能力 | 5 | 5 | 100% | 99 | A |
| 代码审查能力 | 5 | 5 | 100% | 96 | A |
| Skill语义路由 | 10 | 10 | 100% | 90 | A |
| 数据分析能力 | 5 | 5 | 100% | 97 | A |
| 安全合规能力 | 5 | 5 | 100% | 93 | A |

# 基线对比
| Model | Baseline | Current | Diff | Trend |
|-------|----------|---------|------|-------|
| qwen2.5:1.5b | 62 | 95 | +33 | improving |
| qwen3:4b-opt | 75 | 95 | +20 | improving |
```

---

## Guardian 扫描示例

```bash
$ node engine/index.js guardian scan "rm -rf /"
DANGER
  [critical] P0 删除根目录 (Unix) (文件系统)

$ node engine/index.js guardian scan "format C:"
DANGER
  [critical] P0 格式化磁盘 (Win) (文件系统)

$ node engine/index.js guardian scan "del /F /S /Q C:\\Windows"
DANGER
  [critical] P0 强制删除磁盘 (Win) (文件系统)
```

---

## 设计原则

1. **文件系统即记忆** — Agent 记忆独立于模型上下文持久化，跨会话不丢失
2. **引擎驱动事件** — HookRunner 提供真实的事件总线，CLI + Daemon 双模式
3. **真实评测量化** — EvalRunner 执行基准用例，结果持久化可对比
4. **分层架构清晰** — Engine → Plugins → Hooks → Dashboard，职责分明
5. **安全分层防御** — 42 种危险模式 P0/P1/P2 三级分类，Win+Unix 双覆盖
6. **算法可复用** — memory-decay 导出衰减算法 API 供外部 Skill 调用
7. **零外部依赖** — 全部 CommonJS + Node 标准库

---

## 贡献指南

所有插件遵循统一规范：

```
plugin-name/
├── index.js    # CommonJS 模块，导出主类
├── SKILL.md    # 中文文档
└── test.js     # 测试用例
```

提交 PR 前请确保：
- 插件可通过 CLI 独立运行
- `SKILL.md` 包含完整的 CLI 命令和 API 文档
- 代码遵循现有风格（CommonJS，无外部依赖）

---

## 许可证

MIT © 2026

---

*由 CodeBuddy Code 构建 · 2026 年 5 月 14 日 (初始) · 2026 年 5 月 17 日 (v2.0 Engine)*
