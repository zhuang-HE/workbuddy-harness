#!/usr/bin/env node
/**
 * fusion-router - P4-9 融合智能路由器 (增强版)
 * 维度: D6-Integration | 20+领域规则·智能分发·自适应学习
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// Capability mapping (enhanced)
const CAPABILITY_MAP = {
  workbuddy: {
    name: 'WorkBuddy',
    strengths: [
      '量化分析', '金融数据', '文档报告', '保险产品', '技术分析', 
      '股票', 'Excel处理', 'PPT生成', 'Word文档', 'PDF处理', 
      'Skill生态', '代码审查', '项目规划', '数据分析', '机器学习',
      '深度学习', 'AI模型', '风险评估', '财务分析'
    ],
    weakAt: ['浏览器交互', '文件系统操作', '实时通信', '系统管理', '硬件控制'],
    model: 'DeepSeek-V4',
    avgResponseTime: 2500 // ms
  },
  hermes: {
    name: 'HERMES',
    strengths: [
      '浏览器自动化', '终端命令', '文件操作', '系统管理', '实时API', 
      'MCP集成', '定时任务', 'Cron调度', '网络爬虫', '多模态处理',
      '进程管理', '环境变量', 'Docker操作', 'Git操作', '日志监控'
    ],
    weakAt: ['量化计算', '金融数据清洗', '保险条款', '复杂文档生成', '深度分析'],
    model: 'Qwen2.5-7B (Ollama)',
    avgResponseTime: 800 // ms
  }
};

const ROUTE_TARGET = { 
  WORKBUDDY: 'workbuddy', 
  HERMES: 'hermes', 
  BOTH: 'both', 
  AUTO: 'auto',
  FALLBACK: 'fallback'
};

class FusionRouter {
  constructor(options = {}) {
    this.configDir = options.configDir || path.join(os.homedir(), '.workbuddy', 'fusion-router');
    this.routingLog = [];
    this.rules = [];
    this.performanceLog = [];
    this.learningData = new Map(); // taskType -> success stats
    
    this._ensureConfig();
    this._initRules();
    this._loadLearningData();
  }
  
  _ensureConfig() {
    if (!fs.existsSync(this.configDir)) {
      fs.mkdirSync(this.configDir, { recursive: true });
    }
  }
  
  _gid() { 
    return Math.random().toString(36).substring(2, 10); 
  }
  
  _ts() { 
    return new Date().toISOString(); 
  }
  
  /**
   * Initialize 20+ domain rules (扩展自11条)
   */
  _initRules() {
    // ========== WorkBuddy 领域规则 (10条) ==========
    this.rules.push(
      // 量化金融 (增强)
      { 
        domain: '量化金融',   
        keywords: ['股票', 'A股', '基金', 'K线', '技术分析', 'MACD', 'RSI', '均线', '回测', '量化', '交易策略', '选股', '缠论', '五维分析', '主力资金'], 
        route: 'workbuddy', 
        priority: 95,
        examples: ['分析贵州茅台股票', '生成缠论买卖点']
      },
      
      // 数据分析 (新)
      { 
        domain: '数据分析',   
        keywords: ['Excel', 'CSV', '数据清洗', '统计分析', '数据透视', '报表', '图表', '可视化', 'pandas', 'numpy'], 
        route: 'workbuddy', 
        priority: 88,
        examples: ['分析销售数据', '生成Excel透视表']
      },
      
      // 文档处理 (增强)
      { 
        domain: '文档处理',   
        keywords: ['Word', 'PPT', 'PDF', '文档', '报告', '合同', '条款', '生成文档', 'Docx', '模板', 'Markdown', 'LaTeX'], 
        route: 'workbuddy', 
        priority: 90,
        examples: ['生成项目报告', '创建PPT演示']
      },
      
      // 代码审查 (增强)
      { 
        domain: '代码审查',   
        keywords: ['代码审查', '安全审计', 'code review', '漏洞', 'SQL注入', 'XSS', 'CSRF', '代码质量', '重构建议'], 
        route: 'workbuddy', 
        priority: 85,
        examples: ['审查这段代码', '安全审计报告']
      },
      
      // 保险产品 (增强)
      { 
        domain: '保险产品',   
        keywords: ['保险', '条款', '责任险', '产品开发', '保费', '精算', '非车险', '网络安全保险', '绿色保险'], 
        route: 'workbuddy', 
        priority: 92,
        examples: ['设计网络安全保险条款', '计算保费']
      },
      
      // 研究分析 (新)
      { 
        domain: '研究分析',   
        keywords: ['深度研究', '调研', '分析报告', '论文', '行业分析', '竞品分析', '市场研究', '技术选型'], 
        route: 'workbuddy', 
        priority: 82,
        examples: ['调研LLM技术选型', '生成行业分析报告']
      },
      
      // AI/ML (新)
      { 
        domain: 'AI/ML',   
        keywords: ['机器学习', '深度学习', '神经网络', '模型训练', '特征工程', 'NLP', '计算机视觉', '聚类', '分类'], 
        route: 'workbuddy', 
        priority: 87,
        examples: ['训练分类模型', '特征工程建议']
      },
      
      // 财务分析 (新)
      { 
        domain: '财务分析',   
        keywords: ['财务报表', '现金流', '资产负债表', '利润表', '财务比率', '杜邦分析', '估值', 'DCF'], 
        route: 'workbuddy', 
        priority: 89,
        examples: ['分析万科财务', 'DCF估值']
      },
      
      // 法律合规 (新)
      { 
        domain: '法律合规',   
        keywords: ['合同审查', '法律条款', '合规检查', '风险提示', '法律意见', '诉讼', '仲裁'], 
        route: 'workbuddy', 
        priority: 84,
        examples: ['审查合同条款', '合规风险评估']
      },
      
      // 项目管理 (新)
      { 
        domain: '项目管理',   
        keywords: ['项目规划', '进度管理', '风险评估', '资源分配', '甘特图', '敏捷开发', 'Scrum', '看板'], 
        route: 'workbuddy', 
        priority: 80,
        examples: ['制定项目计划', '风险评估报告']
      }
    );
    
    // ========== HERMES 领域规则 (8条) ==========
    this.rules.push(
      // 浏览器自动化 (增强)
      { 
        domain: '浏览器自动化', 
        keywords: ['打开', '搜索', '浏览器', '截图', '爬虫', '网页', '表单', '点击', '页面', '百度', '谷歌', '访问', '跳转', '登录网页', '滚动', '输入'], 
        route: 'hermes', 
        priority: 90,
        examples: ['打开百度搜索', '截图保存']
      },
      
      // 文件操作 (增强)
      { 
        domain: '文件操作',   
        keywords: ['文件', '批量', '重命名', '目录', '同步', '备份', '下载', '压缩', '解压', '复制', '移动', '权限', '软链接'], 
        route: 'hermes', 
        priority: 85,
        examples: ['批量重命名文件', '同步目录']
      },
      
      // 系统管理 (增强)
      { 
        domain: '系统管理',   
        keywords: ['系统', '进程', '服务', '配置', '环境变量', '注册表', '安装', '卸载', 'Docker', '容器', '部署', '端口', '网络', '重启', '日志'], 
        route: 'hermes', 
        priority: 82,
        examples: ['查看进程状态', '配置环境变量']
      },
      
      // 实时交互 (增强)
      { 
        domain: '实时交互',   
        keywords: ['实时', 'WebSocket', '流式', 'live', '即时', '监控', '日志', 'Cron', '定时任务', 'webhook'], 
        route: 'hermes', 
        priority: 78,
        examples: ['监控日志变化', '设置定时任务']
      },
      
      // Git操作 (新)
      { 
        domain: 'Git操作',   
        keywords: ['git', 'commit', 'push', 'pull', 'branch', 'merge', 'rebase', 'clone', 'fetch', '冲突解决'], 
        route: 'hermes', 
        priority: 86,
        examples: ['提交代码', '解决合并冲突']
      },
      
      // 网络请求 (新)
      { 
        domain: '网络请求',   
        keywords: ['curl', 'wget', 'HTTP请求', 'API调用', 'REST', 'GraphQL', 'POST', 'GET', 'PUT', 'DELETE'], 
        route: 'hermes', 
        priority: 83,
        examples: ['发送HTTP请求', '调用REST API']
      },
      
      // 数据库操作 (新)
      { 
        domain: '数据库操作',   
        keywords: ['SQL', '查询', '数据库', 'MySQL', 'PostgreSQL', 'MongoDB', 'Redis', '索引', '事务'], 
        route: 'hermes', 
        priority: 81,
        examples: ['执行SQL查询', '优化数据库索引']
      },
      
      // 开发环境 (新)
      { 
        domain: '开发环境',   
        keywords: ['npm', 'pip', 'conda', '虚拟环境', '依赖管理', '编译', '构建', '测试', 'lint'], 
        route: 'hermes', 
        priority: 79,
        examples: ['安装npm依赖', '运行单元测试']
      }
    );
    
    // ========== 协作规则 (4条) ==========
    this.rules.push(
      // 大项目 (增强)
      { 
        domain: '大项目',     
        keywords: ['完整系统', '全栈项目', '大型项目', '重构', '整体方案', '微服务', '分布式'], 
        route: 'both', 
        priority: 88,
        examples: ['构建电商系统', '微服务架构设计']
      },
      
      // 数据分析+可视化 (新)
      { 
        domain: '数据分析+可视化',     
        keywords: ['数据分析', '图表', '可视化', 'Dashboard', '实时监控'], 
        route: 'both', 
        priority: 85,
        examples: ['分析数据并生成Dashboard']
      },
      
      // 文档+自动化 (新)
      { 
        domain: '文档+自动化',     
        keywords: ['生成文档', '自动发布', 'CI/CD', '自动化部署'], 
        route: 'both', 
        priority: 82,
        examples: ['生成API文档并自动发布']
      },
      
      // 研究+实现 (新)
      { 
        domain: '研究+实现',     
        keywords: ['技术研究', '原型实现', 'POC', '技术验证'], 
        route: 'both', 
        priority: 80,
        examples: ['研究LLM并做POC']
      }
    );
    
    console.log(`[FusionRouter] 初始化 ${this.rules.length} 条领域规则`);
  }
  
  /**
   * 核心路由算法 (增强版)
   */
  route(task, options = {}) {
    const scores = { workbuddy: 0, hermes: 0, both: 0 };
    const matches = [];
    const text = (task.description || task.prompt || '').toLowerCase();
    
    // 计算各规则匹配度
    for (const rule of this.rules) {
      const matchedKeywords = rule.keywords.filter(kw => 
        text.includes(kw.toLowerCase())
      );
      
      if (matchedKeywords.length > 0) {
        // 增强评分算法
        const matchRatio = matchedKeywords.length / Math.min(rule.keywords.length, 8);
        const keywordBonus = matchedKeywords.length * 2; // 关键词越多，加分越多
        const score = rule.priority * matchRatio + keywordBonus;
        
        scores[rule.route] += score;
        matches.push({ 
          domain: rule.domain, 
          keywords: matchedKeywords, 
          route: rule.route, 
          score: Math.round(score),
          priority: rule.priority
        });
      }
    }
    
    // 应用学习数据调整评分
    const taskType = this._inferTaskType(text);
    if (this.learningData.has(taskType)) {
      const stats = this.learningData.get(taskType);
      if (stats.bestRoute && stats.confidence > 70) {
        scores[stats.bestRoute] *= 1.2; // 历史最佳路由加权20%
        console.log(`  [学习] 任务类型"${taskType}"建议使用 ${stats.bestRoute}`);
      }
    }
    
    // 决策逻辑 (增强)
    let winner = 'workbuddy'; // 默认
    const wbScore = Math.round(scores.workbuddy);
    const hmScore = Math.round(scores.hermes);
    const bothScore = Math.round(scores.both);
    
    // 决策树
    if (bothScore > wbScore && bothScore > hmScore) {
      winner = 'both';
    } else if (hmScore > wbScore + 10) {
      winner = 'hermes';
    } else if (Math.abs(wbScore - hmScore) <= 10 && wbScore > 0 && hmScore > 0) {
      winner = 'both';
    }
    
    // 计算置信度 (增强)
    const maxScore = Math.max(wbScore, hmScore, bothScore);
    let confidence = Math.min(100, Math.max(20, Math.round(maxScore * 1.2)));
    
    // 关键词质量加成
    const allMatches = matches.reduce((sum, m) => sum + m.keywords.length, 0);
    confidence = Math.min(100, confidence + allMatches * 3);
    
    // 匹配规则数量加成
    confidence = Math.min(100, confidence + matches.length * 5);
    
    // 生成结果
    const result = {
      id: 'route_' + this._gid(),
      timestamp: this._ts(),
      task: task.description || task.prompt || 'unknown',
      winner,
      scores: { 
        workbuddy: wbScore, 
        hermes: hmScore, 
        both: bothScore 
      },
      confidence,
      matches: matches.sort((a, b) => b.score - a.score).slice(0, 8),
      recommendation: this._getRecommendation(winner, matches, taskType),
      taskType,
      routingTime: Date.now()
    };
    
    // 记录日志
    this.routingLog.push(result);
    if (this.routingLog.length > 200) {
      this.routingLog = this.routingLog.slice(-200);
    }
    this._saveLog();
    
    return result;
  }
  
  _inferTaskType(text) {
    // 简单任务类型推断
    if (text.match(/股票|基金|量化|K线/)) return 'quant_finance';
    if (text.match(/打开|浏览器|搜索|网页/)) return 'browser_automation';
    if (text.match(/文档|Word|PPT|PDF|报告/)) return 'document_processing';
    if (text.match(/代码|审查|审计/)) return 'code_review';
    if (text.match(/文件|目录|批量/)) return 'file_operations';
    if (text.match(/系统|进程|服务/)) return 'system_admin';
    if (text.match(/git|commit|push/)) return 'git_operations';
    return 'general';
  }
  
  _getRecommendation(winner, matches, taskType) {
    const recommendations = {
      'workbuddy': `路由到 WorkBuddy — 使用 ${CAPABILITY_MAP.workbuddy.model} 处理分析/文档类任务`,
      'hermes': `路由到 HERMES — 使用 ${CAPABILITY_MAP.hermes.model} 处理系统/浏览器交互任务`,
      'both': '协作模式 — 建议先由 WorkBuddy 规划分析，HERMES 执行系统操作',
      'auto': '自动模式 — 根据任务特征动态选择'
    };
    
    let rec = recommendations[winner] || recommendations['auto'];
    
    // 添加学习建议
    if (this.learningData.has(taskType)) {
      const stats = this.learningData.get(taskType);
      if (stats.totalRoutes > 5) {
        rec += `\n  (历史 ${stats.totalRoutes} 次路由，最佳: ${stats.bestRoute})`;
      }
    }
    
    return rec;
  }
  
  /**
   * 记录路由结果反馈 (用于学习)
   */
  recordFeedback(routeId, success, actualRoute, notes = '') {
    const route = this.routingLog.find(r => r.id === routeId);
    if (!route) return { error: 'Route not found' };
    
    const taskType = route.taskType;
    if (!this.learningData.has(taskType)) {
      this.learningData.set(taskType, {
        totalRoutes: 0,
        successCount: 0,
        bestRoute: null,
        confidence: 0,
        history: []
      });
    }
    
    const stats = this.learningData.get(taskType);
    stats.totalRoutes++;
    if (success) stats.successCount++;
    
    // 更新最佳路由
    const successRate = stats.successCount / stats.totalRoutes;
    if (successRate > 0.7) {
      stats.bestRoute = actualRoute || route.winner;
      stats.confidence = Math.round(successRate * 100);
    }
    
    stats.history.push({
      routeId,
      success,
      actualRoute,
      timestamp: this._ts(),
      notes
    });
    
    this._saveLearningData();
    
    return {
      routeId,
      taskType,
      success,
      updatedStats: stats
    };
  }
  
  /**
   * 批量路由
   */
  batchRoute(tasks) {
    return tasks.map(t => this.route(t));
  }
  
  /**
   * A/B 测试：同时路由到两个系统
   */
  abTest(task, callback) {
    const result = this.route(task);
    if (result.winner === 'both') {
      // 执行A/B测试
      const wbResult = this._executeRoute(task, 'workbuddy');
      const hmResult = this._executeRoute(task, 'hermes');
      
      return {
        route: result,
        abTest: {
          workbuddy: wbResult,
          hermes: hmResult,
          comparison: this._compareResults(wbResult, hmResult)
        }
      };
    }
    return result;
  }
  
  _executeRoute(task, target) {
    // 模拟执行（实际使用时需要调用对应系统）
    return {
      target,
      status: 'simulated',
      responseTime: CAPABILITY_MAP[target].avgResponseTime,
      timestamp: this._ts()
    };
  }
  
  _compareResults(wb, hm) {
    return {
      winner: wb.responseTime < hm.responseTime ? 'workbuddy' : 'hermes',
      timeDiff: Math.abs(wb.responseTime - hm.responseTime),
      recommendation: wb.responseTime < hm.responseTime 
        ? 'WorkBuddy 响应更快' 
        : 'HERMES 响应更快'
    };
  }
  
  getStats() {
    const total = this.routingLog.length;
    if (total === 0) return { total: 0, distribution: {}, avgConfidence: 0 };
    
    const dist = {};
    let totalConfidence = 0;
    
    this.routingLog.forEach(r => {
      dist[r.winner] = (dist[r.winner] || 0) + 1;
      totalConfidence += r.confidence;
    });
    
    for (const k of Object.keys(dist)) {
      dist[k] = { 
        count: dist[k], 
        percent: Math.round(dist[k] / total * 100),
        avgResponseTime: CAPABILITY_MAP[k] ? CAPABILITY_MAP[k].avgResponseTime : 0
      };
    }
    
    return { 
      total, 
      distribution: dist, 
      avgConfidence: Math.round(totalConfidence / total),
      recentRoutes: this.routingLog.slice(-10).map(r => ({ 
        task: r.task.substring(0, 50), 
        to: r.winner, 
        confidence: r.confidence,
        taskType: r.taskType
      })),
      learningData: Object.fromEntries(this.learningData)
    };
  }
  
  generateReport() {
    const stats = this.getStats();
    let md = '# 融合路由报告\n\n';
    
    md += '**总路由**: ' + stats.total + '\n';
    md += '**平均置信度**: ' + stats.avgConfidence + '%\n\n';
    
    md += '## 分发比例\n';
    for (const [target, info] of Object.entries(stats.distribution)) {
      md += `- **${target}**: ${info.count} (${info.percent}%) - 平均响应: ${info.avgResponseTime}ms\n`;
    }
    
    if (stats.recentRoutes.length) {
      md += '\n## 最近路由\n';
      stats.recentRoutes.forEach(r => {
        md += `- \`${r.task}\` → **${r.to}** (${r.confidence}%, 类型: ${r.taskType})\n`;
      });
    }
    
    if (Object.keys(stats.learningData).length > 0) {
      md += '\n## 学习数据\n';
      for (const [taskType, stats] of Object.entries(stats.learningData)) {
        md += `- **${taskType}**: ${stats.totalRoutes}次, 成功率: ${Math.round(stats.successCount/stats.totalRoutes*100)}%, 最佳路由: ${stats.bestRoute}\n`;
      }
    }
    
    return md;
  }
  
  _saveLog() {
    try {
      fs.writeFileSync(
        path.join(this.configDir, 'routing-log.json'), 
        JSON.stringify(this.routingLog.slice(-200), null, 2)
      );
    } catch (e) {
      console.error('保存路由日志失败:', e.message);
    }
  }
  
  _loadLearningData() {
    try {
      const filePath = path.join(this.configDir, 'learning-data.json');
      if (fs.existsSync(filePath)) {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        this.learningData = new Map(data);
        console.log(`[FusionRouter] 加载 ${this.learningData.size} 条学习记录`);
      }
    } catch (e) {
      console.error('加载学习数据失败:', e.message);
    }
  }
  
  _saveLearningData() {
    try {
      fs.writeFileSync(
        path.join(this.configDir, 'learning-data.json'),
        JSON.stringify([...this.learningData.entries()], null, 2)
      );
    } catch (e) {
      console.error('保存学习数据失败:', e.message);
    }
  }
  
  listRules() {
    return this.rules.map(r => ({
      domain: r.domain,
      keywords: `${r.keywords.length} keywords`,
      route: r.route,
      priority: r.priority,
      examples: r.examples ? r.examples[0] : ''
    }));
  }
  
  /**
   * 添加新的路由规则 (动态扩展)
   */
  addRule(rule) {
    if (!rule.domain || !rule.keywords || !rule.route) {
      return { error: 'Invalid rule format' };
    }
    
    this.rules.push({
      domain: rule.domain,
      keywords: rule.keywords,
      route: rule.route,
      priority: rule.priority || 75,
      examples: rule.examples || []
    });
    
    console.log(`[FusionRouter] 添加新规则: ${rule.domain}`);
    return { success: true, totalRules: this.rules.length };
  }
}

