/**
 * Context Fusion (D6 融合层)
 * WorkBuddy Agent 上下文融合系统
 */

class ContextFusion {
  constructor() {
    this.sources = new Map();
    this.priorityEngine = new PriorityEngine();
    this.cache = new ContextCache();
    this.fusionHistory = [];
    this.config = null;
  }

  /**
   * 初始化上下文融合引擎
   * @param {Object} config - 配置
   */
  async init(config = {}) {
    this.config = {
      defaultBudget: 8000,
      minPriority: 10,
      cacheSize: 100,
      deduplication: true,
      ...config
    };

    // 注册默认上下文来源
    this.registerSource('system', { priority: 100, mutable: false });
    this.registerSource('skill', { priority: 80, mutable: true });
    this.registerSource('memory', { priority: 60, mutable: true });
    this.registerSource('session', { priority: 40, mutable: true });
    this.registerSource('recent', { priority: 20, mutable: true });

    return this;
  }

  /**
   * 注册上下文来源
   */
  registerSource(name, options = {}) {
    this.sources.set(name, {
      name,
      priority: options.priority || 50,
      mutable: options.mutable !== false,
      weight: options.weight || 1.0,
      ttl: options.ttl || 3600000 // 1小时
    });
  }

  /**
   * 融合多个上下文
   * @param {Array} contexts - 上下文数组
   * @param {Object} options - 融合选项
   */
  async fuse(contexts, options = {}) {
    const budget = options.budget || this.config.defaultBudget;
    
    // 1. 验证和标准化上下文
    const normalized = this.normalizeContexts(contexts);
    
    // 2. 优先级排序
    const prioritized = this.prioritize(normalized);
    
    // 3. 去重合并
    const deduplicated = this.config.deduplication 
      ? this.deduplicate(prioritized) 
      : prioritized;
    
    // 4. 时效性加权
    const weighted = this.applyTimeWeight(deduplicated);
    
    // 5. 智能压缩
    const compressed = this.compressToBudget(weighted, budget);
    
    // 6. 构建融合结果
    const result = this.buildFusionResult(compressed, {
      originalCount: contexts.length,
      budget,
      usedBudget: this.calculateTokens(compressed)
    });

    // 记录融合历史
    this.fusionHistory.push({
      timestamp: Date.now(),
      inputCount: contexts.length,
      outputCount: compressed.length,
      budgetUsed: result.usedBudget
    });

    // 限制历史长度
    if (this.fusionHistory.length > 50) {
      this.fusionHistory = this.fusionHistory.slice(-50);
    }

    return result;
  }

  /**
   * 标准化上下文格式
   */
  normalizeContexts(contexts) {
    return contexts.map(ctx => ({
      source: ctx.source || 'unknown',
      content: ctx.content || '',
      priority: ctx.priority ?? this.getSourcePriority(ctx.source),
      timestamp: ctx.timestamp || Date.now(),
      metadata: ctx.metadata || {},
      tokens: this.estimateTokens(ctx.content)
    }));
  }

  /**
   * 获取来源默认优先级
   */
  getSourcePriority(source) {
    return this.sources.get(source)?.priority || 50;
  }

  /**
   * 优先级排序
   */
  prioritize(contexts) {
    return [...contexts].sort((a, b) => {
      // 首先按优先级
      if (b.priority !== a.priority) {
        return b.priority - a.priority;
      }
      // 然后按时效性（新的在前）
      return b.timestamp - a.timestamp;
    });
  }

  /**
   * 去重合并
   */
  deduplicate(contexts) {
    const seen = new Map();
    const result = [];

    for (const ctx of contexts) {
      const key = this.getDeduplicationKey(ctx);
      
      if (!seen.has(key)) {
        seen.set(key, ctx);
        result.push(ctx);
      } else {
        // 保留更高优先级或更新的版本
        const existing = seen.get(key);
        if (ctx.priority > existing.priority || 
            ctx.timestamp > existing.timestamp) {
          seen.set(key, ctx);
          const idx = result.indexOf(existing);
          if (idx !== -1) result[idx] = ctx;
        }
      }
    }

    return result;
  }

