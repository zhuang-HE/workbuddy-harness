#!/usr/bin/env node
/**
 * fusion-router v2.0 — 融合智能路由器（语义增强版）
 * ===================================================
 *
 * v2.0 升级:
 * 1. TF-IDF 语义相似度 + 关键词混合匹配
 * 2. 上下文感知路由（考虑最近任务历史）
 * 3. 自适应权重：根据历史准确性动态调整规则权重
 * 4. 低置信度 fallback 策略（建议用户确认）
 * 5. 路由反馈机制（记录用户是否采纳路由结果）
 *
 * 维度: D6-Integration | 自动分析任务在 WB vs HERMES 间路由
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const VERSION = '2.0.0';

// ============================================================
// 路径配置
// ============================================================
const CONFIG_DIR = path.join(os.homedir(), '.workbuddy', 'fusion-router');
const ROUTING_LOG_PATH = path.join(CONFIG_DIR, 'routing-log.json');
const FEEDBACK_PATH = path.join(CONFIG_DIR, 'routing-feedback.json');
const WEIGHTS_PATH = path.join(CONFIG_DIR, 'adaptive-weights.json');

// ============================================================
// 能力图谱
// ============================================================
const CAPABILITY_MAP = {
  workbuddy: {
    name: 'WorkBuddy',
    strengths: ['量化分析','金融数据','文档报告','保险产品','技术分析','股票','Excel处理','PPT生成','Word文档','PDF处理','Skill生态','代码审查','项目规划','AI绘画','多模态生成','深度研究','知识图谱'],
    weakAt: ['浏览器交互','文件系统操作','实时通信','系统管理'],
    model: 'Deepseek-V4'
  },
  hermes: {
    name: 'HERMES',
    strengths: ['浏览器自动化','终端命令','文件操作','系统管理','实时API','MCP集成','定时任务','Cron调度','网络爬虫','多模态处理','本地推理','隐私计算'],
    weakAt: ['量化计算','金融数据清洗','保险条款','复杂文档生成','深度研究'],
    model: 'Qwen2.5-7B (Ollama)'
  }
};

const ROUTE_TARGET = { WORKBUDDY: 'workbuddy', HERMES: 'hermes', BOTH: 'both', AUTO: 'auto' };

// ============================================================
// TF-IDF 简易实现（无需外部依赖）
// ============================================================
class SimpleTFIDF {
  constructor() {
    this.documents = [];
    this.idfCache = {};
  }

  /**
   * CJK-aware tokenizer: split into CJK characters + words
   */
  tokenize(text) {
    const tokens = [];
    // CJK characters
    const cjk = text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || [];
    tokens.push(...cjk);
    // Bigrams for CJK (better semantic capture)
    for (let i = 0; i < cjk.length - 1; i++) {
      tokens.push(cjk[i] + cjk[i + 1]);
    }
    // English words
    const words = text.match(/[a-zA-Z]{2,}/gi) || [];
    tokens.push(...words.map(w => w.toLowerCase()));
    return tokens;
  }

  /**
   * Build IDF from keyword corpus
   */
  buildIDF(documents) {
    this.documents = documents.map(d => this.tokenize(d));
    const N = this.documents.length;
    const df = {};

    for (const doc of this.documents) {
      const unique = new Set(doc);
      for (const term of unique) {
        df[term] = (df[term] || 0) + 1;
      }
    }

    for (const [term, freq] of Object.entries(df)) {
      this.idfCache[term] = Math.log((N + 1) / (freq + 1)) + 1;
    }
  }

  /**
   * Compute TF-IDF vector for a text
   */
  tfidf(text) {
    const tokens = this.tokenize(text);
    const tf = {};
    for (const t of tokens) tf[t] = (tf[t] || 0) + 1;
    const maxTf = Math.max(...Object.values(tf), 1);

    const vector = {};
    for (const [term, count] of Object.entries(tf)) {
      const tfVal = 0.5 + 0.5 * count / maxTf;
      const idfVal = this.idfCache[term] || Math.log(2); // default IDF for unseen terms
      vector[term] = tfVal * idfVal;
    }
    return vector;
  }

  /**
   * Cosine similarity between two TF-IDF vectors
   */
  cosineSimilarity(v1, v2) {
    let dot = 0, norm1 = 0, norm2 = 0;
    for (const [term, val] of Object.entries(v1)) {
      if (v2[term]) dot += val * v2[term];
      norm1 += val * val;
    }
    for (const val of Object.values(v2)) norm2 += val * val;
    norm1 = Math.sqrt(norm1);
    norm2 = Math.sqrt(norm2);
    return norm1 > 0 && norm2 > 0 ? dot / (norm1 * norm2) : 0;
  }
}