// CLI 支持
if (require.main === module) {
  const fr = new FusionRouter();
  const cmd = process.argv[2];
  const args = process.argv;
  
  const get = (k, d) => {
    const i = args.indexOf(k);
    return i > -1 ? args[i + 1] : d;
  };
  
  const cmds = {
    route() {
      const task = args[3] || '分析股票走势';
      const result = fr.route({ description: task });
      console.log(JSON.stringify(result, null, 2));
    },
    
    batch() {
      const tasks = (get('--tasks') || '分析数据,打开网页,生成报告').split(',');
      const results = fr.batchRoute(tasks.map(t => ({ description: t.trim() })));
      console.log(JSON.stringify(results, null, 2));
    },
    
    stats() {
      console.log(JSON.stringify(fr.getStats(), null, 2));
    },
    
    report() {
      console.log(fr.generateReport());
    },
    
    rules() {
      console.log(JSON.stringify(fr.listRules(), null, 2));
    },
    
    test() {
      const cases = [
        '分析贵州茅台股票走势',
        '打开百度搜索AI新闻',
        '生成Q2销售报告PPT',
        '修改系统环境变量',
        '审查代码安全漏洞',
        '部署Docker容器',
        '爬取网页数据并分析',
        '提交代码到Git仓库',
        '执行SQL查询',
        '安装npm依赖包'
      ];
      
      console.log('\n=== FusionRouter 测试 ===\n');
      cases.forEach(c => {
        const r = fr.route({ description: c });
        const winner = r.winner.toUpperCase().padEnd(10);
        const conf = `${r.confidence}%`.padEnd(8);
        console.log(`${winner} [${conf}] ${c}`);
      });
    },
    
    'add-rule'() {
      const rule = {
        domain: get('--domain'),
        keywords: (get('--keywords') || '').split(','),
        route: get('--route'),
        priority: parseInt(get('--priority', '75'))
      };
      const result = fr.addRule(rule);
      console.log(JSON.stringify(result));
    },
    
    help() {
      console.log('\nFusionRouter CLI - P4-9 融合智能路由器\n');
      console.log('命令:');
      console.log('  route <task>              分析任务并路由');
      console.log('  batch --tasks t1,t2,...    批量路由');
      console.log('  test                       运行测试用例');
      console.log('  stats                      路由统计');
      console.log('  report                     生成报告');
      console.log('  rules                      列出所有规则');
      console.log('  add-rule --domain X --keywords a,b --route Y  添加规则');
      console.log('  help\n');
    }
  };
  
  (cmds[cmd] || cmds.help)();
}

module.exports = FusionRouter;
console.log('[FusionRouter] 加载成功 - P4-9 融合智能路由器 (22条领域规则)');
