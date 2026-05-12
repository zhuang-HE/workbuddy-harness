# multi-agent-orchestrator v2.0 多Agent编排器 [优化版]

> **Skill 类型**: 系统插件
> **版本**: 2.0.0
> **优先级**: P4-3 (P0)
> **维度**: D9-MultiAgent
> **更新时间**: 2026-05-12
> **触发词**: 多Agent、团队协作、任务分配、Agent编排、multi-agent、orchestration

## v2.0 优化变更

| 优化项 | v1.0 | v2.0 | 收益 |
|--------|------|------|------|
| Agent类型 | 7种（含低频） | 5核心+2扩展 | 精简30%，核心场景全覆盖 |
| 团队模板 | 8个（含solo/devops/design） | 6核心（新增quant/doc） | 贴合实际业务，减少空转 |
| 协作模式 | 无分级 | Quick/Standard/Full三级 | 低复杂度任务跳过组队，节省Token |
| 质量保障 | 无 | 质量门禁+必过项检查 | 交付质量可量化 |
| 模型绑定 | 固定(qwen2.5:1.5b/4b) | 动态选择(fast→balanced→powerful) | 按任务复杂度智能配模型 |
| 任务分解 | 关键词硬匹配 | 按团队类型智能分解 | 量化/文档/研究各有专属流程 |

## Agent 角色体系 v2.0

### 核心5（始终可用）

| Agent | 角色 | 核心能力 | 辅助能力 | 质量权重 |
|-------|------|---------|---------|---------|
| architect 架构师 | Leader | planning, system_design, ui_design | code_review, documentation | 1.2 |
| coder 开发工程师 | Executor | code_generation, debugging | testing, documentation | 1.0 |
| analyst 分析师 | Executor | data_analysis, quant_research, research | code_generation, documentation | 1.1 |
| tester 测试工程师 | Executor | testing, documentation | code_generation, data_analysis | 0.9 |
| reviewer 审查员 | Reviewer | code_review, security_audit | planning, testing | 1.3 |

### 扩展2（按需启用）

| Agent | 角色 | 核心能力 | 触发条件 |
|-------|------|---------|---------|
| writer 文档工程师 | Executor | content_writing, documentation | 报告/PPT/条款/文档生成 |
| devops DevOps工程师 | Executor | deployment, system_design | 部署/运维/CI/CD |

> **设计原则**: 每个Agent有primaryCapabilities（核心）和secondaryCapabilities（辅助），能力互补确保团队内部有冗余容错空间。architect合并了designer能力，analyst覆盖了量化金融和数据分析。

## 团队模板 v2.0

### 开发类

| 模板 | 成员 | 复杂度 | 工作流 | 质量门禁 | 场景 |
|------|------|--------|--------|---------|------|
| **dev-3** | architect + coder + reviewer | 3-6 | sequential | 70分+审查 | 常规功能开发 |
| **dev-5** | architect + coder×2 + reviewer + tester | 7-10 | pipeline | 80分+4项检查 | 复杂系统/全栈 |

### 业务场景类

| 模板 | 成员 | 复杂度 | 工作流 | 质量门禁 | 场景 |
|------|------|--------|--------|---------|------|
| **quant-team** | analyst + coder + reviewer | 4-8 | pipeline | 75分+数据验证 | 股票分析/量化策略 |
| **doc-team** | writer + reviewer + architect | 2-6 | review_loop | 70分+格式审查 | 报告/PPT/条款 |
| **research-team** | analyst×2 + reviewer | 4-7 | parallel | 75分+交叉验证 | 深度研究/竞品调研 |
| **safety-audit** | reviewer×2 + architect | 5-9 | parallel | 90分+3项检查 | 安全审计/合规审查 |

> **与v1.0对比**: 新增quant-team（量化金融）、doc-team（文档生成）；合并qa-team→dev-3；移除solo-review、devops-team、design-team（低频/能力已并入）。

## 三级智能协作模式

```
复杂度评估 → 模式选择 → 团队组建

复杂度<5  → QUICK   → 单人直接执行（不组队，节省Token）
复杂度5-7 → STANDARD → 最优3人团队（效率与质量平衡）
复杂度≥8  → FULL    → 全栈5人团队（质量优先）
```

### 复杂度评估规则

| 关键词 | 加分 |
|--------|------|
| 系统/平台/架构/重构/微服务/全栈/安全审计 | +3 |
| 分析/策略/量化/开发/实现/部署/设计/优化 | +1.5 |
| 查看/检查/修复/修改/更新/查询/统计 | +0.5 |

## 目标分类路由

| 关键词 | → 推荐团队 |
|--------|-----------|
| 股票/走势/K线/MACD/量化/策略/回测 | quant-team |
| 安全/漏洞/审计/渗透/合规 | safety-audit |
| 报告/PPT/文档/条款/保险 | doc-team |
| 研究/调研/分析报告/论文/竞品 | research-team |
| 全栈/系统/平台/架构/微服务 | dev-5 |
| 其他 | dev-3 (默认) |

## 质量门禁

每个团队模板有独立的质量门禁：

| 团队 | 最低分 | 必过检查项 |
|------|--------|-----------|
| dev-3 | 70 | code_review, syntax_check |
| dev-5 | 80 | code_review, security_scan, test_coverage, dependency_audit |
| quant-team | 75 | data_validation, signal_verification |
| doc-team | 70 | format_check, content_review |
| research-team | 75 | source_verification, cross_validation |
| safety-audit | 90 | vulnerability_scan, compliance_check, risk_assessment |

## CLI 命令

```bash
# 查看Agent
node multi-agent-orchestrator.js agents              # 核心5
node multi-agent-orchestrator.js agents all          # 全部7（含扩展）
node multi-agent-orchestrator.js agents extensions   # 仅扩展

# 查看团队模板
node multi-agent-orchestrator.js teams

# 查看协作模式指南
node multi-agent-orchestrator.js guide

# 智能编排
node multi-agent-orchestrator.js orchestrate "创建用户认证API"
node multi-agent-orchestrator.js orchestrate "分析贵州茅台走势"

# 目标分析（预览推荐团队和复杂度）
node multi-agent-orchestrator.js classify "写一份保险产品条款"

# 查看指标
node multi-agent-orchestrator.js metrics

# 编排管理
node multi-agent-orchestrator.js status <orchId>
node multi-agent-orchestrator.js quality <orchId>
node multi-agent-orchestrator.js report <orchId>
```

## 版本历史

| 日期 | 版本 | 变更 |
|------|------|------|
| 2026-05-12 | 2.0.0 | **重构**: Agent 7→5核心+2扩展；团队 8→6核心；新增三级协作模式；质量门禁；模型动态绑定；目标分类路由优化 |
| 2026-05-12 | 1.0.0 | 初始版本：5种Agent角色、3个团队模板、IPC通信 |
