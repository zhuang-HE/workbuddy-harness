#!/usr/bin/env node
/**
 * context-awareness - WorkBuddy P4-5 上下文感知
 * 四维上下文感知（环境/项目/时间/对话），动态行为策略调整
 *
 * 维度: D1-Identity
 * 优先级: P1
 * 创建: 2026-05-12
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// ============================================================================
// Context Awareness Engine
// ============================================================================

class ContextAwareness {
  constructor(options = {}) {
    this.configDir = options.configDir || path.join(os.homedir(), '.workbuddy', 'context-awareness');
    this.context = { environment: {}, project: {}, user: {}, time: {}, conversation: {} };
    this.history = [];
    this.lastScan = null;

    this.ContextType = {
      ENVIRONMENT: 'environment', PROJECT: 'project', USER: 'user',
      TIME: 'time', CONVERSATION: 'conversation', SYSTEM: 'system'
    };

    this._ensureConfigDir();
  }

  _ensureConfigDir() {
    const p = path.join(this.configDir, 'snapshots');
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
  }

  _generateId() { return Math.random().toString(36).substring(2, 10); }
  _timestamp() { return new Date().toISOString(); }

  // ==================== Context Scanning ====================

  scanAll() {
    this.context.environment = this.scanEnvironment();
    this.context.project = this.scanProject();
    this.context.time = this.scanTime();
    this.context.user = this._getUserContext();
    this.lastScan = Date.now();
    this.history.push({ timestamp: this._timestamp(), summary: this.getSummary() });
    if (this.history.length > 100) this.history = this.history.slice(-100);
    return this.context;
  }

  scanEnvironment() {
    return {
      os: process.platform,
      shell: process.env.SHELL || (process.platform === 'win32' ? 'cmd' : 'bash'),
      workspace: process.cwd(),
      nodeVersion: process.version,
      homeDir: os.homedir(),
      isWindows: process.platform === 'win32',
      hostname: os.hostname(),
      arch: process.arch,
      cpus: os.cpus().length,
      totalMem: Math.round(os.totalmem() / (1024 * 1024 * 1024)) + 'GB',
      freeMem: Math.round(os.freemem() / (1024 * 1024 * 1024)) + 'GB'
    };
  }

  scanProject() {
    const cwd = process.cwd();
    const hasGit = fs.existsSync(path.join(cwd, '.git'));
    const hasPackageJson = fs.existsSync(path.join(cwd, 'package.json'));
    const hasRequirements = fs.existsSync(path.join(cwd, 'requirements.txt'));
    const hasDocker = fs.existsSync(path.join(cwd, 'Dockerfile'));

    let projectType = 'unknown';
    if (hasPackageJson) projectType = 'node';
    else if (hasRequirements || fs.existsSync(path.join(cwd, 'setup.py')) || fs.existsSync(path.join(cwd, 'pyproject.toml'))) projectType = 'python';
    else if (fs.existsSync(path.join(cwd, 'index.html'))) projectType = 'web';
    else if (fs.existsSync(path.join(cwd, 'Cargo.toml'))) projectType = 'rust';

    let pkgName = path.basename(cwd);
    let pkgVersion = 'unknown';
    if (hasPackageJson) {
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));
        pkgName = pkg.name || pkgName;
        pkgVersion = pkg.version || pkgVersion;
      } catch (e) { }
    }

    return {
      name: pkgName,
      version: pkgVersion,
      type: projectType,
      hasGit,
      hasPackageJson,
      hasDocker,
      workspacePath: cwd
    };
  }

  scanTime() {
    const now = new Date();
    const hour = now.getHours();
    const dayOfWeek = now.getDay();
    const dayNames = ['日', '一', '二', '三', '四', '五', '六'];

    let timeOfDay;
    if (hour < 6) timeOfDay = '凌晨';
    else if (hour < 12) timeOfDay = '上午';
    else if (hour < 18) timeOfDay = '下午';
    else timeOfDay = '晚上';

    return {
      timestamp: this._timestamp(),
      hour,
      minute: now.getMinutes(),
      timeOfDay,
      dayOfWeek: dayNames[dayOfWeek],
      dayOfWeekNum: dayOfWeek,
      isWeekend: dayOfWeek === 0 || dayOfWeek === 6,
      date: now.toISOString().split('T')[0]
    };
  }

  _getUserContext() {
    return {
      sessionStart: this._timestamp(),
      turnCount: this.context.conversation?.turnCount || 0,
      currentFocus: this.context.conversation?.focus || '未知'
    };
  }

  updateConversationContext(turnCount, taskType, focusArea) {
    this.context.conversation = {
      turnCount: turnCount || (this.context.conversation?.turnCount || 0) + 1,
      taskType: taskType || this.context.conversation?.taskType || 'general',
      focus: focusArea || this.context.conversation?.focus || 'general'
    };
  }

  freshnessCheck() {
    const age = this.lastScan ? (Date.now() - this.lastScan) / 1000 : Infinity;
    return { fresh: age < 300, age: Math.round(age) };
  }

  // ==================== Context Query ====================

  getContext(type) {
    return this.context[type] || null;
  }

  getSummary() {
    const env = this.context.environment;
    const proj = this.context.project;
    const time = this.context.time;
    const conv = this.context.conversation;
    const parts = [];
    if (proj?.name) parts.push(`项目: ${proj.name}(${proj.type || '?'})`);
    if (time?.timeOfDay) parts.push(`时段: ${time.timeOfDay}`);
    if (env?.os) parts.push(`系统: ${env.os}`);
    if (conv?.turnCount) parts.push(`轮次: ${conv.turnCount}`);
    return parts.join(' | ') || '无上下文';
  }

  getFullContext() {
    return { ...this.context, lastScan: this.lastScan ? this._timestamp() : null };
  }

  detectChanges() {
    if (this.history.length < 2) return { hasChanges: false, changes: [] };
    // Simple detection based on project type
    const changes = [];
    const fresh = this.freshnessCheck();
    if (!fresh.fresh) changes.push('上下文过期，已超过5分钟');
    return { hasChanges: changes.length > 0, changes };
  }

  // ==================== Context Application ====================

  enrichPrompt(prompt, options = {}) {
    const ctx = this.scanAll();
    const time = ctx.time;
    const proj = ctx.project;

    let enriched = prompt;

    // Add project context
    if (proj.type !== 'unknown') {
      enriched = `[项目: ${proj.name} (${proj.type})] ${enriched}`;
    }

    // Add time hints
    if (options.includeTime !== false) {
      if (time.timeOfDay === '晚上' || time.timeOfDay === '凌晨') {
        enriched += ' (请简洁回复)';
      }
    }

    return enriched;
  }

  routeTask(taskType) {
    const time = this.scanTime();
    const hour = time.hour;

    // Night time: use lighter model
    if (hour >= 22 || hour < 7) {
      return { model: 'qwen2.5:1.5b', reason: '深夜时段，使用轻量模型' };
    }

    // Day time heavy tasks
    if (['code_generation', 'analysis', 'research', 'planning'].includes(taskType)) {
      return { model: 'qwen3:4b-opt', reason: '复杂任务，使用主力模型' };
    }

    return { model: 'qwen2.5:1.5b', reason: '日常任务，使用默认模型' };
  }

  suggestSkills() {
    const proj = this.scanProject();
    const skills = [];

    if (proj.type === 'node') skills.push('code-review', 'git-workflow', 'documentation');
    else if (proj.type === 'python') skills.push('code-review', 'documentation');
    else if (proj.type === 'web') skills.push('code-review', 'documentation-lookup');

    if (proj.hasGit) skills.push('git-workflow');
    return skills;
  }

  getRecommendedStrategy() {
    const time = this.scanTime();
    const conv = this.context.conversation || {};
    const strategy = { verbosity: 'normal' };

    // Night mode
    if (time.hour >= 22 || time.hour < 7) {
      strategy.verbosity = 'concise';
      strategy.autoConfirm = true;
    }

    // Long session
    if (conv.turnCount > 20) {
      strategy.suggestBreak = true;
      strategy.contextCompression = true;
    }

    // Weekend mode
    if (time.isWeekend) {
      strategy.casual = true;
    }

    return strategy;
  }

  // ==================== State Awareness ====================

  isUserLikelyTired() {
    return (this.context.conversation?.turnCount || 0) > 20;
  }

  isContextOverloaded() {
    return (this.context.conversation?.turnCount || 0) > 40;
  }

  recommendBreak() {
    if (this.isUserLikelyTired()) {
      return '提示: 当前会话已较长，建议休息片刻以保持效率。';
    }
    return null;
  }

  // ==================== Persistence ====================

  saveSnapshot() {
    const snapshot = {
      timestamp: this._timestamp(),
      context: this.context,
      summary: this.getSummary()
    };
    const p = path.join(this.configDir, 'snapshots', `${Date.now()}.json`);
    fs.writeFileSync(p, JSON.stringify(snapshot, null, 2));
    return snapshot;
  }

  loadSnapshot() {
    const dir = path.join(this.configDir, 'snapshots');
    if (!fs.existsSync(dir)) return null;
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort().reverse();
    if (files.length === 0) return null;
    try {
      return JSON.parse(fs.readFileSync(path.join(dir, files[0]), 'utf8'));
    } catch (e) {
      return null;
    }
  }

  getHistory(count = 10) {
    return this.history.slice(-count);
  }
}

// ============================================================================
// CLI
// ============================================================================
if (require.main === module) {
  const args = process.argv.slice(2);
  const cmd = args[0];
  const ca = new ContextAwareness();

  function showHelp() {
    console.log(`
Context Awareness - P4-5 上下文感知

命令:
  scan              全维度扫描
  summary           上下文摘要
  enrich "<prompt>"  丰富提示词
  strategy          行为策略推荐
  suggest           技能建议
  route <taskType>  任务路由建议
  snapshot save     保存快照
  snapshot load     加载快照
  history [count]   历史记录
  help              显示帮助
`);
  }

  try {
    switch (cmd) {
      case 'scan': {
        const ctx = ca.scanAll();
        console.log(JSON.stringify({
          environment: ctx.environment,
          project: ctx.project,
          time: ctx.time
        }, null, 2));
        break;
      }
      case 'summary':
        console.log(ca.getSummary());
        break;
      case 'enrich': {
        const prompt = args[1] || '';
        console.log(`原始: ${prompt}`);
        console.log(`丰富: ${ca.enrichPrompt(prompt)}`);
        break;
      }
      case 'strategy':
        console.log(JSON.stringify(ca.getRecommendedStrategy(), null, 2));
        break;
      case 'suggest': {
        const skills = ca.suggestSkills();
        console.log(`推荐Skills: ${skills.join(', ')}`);
        break;
      }
      case 'route': {
        const r = ca.routeTask(args[1] || 'general');
        console.log(`推荐模型: ${r.model} (${r.reason})`);
        break;
      }
      case 'snapshot':
        if (args[1] === 'save') {
          const s = ca.saveSnapshot();
          console.log(`快照已保存: ${s.timestamp}`);
        } else if (args[1] === 'load') {
          const s = ca.loadSnapshot();
          console.log(s ? JSON.stringify(s, null, 2) : '无快照');
        }
        break;
      case 'history': {
        const h = ca.getHistory(parseInt(args[1]) || 10);
        h.forEach(e => console.log(`${e.timestamp}: ${e.summary}`));
        break;
      }
      default:
        showHelp();
    }
  } catch (e) {
    console.error(`错误: ${e.message}`);
  }
}

module.exports = ContextAwareness;
console.log('[ContextAwareness] 加载成功 - P4-5 上下文感知');
