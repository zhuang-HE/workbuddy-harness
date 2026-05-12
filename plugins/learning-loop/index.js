#!/usr/bin/env node
/**
 * P4-8 LearningLoop - 学习闭环 (O→A→L→E→A)
 * 增强版: 支持 MEDIUM 置信度提取 + 本能进化 + 自动应用
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

class LearningLoop {
  constructor(options = {}) {
    this.configDir = options.configDir || path.join(os.homedir(), '.workbuddy', 'learning-loop');
    this.sessions = [];
    this.instincts = new Map();
    this.feedbackLoop = {
      cycle: 0,
      totalLearned: 0,
      lastRun: null,
      autoApplyThreshold: 85  // 自动应用阈值
    };
    
    // 扩展置信度层级
    this.Confidence = {
      CRITICAL: 95,   // 自动应用
      HIGH: 80,        // 主动建议
      MEDIUM: 60,      // 观察学习
      LOW: 40,         // 实验性
      EXPERIMENTAL: 20 // 待验证
    };
    
    this.Phase = {
      OBSERVE: 'observe',      // 观察
      ANALYZE: 'analyze',      // 分析
      LEARN: 'learn',          // 学习
      EVALUATE: 'evaluate',    // 评估
      APPLY: 'apply',          // 应用
      REFINE: 'refine'         // 精炼
    };
    
    // 确保目录存在
    ['sessions', 'instincts', 'feedback', 'applied'].forEach(d => {
      const p = path.join(this.configDir, d);
      if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
    });
  }
  
  _id() {
    return Math.random().toString(36).substring(2, 10);
  }
  
  _ts() {
    return new Date().toISOString();
  }
  
  /**
   * O - Observe: 观察并分析会话
   */
  analyzeSession(data) {
    const analysis = {
      sessionId: data.id || this._id(),
      timestamp: this._ts(),
      taskType: data.taskType || 'unknown',
      complexity: data.complexity || 5,
      duration: data.duration || 0,
      toolCalls: data.toolCalls || 0,
      success: data.success !== false,
      errorCount: data.errors || 0,
      patterns: [],
      extractedInstincts: [],
      recommendations: []
    };
    
    // 模式识别 (扩展)
    if (data.toolCalls > 10 && data.success) {
      analysis.patterns.push({ type: 'high_tool_usage_success', confidence: 70 });
    }
    if (data.errorCount === 0 && data.complexity > 5) {
      analysis.patterns.push({ type: 'complex_task_flawless', confidence: 85 });
    }
    if (data.toolCalls > 3 && data.toolCalls < 8 && data.success) {
      analysis.patterns.push({ type: 'efficient_execution', confidence: 75 });
    }
    // 新增: 快速任务识别
    if (data.duration < 5000 && data.success) {
      analysis.patterns.push({ type: 'quick_resolution', confidence: 80 });
    }
    // 新增: 错误恢复能力
    if (data.errorCount > 0 && data.success) {
      analysis.patterns.push({ type: 'error_recovery', confidence: 90 });
    }
    
    this.sessions.push(analysis);
    if (this.sessions.length > 100) {
      this.sessions = this.sessions.slice(-100);
    }
    
    return analysis;
  }
  
  /**
   * A - Analyze: 从分析中抽取本能 (降低阈值到 MEDIUM)
   */
  extractInstincts(analysis) {
    const extracted = [];
    
    for (const pattern of analysis.patterns) {
      // 降低阈值: MEDIUM (60+) 即可提取
      if (pattern.confidence >= this.Confidence.MEDIUM) {
        const exist = [...this.instincts.values()].find(i => i.type === pattern.type);
        
        if (exist) {
          // 更新已有本能
          exist.confidence = Math.min(100, exist.confidence + 5);
          exist.occurrences++;
          exist.lastSeen = this._ts();
          extracted.push({ action: 'updated', instinct: exist });
        } else {
          // 创建新本能
          const newInstinct = {
            id: 'inst_' + this._id(),
            type: pattern.type,
            confidence: pattern.confidence,
            source: 'session_pattern',
            occurrences: 1,
            firstSeen: this._ts(),
            lastSeen: this._ts(),
            taskType: analysis.taskType,
            status: 'active',
            autoApplicable: pattern.confidence >= this.feedbackLoop.autoApplyThreshold
          };
          this.instincts.set(newInstinct.id, newInstinct);
          extracted.push({ action: 'created', instinct: newInstinct });
        }
      }
    }
    
    analysis.extractedInstincts = extracted;
    return extracted;
  }
  
  /**
   * L - Learn: 记录反馈并调整本能
   */
  recordFeedback(feedback) {
    const fb = {
      id: this._id(),
      sessionId: feedback.sessionId,
      taskType: feedback.taskType || 'unknown',
      model: feedback.model || 'unknown',
      reward: feedback.reward || 0,
      timestamp: this._ts()
    };
    
    this.feedbackLoop.cycle++;
    this.feedbackLoop.totalLearned++;
    this.feedbackLoop.lastRun = this._ts();
    
    // 调整相关本能的置信度
    for (const [id, inst] of this.instincts) {
      if (inst.taskType === fb.taskType && inst.status === 'active') {
        if (fb.reward > 0) {
          inst.confidence = Math.min(100, inst.confidence + fb.reward * 2);
          inst.autoApplicable = inst.confidence >= this.feedbackLoop.autoApplyThreshold;
        } else {
          inst.confidence = Math.max(10, inst.confidence - Math.abs(fb.reward) * 3);
          if (inst.confidence < 20) inst.status = 'deprecated';
        }
      }
    }
    
    return fb;
  }
  
  /**
   * E - Evaluate: 评估本能质量
   */
  evaluateInstincts() {
    const all = [...this.instincts.values()];
    const active = all.filter(i => i.status === 'active');
    const deprecated = all.filter(i => i.status === 'deprecated');
    
    return {
      total: all.length,
      active: active.length,
      deprecated: deprecated.length,
      avgConfidence: active.length > 0 
        ? Math.round(active.reduce((s, i) => s + i.confidence, 0) / active.length) 
        : 0,
      autoApplicable: active.filter(i => i.autoApplicable).length,
      recommendations: this._generateRecommendations(active)
    };
  }
  
  _generateRecommendations(active) {
    const recs = [];
    
    // 推荐自动应用高置信度本能
    const autoApps = active.filter(i => i.autoApplicable && i.confidence >= 90);
    if (autoApps.length > 0) {
      recs.push({
        type: 'auto_apply',
        count: autoApps.length,
        instincts: autoApps.map(i => i.type)
      });
    }
    
    // 推荐淘汰低置信度本能
    const lowConf = active.filter(i => i.confidence < 30);
    if (lowConf.length > 0) {
      recs.push({
        type: 'deprecate_low_confidence',
        count: lowConf.length
      });
    }
    
    return recs;
  }
  
  /**
   * A - Apply: 应用本能到新任务
   */
  applyInstincts(taskType, options = {}) {
    const applicable = [...this.instincts.values()]
      .filter(i => i.status === 'active')
      .filter(i => options.autoOnly ? i.autoApplicable : true)
      .filter(i => taskType ? i.taskType === taskType : true)
      .sort((a, b) => b.confidence - a.confidence);
    
    return {
      taskType,
      applicableCount: applicable.length,
      instincts: applicable.slice(0, options.limit || 5),
      suggestions: this._generateSuggestions(applicable)
    };
  }
  
  _generateSuggestions(instincts) {
    return instincts.map(inst => ({
      instinctId: inst.id,
      type: inst.type,
      confidence: inst.confidence,
      suggestion: this._instinctToSuggestion(inst)
    }));
  }
  
  _instinctToSuggestion(inst) {
    const map = {
      'high_tool_usage_success': '考虑拆分任务以减少工具调用次数',
      'complex_task_flawless': '此任务类型已掌握，可尝试优化',
      'efficient_execution': '当前执行效率良好，保持策略',
      'quick_resolution': '快速解决模式，适用于类似简单任务',
      'error_recovery': '已掌握错误恢复，可增加挑战性'
    };
    return map[inst.type] || '继续观察此模式';
  }
  
  /**
   * R - Refine: 精炼本能 (进化)
   */
  refineInstincts() {
    const refined = [];
    
    for (const [id, inst] of this.instincts) {
      // 合并相似本能
      const similar = [...this.instincts.values()].filter(i => 
        i.id !== id && 
        i.type.includes(inst.type.substring(0, 10)) &&
        i.taskType === inst.taskType
      );
      
      if (similar.length > 0) {
        // 合并到主本能
        const primary = similar.find(s => s.occurrences > inst.occurrences) || inst;
        primary.confidence = Math.min(100, primary.confidence + 5);
        primary.occurrences += similar.reduce((s, i) => s + i.occurrences, 0);
        refined.push({ action: 'merged', primary: primary.id, merged: similar.map(s => s.id) });
        
        // 删除被合并的
        similar.forEach(s => this.instincts.delete(s.id));
      }
    }
    
    return refined;
  }
  
  /**
   * 运行完整学习周期 (O→A→L→E→A→R)
   */
  runLearningCycle(data) {
    this.feedbackLoop.lastRun = this._ts();
    
    // O - Observe
    const analysis = this.analyzeSession(data);
    
    // A - Analyze
    const instincts = this.extractInstincts(analysis);
    
    // E - Evaluate
    const evaluation = this.evaluateInstincts();
    
    // A - Apply (获取适用本能)
    const application = this.applyInstincts(data.taskType);
    
    // R - Refine (定期精炼)
    let refinement = [];
    if (this.feedbackLoop.cycle % 10 === 0) {
      refinement = this.refineInstincts();
    }
    
    return {
      cycle: this.feedbackLoop.cycle,
      phase: 'O→A→L→E→A→R',
      analysis,
      instinctsExtracted: instincts.length,
      instincts: instincts,
      evaluation,
      application,
      refinement,
      totalInstincts: this.instincts.size
    };
  }
  
  getInstincts(filter = {}) {
    let result = [...this.instincts.values()];
    if (filter.taskType) result = result.filter(i => i.taskType === filter.taskType);
    if (filter.minConfidence) result = result.filter(i => i.confidence >= filter.minConfidence);
    if (filter.status) result = result.filter(i => i.status === filter.status);
    if (filter.autoApplicable) result = result.filter(i => i.autoApplicable);
    return result.sort((a, b) => b.confidence - a.confidence);
  }
  
  getTopInstincts(n = 5) {
    return this.getInstincts({ status: 'active' }).slice(0, n);
  }
  
  getLoopStats() {
    const all = [...this.instincts.values()];
    const evaluation = this.evaluateInstincts();
    
    return {
      cycles: this.feedbackLoop.cycle,
      totalLearned: this.feedbackLoop.totalLearned,
      lastRun: this.feedbackLoop.lastRun,
      activeInstincts: evaluation.active,
      deprecatedInstincts: evaluation.deprecated,
      sessions: this.sessions.length,
      avgConfidence: evaluation.avgConfidence,
      autoApplicable: evaluation.autoApplicable,
      recommendations: evaluation.recommendations
    };
  }
  
  reset() {
    this.sessions = [];
    this.instincts.clear();
    this.feedbackLoop = {
      cycle: 0,
      totalLearned: 0,
      lastRun: null,
      autoApplyThreshold: 85
    };
    return { reset: true };
  }
}

