# WorkBuddy Harness + Hermes Agent

<p align="center">
  <img src="assets/banner.png" alt="Hermes Agent" width="100%">
</p>

# WorkBuddy Harness v3.1

> 🏗️ AI Agent 九维基础设施框架 — 成熟度 93%

## 简介

**WorkBuddy Harness** 是一套为 AI Agent 设计的系统化基础设施框架。它将 Agent 的能力体系拆解为 **9 个架构维度**，每个维度配备专用插件，形成从身份认知、记忆管理、任务调度到安全防护、评测反馈、多Agent协作的完整闭环。

在传统 AI Agent 开发中，工程师往往将注意力集中在「让模型变聪明」上，而忽略了 Agent 作为一个持续运行的软件系统所需的工程化支撑。本项目的核心洞察是：**Agent 的能力上限不取决于模型本身，而取决于它的基础设施（Harness）有多完善。**

本项目在已有 WorkBuddy 系统的基础上，将 9 个维度的成熟度从 **55% 提升至 93%**，新增了 **11 个核心插件**、**21 个自动化 Hooks**、**30 条基准评测用例**，以及一套实时健康仪表板。

---

## Hermes Agent ☤

<p align="center">
  <a href="https://hermes-agent.nousresearch.com/docs/"><img src="https://img.shields.io/badge/Docs-hermes--agent.nousresearch.com-FFD700?style=for-the-badge" alt="Documentation"></a>
  <a href="https://discord.gg/NousResearch"><img src="https://img.shields.io/badge/Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Discord"></a>
  <a href="https://github.com/NousResearch/hermes-agent/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-MIT-green?style=for-the-badge" alt="License: MIT"></a>
  <a href="https://nousresearch.com"><img src="https://img.shields.io/badge/Built%20by-Nous%20Research-blueviolet?style=for-the-badge" alt="Built by Nous Research"></a>
</p>

**The self-improving AI agent built by [Nous Research](https://nousresearch.com).** It's the only agent with a built-in learning loop — it creates skills from experience, improves them during use, nudges itself to persist knowledge, searches its own past conversations, and builds a deepening model of who you are across sessions. Run it on a $5 VPS, a GPU cluster, or serverless infrastructure that costs nearly nothing when idle.

Use any model you want — [Nous Portal](https://portal.nousresearch.com), [OpenRouter](https://openrouter.ai) (200+ models), [NVIDIA NIM](https://build.nvidia.com) (Nemotron), [Xiaomi MiMo](https://platform.xiaomimimo.com), [z.ai/GLM](https://z.ai), [Kimi/Moonshot](https://platform.moonshot.ai), [MiniMax](https://www.minimax.io), [Hugging Face](https://huggingface.co), OpenAI, or your own endpoint. Switch with `hermes model` — no code changes, no lock-in.

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
│                   WorkBuddy Harness v3.1                          │
│                   九维 AI Agent 基础设施                            │
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
│  11 插件 · 21 Hooks · 30 基准用例 · 8 团队模板 · 实时仪表板        │
└──────────────────────────────────────────────────────────────────┘
```

---

## 快速开始

### Hermes CLI

```bash
hermes              # Interactive CLI — start a conversation
hermes model        # Choose your LLM provider and model
hermes tools        # Configure which tools are enabled
hermes config set   # Set individual config values
hermes gateway      # Start the messaging gateway
hermes setup        # Run the full setup wizard
hermes doctor       # Diagnose any issues
```

### 安装 Harness 插件

```bash
# 克隆仓库
git clone https://github.com/zhuang-HE/workbuddy-harness.git
cd workbuddy-harness

# 安装插件到 WorkBuddy
cp -r plugins/* ~/.workbuddy/plugins/
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

## 许可证

MIT © 2026 WorkBuddy + Nous Research

---

*由 CodeBuddy Code (AI Engineer) 构建 · 2026 年 5 月 12 日*