  /**
   * 获取去重键
   */
  getDeduplicationKey(ctx) {
    // 基于内容和来源生成键
    const contentHash = this.simpleHash(ctx.content.substring(0, 100));
    return `${ctx.source}_${contentHash}`;
  }

  /**
   * 简单哈希函数
   */
  simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * 应用时效性权重
   */
  applyTimeWeight(contexts) {
    const now = Date.now();
    
    return contexts.map(ctx => {
      const age = now - ctx.timestamp;
      const sourceConfig = this.sources.get(ctx.source);
      const baseWeight = sourceConfig?.weight || 1.0;
      
      // 时间衰减因子（1小时前约0.9，24小时前约0.7）
      const timeDecay = Math.max(0.5, 1 - (age / (24 * 3600000)) * 0.3);
      
      return {
        ...ctx,
        effectivePriority: ctx.priority * baseWeight * timeDecay
      };
    });
  }

  /**
   * 压缩到指定 Token 预算
   */
  compressToBudget(contexts, budget) {
    // 首先计算总 Token 数
    let totalTokens = contexts.reduce((sum, ctx) => sum + ctx.tokens, 0);
    
    if (totalTokens <= budget) {
      return contexts;
    }

    // 按有效优先级排序（低的先压缩）
    const sorted = [...contexts].sort(
      (a, b) => a.effectivePriority - b.effectivePriority
    );

    const result = [];
    let usedBudget = 0;
    const preserved = contexts.filter(ctx => ctx.priority >= 90); // 高优先级保留

    // 优先保留高优先级内容
    for (const ctx of sorted) {
      if (ctx.priority >= 90) {
        result.push(ctx);
        usedBudget += ctx.tokens;
      }
    }

    // 填充剩余内容直到达到预算
    for (const ctx of sorted) {
      if (ctx.priority < 90 && usedBudget + ctx.tokens <= budget) {
        result.push(ctx);
        usedBudget += ctx.tokens;
      }
    }

    // 重新按优先级排序
    return this.prioritize(result);
  }

  /**
   * 压缩单个上下文
   */
  async compress(context, options = {}) {
    const budget = options.budget || this.config.defaultBudget;
    const preserve = options.preserve || [];

    const contexts = Array.isArray(context) ? context : [context];
    
    // 标记需要保留的内容
    const marked = contexts.map(ctx => ({
      ...ctx,
      priority: preserve.includes(ctx.source) ? 100 : ctx.priority
    }));

    return this.fuse(marked, { budget });
  }

  /**
   * 估算 Token 数（简单估算：中文约2字符/token，英文约4字符/token）
   */
  estimateTokens(content) {
    if (!content) return 0;
    
    const chinese = (content.match(/[\u4e00-\u9fff]/g) || []).length;
    const english = (content.match(/[a-zA-Z]/g) || []).length;
    const other = content.length - chinese - english;
    
    return Math.ceil(chinese / 2 + english / 4 + other / 4);
  }

  /**
   * 计算总 Token 数
   */
  calculateTokens(contexts) {
    return contexts.reduce((sum, ctx) => sum + (ctx.tokens || this.estimateTokens(ctx.content)), 0);
  }

  /**
   * 构建融合结果
   */
  buildFusionResult(contexts, stats) {
    return {
      contexts,
      summary: {
        total: contexts.length,
        budget: stats.budget,
        usedBudget: stats.usedBudget,
        compressionRatio: (1 - stats.usedBudget / stats.budget).toFixed(2),
        sources: [...new Set(contexts.map(c => c.source))]
      },
      metadata: {
        timestamp: Date.now(),
        sources: stats.inputCount
      }
    };
  }