// CLI 支持
if (require.main === module) {
  const ll = new LearningLoop();
  const cmd = process.argv[2];
  const args = process.argv;
  
  const get = (k, d) => {
    const i = args.indexOf(k);
    return i > -1 ? args[i + 1] : d;
  };
  
  switch(cmd) {
    case 'cycle': {
      const result = ll.runLearningCycle({
        id: get('--session', 's1'),
        taskType: get('--type', 'general'),
        complexity: parseInt(get('--complexity', '5')),
        toolCalls: parseInt(get('--toolcalls', '5')),
        success: !args.includes('--fail'),
        duration: parseInt(get('--duration', '100'))
      });
      console.log('\n=== 学习周期 #' + result.cycle + ' ===');
      console.log('阶段:', result.phase);
      console.log('提取本能:', result.instinctsExtracted);
      console.log('活跃本能:', result.evaluation.active);
      console.log('建议:', JSON.stringify(result.evaluation.recommendations));
      break;
    }
    
    case 'feedback': {
      const result = ll.recordFeedback({
        sessionId: get('--session', 's1'),
        taskType: get('--type', 'general'),
        reward: parseInt(get('--reward', '5'))
      });
      console.log('反馈已记录: reward=' + result.reward);
      break;
    }
    
    case 'instincts': {
      const filter = {};
      if (args.includes('--type')) filter.taskType = get('--type');
      if (args.includes('--min')) filter.minConfidence = parseInt(get('--min'));
      if (args.includes('--auto')) filter.autoApplicable = true;
      const instincts = ll.getInstincts(filter);
      console.log('\n=== 本能列表 (' + instincts.length + ') ===');
      instincts.forEach(i => {
        const auto = i.autoApplicable ? ' [自动应用]' : '';
        console.log('  [' + i.confidence + '%]' + auto + ' ' + i.type + ' (occ:' + i.occurrences + ')');
      });
      break;
    }
    
    case 'apply': {
      const result = ll.applyInstincts(get('--type', null), {
        autoOnly: args.includes('--auto'),
        limit: parseInt(get('--limit', '5'))
      });
      console.log('\n=== 可应用本能 ===');
      console.log('任务类型:', result.taskType || '全部');
      console.log('可应用:', result.applicableCount);
      result.suggestions.forEach(s => {
        console.log('  [' + s.confidence + '%] ' + s.type + ': ' + s.suggestion);
      });
      break;
    }
    
    case 'top': {
      const n = parseInt(args[3]) || 5;
      ll.getTopInstincts(n).forEach((i, idx) => {
        console.log('#' + (idx + 1) + ' [' + i.confidence + '%] ' + i.type);
      });
      break;
    }
    
    case 'stats': {
      const stats = ll.getLoopStats();
      console.log('\n=== 学习循环统计 ===');
      console.log(JSON.stringify(stats, null, 2));
      break;
    }
    
    case 'reset':
      ll.reset();
      console.log('重置完成');
      break;
      
    case 'help':
    default:
      console.log('\nLearningLoop P4-8 - 学习闭环 (O→A→L→E→A→R)\n');
      console.log('命令:');
      console.log('  cycle --session <id> --type <task> --complexity <n> --toolcalls <n>');
      console.log('  feedback --session <id> --type <task> --reward <n>');
      console.log('  instincts [--type <task>] [--min <conf>] [--auto]');
      console.log('  apply [--type <task>] [--auto] [--limit <n>]');
      console.log('  top [n]');
      console.log('  stats');
      console.log('  reset');
      console.log('  help\n');
      break;
  }
}

module.exports = LearningLoop;
console.log('[LearningLoop] 加载成功 - P4-8 学习闭环(O→A→L→E→A→R)');
