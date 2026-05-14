#!/usr/bin/env node
/**
 * memory-git - WorkBuddy P4-12 记忆Git版本控制
 * 实现记忆变更追踪、历史回滚、版本差异对比
 *
 * 维度: D2-Memory (增强)
 * 优先级: P0
 * 对标: OpenHarness Memory Git版本控制
 * 创建: 2026-05-14
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawn } = require('child_process');

// ============================================================================
// Simple Git Wrapper (无需外部依赖)
// ============================================================================

class SimpleGit {
  constructor(repoPath) {
    this.repoPath = repoPath;
    this._initRepo();
  }

  _run(args, options = {}) {
    try {
      const result = execSync(`git ${args.join(' ')}`, {
        cwd: this.repoPath,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        ...options
      });
      return { success: true, output: result, error: null };
    } catch (e) {
      return { success: false, output: e.stdout || '', error: e.stderr || e.message };
    }
  }

  _initRepo() {
    const gitDir = path.join(this.repoPath, '.git');
    if (!fs.existsSync(gitDir)) {
      this._run(['init']);
      this._run(['config', 'user.email', '"memory-git@workbuddy.local"']);
      this._run(['config', 'user.name', '"Memory Git"']);
    }
  }

  add(files = '.') {
    if (Array.isArray(files)) {
      return this._run(['add', ...files]);
    }
    return this._run(['add', files]);
  }

  commit(message) {
    const safeMsg = message.replace(/"/g, '\\"');
    return this._run(['commit', '-m', safeMsg]);
  }

  log(options = {}) {
    const args = ['log', '--format=%H|%an|%ai|%s'];
    if (options.maxCount) args.push(`-n${options.maxCount}`);
    if (options.file) args.push('--', options.file);

    const result = this._run(args);
    if (!result.success) return [];

    return result.output.trim().split('\n')
      .filter(line => line.trim())
      .map(line => {
        const [hash, author, date, ...msgParts] = line.split('|');
        return { hash: hash.trim(), author, date, message: msgParts.join('|') };
      });
  }

  diff(commit1, commit2 = '', file = '') {
    const args = ['diff'];
    if (commit2) args.push(commit1, commit2);
    else args.push('HEAD', commit1);

    if (file) args.push('--', file);
    return this._run(args);
  }

  show(commit, file = '') {
    const args = ['show', commit];
    if (file) args.push('--', file);
    return this._run(args);
  }

  checkout(commit, file = '') {
    const args = ['checkout', commit];
    if (file) args.push('--', file);
    else args.push('-b', commit);
    return this._run(args);
  }

  reset(commit, hard = false) {
    const args = ['reset'];
    if (hard) args.push('--hard');
    args.push(commit);
    return this._run(args);
  }

  status() {
    return this._run(['status', '--porcelain']);
  }

  getCurrentCommit() {
    const result = this._run(['rev-parse', 'HEAD']);
    return result.success ? result.output.trim() : null;
  }

  getBranches() {
    const result = this._run(['branch', '-a']);
    if (!result.success) return [];
    return result.output.trim().split('\n').map(b => b.trim().replace(/^\*/, ''));
  }

  createBranch(name) {
    return this._run(['checkout', '-b', name]);
  }

  getFileAtCommit(commit, file) {
    const result = this._run(['show', `${commit}:${file}`]);
    if (result.success) return result.output;
    return null;
  }
}

// ============================================================================
// Memory Git Version Control
// ============================================================================

class MemoryGitVC {
  constructor(options = {}) {
    this.configDir = options.configDir || path.join(os.homedir(), '.workbuddy', 'memory-git');
    this.memoryDataDir = options.memoryDataDir || path.join(os.homedir(), '.workbuddy', 'memory-decay', 'data');
    this.autoCommit = options.autoCommit !== false;
    this.maxHistory = options.maxHistory || 100;
    this.branches = {
      main: 'main',
      backup: 'backup',
      daily: 'daily'
    };

    this._ensureConfigDir();
    this.git = new SimpleGit(this.configDir);
    this._syncFromMemoryDecay();
  }

