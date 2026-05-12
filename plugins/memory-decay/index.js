/**
 * memory-decay - WorkBuddy P4-6 记忆衰减管理器 [增强版]
 * 实现指数衰减模型、重要性加权遗忘、动态记忆压缩
 *
 * 维度: D2-Memory
 * 优先级: P1
 *
 * 增强内容：
 * - 自适应衰减参数学习
 * - 记忆关联强度计算
 * - 情感重要性权重
 * - 快速回忆机制（boost）
 * - 遗忘曲线可视化数据
 * - 记忆健康度预测
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

// ============================================================================
// Memory Decay Manager
// ============================================================================

class MemoryDecay {
  constructor(options = {}) {
    this.configDir = options.configDir || path.join(os.homedir(), '.workbuddy', 'memory-decay');
    this.decayModel = options.decayModel || 'exponential';
    this.memoryStore = new Map();
    this.accessHistory = new Map(); // 访问历史
    this.associations = new Map(); // 记忆关联
    this.decayParameters = this._loadDecayParameters();

    this.DecayModel = {
      EXPONENTIAL: 'exponential',
      LINEAR: 'linear',
      LOGARITHMIC: 'logarithmic',
      ADAPTIVE: 'adaptive',
      WEIBULL: 'weibull' // 新增：Weibull分布模型
    };

    this.ImportanceLevel = {
      CRITICAL: 5,
      HIGH: 4,
      MEDIUM: 3,
      LOW: 2,
      TRANSIENT: 1
    };

    // 增强：动态半衰期（可根据使用模式调整）
    this.halfLifes = {
      5: Infinity,
      4: 720,
      3: 168,
      2: 48,
      1: 12
    };

    // 内容类型权重
    this.contentWeights = {
      user_preference: 1.0,
      technical_decision: 0.95,
      project_convention: 0.90,
      task_state: 0.80,
      emotional_content: 0.75,
      conversation_detail: 0.50,
      casual_chat: 0.20
    };

    // 情感重要性关键词
    this.emotionalKeywords = {
      positive: ['喜欢', '满意', '重要', '成功', '很好', '棒'],
      negative: ['讨厌', '问题', '失败', '错误', '糟糕', '担心'],
      urgent: ['紧急', '必须', '立即', '重要', '关键']
    };

    this._ensureConfigDir();
    this._load();
  }

  // ==================== Decay Parameter Learning ====================

  _loadDecayParameters() {
    const p = path.join(this.configDir, 'data', 'decay-params.json');
    try {
      if (fs.existsSync(p)) {
        return JSON.parse(fs.readFileSync(p, 'utf8'));
      }
    } catch (e) { /* ignore */ }
    return {
      baseHalfLife: 168,
      learningRate: 0.1,
      adaptationFactor: 1.0,
      lastUpdate: null
    };
  }

  _saveDecayParameters() {
    const p = path.join(this.configDir, 'data', 'decay-params.json');
    try {
      this.decayParameters.lastUpdate = new Date().toISOString();
      fs.writeFileSync(p, JSON.stringify(this.decayParameters, null, 2));
    } catch (e) { /* ignore */ }
  }

  /**
   * 从访问模式学习衰减参数
   */
  learnFromAccessPatterns() {
    const params = this.decayParameters;
    let totalAccess = 0;
    let reaccessedMemories = 0;

    for (const [memId, history] of this.accessHistory) {
      if (history.length > 1) {
        totalAccess += history.length;
        reaccessedMemories++;
      }
    }

    if (totalAccess > 0) {
      const avgAccess = totalAccess / this.memoryStore.size;
      // 如果记忆被频繁访问，增加保留时间
      params.adaptationFactor = Math.min(2.0, Math.max(0.5, avgAccess / 5));
    }

    this._saveDecayParameters();
    return params;
  }

  // ==================== Memory CRUD ====================

  registerMemory(memory) {
    const id = memory.id || `mem_${this._generateId()}`;

    // 计算情感权重
    const emotionalWeight = this._calculateEmotionalWeight(memory.content || '');

    const mem = {
      id,
      content: memory.content || '',
      type: memory.type || 'conversation_detail',
      importance: memory.importance || this.classifyImportance(memory.content, memory.type),
      initialImportance: memory.importance || 3,
      emotionalWeight,
      created: memory.created || Date.now(),
      tags: memory.tags || [],
      accessCount: 0,
      lastAccess: null,
      linkedTo: memory.linkedTo || [],
      boostCount: 0,
      lastBoost: null,
      decayVersion: this.decayParameters.adaptationFactor
    };

    this.memoryStore.set(id, mem);
    this.accessHistory.set(id, []);

    // 建立关联
    if (memory.linkedTo?.length > 0) {
      this._createAssociations(id, memory.linkedTo);
    }

    this._persist();
    return mem;
  }

  _calculateEmotionalWeight(content) {
    const lower = content.toLowerCase();
    let weight = 0;

    for (const [type, keywords] of Object.entries(this.emotionalKeywords)) {
      for (const kw of keywords) {
        if (lower.includes(kw)) {
          if (type === 'urgent') weight += 0.3;
          else if (type === 'negative') weight += 0.2;
          else weight += 0.1;
        }
      }
    }

    return Math.min(1.0, weight);
  }

  getMemory(id) {
    const mem = this.memoryStore.get(id);
    if (mem) {
      // 记录访问
      this._recordAccess(id);
      mem.lastAccess = Date.now();
      mem.accessCount = (mem.accessCount || 0) + 1;
    }
    return mem || null;
  }

  _recordAccess(memoryId) {
    if (!this.accessHistory.has(memoryId)) {
      this.accessHistory.set(memoryId, []);
    }
    this.accessHistory.get(memoryId).push({
      timestamp: Date.now(),
      type: 'read'
    });

    // 保留最近100条
    const history = this.accessHistory.get(memoryId);
    if (history.length > 100) history.shift();
  }

  updateMemory(id, updates) {
    const mem = this.memoryStore.get(id);
    if (!mem) return null;
    Object.assign(mem, updates);
    mem.lastAccess = Date.now();
    mem.accessCount = (mem.accessCount || 0) + 1;
    this._recordAccess(id);
    this._persist();
    return mem;
  }

  deleteMemory(id) {
    this.memoryStore.delete(id);
    this.accessHistory.delete(id);
    this.associations.delete(id);
    this._persist();
    return true;
  }

  listMemories(filter = {}) {
    let result = [...this.memoryStore.values()];
    if (filter.type) result = result.filter(m => m.type === filter.type);
    if (filter.importance) result = result.filter(m => m.importance === filter.importance);
    if (filter.tag) result = result.filter(m => (m.tags || []).includes(filter.tag));
    return result;
  }

  // ==================== Association Management ====================

  _createAssociations(memoryId, linkedIds) {
    for (const linkedId of linkedIds) {
      if (!this.associations.has(memoryId)) {
        this.associations.set(memoryId, new Map());
      }
      if (!this.associations.has(linkedId)) {
        this.associations.set(linkedId, new Map());
      }

      // 双向关联
      const now = Date.now();
      this.associations.get(memoryId).set(linkedId, { weight: 1.0, created: now });
      this.associations.get(linkedId).set(memoryId, { weight: 1.0, created: now });
    }
  }

  /**
   * 获取记忆关联强度
   */
  getAssociationStrength(memoryId, targetId) {
    const assoc = this.associations.get(memoryId);
    if (!assoc) return 0;
    return assoc.get(targetId)?.weight || 0;
  }

  /**
   * 更新关联强度
   */
  updateAssociation(memoryId, targetId, delta) {
    const assoc = this.associations.get(memoryId);
    if (!assoc || !assoc.has(targetId)) return 0;

    const current = assoc.get(targetId);
    current.weight = Math.max(0, Math.min(1, current.weight + delta));
    return current.weight;
  }

  /**
   * 获取相关记忆
   */
  getRelatedMemories(memoryId, limit = 5) {
    const assoc = this.associations.get(memoryId);
    if (!assoc) return [];

    const related = [];
    for (const [id, data] of assoc) {
      const mem = this.memoryStore.get(id);
      if (mem) {
        related.push({
          id,
          content: mem.content.substring(0, 50),
          strength: data.weight,
          decay: this.calculateDecay(id)
        });
      }
    }

    // 按关联强度和当前重要性排序
    related.sort((a, b) => {
      const scoreA = a.strength * (a.decay?.currentImportance || 0);
      const scoreB = b.strength * (b.decay?.currentImportance || 0);
      return scoreB - scoreA;
    });

    return related.slice(0, limit);
  }

  // ==================== Decay Calculation ====================

  calculateDecay(memoryId) {
    const mem = this.memoryStore.get(memoryId);
    if (!mem) return null;

    const ageMs = Date.now() - (mem.created || Date.now());
    const ageHours = ageMs / (1000 * 60 * 60);
    const importance = mem.initialImportance || mem.importance || 3;

    // CRITICAL never decays
    if (importance >= 5) {
      return {
        currentImportance: 5,
        initialImportance: importance,
        ageHours: Math.round(ageHours * 10) / 10,
        ageDays: Math.round(ageHours / 24 * 10) / 10,
        percentRetained: 100,
        willBeForgotten: false,
        level: 'CRITICAL',
        halfLifeHours: Infinity
      };
    }

    // 考虑适应因子
    const adaptationFactor = this.decayParameters.adaptationFactor || 1.0;
    const effectiveHalfLife = this.halfLifes[Math.round(importance)] * adaptationFactor;

    let currentImportance;
    switch (this.decayModel) {
      case 'linear':
        currentImportance = Math.max(1, importance - (ageHours / effectiveHalfLife));
        break;
      case 'logarithmic':
        currentImportance = importance / (1 + Math.log(1 + ageHours / effectiveHalfLife));
        break;
      case 'weibull':
        // Weibull分布衰减
        const k = 1.5; // 形状参数
        const lambdaW = effectiveHalfLife / Math.pow(Math.log(2), 1/k);
        currentImportance = importance * Math.exp(-Math.pow(ageHours / lambdaW, k));
        break;
      case 'adaptive':
      case 'exponential':
      default:
        const lambdaE = Math.log(2);
        currentImportance = importance * Math.exp(-lambdaE * ageHours / effectiveHalfLife);
        break;
    }

    const percentRetained = Math.round(currentImportance / importance * 100);

    return {
      currentImportance: Math.round(currentImportance * 100) / 100,
      initialImportance: importance,
      ageHours: Math.round(ageHours * 10) / 10,
      ageDays: Math.round(ageHours / 24 * 10) / 10,
      percentRetained: Math.max(0, percentRetained),
      willBeForgotten: currentImportance < 0.3,
      level: this._getLevelName(importance),
      halfLifeHours: Math.round(effectiveHalfLife),
      model: this.decayModel,
      adaptationFactor
    };
  }

  calculateAllDecays() {
    const results = [];
    for (const id of this.memoryStore.keys()) {
      const d = this.calculateDecay(id);
      if (d) results.push({ id, ...d });
    }
    return results;
  }

  /**
   * 自适应衰减计算
   */
  adaptiveDecay(memory, accessHistory = []) {
    const baseDecay = this.calculateDecay(memory.id);
    if (!baseDecay) return null;

    let bonus = 0;
    const accessCount = accessHistory.length;

    // 访问频率加成
    bonus += Math.min(accessCount * 0.1, 0.3);

    // 最近访问加成
    if (accessHistory.length > 0) {
      const lastAccess = accessHistory[accessHistory.length - 1];
      const hoursSince = (Date.now() - lastAccess.timestamp) / 3600000;
      bonus += Math.max(0, 0.2 * Math.exp(-0.1 * hoursSince));
    }

    // 关联加成
    const linked = memory.linkedTo || [];
    bonus += Math.min(linked.length * 0.05, 0.2);

    // 情感权重加成
    bonus += (memory.emotionalWeight || 0) * 0.2;

    // Boost加成
    if (memory.boostCount > 0) {
      bonus += Math.min(memory.boostCount * 0.1, 0.3);
    }

    return {
      ...baseDecay,
      currentImportance: Math.min(5, Math.round((baseDecay.currentImportance + bonus) * 100) / 100),
      adaptiveBonus: Math.round(bonus * 100) / 100,
      reasons: {
        accessFrequency: Math.min(accessCount * 0.1, 0.3),
        recentAccess: accessHistory.length > 0 ? Math.max(0, 0.2 * Math.exp(-0.1 * ((Date.now() - accessHistory[accessHistory.length - 1].timestamp) / 3600000))) : 0,
        associations: Math.min(linked.length * 0.05, 0.2),
        emotional: (memory.emotionalWeight || 0) * 0.2,
        boost: Math.min(memory.boostCount * 0.1, 0.3)
      }
    };
  }

  /**
   * 生成遗忘曲线数据
   */
  getDecayCurve(memoryId, maxHours = 720) {
    const mem = this.memoryStore.get(memoryId);
    if (!mem) return null;

    const importance = mem.initialImportance || mem.importance || 3;
    const adaptationFactor = this.decayParameters.adaptationFactor || 1.0;
    const halfLife = this.halfLifes[Math.round(importance)] * adaptationFactor;
    const lambda = Math.log(2);

    const points = [];
    const steps = 24; // 24个数据点

    for (let i = 0; i <= steps; i++) {
      const hours = (i / steps) * maxHours;
      const currentImportance = importance * Math.exp(-lambda * hours / halfLife);
      points.push({
        hours: Math.round(hours),
        importance: Math.round(currentImportance * 100) / 100,
        percentRetained: Math.round((currentImportance / importance) * 100)
      });
    }

    return {
      memoryId,
      initialImportance: importance,
      halfLife: Math.round(halfLife),
      model: this.decayModel,
      points
    };
  }

  // ==================== Importance Management ====================

  assignImportance(memoryId, level) {
    const mem = this.memoryStore.get(memoryId);
    if (!mem) return null;
    mem.importance = Math.max(1, Math.min(5, level));
    mem.initialImportance = mem.importance;
    this._persist();
    return mem;
  }

  boostImportance(memoryId, amount = 1) {
    const mem = this.memoryStore.get(memoryId);
    if (!mem) return null;
    mem.importance = Math.min(5, (mem.importance || 3) + amount);
    mem.boostCount = (mem.boostCount || 0) + 1;
    mem.lastBoost = Date.now();
    this._persist();
    return mem;
  }

  /**
   * 快速回忆（临时提升重要性）
   */
  quickRecall(memoryId) {
    const mem = this.memoryStore.get(memoryId);
    if (!mem) return null;

    // 临时提升0.5重要性，有效期1小时
    const originalImportance = mem.importance;
    mem.importance = Math.min(5, mem.importance + 0.5);
    mem.quickRecallAt = Date.now();
    mem.quickRecallExpires = Date.now() + 3600000;

    this._persist();
    return {
      id: memoryId,
      originalImportance,
      boostedImportance: mem.importance,
      expiresIn: '1 hour'
    };
  }

  /**
   * 检查并恢复过期快速回忆
   */
  checkQuickRecallExpiry() {
    const now = Date.now();
    for (const [id, mem] of this.memoryStore) {
      if (mem.quickRecallExpires && mem.quickRecallExpires < now) {
        mem.importance = Math.max(mem.initialImportance || 3, mem.importance - 0.5);
        delete mem.quickRecallAt;
        delete mem.quickRecallExpires;
      }
    }
  }

  classifyImportance(content, type) {
    const weight = this.contentWeights[type] || 0.5;
    let importance = this.ImportanceLevel.MEDIUM;

    if (weight >= 0.95) importance = this.ImportanceLevel.HIGH;
    else if (weight >= 0.80) importance = this.ImportanceLevel.MEDIUM;
    else if (weight >= 0.40) importance = this.ImportanceLevel.LOW;
    else importance = this.ImportanceLevel.TRANSIENT;

    // 情感关键词调整
    const emotionalWeight = this._calculateEmotionalWeight(content || '');
    if (emotionalWeight > 0.5) {
      importance = Math.min(5, importance + 1);
    }

    return importance;
  }

  getImportance(memoryId) {
    const mem = this.memoryStore.get(memoryId);
    return mem ? (mem.importance || 3) : null;
  }

  _getLevelName(importance) {
    if (importance >= 5) return 'CRITICAL';
    if (importance >= 4) return 'HIGH';
    if (importance >= 3) return 'MEDIUM';
    if (importance >= 2) return 'LOW';
    return 'TRANSIENT';
  }

  // ==================== Forgetting & Compression ====================

  shouldForget(memoryId, threshold = 0.3) {
    const decay = this.calculateDecay(memoryId);
    if (!decay) return false;
    if (decay.level === 'CRITICAL') return false;
    return decay.currentImportance < threshold;
  }

  compressLowImportance(maxItems = 10) {
    const low = this.listMemories({ importance: this.ImportanceLevel.LOW });
    if (low.length <= maxItems) return { compressed: 0, remaining: low.length };

    const sorted = low.map(m => ({ id: m.id, decay: this.calculateDecay(m.id) }))
      .filter(d => d.decay)
      .sort((a, b) => a.decay.currentImportance - b.decay.currentImportance);

    const toCompress = sorted.slice(0, sorted.length - maxItems);
    for (const item of toCompress) {
      const mem = this.memoryStore.get(item.id);
      if (mem) mem.content = `[压缩] ${mem.content.substring(0, 50)}...`;
    }
    this._persist();
    return { compressed: toCompress.length, remaining: maxItems };
  }

  summarizeOldMemories(olderThanHours = 168) {
    const cutoff = Date.now() - olderThanHours * 3600000;
    let count = 0;
    for (const [id, mem] of this.memoryStore) {
      if (mem.created < cutoff && mem.importance <= this.ImportanceLevel.LOW) {
        mem.content = `[摘要-${new Date(mem.created).toISOString().split('T')[0]}] ${mem.content.substring(0, 80)}`;
        count++;
      }
    }
    this._persist();
    return { summarized: count };
  }

  pruneForgottenMemories() {
    this.checkQuickRecallExpiry(); // 先检查快速回忆过期

    let pruned = 0;
    for (const [id, mem] of this.memoryStore) {
      if (mem.importance >= this.ImportanceLevel.CRITICAL) continue;
      const decay = this.calculateDecay(id);
      if (decay && decay.willBeForgotten) {
        this.memoryStore.delete(id);
        this.accessHistory.delete(id);
        this.associations.delete(id);
        pruned++;
      }
    }
    this._persist();
    return { pruned };
  }

  getRetentionWeight(memory, turnsAgo = 0) {
    const decay = this.calculateDecay(memory.id || memory);
    if (!decay) return 0.3;
    const turnDecay = Math.exp(-turnsAgo * 0.1);
    return Math.max(0.1, decay.currentImportance / 5 * turnDecay);
  }

  // ==================== Retrieval ====================

  getRelevantMemories(context, limit = 5) {
    const query = (context || '').toLowerCase();
    const scored = [];

    for (const [id, mem] of this.memoryStore) {
      const decay = this.calculateDecay(id);
      const accessHistory = this.accessHistory.get(id) || [];

      // 关键词匹配
      const keywordMatch = mem.content && mem.content.toLowerCase().includes(query);
      const relevance = keywordMatch ? 0.5 : 0;

      // 关联强度加成
      let associationBonus = 0;
      if (keywordMatch) {
        const related = this.getRelatedMemories(id, 3);
        associationBonus = related.reduce((s, r) => s + r.strength * 0.1, 0);
      }

      // 综合评分
      const baseScore = (decay ? decay.currentImportance / 5 : 0.3) * 0.5;
      const relevanceScore = relevance * 0.3;
      const associationScore = Math.min(associationBonus, 0.2);
      const accessScore = Math.min((accessHistory.length * 0.02), 0.2);

      const score = baseScore + relevanceScore + associationScore + accessScore;

      scored.push({
        id,
        content: mem.content,
        score: Math.round(score * 100) / 100,
        currentImportance: decay?.currentImportance || mem.importance,
        associationStrength: associationBonus
      });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }

  searchWithDecay(query) {
    return this.getRelevantMemories(query, 20);
  }

  getTopMemories(limit = 10) {
    const all = this.calculateAllDecays();
    all.sort((a, b) => b.currentImportance - a.currentImportance);
    return all.slice(0, limit);
  }

  // ==================== Health Prediction ====================

  /**
   * 预测记忆健康度趋势
   */
  predictHealth(daysAhead = 7) {
    const predictions = [];
    const hoursAhead = daysAhead * 24;

    for (const [id, mem] of this.memoryStore) {
      if (mem.importance >= 5) continue; // CRITICAL不衰减

      const ageHours = (Date.now() - mem.created) / 3600000;
      const futureAgeHours = ageHours + hoursAhead;
      const importance = mem.initialImportance || mem.importance || 3;
      const halfLife = this.halfLifes[Math.round(importance)] * (this.decayParameters.adaptationFactor || 1.0);
      const lambda = Math.log(2);

      const futureImportance = importance * Math.exp(-lambda * futureAgeHours / halfLife);
      const willDecay = futureImportance < 0.3;

      predictions.push({
        id,
        currentImportance: mem.importance,
        predictedImportance: Math.round(futureImportance * 100) / 100,
        willBeForgotten: willDecay,
        daysUntilForgotten: willDecay ? Math.round((Math.log(importance / 0.3) * halfLife / lambda) / 24) : null
      });
    }

    return {
      predictedAt: new Date().toISOString(),
      daysAhead,
      memories: predictions,
      atRisk: predictions.filter(p => p.willBeForgotten).length,
      healthy: predictions.filter(p => !p.willBeForgotten).length
    };
  }

  // ==================== Statistics ====================

  getDecayStats() {
    const all = this.calculateAllDecays();
    const criticalCount = all.filter(d => d.level === 'CRITICAL').length;
    const forgottenCount = all.filter(d => d.willBeForgotten).length;
    const avgImportance = all.length > 0
      ? Math.round(all.reduce((s, d) => s + d.currentImportance, 0) / all.length * 100) / 100
      : 0;

    return {
      total: all.length,
      avgImportance,
      forgottenCount,
      criticalCount,
      decayRate: all.length > 0 ? Math.round(forgottenCount / all.length * 100) : 0,
      decayParameters: this.decayParameters,
      distribution: {
        CRITICAL: criticalCount,
        HIGH: all.filter(d => d.level === 'HIGH' && !d.willBeForgotten).length,
        MEDIUM: all.filter(d => d.level === 'MEDIUM' && !d.willBeForgotten).length,
        LOW: all.filter(d => d.level === 'LOW' && !d.willBeForgotten).length,
        TRANSIENT: all.filter(d => d.level === 'TRANSIENT' && !d.willBeForgotten).length
      }
    };
  }

  getMemoryHealthScore() {
    const stats = this.getDecayStats();
    let score = 100;

    if (stats.decayRate > 30) score -= 20;
    else if (stats.decayRate > 15) score -= 10;

    if (stats.avgImportance < 2) score -= 15;
    else if (stats.avgImportance < 3) score -= 5;

    if (stats.criticalCount === 0 && stats.total > 0) score -= 5;

    // 适应因子调整
    if (this.decayParameters.adaptationFactor > 1.5) score += 5; // 良好的学习效果
    else if (this.decayParameters.adaptationFactor < 0.7) score -= 5;

    return Math.max(0, Math.min(100, score));
  }

  generateDecayReport() {
    const stats = this.getDecayStats();
    const top = this.getTopMemories(5);
    const forgotten = this.calculateAllDecays().filter(d => d.willBeForgotten).slice(0, 5);
    const health = this.predictHealth(7);

    let md = `# 记忆衰减报告\n\n`;
    md += `**生成时间**: ${this._timestamp()}\n`;
    md += `**健康分数**: ${this.getMemoryHealthScore()}/100\n`;
    md += `**适应因子**: ${this.decayParameters.adaptationFactor}\n\n`;

    md += `## 概览\n`;
    md += `| 指标 | 值 |\n|---|---|\n`;
    md += `| 总记忆数 | ${stats.total} |\n`;
    md += `| 平均重要性 | ${stats.avgImportance} |\n`;
    md += `| 遗忘风险 | ${stats.forgottenCount} (${stats.decayRate}%) |\n`;
    md += `| CRITICAL数量 | ${stats.criticalCount} |\n`;
    md += `| 7天预测风险 | ${health.atRisk} |\n\n`;

    md += `## 分布\n`;
    for (const [level, count] of Object.entries(stats.distribution)) {
      md += `- ${level}: ${count}\n`;
    }

    md += `\n## 最高重要性记忆\n`;
    for (const m of top) {
      md += `- **${m.id}**: ${m.currentImportance} (${m.level}, ${m.ageDays}天)\n`;
    }

    if (forgotten.length > 0) {
      md += `\n## 将被遗忘的记忆\n`;
      for (const f of forgotten) {
        md += `- ${f.id}: 重要性降至${f.currentImportance}\n`;
      }
    }

    return md;
  }

  // ==================== Priority Compression ====================

  compressContextBuffer(items, maxTokens) {
    const scored = items.map((item, i) => ({
      ...item,
      _score: this.getRetentionWeight(item, item.turnsAgo || i),
      _turnsAgo: item.turnsAgo || i
    }));

    scored.sort((a, b) => b._score - a._score);

    let tokens = 0;
    const kept = [];

    for (const item of scored) {
      const estTokens = Math.ceil((item.content || '').length / 4);
      if (tokens + estTokens > maxTokens) break;
      tokens += estTokens;
      kept.push(item);
    }

    return {
      kept,
      dropped: items.length - kept.length,
      compressionRatio: items.length > 0 ? Math.round(kept.length / items.length * 100) / 100 : 1,
      estimatedTokens: tokens
    };
  }

  // ==================== Persistence ====================

  _persist() {
    const p = path.join(this.configDir, 'data', 'store.json');
    const data = {};
    for (const [k, v] of this.memoryStore) {
      data[k] = v;
    }
    fs.writeFileSync(p, JSON.stringify(data, null, 2));
  }

  _load() {
    const p = path.join(this.configDir, 'data', 'store.json');
    if (!fs.existsSync(p)) return;
    try {
      const data = JSON.parse(fs.readFileSync(p, 'utf8'));
      for (const [id, mem] of Object.entries(data)) {
        this.memoryStore.set(id, mem);
        this.accessHistory.set(id, []);
      }
    } catch (e) { /* ignore */ }
  }

  _ensureConfigDir() {
    const p = path.join(this.configDir, 'data');
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
  }

  _generateId() { return crypto.randomBytes(4).toString('hex'); }
  _timestamp() { return new Date().toISOString(); }
}

