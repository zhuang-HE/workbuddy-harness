# Backup & Recovery - 备份与灾难恢复系统

> **版本**: 1.0.0  
> **类型**: P3 系统插件  
> **依赖**: 无 (推荐安装 tar 用于压缩)

---

## 概述

Backup & Recovery 提供完整的备份、版本控制和灾难恢复功能，确保 WorkBuddy 数据安全。

## 核心功能

### 1. 备份类型

| 类型 | 说明 |
|------|------|
| `full` | 完整备份 |
| `incremental` | 增量备份 (计划中) |
| `differential` | 差异备份 (计划中) |

### 2. 备份目标

| 目标 | 默认 | 说明 |
|------|------|------|
| memory | ✅ 启用 | 记忆文件 |
| skills | ✅ 启用 | Skills 定义 |
| hooks | ✅ 启用 | Hooks 配置 |
| plugins | ❌ 禁用 | 插件目录 (太大) |
| config | ✅ 启用 | 配置文件 |

### 3. 调度选项

| 间隔 | 说明 |
|------|------|
| daily | 每天 |
| weekly | 每周 |
| monthly | 每月 |

默认时间: 凌晨 2:00

## 使用方法

### CLI 命令

```bash
# 创建备份
node backup-recovery.js backup

# 查看备份列表
node backup-recovery.js list

# 查看备份详情
node backup-recovery.js info abc123

# 恢复备份
node backup-recovery.js restore abc123

# 删除备份
node backup-recovery.js delete abc123

# 查看统计
node backup-recovery.js stats

# 检查是否需要备份
node backup-recovery.js check

# 查看配置
node backup-recovery.js config show
```

### Node.js API

```javascript
const BackupRecovery = require('~/.workbuddy/plugins/backup-recovery');

const br = new BackupRecovery();

// 创建备份
const backup = br.createBackup();
console.log(backup.id);

// 检查是否需要备份
const { should, reason } = br.shouldBackup();
if (should) {
  br.createBackup();
}

// 恢复备份
br.restoreBackup('backup-id');

// 查看统计
const stats = br.getStats();
console.log(`总备份数: ${stats.total}, 总大小: ${stats.totalSize}`);

// 查看备份列表
const backups = br.listBackups();

// 获取配置
const config = br.getConfig();
config.schedule.interval = 'weekly'; // 修改为每周
br.updateConfig(config);
```

## 数据存储

```
~/.workbuddy/backup-recovery/
├── backups/                  # 备份文件
│   ├── abc123/              # 完整备份目录
│   ├── def456.tar.gz        # 压缩备份
│   └── ...
├── metadata.json            # 备份元数据
└── config.json             # 配置
```

## 配置示例

```javascript
{
  "schedule": {
    "autoBackup": true,
    "interval": "daily",
    "time": "02:00",
    "retention": 30  // 保留 30 天
  },
  "targets": [
    { "name": "memory", "enabled": true },
    { "name": "skills", "enabled": true },
    { "name": "hooks", "enabled": true }
  ],
  "compression": {
    "enabled": true,
    "level": 6
  }
}
```

## 安全特性

- SHA-256 校验和验证
- 可选的 AES-256-GCM 加密
- 增量备份支持 (计划中)

---

**维护**: CodeBuddy AI Engineer  
**更新**: 2026-05-11