  _ensureConfigDir() {
    if (!fs.existsSync(this.configDir)) {
      fs.mkdirSync(this.configDir, { recursive: true });
    }
    // 创建一个.gitignore
    const gitignore = path.join(this.configDir, '.gitignore');
    if (!fs.existsSync(gitignore)) {
      fs.writeFileSync(gitignore, '*.tmp\n*.log\n');
    }
  }

  // 同步memory-decay的数据到本地Git仓库
  _syncFromMemoryDecay() {
    if (!fs.existsSync(this.memoryDataDir)) return;

    const files = fs.readdirSync(this.memoryDataDir).filter(f => f.endsWith('.json'));
    if (files.length === 0) return;

    // 复制文件到memory-git目录
    for (const file of files) {
      const src = path.join(this.memoryDataDir, file);
      const dest = path.join(this.configDir, file);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, dest);
      }
    }

    // 自动commit
    if (this.autoCommit) {
      this._autoCommit('sync');
    }
  }

  _autoCommit(type) {
    const status = this.git.status();
    if (!status.output.trim()) return null; // 没有变更

    const messages = {
      sync: `Sync: memory-decay数据同步 ${new Date().toISOString()}`,
      register: `Memory: 注册新记忆 ${new Date().toISOString()}`,
      update: `Memory: 更新记忆 ${new Date().toISOString()}`,
      delete: `Memory: 删除记忆 ${new Date().toISOString()}`,
      compress: `Memory: 压缩记忆 ${new Date().toISOString()}`,
      prune: `Memory: 清理记忆 ${new Date().toISOString()}`,
      restore: `Memory: 回滚操作 ${new Date().toISOString()}`
    };

    const msg = messages[type] || `Change: ${type}`;
    this.git.add('.');
    const result = this.git.commit(msg);
    return result;
  }

  // ==================== Public API ====================

  // 追踪memory-decay变更
  trackChange(type = 'change') {
    this._syncFromMemoryDecay();
    return this._autoCommit(type);
  }

  // 获取变更历史
  getHistory(options = {}) {
    const history = this.git.log({
      maxCount: options.maxCount || this.maxHistory,
      file: options.file || undefined
    });
    return history;
  }

  // 获取记忆在特定版本的内容
  getMemoryAtVersion(memoryId, commit = 'HEAD') {
    const files = fs.readdirSync(this.configDir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      const content = this.git.getFileAtCommit(commit, file);
      if (content) {
        try {
          const data = JSON.parse(content);
          if (data[memoryId]) {
            return { file, memory: data[memoryId], commit };
          }
        } catch (e) {
          // 忽略解析错误
        }
      }
    }
    return null;
  }

  // 获取两个版本之间的差异
  getDiff(commit1, commit2 = 'HEAD~1') {
    const result = this.git.diff(commit1, commit2);
    return result;
  }

  // 回滚到指定版本
  rollback(commit) {
    // 先创建备份分支
    const backupName = `backup-${Date.now()}`;
    this.git.createBranch(backupName);

    // 获取目标commit的数据
    const files = fs.readdirSync(this.configDir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      const content = this.git.getFileAtCommit(commit, file);
      if (content) {
        // 恢复到memory-decay目录
        const dest = path.join(this.memoryDataDir, file);
        fs.writeFileSync(dest, content);
      }
    }

    // 记录回滚commit
    this._autoCommit('restore');
    return { success: true, backupBranch: backupName, rollbackTo: commit };
  }

  // 获取当前状态
  getStatus() {
    const currentCommit = this.git.getCurrentCommit();
    const branches = this.git.getBranches();
    const history = this.git.log({ maxCount: 5 });
    const status = this.git.status();

    return {
      currentCommit,
      branches,
      recentCommits: history.length,
      hasChanges: status.output.trim().length > 0,
      changeCount: status.output.trim().split('\n').filter(l => l.trim()).length
    };
  }

  // 强制同步并提交
  forceSync() {
    this._syncFromMemoryDecay();
    return this._autoCommit('sync');
  }

  // 获取每日备份（自动）
  createDailyBackup() {
    const date = new Date().toISOString().split('T')[0];
    const branchName = `daily-${date.replace(/-/g, '')}`;

    // 切换到main，提交当前状态
    this.git.add('.');
    const result = this.git.commit(`Daily backup: ${date}`);
    if (result.success) {
      return { success: true, branch: branchName, date };
    }
    return { success: false, error: result.error };
  }

  // 生成变更报告
  generateChangeReport(startCommit = null, endCommit = 'HEAD') {
    const logs = this.git.log({ maxCount: this.maxHistory });

    let startIdx = 0;
    if (startCommit) {
      startIdx = logs.findIndex(l => l.hash.startsWith(startCommit));
      if (startIdx === -1) startIdx = 0;
    }

    const changes = logs.slice(startIdx, 20); // 最近20条

    let report = `# 记忆变更报告\n\n`;
    report += `**生成时间**: ${new Date().toISOString()}\n`;
    report += `**当前版本**: ${this.git.getCurrentCommit()?.substring(0, 7)}\n\n`;

    report += `## 变更历史 (最近${changes.length}条)\n\n`;
    report += `| 版本 | 时间 | 变更类型 | 消息 |\n`;
    report += `|------|------|----------|------|\n`;

    for (const c of changes) {
      const type = c.message.includes('Register') ? '注册' :
                   c.message.includes('Update') ? '更新' :
                   c.message.includes('Delete') ? '删除' :
                   c.message.includes('Compress') ? '压缩' :
                   c.message.includes('Prune') ? '清理' :
                   c.message.includes('Restore') ? '回滚' :
                   c.message.includes('Sync') ? '同步' : '其他';
      report += `| ${c.hash.substring(0, 7)} | ${c.date} | ${type} | ${c.message.substring(0, 40)} |\n`;
    }

    return report;
  }
}

