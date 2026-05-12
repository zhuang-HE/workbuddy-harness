# WorkBuddy Harness v3.1

> AI Agent 9-Dimensional Infrastructure Framework — 55% → 90% Maturity

## Overview

WorkBuddy Harness is a comprehensive AI Agent execution framework that systematically organizes an agent's capabilities across **9 architectural dimensions**. This project completes the harness from 55% to **90%** maturity with 9 plugins, 21 hooks, 30 benchmark cases, and an 8-template multi-agent team system.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    WorkBuddy Harness v3.1                    │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  D1 Identity ───── context-awareness (90%)                  │
│  D2 Memory ─────── memory-decay (90%)                       │
│  D3 Skills ─────── 53+ Skills + semantic-router (90%)       │
│  D4 Learning ───── learning-loop (90%)                      │
│  D5 Orchestration  task-orchestrator (88%)                  │
│  D6 Integration ── fusion-router + fusion-sync-enhancer (85%)│
│  D7 Security ───── runtime-guardian (85%)                   │
│  D8 Evaluation ─── eval-framework (85%)                     │
│  D9 Multi-Agent ── multi-agent-orchestrator (85%)           │
│                                                              │
│  ═══════════════════════════════════════════════════════════ │
│  9 Plugins · 21 Hooks · 30 Benchmarks · 8 Team Templates    │
│  10/10 Routing Accuracy · Real-time Dashboard               │
└─────────────────────────────────────────────────────────────┘
```

## Plugin Catalog

| # | Plugin | Dimension | Lines | Tests | Key Capability |
|---|--------|-----------|-------|-------|----------------|
| P4-1 | `task-orchestrator` | D5 | 636 | 8/8 | Goal decomposition, DAG, WorkerPool, PriorityQueue, RetryManager |
| P4-2 | `eval-framework` | D8 | 509 | 9/9 | 5-dim evaluation, RuntimeEvalTracker, A/B testing, regression detection |
| P4-3 | `multi-agent-orchestrator` | D9 | 511 | 6/6 | 8 team templates, 5 agent roles, IPC process manager, batch execution |
| P4-4 | `runtime-guardian` | D7 | 785 | 6/6 | 12 dangerous patterns, file access control, anomaly detection |
| P4-5 | `context-awareness` | D1 | 389 | 8/8 | 4-dim context (env/project/time/conversation), dynamic strategy |
| P4-6 | `memory-decay` | D2 | 520 | 9/9 | Exponential decay model, importance-weighted forgetting, compression |
| P4-7 | `fusion-sync-enhancer` | D6 | 320 | 9/9 | Incremental bidirectional sync, 5 conflict strategies, health monitoring |
| P4-8 | `learning-loop` | D4 | 180 | 6/6 | OBSERVE→ANALYZE→LEARN→EVOLVE→APPLY 5-phase closed loop |
| P4-9 | `fusion-router` | D6 | 200 | 6/6 | 11-domain rules, WB/HERMES/collaboration auto-routing, 10/10 accuracy |

## Quick Start

### Prerequisites
- Node.js ≥ 18
- WorkBuddy Code environment
- (Optional) HERMES Agent + Ollama for routing

### Install
```bash
# Clone the repository
git clone https://github.com/zhuang-HE/workbuddy-harness.git
cd workbuddy-harness

# Copy plugins to WorkBuddy
cp -r plugins/* ~/.workbuddy/plugins/

# Apply hooks configuration
cp hooks/hooks.json ~/.workbuddy/hooks/

# Load benchmark dataset
cp benchmarks/agent-benchmark-v1.json ~/.workbuddy/eval-framework/datasets/

# Open dashboard
open dashboard/harness-dashboard.html
```

### Verification
```bash
# Run all plugin tests
cd ~/.workbuddy/plugins
node test-framework/index.js run task-orchestrator eval-framework multi-agent-orchestrator runtime-guardian context-awareness memory-decay fusion-sync-enhancer learning-loop fusion-router

# Test fusion routing
node fusion-router/index.js test
```

## Maturity Evolution

```
Initial:  55%  D1:80 D2:85 D3:90 D4:85 D5:40 D6:65 D7:50 D8:00 D9:00
Phase 1:  82%  D1:90 D2:90 D3:90 D4:85 D5:80 D6:65 D7:85 D8:75 D9:75
Phase 3:  85%  D1:90 D2:90 D3:90 D4:85 D5:80 D6:80 D7:85 D8:75 D9:75
Phase 5:  88%  D1:90 D2:90 D3:90 D4:90 D5:88 D6:80 D7:85 D8:85 D9:85
Phase 6:  90%  D1:90 D2:90 D3:90 D4:90 D5:88 D6:85 D7:85 D8:85 D9:85
```

## Directory Structure

```
workbuddy-harness/
├── README.md
├── plugins/                        # 9 harness plugins
│   ├── task-orchestrator/          # D5: Task orchestration
│   ├── eval-framework/             # D8: Evaluation system
│   ├── multi-agent-orchestrator/   # D9: Multi-agent coordination
│   ├── runtime-guardian/           # D7: Runtime security
│   ├── context-awareness/          # D1: Dynamic context
│   ├── memory-decay/               # D2: Memory management
│   ├── fusion-sync-enhancer/       # D6: Sync enhancement
│   ├── learning-loop/              # D4: Learning closed loop
│   └── fusion-router/              # D6: Intelligent routing
├── hooks/
│   └── hooks.json                  # 21 hooks configuration
├── dashboard/
│   └── harness-dashboard.html      # Real-time health dashboard
├── benchmarks/
│   └── agent-benchmark-v1.json     # 5 suites × 30 cases
├── scripts/
│   ├── hermes-health-check.ps1     # Periodic health monitoring
│   └── clean-start.ps1             # Safe HERMES gateway startup
└── *.md                            # Implementation reports
```

## Key Design Patterns

1. **File System as Memory** — Persistent agent memory decoupled from model context
2. **Confidence Scoring** — Quantitative experience scoring (Instinct 0-100)
3. **Trigger Self-Evolution** — Skills learn user language patterns automatically
4. **Multi-System Fusion** — WorkBuddy + HERMES + Obsidian tri-fusion
5. **Layered Architecture** — Identity/Soul/User → Skills → Memory → Automation
6. **Continuous Auditing** — Weekly skill health checks prevent decay

## Contributing

All plugins follow a consistent pattern:
- `index.js` — CommonJS module with class export
- `SKILL.md` — Chinese documentation with YAML frontmatter
- `test.js` — Test cases for the built-in test framework

## License

MIT © 2026 WorkBuddy

---

*Built by CodeBuddy Code (AI Engineer) · May 12, 2026*
