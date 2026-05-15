/**
 * Backup & Recovery - 备份与灾难恢复系统
 * 
 * 自动备份、版本控制、灾难恢复
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

// 默认配置目录
const DEFAULT_CONFIG_DIR = path.join(process.env.HOME || process.env.USERPROFILE, '.workbuddy', 'backup-recovery');

class BackupRecovery {
  constructor(options = {}) {
    this.configDir = options.configDir || DEFAULT_CONFIG_DIR;
    this.backupsDir = path.join(this.configDir, 'backups');
    this.metadataFile = path.join(this.configDir, 'metadata.json');
    this.configFile = path.join(this.configDir, 'config.json');
    
    this._ensureConfigDir();
    
    // 备份类型
    this.BackupTypes = {
      FULL: 'full',
      INCREMENTAL: 'incremental',
      DIFFERENTIAL: 'differential'
    };
    
    // 备份状态
    this.BackupStatus = {
      PENDING: 'pending',
      RUNNING: 'running',
      COMPLETED: 'completed',
      FAILED: 'failed'
    };
    
    // 加载配置
    this.config = this._loadConfig();
  }

  /**
   * 确保配置目录存在
   */
  _ensureConfigDir() {
    if (!fs.existsSync(this.configDir)) {
      fs.mkdirSync(this.configDir, { recursive: true });
    }
    if (!fs.existsSync(this.backupsDir)) {
      fs.mkdirSync(this.backupsDir, { recursive: true });
    }
  }

  /**
   * 生成唯一 ID
   */
  _generateId() {
    return crypto.randomBytes(8).toString('hex');
  }

  /**
   * 获取时间戳
   */
  _timestamp() {
    return new Date().toISOString();
  }

  /**
   * 加载配置
   */
  _loadConfig() {
    if (!fs.existsSync(this.configFile)) {
      return this._getDefaultConfig();
    }
    
    try {
      return JSON.parse(fs.readFileSync(this.configFile, 'utf-8'));
    } catch (e) {
      return this._getDefaultConfig();
    }
  }

  /**
   * 获取默认配置
   */
  _getDefaultConfig() {
    const homeDir = process.env.HOME || process.env.USERPROFILE;
    
    return {
      schedule: {
        autoBackup: true,
        interval: 'daily', // daily, weekly, monthly
        time: '02:00', // 凌晨 2 点
        retention: 30 // 保留 30 天
      },
      targets: [
        {
          name: 'memory',
          path: path.join(homeDir, '.workbuddy', 'memory'),
          enabled: true,
          priority: 'high'
        },
        {
          name: 'skills',
          path: path.join(homeDir, '.workbuddy', 'skills'),
          enabled: true,
          priority: 'high'
        },
        {
          name: 'hooks',
          path: path.join(homeDir, '.workbuddy', 'hooks'),
          enabled: true,
          priority: 'medium'
        },
        {
          name: 'plugins',
          path: path.join(homeDir, '.workbuddy', 'plugins'),
          enabled: false, // 插件太大，默认不备份
          priority: 'low'
        },
        {
          name: 'config',
          path: path.join(homeDir, '.workbuddy'),
          pattern: ['*.json', '*.yaml', '*.md'],
          enabled: true,
          priority: 'high'
        }
      ],
      compression: {
        enabled: true,
        level: 6 // 1-9, 6 是速度和压缩的平衡
      },
      encryption: {
        enabled: false,
        algorithm: 'aes-256-gcm'
      },
      storage: {
        local: true,
        remotePath: null,
        cloudProvider: null
      },
      notifications: {
        onSuccess: false,
        onFailure: true
      }
    };
  }

  // ==================== 备份操作 ====================

  /**
   * 创建完整备份
   */
  createBackup(options = {}) {
    const backupId = this._generateId();
    const timestamp = this._timestamp();
    
    const backup = {
      id: backupId,
      type: this.BackupTypes.FULL,
      status: this.BackupStatus.RUNNING,
      createdAt: timestamp,
      completedAt: null,
      files: [],
      size: 0,
      fileCount: 0,
      error: null
    };
    
    const backupPath = path.join(this.backupsDir, backupId);
    
    try {
      fs.mkdirSync(backupPath);
      
      // 备份每个目标
      for (const target of this.config.targets) {
        if (!target.enabled) continue;
        
        const targetBackup = this._backupTarget(target, backupPath);
        backup.files.push(targetBackup);
        backup.size += targetBackup.size;
        backup.fileCount += targetBackup.fileCount;
      }
      
      // 压缩备份
      if (this.config.compression.enabled) {
        this._compressBackup(backupPath);
      }
      
      backup.status = this.BackupStatus.COMPLETED;
      backup.completedAt = this._timestamp();
      backup.checksum = this._calculateChecksum(backupPath);
      
      // 保存元数据
      this._saveBackupMetadata(backup);
      
      // 清理过期备份
      this._cleanupOldBackups();
      
    } catch (e) {
      backup.status = this.BackupStatus.FAILED;
      backup.error = e.message;
      backup.completedAt = this._timestamp();
    }
    
    return backup;
  }

  /**
   * 备份单个目标
   */
  _backupTarget(target, backupPath) {
    const targetPath = path.join(backupPath, target.name);
    let fileCount = 0;
    let size = 0;
    
    if (!fs.existsSync(target.path)) {
      return { name: target.name, fileCount: 0, size: 0, skipped: true };
    }
    
    fs.mkdirSync(targetPath, { recursive: true });
    
    const stats = fs.statSync(target.path);
    
    if (stats.isFile()) {
      // 单文件
      fs.copyFileSync(target.path, path.join(targetPath, path.basename(target.path)));
      fileCount = 1;
      size = stats.size;
    } else {
      // 目录
      this._copyDirectory(target.path, targetPath, target.pattern);
      const result = this._getDirStats(targetPath);
      fileCount = result.fileCount;
      size = result.size;
    }
    
    return {
      name: target.name,
      sourcePath: target.path,
      fileCount,
      size
    };
  }

  /**
   * 复制目录
   */
  _copyDirectory(src, dest, pattern = null) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    
    const entries = fs.readdirSync(src, { withFileTypes: true });
    
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      
      if (entry.isDirectory()) {
        this._copyDirectory(srcPath, destPath, pattern);
      } else if (entry.isFile()) {
        // 检查模式匹配
        if (pattern) {
          const match = pattern.some(p => {
            const regex = new RegExp('^' + p.replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
            return regex.test(entry.name);
          });
          if (!match) continue;
        }
        
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }

  /**
   * 获取目录统计
   */
  _getDirStats(dir) {
    let fileCount = 0;
    let size = 0;
    
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const result = this._getDirStats(path.join(dir, entry.name));
        fileCount += result.fileCount;
        size += result.size;
      } else if (entry.isFile()) {
        const stat = fs.statSync(path.join(dir, entry.name));
        fileCount++;
        size += stat.size;
      }
    }
    
    return { fileCount, size };
  }

  /**
   * 压缩备份
   */
  _compressBackup(backupPath) {
    // 创建 tar.gz 归档
    const { execSync } = require('child_process');
    
    try {
      const tarPath = backupPath + '.tar.gz';
      execSync(`tar -czf "${tarPath}" -C "${this.backupsDir}" "${path.basename(backupPath)}"`, {
        stdio: 'pipe'
      });
      
      // 删除原始目录
      fs.rmSync(backupPath, { recursive: true, force: true });
      
      return tarPath;
    } catch (e) {
      // 如果 tar 不可用，返回原始路径
      return backupPath;
    }
  }

  /**
   * 计算校验和
   */
  _calculateChecksum(filePath) {
    const hash = crypto.createHash('sha256');
    
    if (fs.statSync(filePath).isDirectory()) {
      // 目录：计算所有文件哈希
      const files = this._getAllFiles(filePath);
      for (const file of files) {
        const content = fs.readFileSync(file);
        hash.update(content);
      }
    } else {
      // 文件
      const content = fs.readFileSync(filePath);
      hash.update(content);
    }
    
    return hash.digest('hex');
  }

  /**
   * 获取所有文件
   */
  _getAllFiles(dir) {
    const files = [];
    
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...this._getAllFiles(fullPath));
      } else {
        files.push(fullPath);
      }
    }
    
    return files;
  }

  // ==================== 恢复操作 ====================

  /**
   * 恢复备份
   */
  restoreBackup(backupId, targetPath = null) {
    const backupPath = path.join(this.backupsDir, backupId);
    
    if (!fs.existsSync(backupPath) && !fs.existsSync(backupPath + '.tar.gz')) {
      // 检查是否是压缩文件
      const compressedPath = path.join(this.backupsDir, backupId + '.tar.gz');
      if (fs.existsSync(compressedPath)) {
        return this._restoreCompressedBackup(backupId, targetPath);
      }
      
      return { success: false, error: '备份不存在' };
    }
    
    const metadata = this._getBackupMetadata(backupId);
    
    if (!metadata) {
      return { success: false, error: '无法读取备份元数据' };
    }
    
    try {
      const restorePath = targetPath || path.join(process.env.HOME || process.env.USERPROFILE, '.workbuddy');
      
      // 恢复每个目标
      for (const file of metadata.files) {
        const srcPath = fs.statSync(backupPath + '.tar.gz' ? backupPath + '.tar.gz' : backupPath).isFile()
          ? path.join(this.backupsDir, backupId + '.tar.gz')
          : path.join(backupPath, file.name);
        const destPath = path.join(restorePath, file.name);
        
        if (!fs.existsSync(path.dirname(destPath))) {
          fs.mkdirSync(path.dirname(destPath), { recursive: true });
        }
        
        if (file.skipped) continue;
        
        fs.cpSync(srcPath, destPath, { recursive: true });
      }
      
      return {
        success: true,
        backupId,
        restoredAt: this._timestamp(),
        files: metadata.files.length
      };
      
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  /**
   * 恢复压缩备份
   */
  _restoreCompressedBackup(backupId, targetPath) {
    const { execSync } = require('child_process');
    const compressedPath = path.join(this.backupsDir, backupId + '.tar.gz');
    const tempPath = path.join(this.backupsDir, 'temp-restore-' + backupId);
    
    try {
      // 解压到临时目录
      fs.mkdirSync(tempPath, { recursive: true });
      execSync(`tar -xzf "${compressedPath}" -C "${tempPath}"`, { stdio: 'pipe' });
      
      // 复制内容
      const extractedDir = path.join(tempDir, path.basename(backupId));
      const restorePath = targetPath || path.join(process.env.HOME || process.env.USERPROFILE, '.workbuddy');
      
      const entries = fs.readdirSync(extractedDir);
      for (const entry of entries) {
        fs.cpSync(path.join(extractedDir, entry), path.join(restorePath, entry), { recursive: true });
      }
      
      // 清理
      fs.rmSync(tempPath, { recursive: true, force: true });
      
      return {
        success: true,
        backupId,
        restoredAt: this._timestamp()
      };
      
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  // ==================== 元数据管理 ====================

  /**
   * 保存备份元数据
   */
  _saveBackupMetadata(backup) {
    let metadata = [];
    
    if (fs.existsSync(this.metadataFile)) {
      try {
        metadata = JSON.parse(fs.readFileSync(this.metadataFile, 'utf-8'));
      } catch (e) {
        metadata = [];
      }
    }
    
    // 添加新备份
    metadata.unshift({
      id: backup.id,
      type: backup.type,
      status: backup.status,
      createdAt: backup.createdAt,
      completedAt: backup.completedAt,
      size: backup.size,
      fileCount: backup.fileCount,
      checksum: backup.checksum,
      error: backup.error
    });
    
    // 保存
    fs.writeFileSync(this.metadataFile, JSON.stringify(metadata, null, 2));
  }

  /**
   * 获取备份元数据
   */
  _getBackupMetadata(backupId) {
    if (!fs.existsSync(this.metadataFile)) {
      return null;
    }
    
    try {
      const metadata = JSON.parse(fs.readFileSync(this.metadataFile, 'utf-8'));
      return metadata.find(b => b.id === backupId);
    } catch (e) {
      return null;
    }
  }

  /**
   * 列出所有备份
   */
  listBackups() {
    if (!fs.existsSync(this.metadataFile)) {
      return [];
    }
    
    try {
      return JSON.parse(fs.readFileSync(this.metadataFile, 'utf-8'));
    } catch (e) {
      return [];
    }
  }

  /**
   * 获取备份详情
   */
  getBackupInfo(backupId) {
    return this._getBackupMetadata(backupId);
  }

  // ==================== 清理 ====================

  /**
   * 清理过期备份
   */
  _cleanupOldBackups() {
    const metadata = this.listBackups();
    const retention = this.config.schedule.retention || 30;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retention);
    
    const toDelete = metadata.filter(b => 
      b.status === this.BackupStatus.COMPLETED &&
      new Date(b.createdAt) < cutoff
    );
    
    for (const backup of toDelete) {
      this.deleteBackup(backup.id);
    }
    
    return { deleted: toDelete.length };
  }

  /**
   * 删除备份
   */
  deleteBackup(backupId) {
    const backupPath = path.join(this.backupsDir, backupId);
    const compressedPath = backupPath + '.tar.gz';
    
    try {
      if (fs.existsSync(backupPath)) {
        fs.rmSync(backupPath, { recursive: true, force: true });
      }
      if (fs.existsSync(compressedPath)) {
        fs.unlinkSync(compressedPath);
      }
      
      // 从元数据中移除
      let metadata = this.listBackups();
      metadata = metadata.filter(b => b.id !== backupId);
      fs.writeFileSync(this.metadataFile, JSON.stringify(metadata, null, 2));
      
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  // ==================== 调度 ====================

  /**
   * 检查是否需要备份
   */
  shouldBackup() {
    if (!this.config.schedule.autoBackup) {
      return { should: false, reason: '自动备份已禁用' };
    }
    
    const backups = this.listBackups();
    const lastBackup = backups[0];
    
    if (!lastBackup) {
      return { should: true, reason: '从未备份过' };
    }
    
    const lastTime = new Date(lastBackup.createdAt);
    const now = new Date();
    
    let intervalHours;
    switch (this.config.schedule.interval) {
      case 'daily':
        intervalHours = 24;
        break;
      case 'weekly':
        intervalHours = 24 * 7;
        break;
      case 'monthly':
        intervalHours = 24 * 30;
        break;
      default:
        intervalHours = 24;
    }
    
    const hoursSince = (now - lastTime) / (1000 * 60 * 60);
    
    if (hoursSince >= intervalHours) {
      return { should: true, reason: `已超过 ${intervalHours} 小时` };
    }
    
    return { should: false, reason: `距离上次备份 ${Math.round(hoursSince)} 小时` };
  }

  /**
   * 获取备份统计
   */
  getStats() {
    const backups = this.listBackups();
    const completed = backups.filter(b => b.status === this.BackupStatus.COMPLETED);
    
    const totalSize = completed.reduce((sum, b) => sum + (b.size || 0), 0);
    const avgSize = completed.length > 0 ? totalSize / completed.length : 0;
    
    return {
      total: backups.length,
      completed: completed.length,
      failed: backups.filter(b => b.status === this.BackupStatus.FAILED).length,
      pending: backups.filter(b => b.status === this.BackupStatus.PENDING).length,
      running: backups.filter(b => b.status === this.BackupStatus.RUNNING).length,
      totalSize,
      avgSize,
      latestBackup: completed[0] || null,
      oldestBackup: completed[completed.length - 1] || null
    };
  }

  // ==================== 配置 ====================

  /**
   * 更新配置
   */
  updateConfig(config) {
    this.config = { ...this.config, ...config };
    fs.writeFileSync(this.configFile, JSON.stringify(this.config, null, 2));
    return { success: true, config: this.config };
  }

  /**
   * 获取配置
   */
  getConfig() {
    return this.config;
  }

  /**
   * 启用/禁用目标
   */
  setTargetEnabled(targetName, enabled) {
    const target = this.config.targets.find(t => t.name === targetName);
    if (target) {
      target.enabled = enabled;
      fs.writeFileSync(this.configFile, JSON.stringify(this.config, null, 2));
      return { success: true };
    }
    return { success: false, error: '目标不存在' };
  }

  // ==================== CLI 入口 ====================
}

// CLI 入口
if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];
  const br = new BackupRecovery();
  
  switch (command) {
    case 'backup':
      const backup = br.createBackup();
      console.log(JSON.stringify(backup, null, 2));
      break;
      
    case 'restore':
      const backupId = args[1];
      if (!backupId) {
        console.log('用法: backup-recovery.js restore <backupId>');
        process.exit(1);
      }
      console.log(JSON.stringify(br.restoreBackup(backupId), null, 2));
      break;
      
    case 'list':
      const backups = br.listBackups();
      console.log(JSON.stringify(backups, null, 2));
      break;
      
    case 'info':
      const id = args[1];
      if (!id) {
        console.log('用法: backup-recovery.js info <backupId>');
        process.exit(1);
      }
      console.log(JSON.stringify(br.getBackupInfo(id), null, 2));
      break;
      
    case 'delete':
      const delId = args[1];
      if (!delId) {
        console.log('用法: backup-recovery.js delete <backupId>');
        process.exit(1);
      }
      console.log(JSON.stringify(br.deleteBackup(delId), null, 2));
      break;
      
    case 'stats':
      console.log(JSON.stringify(br.getStats(), null, 2));
      break;
      
    case 'check':
      console.log(JSON.stringify(br.shouldBackup(), null, 2));
      break;
      
    case 'config':
      if (args[1] === 'show') {
        console.log(JSON.stringify(br.getConfig(), null, 2));
      } else {
        console.log('用法: backup-recovery.js config show');
      }
      break;
      
    default:
      console.log(`
Backup & Recovery CLI
====================
用法: backup-recovery.js <command> [options]

备份操作:
  backup                      创建完整备份
  restore <backupId>          恢复备份
  check                        检查是否需要备份

备份管理:
  list                         列出所有备份
  info <backupId>              查看备份详情
  delete <backupId>           删除备份
  stats                        查看统计信息

配置管理:
  config show                  显示配置

示例:
  node backup-recovery.js backup
  node backup-recovery.js restore abc123
  node backup-recovery.js list
      `);
  }
}

module.exports = BackupRecovery;