// ============================================================================
// CLI
// ============================================================================

if (require.main === module) {
  const args = process.argv.slice(2);
  const cmd = args[0];
  const mg = new MemoryGitVC();

  function showHelp() {
    console.log(`
Memory Git - P4-12 记忆版本控制

命令:
  track [--type <type>]    追踪变更 (sync|register|update|delete|compress|prune)
  history [--count <n>]    查看历史 (默认最近100条)
  diff <v1> [v2]           对比两个版本差异
  show <commit>             查看特定版本
  rollback <commit>        回滚到指定版本
  status                   当前状态
  sync                     强制同步
  backup                   创建每日备份
  report                   生成变更报告
  help                     显示帮助
`);
  }

  try {
    switch (cmd) {
      case 'track': {
        const typeIdx = args.indexOf('--type');
        const type = typeIdx > -1 ? args[typeIdx + 1] : 'change';
        const result = mg.trackChange(type);
        console.log(result.success ? '追踪成功' : '无变更: ' + result.error);
        break;
      }
      case 'history': {
        const countIdx = args.indexOf('--count');
        const count = countIdx > -1 ? parseInt(args[countIdx + 1]) : 100;
        const history = mg.getHistory({ maxCount: count });
        console.log(`历史记录 (${history.length}条):`);
        history.forEach(h => console.log(`  ${h.hash.substring(0,7)} ${h.date} ${h.message}`));
        break;
      }
      case 'diff': {
        const v1 = args[1];
        const v2 = args[2];
        const result = mg.getDiff(v1, v2);
        console.log(result.success ? result.output : result.error);
        break;
      }
      case 'show': {
        const commit = args[1];
        const result = mg.git.show(commit);
        console.log(result.success ? result.output : result.error);
        break;
      }
      case 'rollback': {
        const commit = args[1];
        const result = mg.rollback(commit);
        console.log(result.success ?
          `回滚成功! 备份分支: ${result.backupBranch}` :
          '回滚失败: ' + result.error);
        break;
      }
      case 'status': {
        const status = mg.getStatus();
        console.log(JSON.stringify(status, null, 2));
        break;
      }
      case 'sync': {
        const result = mg.forceSync();
        console.log(result.success ? '同步成功' : '无变更');
        break;
      }
      case 'backup': {
        const result = mg.createDailyBackup();
        console.log(result.success ?
          `备份成功: ${result.branch}` :
          '备份失败: ' + result.error);
        break;
      }
      case 'report': {
        console.log(mg.generateChangeReport());
        break;
      }
      default:
        showHelp();
    }
  } catch (e) {
    console.error(`错误: ${e.message}`);
  }
}

module.exports = { MemoryGitVC, SimpleGit };
console.log('[MemoryGit] 加载成功 - P4-12 记忆版本控制');
