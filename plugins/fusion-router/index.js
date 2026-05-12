#!/usr/bin/env node
/**
 * fusion-router - P4-9 融合智能路由器
 * 维度: D6-Integration | 自动分析任务在 WB vs HERMES 间路由
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

// Routing rules by capability domain
const CAPABILITY_MAP = {
  workbuddy: {
    name: 'WorkBuddy',
    strengths: ['量化分析','金融数据','文档报告','保险产品','技术分析','股票','Excel处理','PPT生成','Word文档','PDF处理','Skill生态','代码审查','项目规划'],
    weakAt: ['浏览器交互','文件系统操作','实时通信','系统管理'],
    model: 'Deepseek-V4'
  },
  hermes: {
    name: 'HERMES',
    strengths: ['浏览器自动化','终端命令','文件操作','系统管理','实时API','MCP集成','定时任务','Cron调度','网络爬虫','多模态处理'],
    weakAt: ['量化计算','金融数据清洗','保险条款','复杂文档生成'],
    model: 'Qwen2.5-7B (Ollama)'
  }
};

const ROUTE_TARGET = { WORKBUDDY: 'workbuddy', HERMES: 'hermes', BOTH: 'both', AUTO: 'auto' };

class FusionRouter {
  constructor(options = {}) {
    this.configDir = options.configDir || path.join(os.homedir(), '.workbuddy', 'fusion-router');
    this.routingLog = [];
    this.rules = [];
    this._ensureConfig();
    this._initRules();
  }

  _ensureConfig() {
    if (!fs.existsSync(this.configDir)) fs.mkdirSync(this.configDir, { recursive: true });
  }
  _gid() { return Math.random().toString(36).substring(2, 8); }
  _ts() { return new Date().toISOString(); }

  _initRules() {
    // WorkBuddy domain rules
    this.rules.push(
      { domain: '量化金融',   keywords: ['股票','A股','基金','K线','技术分析','MACD','RSI','均线','回测','量化','交易策略','选股'], route: 'workbuddy', priority: 90 },
      { domain: '数据分析',   keywords: ['Excel','CSV','数据清洗','统计分析','数据透视','报表','图表'], route: 'workbuddy', priority: 80 },
      { domain: '文档处理',   keywords: ['Word','PPT','PDF','文档','报告','合同','条款','生成文档','Docx','模板'], route: 'workbuddy', priority: 85 },
      { domain: '代码审查',   keywords: ['代码审查','安全审计','code review','漏洞','SQL注入','XSS'], route: 'workbuddy', priority: 75 },
      { domain: '保险产品',   keywords: ['保险','条款','责任险','产品开发','保费','精算'], route: 'workbuddy', priority: 90 },
      { domain: '研究分析',   keywords: ['深度研究','调研','分析报告','论文','行业分析'], route: 'workbuddy', priority: 70 },

      // HERMES domain rules
      { domain: '浏览器自动化', keywords: ['打开','搜索','浏览器','截图','爬虫','网页','表单','点击','页面','百度','谷歌','访问','跳转','登录网页'], route: 'hermes', priority: 85 },
      { domain: '文件操作',   keywords: ['文件','批量','重命名','目录','同步','备份','下载','压缩','解压','复制','移动'], route: 'hermes', priority: 80 },
      { domain: '系统管理',   keywords: ['系统','进程','服务','配置','环境变量','注册表','安装','卸载','Docker','容器','部署','端口','网络','重启'], route: 'hermes', priority: 78 },
      { domain: '实时交互',   keywords: ['实时','WebSocket','流式','live','即时','监控','日志'], route: 'hermes', priority: 70 },

      // Collaboration rules
      { domain: '大项目',     keywords: ['完整系统','全栈项目','大型项目','重构','整体方案'], route: 'both', priority: 80 }
    );
  }

  /**
   * Analyze task and determine best route
   */
  route(task) {
    const scores = { workbuddy: 0, hermes: 0, both: 0 };
    const matches = [];
    const text = task.description || task.prompt || '';

    for (const rule of this.rules) {
      const matchedKeywords = rule.keywords.filter(kw => text.includes(kw));
      if (matchedKeywords.length > 0) {
        // Score = priority * match_ratio, boosted by keyword count
        const matchRatio = matchedKeywords.length / Math.min(rule.keywords.length, 5);
        const score = rule.priority * matchRatio * (1 + matchedKeywords.length * 0.1);
        scores[rule.route] += score;
        matches.push({ domain: rule.domain, keywords: matchedKeywords, route: rule.route, score: Math.round(score) });
      }
    }

    // Determine winner
    let winner = 'workbuddy'; // default
    const wbScore = Math.round(scores.workbuddy);
    const hmScore = Math.round(scores.hermes);

    if (hmScore > wbScore + 5) winner = 'hermes';
    else if (Math.abs(wbScore - hmScore) <= 5 && wbScore > 0 && hmScore > 0) winner = 'both';

    const maxScore = Math.max(wbScore, hmScore, Math.round(scores.both));
    const confidence = Math.min(100, Math.max(10, Math.round(maxScore * 1.5)));

    // Boost confidence based on keyword match quality
    const allMatches = matches.reduce((sum, m) => sum + m.keywords.length, 0);
    const adjConfidence = Math.min(100, confidence + allMatches * 5);

    const result = {
      id: 'route_' + this._gid(),
      timestamp: this._ts(),
      task: task.description || task.prompt || 'unknown',
      winner,
      scores: { workbuddy: Math.round(scores.workbuddy), hermes: Math.round(scores.hermes), both: Math.round(scores.both) },
      confidence: adjConfidence,
      matches: matches.slice(0, 5),
      recommendation: this._getRecommendation(winner, matches)
    };

    this.routingLog.push(result);
    if (this.routingLog.length > 100) this.routingLog = this.routingLog.slice(-100);
    this._saveLog();

    return result;
  }

  _getRecommendation(winner, matches) {
    if (winner === 'workbuddy') return '路由到 WorkBuddy — 使用 Deepseek-V4 处理分析/文档类任务';
    if (winner === 'hermes') return '路由到 HERMES — 使用本地 Qwen 模型处理系统/浏览器交互任务';
    if (winner === 'both') return '协作模式 — 建议先由 WorkBuddy 规划分析，HERMES 执行系统操作';
    return '自动模式 — 默认使用 WorkBuddy';
  }

  /**
   * Batch route multiple tasks
   */
  batchRoute(tasks) {
    return tasks.map(t => this.route(t));
  }

  getStats() {
    const total = this.routingLog.length;
    if (total === 0) return { total: 0, distribution: {} };
    const dist = {};
    this.routingLog.forEach(r => { dist[r.winner] = (dist[r.winner] || 0) + 1; });
    for (const k of Object.keys(dist)) {
      dist[k] = { count: dist[k], percent: Math.round(dist[k] / total * 100) };
    }
    return { total, distribution: dist, recentRoutes: this.routingLog.slice(-5).map(r => ({ task: r.task.substring(0, 40), to: r.winner, confidence: r.confidence })) };
  }

  generateReport() {
    const stats = this.getStats();
    let md = '# 融合路由报告\n\n';
    md += '**总路由**: ' + stats.total + '\n\n';
    md += '## 分发比例\n';
    for (const [target, info] of Object.entries(stats.distribution)) {
      md += '- **' + target + '**: ' + info.count + ' (' + info.percent + '%)\n';
    }
    if (stats.recentRoutes.length) {
      md += '\n## 最近路由\n';
      stats.recentRoutes.forEach(r => {
        md += '- `' + r.task + '` → **' + r.to + '** (' + r.confidence + '%)\n';
      });
    }
    return md;
  }

  _saveLog() {
    fs.writeFileSync(path.join(this.configDir, 'routing-log.json'), JSON.stringify(this.routingLog.slice(-100), null, 2));
  }

  listRules() {
    return this.rules.map(r => ({
      domain: r.domain, keywords: r.keywords.length + ' keywords', route: r.route, priority: r.priority
    }));
  }
}