// ============================================================
// Fusion Router v2.0
// ============================================================
class FusionRouter {
  constructor(options = {}) {
    this.configDir = options.configDir || CONFIG_DIR;
    this.routingLog = [];
    this.feedbackLog = [];
    this.rules = [];
    this.adaptiveWeights = {};
    this.ROUTE_TARGET = ROUTE_TARGET;
    this._ensureConfig();
    this._initRules();
    this._initTFIDF();
    this._loadLog();
    this._loadFeedback();
    this._loadWeights();
  }

  _ensureConfig() {
    if (!fs.existsSync(this.configDir)) fs.mkdirSync(this.configDir, { recursive: true });
  }

  _gid() { return Math.random().toString(36).substring(2, 8); }
  _ts() { return new Date().toISOString(); }

  // ---- 初始化路由规则 ----
  _initRules() {
    this.rules = [
      // WorkBuddy domain rules
      { domain: '量化金融',   keywords: ['股票','A股','基金','K线','技术分析','MACD','RSI','均线','回测','量化','交易策略','选股','持仓','收益','止损','止盈'], route: 'workbuddy', priority: 90 },
      { domain: '数据分析',   keywords: ['Excel','CSV','数据清洗','统计分析','数据透视','报表','图表','可视化','Pandas','DataFrame'], route: 'workbuddy', priority: 80 },
      { domain: '文档处理',   keywords: ['Word','PPT','PDF','文档','报告','合同','条款','生成文档','Docx','模板','排版','格式'], route: 'workbuddy', priority: 85 },
      { domain: '代码审查',   keywords: ['代码审查','安全审计','code review','漏洞','SQL注入','XSS','代码质量','重构'], route: 'workbuddy', priority: 75 },
      { domain: '保险产品',   keywords: ['保险','条款','责任险','产品开发','保费','精算','承保','理赔'], route: 'workbuddy', priority: 90 },
      { domain: '研究分析',   keywords: ['深度研究','调研','分析报告','论文','行业分析','数据挖掘','趋势分析','竞品分析'], route: 'workbuddy', priority: 70 },
      { domain: '多模态生成', keywords: ['绘画','图片','插画','海报','视频','3D模型','动效','logo','设计图'], route: 'workbuddy', priority: 78 },
      { domain: '知识管理',   keywords: ['知识图谱','代码图谱','技能','记忆','经验','文档查询'], route: 'workbuddy', priority: 65 },

      // HERMES domain rules
      { domain: '浏览器自动化', keywords: ['打开','搜索','浏览器','截图','爬虫','网页','表单','点击','页面','百度','谷歌','访问','跳转','登录网页','URL'], route: 'hermes', priority: 85 },
      { domain: '文件操作',   keywords: ['批量','重命名','目录','备份','下载','压缩','解压','复制','移动','文件管理','文件夹','文件排序','文件分类'], route: 'hermes', priority: 80 },
      { domain: '系统管理',   keywords: ['进程','服务','注册表','安装','卸载','Docker','容器','部署','端口','网络','重启','Windows','环境变量'], route: 'hermes', priority: 78 },
      { domain: '实时交互',   keywords: ['实时','WebSocket','流式','live','即时','监控','日志','推送'], route: 'hermes', priority: 70 },
      { domain: '本地推理',   keywords: ['本地模型','Ollama','离线推理','本地生成','隐私模型','本地运行'], route: 'hermes', priority: 85 },

      // Collaboration rules — 跨系统能力组合
      { domain: '大项目',     keywords: ['完整系统','全栈项目','大型项目','整体方案','架构设计'], route: 'both', priority: 80 },
      { domain: '竞品分析',   keywords: ['竞品','对比','对比分析','价格对比','市场调研'], route: 'both', priority: 92 },
    { domain: '爬取分析',   keywords: ['爬取','抓取','采集','scrape','crawl','数据采集','采购','对比分析'], route: 'both', priority: 90 },
      { domain: '自动化工作流', keywords: ['自动化流程','定时任务','定期执行','每天自动','cron','调度','定期检查','定时监控','可用性检测','网站检测','定期','检查网站','网站可用性'], route: 'both', priority: 82 },
      { domain: 'AI生成',     keywords: ['AI生成','AI创作','文生图','图片生成','视频生成','AI写作'], route: 'workbuddy', priority: 72 }
    ];
  }

