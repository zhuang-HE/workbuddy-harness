/**
 * context-awareness - WorkBuddy P4-5 上下文感知 [增强版]
 * 四维上下文感知（环境/项目/时间/对话），动态行为策略调整
 *
 * 维度: D1-Identity
 * 优先级: P1
 *
 * 增强内容：
 * - 深夜简洁模式增强
 * - 上下文压缩与摘要
 * - 多会话上下文关联
 * - 隐私敏感度评估
 * - 用户行为模式识别
 * - 动态Token预算管理
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
    this.context = {
      environment: {},
      project: {},
      user: {},
      time: {},
      conversation: {}
    };
    this.history = [];
    this.lastScan = null;
    this.sessions = new Map(); // 多会话管理
    this.userPatterns = new Map(); // 用户行为模式
    this.tokenBudget = { total: 8000, used: 0, warningThreshold: 0.8 }; // Token预算

    this.ContextType = {
      ENVIRONMENT: 'environment',
      PROJECT: 'project',
      USER: 'user',
      TIME: 'time',
      CONVERSATION: 'conversation',
      SYSTEM: 'system'
    };

    // 隐私敏感度配置
    this.privacyLevels = {
      PUBLIC: { level: 0, keywords: ['公开', '文档', '说明'] },
      INTERNAL: { level: 1, keywords: ['内部', '代码', '配置'] },
      CONFIDENTIAL: { level: 2, keywords: ['密码', '密钥', '密钥'] },
      RESTRICTED: { level: 3, keywords: ['机密', '敏感', '个人'] }
    };

    // 深夜简洁模式配置
    this.nightModeConfig = {
      startHour: 22,
      endHour: 7,
      maxResponseTokens: 200,
      skipExplanations: true,
      useShorterPrompts: true
    };

    this._ensureConfigDir();
    this._loadUserPatterns();
  }

  // ==================== Session Management ====================

  /**
   * 创建新会话
   */
  createSession(sessionId = null) {
    const sid = sessionId || this._generateId();
    const session = {
      id: sid,
      startTime: Date.now(),
      turnCount: 0,
      contextSnapshots: [],
      userPreferences: {},
      tokenUsage: 0,
      status: 'active'
    };
    this.sessions.set(sid, session);
    this.context.conversation = { sessionId: sid, turnCount: 0 };
    return session;
  }

  /**
   * 切换会话
   */
  switchSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    this.context.conversation = {
      sessionId,
      turnCount: session.turnCount,
      previousContext: this.context
    };
    return session;
  }

  /**
   * 获取会话历史
   */
  getSessionHistory(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    return {
      turnCount: session.turnCount,
      duration: Date.now() - session.startTime,
      snapshots: session.contextSnapshots.slice(-10)
    };
  }

  /**
   * 合并多会话上下文
   */
  mergeSessionContexts(sessionIds) {
    const contexts = [];
    for (const sid of sessionIds) {
      const session = this.sessions.get(sid);
      if (session && session.contextSnapshots.length > 0) {
        contexts.push(session.contextSnapshots[session.contextSnapshots.length - 1]);
      }
    }

    if (contexts.length === 0) return null;

    // 合并策略：取最新的上下文，保留关键信息
    const merged = {
      project: contexts[0].project,
      time: this.scanTime(),
      environment: contexts[0].environment,
      conversation: {
        turnCount: contexts.reduce((s, c) => s + (c.conversation?.turnCount || 0), 0),
        merged: true,
        sessionCount: contexts.length
      }
    };

    return merged;
  }

  // ==================== Context Scanning ====================

  scanAll() {
    this.context.environment = this.scanEnvironment();
    this.context.project = this.scanProject();
    this.context.time = this.scanTime();
    this.context.user = this._getUserContext();
    this.context.conversation = {
      ...this.context.conversation,
      turnCount: (this.context.conversation?.turnCount || 0) + 1
    };

    this.lastScan = Date.now();
    this._recordSnapshot();
    this._updateUserPatterns();

    if (this.history.length > 100) this.history = this.history.slice(-100);

    return this.context;
  }

  _recordSnapshot() {
    const snapshot = {
      timestamp: this._timestamp(),
      summary: this.getSummary(),
      context: { ...this.context }
    };

    // 更新当前会话
    const sessionId = this.context.conversation?.sessionId;
    if (sessionId && this.sessions.has(sessionId)) {
      const session = this.sessions.get(sessionId);
      session.contextSnapshots.push(snapshot);
      if (session.contextSnapshots.length > 50) session.contextSnapshots.shift();
    }
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
      freeMem: Math.round(os.freemem() / (1024 * 1024 * 1024)) + 'GB',
      envVars: this._sanitizeEnvVars()
    };
  }

  _sanitizeEnvVars() {
    // 隐藏敏感环境变量
    const sensitive = ['SECRET', 'PASSWORD', 'TOKEN', 'KEY', 'API_KEY', 'AUTH'];
    const safe = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (!sensitive.some(s => key.toUpperCase().includes(s))) {
        safe[key] = value;
      } else {
        safe[key] = '[REDACTED]';
      }
    }
    return safe;
  }

  scanProject() {
    const cwd = process.cwd();
    const hasGit = fs.existsSync(path.join(cwd, '.git'));
    const hasPackageJson = fs.existsSync(path.join(cwd, 'package.json'));
    const hasRequirements = fs.existsSync(path.join(cwd, 'requirements.txt'));
    const hasDocker = fs.existsSync(path.join(cwd, 'Dockerfile'));
    const hasReadme = fs.existsSync(path.join(cwd, 'README.md'));

    let projectType = 'unknown';
    if (hasPackageJson) projectType = 'node';
    else if (hasRequirements || fs.existsSync(path.join(cwd, 'setup.py')) || fs.existsSync(path.join(cwd, 'pyproject.toml'))) projectType = 'python';
    else if (fs.existsSync(path.join(cwd, 'index.html'))) projectType = 'web';
    else if (fs.existsSync(path.join(cwd, 'Cargo.toml'))) projectType = 'rust';
    else if (fs.existsSync(path.join(cwd, 'go.mod'))) projectType = 'go';

    let pkgName = path.basename(cwd);
    let pkgVersion = 'unknown';
    let description = '';

    if (hasPackageJson) {
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));
        pkgName = pkg.name || pkgName;
        pkgVersion = pkg.version || pkgVersion;
        description = pkg.description || '';
      } catch (e) { }
    }

    return {
      name: pkgName,
      version: pkgVersion,
      description,
      type: projectType,
      hasGit,
      hasPackageJson,
      hasDocker,
      hasReadme,
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

    // 工作时段判断
    const isWorkHours = hour >= 9 && hour < 18 && dayOfWeek >= 1 && dayOfWeek <= 5;

    return {
      timestamp: this._timestamp(),
      hour,
      minute: now.getMinutes(),
      second: now.getSeconds(),
      timeOfDay,
      dayOfWeek: dayNames[dayOfWeek],
      dayOfWeekNum: dayOfWeek,
      isWeekend: dayOfWeek === 0 || dayOfWeek === 6,
      isWorkHours,
      isNightTime: hour >= 22 || hour < 7,
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
      ...this.context.conversation,
      turnCount: turnCount || (this.context.conversation?.turnCount || 0) + 1,
      taskType: taskType || this.context.conversation?.taskType || 'general',
      focus: focusArea || this.context.conversation?.focus || 'general'
    };
  }

  freshnessCheck() {
    const age = this.lastScan ? (Date.now() - this.lastScan) / 1000 : Infinity;
    return {
      fresh: age < 300,
      age: Math.round(age),
      suggestion: age > 300 ? '建议重新扫描上下文' : null
    };
  }

  // ==================== User Behavior Patterns ====================

  _updateUserPatterns() {
    const sessionId = this.context.conversation?.sessionId;
    if (!sessionId) return;

    const patterns = this.userPatterns.get(sessionId) || {
      taskTypes: {},
      preferredComplexity: {},
      avgResponseLength: [],
      preferredSkills: {},
      sessionCount: 0
    };

    patterns.sessionCount++;
    const taskType = this.context.conversation?.taskType || 'general';
    patterns.taskTypes[taskType] = (patterns.taskTypes[taskType] || 0) + 1;

    this.userPatterns.set(sessionId, patterns);
    this._saveUserPatterns();
  }

  getUserPatterns(sessionId = null) {
    const sid = sessionId || this.context.conversation?.sessionId;
    return this.userPatterns.get(sid) || null;
  }

  predictNextAction() {
    const patterns = this.getUserPatterns();
    if (!patterns) return null;

    // 预测最可能的下一个任务类型
    const mostLikely = Object.entries(patterns.taskTypes)
      .sort((a, b) => b[1] - a[1])[0];

    return {
      predictedTaskType: mostLikely?.[0] || 'general',
      confidence: mostLikely ? mostLikely[1] / patterns.sessionCount : 0,
      allPredictions: patterns.taskTypes
    };
  }

  _loadUserPatterns() {
    const p = path.join(this.configDir, 'user-patterns.json');
    try {
      if (fs.existsSync(p)) {
        const data = JSON.parse(fs.readFileSync(p, 'utf8'));
        for (const [k, v] of Object.entries(data)) {
          this.userPatterns.set(k, v);
        }
      }
    } catch (e) { /* ignore */ }
  }

  _saveUserPatterns() {
    const p = path.join(this.configDir, 'user-patterns.json');
    try {
      const data = Object.fromEntries(this.userPatterns);
      fs.writeFileSync(p, JSON.stringify(data, null, 2));
    } catch (e) { /* ignore */ }
  }

  // ==================== Privacy Sensitivity ====================

  /**
   * 评估内容隐私敏感度
   */
  assessPrivacySensitivity(content) {
    const lower = content.toLowerCase();
    let maxLevel = 0;
    const detected = [];

    for (const [name, config] of Object.entries(this.privacyLevels)) {
      for (const keyword of config.keywords) {
        if (lower.includes(keyword.toLowerCase())) {
          if (config.level > maxLevel) maxLevel = config.level;
          detected.push({ keyword, level: name });
        }
      }
    }

    // 检查常见敏感模式
    const sensitivePatterns = [
      { pattern: /password\s*[:=]\s*\S+/i, level: 2 },
      { pattern: /api[_-]?key\s*[:=]\s*\S+/i, level: 2 },
      { pattern: /secret\s*[:=]\s*\S+/i, level: 2 },
      { pattern: /Bearer\s+\S+/i, level: 2 },
      { pattern: /\d{3}-\d{2}-\d{4}/, level: 3 }, // SSN
      { pattern: /\d{16}/, level: 3 } // Credit card
    ];

    for (const sp of sensitivePatterns) {
      if (sp.pattern.test(content) && sp.level > maxLevel) {
        maxLevel = sp.level;
        detected.push({ pattern: 'detected', level: sp.level });
      }
    }

    const levelName = Object.entries(this.privacyLevels)
      .find(([, c]) => c.level === maxLevel)?.[0] || 'PUBLIC';

    return {
      level: maxLevel,
      levelName,
      detected,
      recommendation: this._getPrivacyRecommendation(maxLevel)
    };
  }

  _getPrivacyRecommendation(level) {
    const recommendations = {
      0: '可以公开讨论',
      1: '谨慎分享，仅限团队',
      2: '勿在日志中记录，考虑加密',
      3: '最高敏感度，仅必要时访问'
    };
    return recommendations[level] || recommendations[0];
  }

  // ==================== Token Budget Management ====================

  /**
   * 更新Token预算
   */
  updateTokenBudget(used) {
    this.tokenBudget.used = used;
    const ratio = used / this.tokenBudget.total;

    return {
      total: this.tokenBudget.total,
      used,
      remaining: this.tokenBudget.total - used,
      usageRatio: Math.round(ratio * 100),
      warning: ratio >= this.tokenBudget.warningThreshold,
      status: ratio >= 1 ? 'exceeded' : (ratio >= 0.8 ? 'warning' : 'healthy')
    };
  }

  /**
   * 获取推荐的最大响应长度
   */
  getRecommendedResponseLength(context) {
    const budget = this.updateTokenBudget(this.tokenBudget.used);
    const baseLength = budget.remaining;

    // 根据时间调整
    if (this.context.time?.isNightTime) {
      return Math.min(baseLength, this.nightModeConfig.maxResponseTokens);
    }

    // 根据对话长度调整
    const turnCount = this.context.conversation?.turnCount || 0;
    if (turnCount > 30) {
      return Math.round(baseLength * 0.7); // 长对话减少响应
    }

    return baseLength;
  }

  // ==================== Context Query ====================

  getContext(type) { return this.context[type] || null; }

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
    return {
      ...this.context,
      lastScan: this.lastScan ? this._timestamp() : null,
      tokenBudget: this.updateTokenBudget(this.tokenBudget.used)
    };
  }

  detectChanges() {
    if (this.history.length < 2) return { hasChanges: false, changes: [] };

    const changes = [];
    const fresh = this.freshnessCheck();
    if (!fresh.fresh) changes.push('上下文过期，已超过5分钟');

    // 检测项目变化
    const current = this.history[this.history.length - 1];
    const previous = this.history[this.history.length - 2];
    if (current?.context?.project?.name !== previous?.context?.project?.name) {
      changes.push(`项目变更: ${previous?.context?.project?.name} → ${current?.context?.project?.name}`);
    }

    return { hasChanges: changes.length > 0, changes };
  }

  // ==================== Context Application ====================

  enrichPrompt(prompt, options = {}) {
    const ctx = this.scanAll();
    const time = ctx.time;
    const proj = ctx.project;

    let enriched = prompt;

    // 添加项目上下文
    if (proj.type !== 'unknown') {
      enriched = `[项目: ${proj.name} (${proj.type})] ${enriched}`;
    }

    // 深夜简洁模式
    if (options.includeTime !== false) {
      if (time.isNightTime) {
        enriched += ' (请简洁回复)';
      }
    }

    // 用户偏好
    const patterns = this.getUserPatterns();
    if (patterns && patterns.sessionCount > 5) {
      const predicted = this.predictNextAction();
      if (predicted && predicted.confidence > 0.5) {
        enriched = `[预测: ${predicted.predictedTaskType}] ${enriched}`;
      }
    }

    return enriched;
  }

  /**
   * 深度Prompt丰富
   */
  deepEnrichPrompt(prompt, options = {}) {
    const ctx = this.scanAll();
    const segments = [];

    // 1. 任务类型标识
    if (options.taskType) {
      segments.push(`[任务类型: ${options.taskType}]`);
    }

    // 2. 项目上下文
    if (ctx.project?.type !== 'unknown') {
      segments.push(`[项目上下文: ${ctx.project.name} (${ctx.project.type})]`);
    }

    // 3. 时间感知
    if (ctx.time?.isNightTime) {
      segments.push('[时段: 深夜 - 简洁模式]');
    } else if (ctx.time?.isWorkHours) {
      segments.push('[时段: 工作时间 - 专业模式]');
    }

    // 4. Token预算提示
    const budget = this.updateTokenBudget(this.tokenBudget.used);
    if (budget.warning) {
      segments.push(`[Token预算警告: 剩余${budget.remaining}]`);
    }

    // 5. 用户偏好
    const patterns = this.getUserPatterns();
    if (patterns && options.includePreferences) {
      if (patterns.preferredSkills) {
        segments.push(`[偏好技能: ${Object.keys(patterns.preferredSkills).slice(0, 3).join(', ')}]`);
      }
    }

    return segments.join(' ') + '\n' + prompt;
  }

  // ==================== Task Routing ====================

  routeTask(taskType) {
    const time = this.scanTime();
    const hour = time.hour;

    // 深夜时段：使用轻量模型
    if (hour >= 22 || hour < 7) {
      return {
        model: 'qwen2.5:1.5b',
        reason: '深夜时段，使用轻量模型节省资源',
        verbosity: 'concise',
        maxTokens: this.nightModeConfig.maxResponseTokens
      };
    }

    // 高复杂度任务
    if (['code_generation', 'analysis', 'research', 'planning', 'security_audit'].includes(taskType)) {
      return {
        model: 'qwen3:4b-opt',
        reason: '复杂任务，使用主力模型',
        verbosity: 'normal',
        maxTokens: this.tokenBudget.total
      };
    }

    // 用户偏好
    const predicted = this.predictNextAction();
    if (predicted && predicted.confidence > 0.7 && predicted.predictedTaskType === taskType) {
      return {
        model: 'qwen3:4b-opt',
        reason: `基于历史偏好预测(${Math.round(predicted.confidence * 100)}%)`,
        verbosity: 'normal',
        maxTokens: this.tokenBudget.total
      };
    }

    return {
      model: 'qwen2.5:1.5b',
      reason: '日常任务，使用默认模型',
      verbosity: 'normal',
      maxTokens: 2000
    };
  }

  suggestSkills() {
    const proj = this.scanProject();
    const skills = [];

    if (proj.type === 'node') skills.push('code-review', 'git-workflow', 'documentation');
    else if (proj.type === 'python') skills.push('code-review', 'documentation');
    else if (proj.type === 'web') skills.push('code-review', 'documentation-lookup');

    if (proj.hasGit) skills.push('git-workflow');

    // 基于用户历史推荐
    const patterns = this.getUserPatterns();
    if (patterns?.preferredSkills) {
      for (const skill of Object.keys(patterns.preferredSkills).slice(0, 2)) {
        if (!skills.includes(skill)) skills.push(skill);
      }
    }

    return skills;
  }

  getRecommendedStrategy() {
    const time = this.scanTime();
    const conv = this.context.conversation || {};
    const strategy = {
      verbosity: 'normal',
      includeExplanations: true,
      suggestBreaks: false
    };

    // 深夜模式
    if (time.isNightTime) {
      strategy.verbosity = 'concise';
      strategy.includeExplanations = false;
      strategy.autoConfirm = true;
    }

    // 长会话
    if (conv.turnCount > 20) {
      strategy.suggestBreaks = true;
      strategy.contextCompression = true;
    }

    // 周末模式
    if (time.isWeekend) {
      strategy.casual = true;
    }

    // Token预算紧张
    const budget = this.updateTokenBudget(this.tokenBudget.used);
    if (budget.warning) {
      strategy.maxTokens = budget.remaining;
      strategy.verbosity = 'ultra-concise';
    }

    return strategy;
  }

  // ==================== Context Compression ====================

  /**
   * 压缩上下文
   */
  compressContext(items, maxTokens) {
    if (!items || items.length === 0) return [];

    const scored = items.map((item, index) => ({
      ...item,
      _importance: this._calculateImportance(item, index),
      _index: index
    }));

    // 按重要性排序
    scored.sort((a, b) => b._importance - a._importance);

    let tokens = 0;
    const kept = [];

    for (const item of scored) {
      const estTokens = this._estimateTokens(item.content || item.text || '');
      if (tokens + estTokens > maxTokens) break;
      tokens += estTokens;
      kept.push(item);
    }

    // 保持原始顺序
    kept.sort((a, b) => a._index - b._index);

    return {
      kept,
      dropped: items.length - kept.length,
      compressionRatio: items.length > 0 ? kept.length / items.length : 1,
      estimatedTokens: tokens
    };
  }

  _calculateImportance(item, index) {
    let score = 5 - Math.min(4, Math.floor(index / 5)); // 越近越重要

    // 最近提及的关键词
    const recent = item.content || item.text || '';
    if (recent.includes('重要') || recent.includes('关键')) score += 2;
    if (recent.includes('必须') || recent.includes('需要')) score += 1;

    // 包含代码块
    if (/```[\s\S]*?```/.test(recent)) score += 1;

    return score;
  }

  _estimateTokens(text) {
    // 简单估算：中文约1字=1token，英文约4字=1token
    const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const otherChars = text.length - chineseChars;
    return chineseChars + Math.ceil(otherChars / 4);
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
      summary: this.getSummary(),
      tokenBudget: this.tokenBudget
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

  _ensureConfigDir() {
    const p = path.join(this.configDir, 'snapshots');
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
  }

  _generateId() { return Math.random().toString(36).substring(2, 10); }
  _timestamp() { return new Date().toISOString(); }
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
Context Awareness - P4-5 上下文感知 [增强版]

命令:
  scan              全维度扫描
  summary           上下文摘要
  enrich "<prompt>"  丰富提示词
  deep-enrich "<prompt>" 深度丰富提示词
  strategy          行为策略推荐
  suggest           技能建议
  route <taskType>  任务路由建议
  privacy "<text>"   隐私敏感度评估
  token-budget      Token预算状态
  session           会话管理
  patterns          用户行为模式
  compress <items>  上下文压缩测试
  predict           预测下一个动作
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
      case 'deep-enrich': {
        const prompt = args.slice(1).join(' ') || '';
        console.log(`深度丰富:\n${ca.deepEnrichPrompt(prompt, { includePreferences: true })}`);
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
        console.log(`Verbosity: ${r.verbosity}`);
        break;
      }
      case 'privacy': {
        const text = args.slice(1).join(' ') || '';
        console.log(JSON.stringify(ca.assessPrivacySensitivity(text), null, 2));
        break;
      }
      case 'token-budget': {
        console.log(JSON.stringify(ca.updateTokenBudget(ca.tokenBudget.used), null, 2));
        break;
      }
      case 'session': {
        const sub = args[1];
        if (sub === 'new') {
          const s = ca.createSession();
          console.log(`新会话: ${s.id}`);
        } else if (sub === 'list') {
          console.log(`会话列表: ${[...ca.sessions.keys()].join(', ')}`);
        } else {
          console.log('用法: session new|list');
        }
        break;
      }
      case 'patterns': {
        console.log(JSON.stringify(ca.getUserPatterns(), null, 2));
        break;
      }
      case 'predict': {
        console.log(JSON.stringify(ca.predictNextAction(), null, 2));
        break;
      }
      case 'compress': {
        const items = [
          { content: '这是一个重要的技术决策', index: 0 },
          { content: '这是普通的对话', index: 1 },
          { content: '这是关键的用户偏好', index: 2 }
        ];
        const result = ca.compressContext(items, 100);
        console.log(JSON.stringify(result, null, 2));
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
console.log('[ContextAwareness] 加载成功 - P4-5 上下文感知 [增强版]');