if (require.main === module) {
  const fr = new FusionRouter(); const cmd = process.argv[2];
  const cmds = {
    route() { const task = process.argv[3] || '分析股票走势'; console.log(JSON.stringify(fr.route({ description: task }), null, 2)); },
    batch() { const tasks = (process.argv[3] || '分析数据,打开网页,生成报告').split(','); console.log(JSON.stringify(fr.batchRoute(tasks.map(t => ({ description: t.trim() }))), null, 2)); },
    stats() { console.log(JSON.stringify(fr.getStats(), null, 2)); },
    report() { console.log(fr.generateReport()); },
    rules() { console.log(JSON.stringify(fr.listRules(), null, 2)); },
    test() {
      const cases = ['分析贵州茅台股票走势','打开百度搜索AI新闻','生成Q2销售报告PPT','修改系统环境变量','审查代码安全漏洞','部署Docker容器','爬取网页数据并分析'];
      cases.forEach(c => { const r = fr.route({ description: c }); console.log(r.winner.toUpperCase().padEnd(12) + ' [' + r.confidence + '%] ' + c); });
    },
    help() { console.log('FusionRouter CLI\n命令: route, batch, stats, report, rules, test, help'); }
  };
  (cmds[cmd] || cmds.help)();
}

module.exports = FusionRouter;
console.log('[FusionRouter] 加载成功 - P4-9 融合智能路由器');