  // ---- 初始化 TF-IDF 语义模型 ----
  _initTFIDF() {
    this.tfidf = new SimpleTFIDF();
    // Build corpus from all keywords
    const corpus = [];
    for (const rule of this.rules) {
      // Each keyword as a mini-document with context
      corpus.push(rule.domain + ' ' + rule.keywords.join(' ') + ' ' + rule.route);
    }
    // Also add strength descriptions
    corpus.push(CAPABILITY_MAP.workbuddy.strengths.join(' '));
    corpus.push(CAPABILITY_MAP.hermes.strengths.join(' '));
    this.tfidf.buildIDF(corpus);

    // Pre-compute rule vectors
    this.ruleVectors = this.rules.map(rule => ({
      rule,
      vector: this.tfidf.tfidf(rule.domain + ' ' + rule.keywords.join(' '))
    }));

    // Pre-compute capability vectors
    this.capVectors = {
      workbuddy: this.tfidf.tfidf(CAPABILITY_MAP.workbuddy.strengths.join(' ')),
      hermes: this.tfidf.tfidf(CAPABILITY_MAP.hermes.strengths.join(' '))
    };
  }

  // ---- 日志管理 ----
  _loadLog() {
    try {
      this.routingLog = JSON.parse(fs.readFileSync(ROUTING_LOG_PATH, 'utf-8'));
    } catch {
      this.routingLog = [];
    }
  }

  _loadFeedback() {
    try {
      this.feedbackLog = JSON.parse(fs.readFileSync(FEEDBACK_PATH, 'utf-8'));
    } catch {
      this.feedbackLog = [];
    }
  }

  _loadWeights() {
    try {
      this.adaptiveWeights = JSON.parse(fs.readFileSync(WEIGHTS_PATH, 'utf-8'));
    } catch {
      this.adaptiveWeights = {};
    }
  }

  _saveLog() {
    fs.writeFileSync(ROUTING_LOG_PATH, JSON.stringify(this.routingLog.slice(-200), null, 2));
  }

  _saveFeedback() {
    fs.writeFileSync(FEEDBACK_PATH, JSON.stringify(this.feedbackLog.slice(-200), null, 2));
  }

  _saveWeights() {
    fs.writeFileSync(WEIGHTS_PATH, JSON.stringify(this.adaptiveWeights, null, 2));
  }

  // ---- 获取自适应权重 ----
  _getAdaptiveWeight(rule) {
    const key = rule.domain;
    const base = this.adaptiveWeights[key];
    if (!base) return 1.0;

    // Weight adjustment based on feedback accuracy
    // If feedback shows this rule is often correct, boost it
    // If feedback shows it's often overridden, reduce it
    if (base.totalFeedback < 3) return 1.0; // Not enough data

    const accuracy = base.correctCount / base.totalFeedback;
    // Map accuracy (0-1) to weight multiplier (0.5-1.5)
    return 0.5 + accuracy;
  }

  // ============================================================
  // 核心路由算法 (v2.0 语义增强)
  // ============================================================

