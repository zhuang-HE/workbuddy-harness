#!/usr/bin/env node
/**
 * memory-decay - WorkBuddy P4-6 记忆衰减管理器
 * 实现指数衰减模型、重要性加权遗忘、动态记忆压缩
 *
 * 维度: D2-Memory
 * 优先级: P1
 * 创建: 2026-05-12
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

    this.DecayModel = { EXPONENTIAL: 'exponential', LINEAR: 'linear', LOGARITHMIC: 'logarithmic', ADAPTIVE: 'adaptive' };
    this.ImportanceLevel = { CRITICAL: 5, HIGH: 4, MEDIUM: 3, LOW: 2, TRANSIENT: 1 };

    // Half-lifes in hours
    this.halfLifes = { 5: Infinity, 4: 720, 3: 168, 2: 48, 1: 12 };

    // Content type weights
    this.contentWeights = {
      user_preference: 1.0, technical_decision: 0.95, project_convention: 0.90,
      task_state: 0.80, conversation_detail: 0.50, casual_chat: 0.20
    };

    this._ensureConfigDir();
    this._load();
  }

  _ensureConfigDir() {
    const p = path.join(this.configDir, 'data');
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
  }

  _generateId() { return crypto.randomBytes(4).toString('hex'); }
  _timestamp() { return new Date().toISOString(); }

  _persist() {
    const p = path.join(this.configDir, 'data', 'store.json');
    const data = [...this.memoryStore.entries()].reduce((obj, [k, v]) => { obj[k] = v; return obj; }, {});
    fs.writeFileSync(p, JSON.stringify(data, null, 2));
  }

  _load() {
    const p = path.join(this.configDir, 'data', 'store.json');
    if (!fs.existsSync(p)) return;
    try {
      const data = JSON.parse(fs.readFileSync(p, 'utf8'));
      for (const [id, mem] of Object.entries(data)) {
        this.memoryStore.set(id, mem);
      }
    } catch (e) { /* ignore */ }
  }

  // ==================== Memory CRUD ====================

  registerMemory(memory) {
    const id = memory.id || `mem_${this._generateId()}`;
    const mem = {
      id, content: memory.content || '', type: memory.type || 'conversation_detail',
      importance: memory.importance || this.classifyImportance(memory.content, memory.type),
      initialImportance: memory.importance || 3,
      created: memory.created || Date.now(), tags: memory.tags || [],
      accessCount: 0, lastAccess: null, linkedTo: memory.linkedTo || []
    };
    this.memoryStore.set(id, mem);
    this._persist();
    return mem;
  }

  getMemory(id) { return this.memoryStore.get(id) || null; }

  updateMemory(id, updates) {
    const mem = this.memoryStore.get(id);
    if (!mem) return null;
    Object.assign(mem, updates);
    mem.lastAccess = Date.now();
    mem.accessCount = (mem.accessCount || 0) + 1;
    this._persist();
    return mem;
  }

  deleteMemory(id) {
    this.memoryStore.delete(id);
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

  // ==================== Decay Calculation ====================

  calculateDecay(memoryId) {
    const mem = this.memoryStore.get(memoryId);
    if (!mem) return null;

    const ageMs = Date.now() - (mem.created || Date.now());
    const ageHours = ageMs / (1000 * 60 * 60);
    const importance = mem.initialImportance || mem.importance || 3;

    // CRITICAL never decays
    if (importance >= 5) {
      return { currentImportance: 5, initialImportance: importance, ageHours, ageDays: Math.round(ageHours / 24 * 10) / 10, percentRetained: 100, willBeForgotten: false, level: 'CRITICAL' };
    }

    const halfLife = this.halfLifes[Math.round(importance)] || 168;
    const lambda = Math.log(2);
    const currentImportance = importance * Math.exp(-lambda * ageHours / halfLife);
    const percentRetained = Math.round(currentImportance / importance * 100);

    return {
      currentImportance: Math.round(currentImportance * 100) / 100,
      initialImportance: importance,
      ageHours: Math.round(ageHours * 10) / 10,
      ageDays: Math.round(ageHours / 24 * 10) / 10,
      percentRetained: Math.max(0, percentRetained),
      willBeForgotten: currentImportance < 0.3,
      level: this._getLevelName(importance),
      halfLifeHours: halfLife
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

  adaptiveDecay(memory, accessHistory = []) {
    const baseDecay = this.calculateDecay(memory.id);
    if (!baseDecay) return null;

    let bonus = 0;
    const accessCount = accessHistory.length;
    bonus += Math.min(accessCount * 0.1, 0.3);

    if (accessHistory.length > 0) {
      const lastAccess = accessHistory[accessHistory.length - 1];
      const hoursSince = (Date.now() - lastAccess) / 3600000;
      bonus += Math.max(0, 0.2 * Math.exp(-0.1 * hoursSince));
    }

    const linked = memory.linkedTo || [];
    bonus += Math.min(linked.length * 0.05, 0.2);

    return {
      ...baseDecay,
      currentImportance: Math.min(5, Math.round((baseDecay.currentImportance + bonus) * 100) / 100),
      adaptiveBonus: Math.round(bonus * 100) / 100
    };
  }

  getDecayCurve(memoryId, maxHours = 168) {
    const mem = this.memoryStore.get(memoryId);
    if (!mem) return null;

    const importance = mem.initialImportance || mem.importance || 3;
    const halfLife = this.halfLifes[Math.round(importance)] || 168;
    const lambda = Math.log(2);
    const points = [];

    for (let h = 0; h <= maxHours; h += Math.max(1, Math.floor(maxHours / 20))) {
      points.push({ hours: h, importance: Math.round(importance * Math.exp(-lambda * h / halfLife) * 100) / 100 });
    }
    return points;
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
    this._persist();
    return mem;
  }

  classifyImportance(content, type) {
    const weight = this.contentWeights[type] || 0.5;
    if (weight >= 0.95) return this.ImportanceLevel.HIGH;
    if (weight >= 0.80) return this.ImportanceLevel.MEDIUM;
    if (weight >= 0.40) return this.ImportanceLevel.LOW;
    return this.ImportanceLevel.TRANSIENT;
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

    // Sort by current importance ascending
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
    let pruned = 0;
    for (const [id, mem] of this.memoryStore) {
      if (mem.importance >= this.ImportanceLevel.CRITICAL) continue;
      const decay = this.calculateDecay(id);
      if (decay && decay.willBeForgotten) {
        this.memoryStore.delete(id);
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
      const relevance = mem.content && mem.content.toLowerCase().includes(query) ? 0.5 : 0;
      const score = (decay ? decay.currentImportance / 5 : 0.3) * 0.6 + relevance * 0.4;
      scored.push({ id, ...mem, score, currentImportance: decay?.currentImportance || mem.importance });
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

  // ==================== Statistics ====================

  getDecayStats() {
    const all = this.calculateAllDecays();
    const criticalCount = all.filter(d => d.level === 'CRITICAL').length;
    const forgottenCount = all.filter(d => d.willBeForgotten).length;
    const avgImportance = all.length > 0 ? Math.round(all.reduce((s, d) => s + d.currentImportance, 0) / all.length * 100) / 100 : 0;

    return {
      total: all.length, avgImportance, forgottenCount, criticalCount,
      decayRate: all.length > 0 ? Math.round(forgottenCount / all.length * 100) : 0,
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
    return Math.max(0, Math.min(100, score));
  }

  generateDecayReport() {
    const stats = this.getDecayStats();
    const top = this.getTopMemories(5);
    const forgotten = this.calculateAllDecays().filter(d => d.willBeForgotten).slice(0, 5);

    let md = `# 记忆衰减报告\n\n`;
    md += `**生成时间**: ${this._timestamp()}\n`;
    md += `**健康分数**: ${this.getMemoryHealthScore()}/100\n\n`;
    md += `## 概览\n`;
    md += `| 指标 | 值 |\n|---|---|\n`;
    md += `| 总记忆数 | ${stats.total} |\n`;
    md += `| 平均重要性 | ${stats.avgImportance} |\n`;
    md += `| 遗忘风险 | ${stats.forgottenCount} (${stats.decayRate}%) |\n`;
    md += `| CRITICAL数量 | ${stats.criticalCount} |\n\n`;
    md += `## 最高重要性记忆\n`;
    for (const m of top) {
      md += `- **${m.id}**: 重要性=${m.currentImportance} (${m.level}, ${m.ageDays}天)\n`;
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
      compressionRatio: items.length > 0 ? Math.round(kept.length / items.length * 100) / 100 : 1
    };
  }
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
Memory Decay - P4-6 记忆衰减管理器

命令:
  register --content "<text>" --type <type> [--importance <1-5>]  注册记忆
  list [--type <type>] [--importance <level>]                     列出记忆
  decay <id>                                                       计算衰减
  decay-all                                                        全部衰减
  forget-check <id>                                                遗忘检查
  compress                                                          压缩低重要性
  prune                                                             清理遗忘记忆
  stats                                                             统计信息
  health                                                            健康分数
  report                                                            衰减报告
  search <query>                                                    搜索记忆
  top [count]                                                       最高重要性记忆
  compress-test                                                     压缩测试
  help                                                              显示帮助
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
        console.log(`记忆已注册: ${mem.id} (重要性: ${mem.importance})`);
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
        console.log(d ? JSON.stringify(d, null, 2) : '记忆未找到');
        break;
      }
      case 'decay-all': {
        const all = md.calculateAllDecays();
        console.log(`总计 ${all.length} 条记忆:`);
        all.forEach(d => console.log(`  ${d.id}: ${d.currentImportance} (${d.level}, ${d.ageDays}天, ${d.percentRetained}%)${d.willBeForgotten ? ' ⚠遗忘' : ''}`));
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
          { id: '1', content: '用户偏好: 喜欢简洁回复，使用JavaScript', type: 'user_preference', turnsAgo: 0 },
          { id: '2', content: '今天天气不错适合编码', type: 'casual_chat', turnsAgo: 5 },
          { id: '3', content: '项目使用Express.js作为后端框架，MongoDB数据库', type: 'technical_decision', turnsAgo: 1 },
          { id: '4', content: '午饭吃了面条', type: 'casual_chat', turnsAgo: 10 }
        ];
        const result = md.compressContextBuffer(items, 100);
        console.log(`压缩: ${items.length} -> ${result.kept.length} (比例:${result.compressionRatio})`);
        console.log(`保留: ${result.kept.map(i => i.id).join(', ')}`);
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
console.log('[MemoryDecay] 加载成功 - P4-6 记忆衰减管理器');