// ============================================================================
// CLI
// ============================================================================
if (require.main === module) {
  const args = process.argv.slice(2);
  const cmd = args[0];
  const md = new MemoryDecay();

  function showHelp() {
    console.log(`
Memory Decay - P4-6 记忆衰减管理器 [增强版]

命令:
  register --content "<text>" --type <type> [--importance <1-5>]  注册记忆
  list [--type <type>] [--importance <level>]                     列出记忆
  decay <id>                                                       计算衰减
  decay-all                                                        全部衰减
  curve <id> [hours]                                               遗忘曲线
  boost <id> [amount]                                              增强重要性
  recall <id>                                                      快速回忆
  forget-check <id>                                                 遗忘检查
  compress                                                         压缩低重要性
  prune                                                            清理遗忘记忆
  stats                                                            统计信息
  health                                                           健康分数
  predict [days]                                                    健康预测
  learn                                                            学习衰减参数
  related <id>                                                      相关记忆
  decay-params                                                     衰减参数
  report                                                           衰减报告
  search <query>                                                   搜索记忆
  top [count]                                                      最高重要性记忆
  compress-test                                                    压缩测试
  help                                                             显示帮助
`);
  }

  try {
    switch (cmd) {
      case 'register': {
        const contentIdx = args.indexOf('--content');
        const typeIdx = args.indexOf('--type');
        const impIdx = args.indexOf('--importance');
        const content = contentIdx > -1 ? args[contentIdx + 1] : '';
        const type = typeIdx > -1 ? args[typeIdx + 1] : 'conversation_detail';
        const importance = impIdx > -1 ? parseInt(args[impIdx + 1]) : null;
        const mem = md.registerMemory({ content, type, importance: importance || undefined });
        console.log(`记忆已注册: ${mem.id} (重要性: ${mem.importance}, 情感权重: ${mem.emotionalWeight})`);
        break;
      }
      case 'list': {
        const filter = {};
        const typeIdx = args.indexOf('--type');
        const impIdx = args.indexOf('--importance');
        if (typeIdx > -1) filter.type = args[typeIdx + 1];
        if (impIdx > -1) filter.importance = parseInt(args[impIdx + 1]);
        const mems = md.listMemories(filter);
        console.log(`记忆列表 (${mems.length}):`);
        mems.forEach(m => console.log(`  ${m.id} [${m.type}] 重要性:${m.importance} ${m.content.substring(0, 60)}`));
        break;
      }
      case 'decay': {
        const d = md.calculateDecay(args[1]);
        if (d) {
          console.log(`当前重要性: ${d.currentImportance} (${d.level})`);
          console.log(`保留率: ${d.percentRetained}%`);
          console.log(`年龄: ${d.ageDays}天`);
        } else {
          console.log('记忆未找到');
        }
        break;
      }
      case 'decay-all': {
        const all = md.calculateAllDecays();
        console.log(`总计 ${all.length} 条记忆:`);
        all.forEach(d => console.log(`  ${d.id}: ${d.currentImportance} (${d.level}, ${d.percentRetained}%)`));
        break;
      }
      case 'curve': {
        const hours = parseInt(args[2]) || 720;
        const curve = md.getDecayCurve(args[1], hours);
        if (curve) {
          console.log(`遗忘曲线 (半衰期: ${curve.halfLife}h):`);
          curve.points.forEach(p => console.log(`  ${p.hours}h: ${p.importance} (${p.percentRetained}%)`));
        } else {
          console.log('记忆未找到');
        }
        break;
      }
      case 'boost': {
        const amount = parseInt(args[2]) || 1;
        const r = md.boostImportance(args[1], amount);
        console.log(r ? `已增强到: ${r.importance}` : '记忆未找到');
        break;
      }
      case 'recall': {
        const r = md.quickRecall(args[1]);
        console.log(r ? `快速回忆: ${r.originalImportance} → ${r.boostedImportance} (${r.expiresIn})` : '记忆未找到');
        break;
      }
      case 'forget-check':
        console.log(md.shouldForget(args[1]) ? '将被遗忘' : '保留');
        break;
      case 'compress': {
        const r = md.compressLowImportance();
        console.log(`压缩: ${r.compressed}, 保留: ${r.remaining}`);
        break;
      }
      case 'prune': {
        const r = md.pruneForgottenMemories();
        console.log(`清理: ${r.pruned} 条记忆`);
        break;
      }
      case 'stats':
        console.log(JSON.stringify(md.getDecayStats(), null, 2));
        break;
      case 'health':
        console.log(`记忆健康分数: ${md.getMemoryHealthScore()}/100`);
        break;
      case 'predict': {
        const days = parseInt(args[1]) || 7;
        const p = md.predictHealth(days);
        console.log(`7天预测: ${p.atRisk} 风险, ${p.healthy} 健康`);
        break;
      }
      case 'learn': {
        const params = md.learnFromAccessPatterns();
        console.log(`学习完成: 适应因子 = ${params.adaptationFactor}`);
        break;
      }
      case 'related': {
        const r = md.getRelatedMemories(args[1]);
        console.log(`相关记忆 (${r.length}):`);
        r.forEach(m => console.log(`  ${m.id}: 强度=${m.strength}, 重要性=${m.decay?.currentImportance}`));
        break;
      }
      case 'decay-params':
        console.log(JSON.stringify(md.decayParameters, null, 2));
        break;
      case 'report':
        console.log(md.generateDecayReport());
        break;
      case 'search': {
        const results = md.searchWithDecay(args[1] || '');
        console.log(`搜索结果 (${results.length}):`);
        results.forEach(r => console.log(`  ${r.id} [${r.score}] ${r.content?.substring(0, 60)}`));
        break;
      }
      case 'top': {
        const top = md.getTopMemories(parseInt(args[1]) || 5);
        top.forEach(t => console.log(`  #${top.indexOf(t)+1} ${t.id}: ${t.currentImportance} (${t.level})`));
        break;
      }
      case 'compress-test': {
        const items = [
          { content: '用户偏好: 喜欢简洁回复', type: 'user_preference', turnsAgo: 0 },
          { content: '今天天气不错适合编码', type: 'casual_chat', turnsAgo: 5 },
          { content: '项目使用Express.js作为后端框架', type: 'technical_decision', turnsAgo: 1 }
        ];
        const result = md.compressContextBuffer(items, 100);
        console.log(`压缩: ${items.length} -> ${result.kept.length} (比例:${result.compressionRatio})`);
        break;
      }
      default:
        showHelp();
    }
  } catch (e) {
    console.error(`错误: ${e.message}`);
  }
}

module.exports = MemoryDecay;
console.log('[MemoryDecay] 加载成功 - P4-6 记忆衰减管理器 [增强版]');