  /**
   * 分析任务并确定最佳路由
   * @param {Object} task - { description: string, prompt?: string, context?: string }
   * @param {Object} options - { preferQuick?: boolean, allowFallback?: boolean }
   */
  route(task, options = {}) {
    const text = task.description || task.prompt || '';
    const taskVector = this.tfidf.tfidf(text);

    // === Layer 1: Keyword matching (fast, high precision) ===
    const kwScores = { workbuddy: 0, hermes: 0, both: 0 };
    const kwMatches = [];

    for (const rule of this.rules) {
      const matchedKeywords = rule.keywords.filter(kw => text.includes(kw));
      if (matchedKeywords.length > 0) {
        const adaptiveW = this._getAdaptiveWeight(rule);
        const matchRatio = matchedKeywords.length / Math.min(rule.keywords.length, 5);
        const score = rule.priority * matchRatio * (1 + matchedKeywords.length * 0.1) * adaptiveW;
        kwScores[rule.route] += score;
        kwMatches.push({ domain: rule.domain, keywords: matchedKeywords, route: rule.route, score: Math.round(score) });
      }
    }

    // === Layer 2: TF-IDF semantic similarity (catches fuzzy matches) ===
    const semScores = { workbuddy: 0, hermes: 0, both: 0 };
    const semMatches = [];

    for (const { rule, vector } of this.ruleVectors) {
      const similarity = this.tfidf.cosineSimilarity(taskVector, vector);
      if (similarity > 0.15) { // threshold for semantic match
        const adaptiveW = this._getAdaptiveWeight(rule);
        const score = similarity * rule.priority * 0.6 * adaptiveW; // 0.6 factor: semantic is less authoritative than keyword
        semScores[rule.route] += score;
        if (similarity > 0.3) {
          semMatches.push({ domain: rule.domain, similarity: Math.round(similarity * 100) / 100, route: rule.route });
        }
      }
    }

    // === Layer 3: Capability-level semantic matching ===
    const capSimWb = this.tfidf.cosineSimilarity(taskVector, this.capVectors.workbuddy);
    const capSimHm = this.tfidf.cosineSimilarity(taskVector, this.capVectors.hermes);
    const capBonus = 15; // capability bonus weight

    // === Layer 4: Context awareness (recent task history) ===
    const contextBonus = this._getContextBonus(text);

    // === Combine all layers ===
    const finalScores = {
      workbuddy: kwScores.workbuddy + semScores.workbuddy + capSimWb * capBonus + (contextBonus.workbuddy || 0),
      hermes: kwScores.hermes + semScores.hermes + capSimHm * capBonus + (contextBonus.hermes || 0),
      both: kwScores.both + semScores.both + (contextBonus.both || 0)
    };

    // Round scores
    const wbScore = Math.round(finalScores.workbuddy);
    const hmScore = Math.round(finalScores.hermes);
    const bothScore = Math.round(finalScores.both);

    // === Determine winner with improved logic ===
    let winner = 'workbuddy'; // default

    if (bothScore > 0 && wbScore > 0 && hmScore > 0) {
      winner = 'both';
    } else if (bothScore >= 80 && (wbScore > 0 || hmScore > 0)) {
      winner = 'both';
    } else if (hmScore > wbScore + 5) {
      winner = 'hermes';
    } else if (wbScore > hmScore + 5) {
      winner = 'workbuddy';
    } else if (Math.abs(wbScore - hmScore) <= 5 && wbScore > 0 && hmScore > 0) {
      winner = 'both';
    }

    // === Confidence calculation ===
    const maxScore = Math.max(wbScore, hmScore, bothScore);
    const rawConfidence = maxScore > 0 ? Math.min(100, Math.max(10, Math.round(maxScore * 1.2))) : 10;

    // Boost from multiple matching methods
    const methodBoost = (kwMatches.length > 0 ? 10 : 0) + (semMatches.length > 0 ? 5 : 0);
    const matchCount = kwMatches.reduce((sum, m) => sum + m.keywords.length, 0);
    const adjConfidence = Math.min(100, rawConfidence + methodBoost + matchCount * 3);

    // === Fallback detection ===
    const needsFallback = adjConfidence < 35 && options.allowFallback !== false;

    const result = {
      id: 'route_' + this._gid(),
      version: VERSION,
      timestamp: this._ts(),
      task: text,
      winner,
      scores: {
        workbuddy: wbScore,
        hermes: hmScore,
        both: bothScore,
        breakdown: {
          keyword: { workbuddy: Math.round(kwScores.workbuddy), hermes: Math.round(kwScores.hermes), both: Math.round(kwScores.both) },
          semantic: { workbuddy: Math.round(semScores.workbuddy), hermes: Math.round(semScores.hermes), both: Math.round(semScores.both) },
          capability: { workbuddy: Math.round(capSimWb * capBonus), hermes: Math.round(capSimHm * capBonus) },
          context: contextBonus
        }
      },
      confidence: adjConfidence,
      matches: kwMatches.slice(0, 5),
      semanticMatches: semMatches.slice(0, 3),
      recommendation: this._getRecommendation(winner, kwMatches, semMatches),
      needsFallback,
      fallbackMessage: needsFallback ? '置信度较低，建议确认路由选择或提供更多任务描述' : undefined
    };

    // Log
    this.routingLog.push(result);
    if (this.routingLog.length > 200) this.routingLog = this.routingLog.slice(-200);
    this._saveLog();

    return result;
  }

