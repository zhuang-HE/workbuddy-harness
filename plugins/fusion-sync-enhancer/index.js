#!/usr/bin/env node
/**
 * fusion-sync-enhancer - WorkBuddy P4-7 融合同步增强器
 * 双向增量同步、冲突智能解决、同步健康监控、与P4插件集成
 *
 * 维度: D6-Integration
 * 优先级: P2
 * 创建: 2026-05-12
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

// ============================================================================
// Fusion Sync Enhancer
// ============================================================================

class FusionSyncEnhancer {
  constructor(options = {}) {
    this.configDir = options.configDir || path.join(os.homedir(), '.workbuddy', 'fusion-sync-enhancer');
    this.wbMemoryDir = options.wbMemoryDir || path.join(os.homedir(), '.workbuddy', 'memory');
    this.wbSkillsDir = options.wbSkillsDir || path.join(os.homedir(), '.workbuddy', 'skills');
    this.wbPluginsDir = options.wbPluginsDir || path.join(os.homedir(), '.workbuddy', 'plugins');
    this.hermesDir = options.hermesDir || path.join(os.homedir(), '.hermes');
    this.hermesMemoriesDir = path.join(this.hermesDir, 'memories');
    this.hermesSkillsDir = path.join(this.hermesDir, 'skills');
    this.hermesPrefillDir = path.join(this.hermesDir, 'prefill');

    this.state = { lastSync: null, syncCount: 0, conflicts: [], health: { score: 100, issues: [] } };
    this.fileHashes = new Map();
    this.conflictResolver = new ConflictResolver();

    this.SyncDirection = { WB_TO_HERMES: 'wb→hm', HERMES_TO_WB: 'hm→wb', BIDIRECTIONAL: 'both' };
    this.ConflictStrategy = { WB_WINS: 'wb_wins', HERMES_WINS: 'hermes_wins', NEWEST_WINS: 'newest', MERGE: 'merge', MANUAL: 'manual' };

    this._ensureConfigDir();
    this._loadState();
  }

  _ensureConfigDir() {
    for (const d of ['state', 'diffs', 'reports']) {
      const p = path.join(this.configDir, d);
      if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
    }
  }

  _generateId() { return crypto.randomBytes(4).toString('hex'); }
  _timestamp() { return new Date().toISOString(); }
  _hash(content) { return crypto.createHash('md5').update(content || '').digest('hex'); }

  _loadState() {
    const p = path.join(this.configDir, 'state', 'sync-state.json');
    try { if (fs.existsSync(p)) this.state = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { }
  }

  _saveState() {
    const p = path.join(this.configDir, 'state', 'sync-state.json');
    fs.writeFileSync(p, JSON.stringify(this.state, null, 2));
  }

  // ==================== File Scanning ====================

  scanDirectory(dir, filter = () => true) {
    const files = [];
    if (!fs.existsSync(dir)) return files;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isFile() && filter(e.name)) {
        const fp = path.join(dir, e.name);
        files.push({ name: e.name, path: fp, size: fs.statSync(fp).size, mtime: fs.statSync(fp).mtimeMs });
      }
    }
    return files;
  }

  computeFileHashes(files) {
    const hashes = {};
    for (const f of files) {
      try {
        hashes[f.name] = this._hash(fs.readFileSync(f.path, 'utf8'));
      } catch (e) {
        hashes[f.name] = 'ERR:' + e.message;
      }
    }
    return hashes;
  }

  // ==================== Diff Detection ====================

  detectChanges(sourceFiles, targetDir, targetFilter) {
    const sourceHashes = this.computeFileHashes(sourceFiles);
    const targetFiles = this.scanDirectory(targetDir, targetFilter || (() => true));
    const targetHashes = this.computeFileHashes(targetFiles);

    const changes = { added: [], modified: [], deleted: [], unchanged: [] };

    for (const [name, hash] of Object.entries(sourceHashes)) {
      if (!(name in targetHashes)) changes.added.push(name);
      else if (targetHashes[name] !== hash) changes.modified.push(name);
      else changes.unchanged.push(name);
    }

    for (const name of Object.keys(targetHashes)) {
      if (!(name in sourceHashes)) changes.deleted.push(name);
    }

    changes.summary = { total: Object.keys(sourceHashes).length, added: changes.added.length, modified: changes.modified.length, deleted: changes.deleted.length, unchanged: changes.unchanged.length, changePercent: Math.round((changes.added.length + changes.modified.length) / Math.max(Object.keys(sourceHashes).length, 1) * 100) };

    return changes;
  }

  // ==================== Incremental Sync ====================

  incrementalSync(direction = 'both', options = {}) {
    const report = { timestamp: this._timestamp(), direction, operations: [], conflicts: [], errors: [] };
    const dryRun = options.dryRun || false;

    if (direction === 'wb→hm' || direction === 'both') {
      const r = this._syncDirection('wb→hm', dryRun);
      report.operations.push(...r.operations);
      report.conflicts.push(...r.conflicts);
      report.errors.push(...r.errors);
    }

    if (direction === 'hm→wb' || direction === 'both') {
      const r = this._syncDirection('hm→wb', dryRun);
      report.operations.push(...r.operations);
      report.conflicts.push(...r.conflicts);
      report.errors.push(...r.errors);
    }

    this.state.lastSync = this._timestamp();
    this.state.syncCount++;
    this._saveState();

    report.summary = {
      totalOps: report.operations.length,
      added: report.operations.filter(o => o.type === 'added').length,
      updated: report.operations.filter(o => o.type === 'updated').length,
      skipped: report.operations.filter(o => o.type === 'skipped').length,
      conflicts: report.conflicts.length,
      errors: report.errors.length
    };

    this._saveReport(report);
    return report;
  }

  _syncDirection(dir, dryRun) {
    const ops = [];
    const conflicts = [];
    const errors = [];

    if (dir === 'wb→hm') {
      // Sync WorkBuddy memory → HERMES memories
      const wbFiles = this.scanDirectory(this.wbMemoryDir, f => f.endsWith('.md'));
      const changes = this.detectChanges(wbFiles, this.hermesMemoriesDir, f => f.startsWith('wb-sync-'));

      for (const name of [...changes.added, ...changes.modified]) {
        const wbFile = wbFiles.find(f => f.name === name);
        if (!wbFile) continue;
        try {
          const content = fs.readFileSync(wbFile.path, 'utf8');
          const targetName = `wb-sync-${name.replace('.md', '')}.md`;
          const targetPath = path.join(this.hermesMemoriesDir, targetName);

          // Check for conflicts
          if (changes.modified.includes(name) && fs.existsSync(targetPath)) {
            const resolved = this.conflictResolver.resolve(
              { name, path: wbFile.path, content, mtime: wbFile.mtime },
              { name: targetName, path: targetPath, content: fs.readFileSync(targetPath, 'utf8'), mtime: fs.statSync(targetPath).mtimeMs }
            );
            if (resolved.conflict) { conflicts.push(resolved); continue; }
          }

          if (!dryRun) {
            fs.writeFileSync(targetPath, content);
            ops.push({ type: 'added', from: `wb:${name}`, to: `hm:${targetName}` });
          } else {
            ops.push({ type: 'would_add', from: `wb:${name}`, to: `hm:${targetName}` });
          }
        } catch (e) {
          errors.push({ operation: `sync ${name}`, error: e.message });
        }
      }
    }

    if (dir === 'hm→wb') {
      // Sync HERMES evolution → WorkBuddy
      const hmEvo = path.join(this.hermesMemoriesDir, 'evolution.md');
      if (fs.existsSync(hmEvo)) {
        try {
          const content = fs.readFileSync(hmEvo, 'utf8');
          const wbTarget = path.join(this.wbMemoryDir, 'hermes-evolution.md');
          const isNew = !fs.existsSync(wbTarget);
          if (!dryRun) {
            fs.writeFileSync(wbTarget, content);
            ops.push({ type: isNew ? 'added' : 'updated', from: 'hm:evolution.md', to: 'wb:hermes-evolution.md' });
          }
        } catch (e) {
          errors.push({ operation: 'sync evolution', error: e.message });
        }
      }
    }

    return { operations: ops, conflicts, errors };
  }

  // ==================== Smart Conflict Resolution ====================

  resolveAllConflicts(strategy = 'newest') {
    const resolved = [];
    for (const c of this.state.conflicts || []) {
      const r = this.conflictResolver.resolve(c.source, c.target, strategy);
      resolved.push(r);
    }
    this.state.conflicts = [];
    this._saveState();
    return resolved;
  }

  // ==================== Health Monitoring ====================

  checkHealth() {
    const issues = [];
    let score = 100;

    // Check sync recency
    if (this.state.lastSync) {
      const hoursSince = (Date.now() - new Date(this.state.lastSync).getTime()) / 3600000;
      if (hoursSince > 24) { score -= 30; issues.push({ severity: 'error', message: `超过24小时未同步 (${hoursSince.toFixed(1)}h)` }); }
      else if (hoursSince > 12) { score -= 15; issues.push({ severity: 'warning', message: `超过12小时未同步 (${hoursSince.toFixed(1)}h)` }); }
    } else {
      score -= 40; issues.push({ severity: 'error', message: '从未同步' });
    }

    // Check pending conflicts
    const pendingConflicts = (this.state.conflicts || []).length;
    if (pendingConflicts > 5) { score -= 20; issues.push({ severity: 'error', message: `${pendingConflicts}个未解决冲突` }); }
    else if (pendingConflicts > 0) { score -= 10; issues.push({ severity: 'warning', message: `${pendingConflicts}个未解决冲突` }); }

    // Check directory existence
    if (!fs.existsSync(this.hermesMemoriesDir)) { score -= 15; issues.push({ severity: 'error', message: 'HERMES memories目录不存在' }); }
    if (!fs.existsSync(this.hermesPrefillDir)) { score -= 10; issues.push({ severity: 'warning', message: 'HERMES prefill目录不存在' }); }

    this.state.health = { score: Math.max(0, score), issues, checkedAt: this._timestamp() };
    this._saveState();
    return this.state.health;
  }

  // ==================== Context Sync (P4-5 Integration) ====================

  syncContextToHermes(context) {
    const ctxFile = path.join(this.hermesPrefillDir, 'wb-context.json');
    try {
      fs.writeFileSync(ctxFile, JSON.stringify({
        generated: this._timestamp(),
        project: context.project || {},
        time: context.time || {},
        environment: context.environment || {},
        summary: context.summary || ''
      }, null, 2));
      return { synced: true, file: ctxFile };
    } catch (e) {
      return { synced: false, error: e.message };
    }
  }

  // ==================== Skill Sync ====================

  syncSkills(direction = 'both', options = {}) {
    const report = { timestamp: this._timestamp(), direction, synced: [], failed: [] };
    const dryRun = options.dryRun || false;

    // WB → HM skills
    const wbSkillFiles = this.scanDirectory(this.wbSkillsDir, f => f.endsWith('.md'));
    const hmSkillFiles = this.scanDirectory(this.hermesSkillsDir, f => f.endsWith('.md'));

    const wbSkillNames = new Set(wbSkillFiles.map(f => f.name));
    const hmSkillNames = new Set(hmSkillFiles.map(f => f.name));

    // Skills only in WB → copy to HM
    for (const name of wbSkillNames) {
      if (!hmSkillNames.has(name)) {
        const wbF = wbSkillFiles.find(f => f.name === name);
        if (!wbF) continue;
        try {
          if (!dryRun) {
            fs.copyFileSync(wbF.path, path.join(this.hermesSkillsDir, name));
          }
          report.synced.push({ name, direction: 'wb→hm', status: dryRun ? 'would_copy' : 'copied' });
        } catch (e) {
          report.failed.push({ name, error: e.message });
        }
      }
    }

    return report;
  }

  // ==================== Health Report ====================

  generateReport() {
    const health = this.checkHealth();
    let md = `# Fusion Sync 健康报告\n\n**生成时间**: ${this._timestamp()}\n**健康分数**: ${health.score}/100\n\n`;

    md += `## 同步状态\n`;
    md += `| 指标 | 值 |\n|---|---|\n`;
    md += `| 上次同步 | ${this.state.lastSync || '从未'} |\n`;
    md += `| 同步次数 | ${this.state.syncCount} |\n`;
    md += `| 未解决冲突 | ${(this.state.conflicts || []).length} |\n\n`;

    if (health.issues.length > 0) {
      md += `## 问题\n`;
      health.issues.forEach(i => { md += `- [${i.severity}] ${i.message}\n`; });
    }

    return md;
  }

  _saveReport(report) {
    const p = path.join(this.configDir, 'reports', `sync-${Date.now()}.json`);
    fs.writeFileSync(p, JSON.stringify(report, null, 2));
  }
}

// ============================================================================
// Conflict Resolver
// ============================================================================

class ConflictResolver {
  resolve(source, target, strategy = 'newest') {
    const strategies = {
      wb_wins: () => ({ action: 'use_source', reason: 'WB优先' }),
      hermes_wins: () => ({ action: 'use_target', reason: 'HM优先' }),
      newest: () => ({
        action: source.mtime > target.mtime ? 'use_source' : 'use_target',
        reason: `时间优先: ${source.mtime > target.mtime ? 'WB更新' : 'HM更新'}`,
        sourceTime: new Date(source.mtime).toISOString(),
        targetTime: new Date(target.mtime).toISOString()
      }),
      merge: () => ({
        action: 'merge',
        reason: '两方内容合并',
        merged: `[WB] ${source.content.substring(0, 200)}\n---\n[HM] ${target.content.substring(0, 200)}`
      }),
      manual: () => ({ action: 'manual', reason: '手动解决', conflict: true })
    };

    return {
      source: { name: source.name, mtime: source.mtime },
      target: { name: target.name, mtime: target.mtime },
      resolution: (strategies[strategy] || strategies.newest)()
    };
  }
}

// ============================================================================
// CLI
// ============================================================================
if (require.main === module) {
  const args = process.argv.slice(2);
  const cmd = args[0];
  const fse = new FusionSyncEnhancer();

  function showHelp() {
    console.log(`
Fusion Sync Enhancer - P4-7 融合同步增强器

命令:
  sync [--direction wb→hm|hm→wb|both] [--dry-run]    增量同步
  diff [--direction wb→hm|hm→wb]                      检测差异
  health                                               健康检查
  conflicts [resolve --strategy newest|wb_wins]         冲突解决
  report                                               生成报告
  context-sync                                         同步上下文到Hermes
  skill-sync [--dry-run]                               同步Skills
  stats                                                统计信息
  help                                                 显示帮助
`);
  }

  try {
    switch (cmd) {
      case 'sync': {
        const direction = args.includes('--direction') ? args[args.indexOf('--direction') + 1] : 'both';
        const dryRun = args.includes('--dry-run');
        const report = fse.incrementalSync(direction, { dryRun });
        console.log(`同步完成: ${report.summary.totalOps}操作, ${report.summary.conflicts}冲突, ${report.summary.errors}错误`);
        break;
      }

      case 'diff': {
        const dir = args.includes('--direction') ? args[args.indexOf('--direction') + 1] : 'wb→hm';
        if (dir === 'wb→hm' || dir === 'both') {
          const wbFiles = fse.scanDirectory(fse.wbMemoryDir, f => f.endsWith('.md'));
          const changes = fse.detectChanges(wbFiles, fse.hermesMemoriesDir, f => f.startsWith('wb-sync-'));
          console.log(`WB→HM 差异: +${changes.added.length}新增, ~${changes.modified.length}修改, -${changes.deleted.length}删除`);
        }
        break;
      }

      case 'health': {
        const h = fse.checkHealth();
        console.log(`健康分数: ${h.score}/100`);
        if (h.issues.length) h.issues.forEach(i => console.log(`  [${i.severity}] ${i.message}`));
        break;
      }

      case 'conflicts': {
        const strategy = args.includes('--strategy') ? args[args.indexOf('--strategy') + 1] : 'newest';
        const r = fse.resolveAllConflicts(strategy);
        console.log(`已解决: ${r.length} 个冲突 (策略: ${strategy})`);
        break;
      }

      case 'report':
        console.log(fse.generateReport());
        break;

      case 'context-sync':
        try {
          const CA = require('../context-awareness/index.js');
          const ca = new CA();
          const ctx = ca.scanAll();
          const r = fse.syncContextToHermes({ ...ctx, summary: ca.getSummary() });
          console.log(r.synced ? `上下文已同步: ${r.file}` : `同步失败: ${r.error}`);
        } catch (e) {
          console.log('ContextAwareness不可用，仅同步基本信息');
          const r = fse.syncContextToHermes({ project: { name: process.cwd() }, summary: 'basic' });
          console.log(r.synced ? `基本上下文已同步` : `失败: ${r.error}`);
        }
        break;

      case 'skill-sync': {
        const dryRun = args.includes('--dry-run');
        const r = fse.syncSkills('both', { dryRun });
        console.log(`Skills: ${r.synced.length}同步, ${r.failed.length}失败`);
        break;
      }

      case 'stats':
        console.log(JSON.stringify({
          lastSync: fse.state.lastSync,
          syncCount: fse.state.syncCount,
          pendingConflicts: (fse.state.conflicts || []).length,
          health: fse.state.health
        }, null, 2));
        break;

      default:
        showHelp();
    }
  } catch (e) {
    console.error(`错误: ${e.message}`);
  }
}

module.exports = FusionSyncEnhancer;
console.log('[FusionSyncEnhancer] 加载成功 - P4-7 融合同步增强器');
