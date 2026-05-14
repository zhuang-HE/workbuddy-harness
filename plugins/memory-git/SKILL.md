# memory-git 记忆Git版本控制

> **版本**: 1.0.0 | **优先级**: P4-12 (P0) | **维度**: D2-Memory | **对标**: OpenHarness Memory Git
> **触发词**: 记忆版本、版本回滚、变更历史、memory git、版本控制

## 功能概述

为 memory-decay 提供 Git 版本控制能力，实现：
- 记忆变更自动追踪
- 历史版本查询
- 差异对比
- 一键回滚
- 每日自动备份

## 核心能力

### 1. 自动版本追踪

每次记忆变更自动记录：
| 变更类型 | 触发时机 | Commit消息 |
|---------|---------|-----------|
| sync | 数据同步 | Sync: memory-decay数据同步 |
| register | 新注册记忆 | Memory: 注册新记忆 |
| update | 记忆更新 | Memory: 更新记忆 |
| delete | 记忆删除 | Memory: 删除记忆 |
| compress | 记忆压缩 | Memory: 压缩记忆 |
| prune | 记忆清理 | Memory: 清理记忆 |
| restore | 回滚操作 | Memory: 回滚操作 |

### 2. 历史版本管理

```bash
# 查看最近100条历史
node memory-git.js history

# 对比两个版本差异
node memory-git.js diff HEAD~5 HEAD

# 查看特定版本
node memory-git.js show abc1234
```

### 3. 一键回滚

```bash
# 回滚到指定版本（自动创建备份分支）
node memory-git.js rollback abc1234
```

### 4. 每日备份

```bash
# 创建每日备份分支
node memory-git.js backup
```

## CLI 命令

| 命令 | 说明 | 示例 |
|------|------|------|
| `track [--type <type>]` | 追踪变更 | `node memory-git.js track --type register` |
| `history [--count <n>]` | 查看历史 | `node memory-git.js history --count 50` |
| `diff <v1> [v2]` | 版本差异 | `node memory-git.js diff HEAD~3 HEAD` |
| `show <commit>` | 查看版本 | `node memory-git.js show abc1234` |
| `rollback <commit>` | 回滚版本 | `node memory-git.js rollback abc1234` |
| `status` | 当前状态 | `node memory-git.js status` |
| `sync` | 强制同步 | `node memory-git.js sync` |
| `backup` | 每日备份 | `node memory-git.js backup` |
| `report` | 变更报告 | `node memory-git.js report` |

## API 示例

```javascript
const { MemoryGitVC } = require('memory-git');

// 初始化
const mg = new MemoryGitVC();

// 获取状态
const status = mg.getStatus();
console.log(status.currentCommit);

// 追踪变更
mg.trackChange('register');

// 查看历史
const history = mg.getHistory({ maxCount: 50 });

// 回滚
mg.rollback('abc1234');
```

## 数据目录

```
~/.workbuddy/memory-git/
├── .git/                    # Git仓库
├── .gitignore
├── store.json              # memory-decay数据副本
└── memory-index.json       # 索引文件
```

## 版本历史

| 2026-05-14 | 1.0.0 | 初始版本：Git版本控制基础功能 |