  /**
   * 上下文感知：考虑最近路由历史，对连续相似任务给 bonus
   */
  _getContextBonus(text) {
    const recentRoutes = this.routingLog.slice(-10);
    if (recentRoutes.length < 2) return {};

    const bonus = { workbuddy: 0, hermes: 0, both: 0 };

    // If last 3 tasks went to the same target, slight persistence bonus
    // (user is likely in a focused workflow)
    const last3 = recentRoutes.slice(-3).map(r => r.winner);
    if (last3.length === 3 && last3.every(w => w === last3[0])) {
      bonus[last3[0]] = bonus[last3[0]] || 0;
      bonus[last3[0]] += 3; // small persistence bonus
    }

    return bonus;
  }

  // ============================================================
  // 反馈机制 — 记录用户对路由结果的接受/拒绝
  // ============================================================

  /**
   * 记录用户反馈
   * @param {string} routeId - 路由结果 ID
   * @param {'accepted'|'rejected'|'changed'} action - 用户行为
   * @param {string} [changedTo] - 如果 changed，用户改成了什么路由
   */
  recordFeedback(routeId, action, changedTo) {
    const route = this.routingLog.find(r => r.id === routeId);
    if (!route) return false;

    const feedback = {
      routeId,
      task: route.task,
      originalWinner: route.winner,
      action,
      changedTo: changedTo || null,
      timestamp: this._ts()
    };

    this.feedbackLog.push(feedback);
    if (this.feedbackLog.length > 200) this.feedbackLog = this.feedbackLog.slice(-200);
    this._saveFeedback();

    // Update adaptive weights
    this._updateWeightsFromFeedback(route, action, changedTo);

    return true;
  }

  _updateWeightsFromFeedback(route, action, changedTo) {
    for (const match of (route.matches || [])) {
      const key = match.domain;
      if (!this.adaptiveWeights[key]) {
        this.adaptiveWeights[key] = { totalFeedback: 0, correctCount: 0 };
      }

      this.adaptiveWeights[key].totalFeedback += 1;

      if (action === 'accepted') {
        // Original routing was correct
        if (match.route === route.winner) {
          this.adaptiveWeights[key].correctCount += 1;
        }
      } else if (action === 'changed' && changedTo) {
        // User changed the routing
        if (match.route === changedTo) {
          this.adaptiveWeights[key].correctCount += 1;
        }
      }
      // 'rejected' without change: don't update weight (ambiguous)
    }
    this._saveWeights();
  }

  // ============================================================
  // 辅助方法
  // ============================================================