  /**
   * 从历史会话提取相关上下文
   */
  async extractFromHistory(sessionId, options = {}) {
    const maxResults = options.maxResults || 5;
    const relevanceThreshold = options.threshold || 0.5;
    
    // 从缓存中查找
    const candidates = this.cache.getBySession(sessionId);
    
    if (!candidates || candidates.length === 0) {
      return { contexts: [], message: '无历史记录' };
    }

    // 按相关性排序
    const scored = candidates.map(ctx => ({
      ...ctx,
      relevance: this.calculateRelevance(ctx, options.query)
    })).filter(ctx => ctx.relevance >= relevanceThreshold)
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, maxResults);

    return {
      contexts: scored,
      totalFound: candidates.length,
      returned: scored.length
    };
  }

  /**
   * 计算相关性
   */
  calculateRelevance(context, query) {
    if (!query) return context.priority / 100;
    
    const content = (context.content || '').toLowerCase();
    const q = query.toLowerCase();
    
    // 简单关键词匹配
    const keywords = q.split(/\s+/);
    const matches = keywords.filter(k => content.includes(k)).length;
    
    return (matches / keywords.length) * 0.7 + (context.priority / 100) * 0.3;
  }

  /**
   * 获取当前上下文摘要
   */
  getContextSummary() {
    const cached = this.cache.getRecent();
    
    return {
      totalContexts: cached.length,
      bySource: this.groupBySource(cached),
      totalTokens: this.calculateTokens(cached),
      fusionCount: this.fusionHistory.length,
      lastFusion: this.fusionHistory[this.fusionHistory.length - 1]
    };
  }

  /**
   * 按来源分组
   */
  groupBySource(contexts) {
    const groups = {};
    for (const ctx of contexts) {
      if (!groups[ctx.source]) groups[ctx.source] = [];
      groups[ctx.source].push(ctx);
    }
    return groups;
  }

  /**
   * 添加到缓存
   */
  addToCache(context) {
    this.cache.add(context);
  }

  /**
   * 获取融合统计
   */
  getStats() {
    return {
      fusionCount: this.fusionHistory.length,
      cacheSize: this.cache.size(),
      sources: Array.from(this.sources.keys()),
      recentFusions: this.fusionHistory.slice(-5)
    };
  }
}

/**
 * 优先级引擎
 */
class PriorityEngine {
  constructor() {
    this.rules = [];
  }

  addRule(condition, priority) {
    this.rules.push({ condition, priority });
  }

  calculate(context) {
    let priority = context.basePriority || 50;
    
    for (const rule of this.rules) {
      if (rule.condition(context)) {
        priority += rule.priority;
      }
    }
    
    return Math.min(100, Math.max(0, priority));
  }
}

/**
 * 上下文缓存
 */
class ContextCache {
  constructor(maxSize = 100) {
    this.cache = [];
    this.maxSize = maxSize;
    this.index = new Map();
  }

  add(context) {
    // 清理过期内容
    this.cleanExpired();
    
    const entry = {
      ...context,
      cachedAt: Date.now()
    };
    
    this.cache.push(entry);
    
    // 维护索引
    if (context.sessionId) {
      if (!this.index.has(context.sessionId)) {
        this.index.set(context.sessionId, []);
      }
      this.index.get(context.sessionId).push(entry);
    }
    
    // 限制大小
    if (this.cache.length > this.maxSize) {
      this.cache = this.cache.slice(-this.maxSize);
    }
    
    return entry;
  }

  cleanExpired() {
    const now = Date.now();
    const ttl = 24 * 3600000; // 24小时
    this.cache = this.cache.filter(c => now - c.cachedAt < ttl);
  }

  getRecent(limit = 20) {
    return this.cache.slice(-limit);
  }

  getBySession(sessionId) {
    return this.index.get(sessionId) || [];
  }

  size() {
    return this.cache.length;
  }

  clear() {
    this.cache = [];
    this.index.clear();
  }
}

module.exports = ContextFusion;