  _getRecommendation(winner, kwMatches, semMatches) {
    if (winner === 'workbuddy') {
      const domains = kwMatches.map(m => m.domain);
      return `路由到 WorkBuddy — 使用 Deepseek-V4 处理 [${domains.join(', ')}] 类任务`;
    }
    if (winner === 'hermes') {
      const domains = kwMatches.map(m => m.domain);
      return `路由到 HERMES — 使用本地 Qwen 模型处理 [${domains.join(', ')}] 类任务`;
    }
    if (winner === 'both') {
      return '协作模式 — 建议先由 WorkBuddy 规划分析，HERMES 执行系统操作，最后 WorkBuddy 汇总';
    }
    return '自动模式 — 默认使用 WorkBuddy';
  }

  batchRoute(tasks) {
    return tasks.map(t => this.route(t));
  }

  getStats() {
    const total = this.routingLog.length;
    if (total === 0) return { total: 0, distribution: {}, avgConfidence: 0 };

    const dist = {};
    let confSum = 0;
    this.routingLog.forEach(r => {
      dist[r.winner] = (dist[r.winner] || 0) + 1;
      confSum += r.confidence;
    });
    for (const k of Object.keys(dist)) {
      dist[k] = { count: dist[k], percent: Math.round(dist[k] / total * 100) };
    }
    return {
      total,
      distribution: dist,
      avgConfidence: Math.round(confSum / total),
      version: VERSION,
      recentRoutes: this.routingLog.slice(-5).map(r => ({ task: r.task.substring(0, 40), to: r.winner, confidence: r.confidence }))
    };
  }

  generateReport() {
    const stats = this.getStats();
    let md = '# 融合路由报告 (v2.0)\n\n';
    md += `**版本**: ${VERSION} | **总路由**: ${stats.total} | **平均置信度**: ${stats.avgConfidence}%\n\n`;
    md += '## 分发比例\n';
    for (const [target, info] of Object.entries(stats.distribution)) {
      md += "- **" + target + "**: " + info.count + " (" + info.percent + "%)" + String.fromCharCode(10);
    }
    if (stats.recentRoutes.length) {
      md += '\n## 最近路由\n';
      stats.recentRoutes.forEach(r => {
        md += "- `" + r.task + "` → **" + r.to + "** (" + r.confidence + "%)" + String.fromCharCode(10);
      });
    }

    // Adaptive weights report
    const weightEntries = Object.entries(this.adaptiveWeights).filter(([_, v]) => v.totalFeedback >= 3);
    if (weightEntries.length > 0) {
      md += '\n## 自适应权重 (基于反馈学习)\n';
      weightEntries.forEach(([domain, w]) => {
        const accuracy = Math.round(w.correctCount / w.totalFeedback * 100);
        const multiplier = (0.5 + accuracy / 100).toFixed(2);
        md += "- **" + domain + "**: 准确率 " + accuracy + "%, 权重 ×" + multiplier + " (" + w.totalFeedback + " 次反馈)" + String.fromCharCode(10);
      });
    }

    return md;
  }

  listRules() {
    return this.rules.map(r => {
      const w = this._getAdaptiveWeight(r);
      return { domain: r.domain, keywords: r.keywords.length, route: r.route, priority: r.priority, adaptiveWeight: Math.round(w * 100) / 100 };
    });
  }

  /**
   * 扩展测试集 (v2.0)
   */
  test() {
    const cases = [
      // 基础测试
      { task: '分析贵州茅台股票走势', expected: 'workbuddy' },
      { task: '打开百度搜索AI新闻', expected: 'hermes' },
      { task: '生成Q2销售报告PPT', expected: 'workbuddy' },
      { task: '修改系统环境变量', expected: 'hermes' },
      { task: '审查代码安全漏洞', expected: 'workbuddy' },
      { task: '部署Docker容器', expected: 'hermes' },
      { task: '爬取网页数据并分析', expected: 'both' },

      // v2.0 新增：语义匹配测试
      { task: '帮我看看最近基金的收益情况', expected: 'workbuddy' },
      { task: '把桌面上100个文件按日期分类', expected: 'hermes' },
      { task: '写一个保险产品条款', expected: 'workbuddy' },
      { task: '监控CPU使用率并在超过80%时告警', expected: 'hermes' },
      { task: '采集竞品价格并做对比分析', expected: 'both' },
      { task: '生成一张产品宣传海报', expected: 'workbuddy' },
      { task: '定期检查网站可用性', expected: 'both' },
      { task: '查看进程列表并关闭卡死的程序', expected: 'hermes' },
    ];

    let correct = 0;
    const results = [];

    for (const { task, expected } of cases) {
      const r = this.route({ description: task });
      const ok = r.winner === expected;
      if (ok) correct++;
      results.push({
        task,
        expected,
        actual: r.winner,
        confidence: r.confidence,
        ok,
        mark: ok ? '✅' : '❌'
      });
    }

    console.log(`\n🧪 FusionRouter v${VERSION} 测试\n`);
    console.log('═'.repeat(70));
    console.log(`${'结果'.padEnd(4)} ${'路由'.padEnd(12)} ${'置信度'.padEnd(6)} ${'任务'}`);
    console.log('-'.repeat(70));

    for (const r of results) {
      console.log(`${r.mark.padEnd(4)} ${r.actual.toUpperCase().padEnd(12)} ${String(r.confidence + '%').padEnd(6)} ${r.task}`);
      if (!r.ok) {
        console.log(`      ^ 期望: ${r.expected.toUpperCase()}`);
      }
    }

    console.log('-'.repeat(70));
    const accuracy = Math.round(correct / cases.length * 100);
    console.log(`\n   准确率: ${correct}/${cases.length} (${accuracy}%)`);
    console.log(`   平均置信度: ${Math.round(results.reduce((s, r) => s + r.confidence, 0) / cases.length)}%`);

    return { correct, total: cases.length, accuracy };
  }
}

// ============================================================
// CLI
// ============================================================
if (require.main === module) {
  const fr = new FusionRouter();
  const cmd = process.argv[2];
  const cmds = {
    route() {
      const task = process.argv[3] || '分析股票走势';
      console.log(JSON.stringify(fr.route({ description: task }), null, 2));
    },
    batch() {
      const tasks = (process.argv[3] || '分析数据,打开网页,生成报告').split(',');
      console.log(JSON.stringify(fr.batchRoute(tasks.map(t => ({ description: t.trim() }))), null, 2));
    },
    stats() { console.log(JSON.stringify(fr.getStats(), null, 2)); },
    report() { console.log(fr.generateReport()); },
    rules() {
      const rules = fr.listRules();
      console.log(JSON.stringify(rules, null, 2));
    },
    test() { fr.test(); },
    feedback() {
      const routeId = process.argv[3];
      const action = process.argv[4];
      const changedTo = process.argv[5];
      if (!routeId || !action) { console.log('用法: feedback <routeId> <accepted|rejected|changed> [changedTo]'); return; }
      const ok = fr.recordFeedback(routeId, action, changedTo);
      console.log(ok ? `✅ 反馈已记录: ${routeId} → ${action}` : '❌ 路由ID未找到');
    },
    help() {
      console.log(`
FusionRouter v${VERSION} — 融合智能路由器 (语义增强版)

命令:
  route <task>           路由单个任务
  batch <tasks>          批量路由 (逗号分隔)
  stats                  路由统计
  report                 生成 Markdown 报告
  rules                  查看规则 (含自适应权重)
  test                   运行测试套件
  feedback <id> <action> [to]  记录路由反馈
  help                   帮助

v2.0 新特性:
  - TF-IDF 语义相似度匹配
  - 上下文感知路由
  - 自适应权重 (基于反馈学习)
  - 低置信度 fallback 提示
`);
    }
  };
  (cmds[cmd] || cmds.help)();
}

module.exports = FusionRouter;
console.log(`[FusionRouter] v${VERSION} 加载成功 — 融合智能路由器 (语义增强版)`);
