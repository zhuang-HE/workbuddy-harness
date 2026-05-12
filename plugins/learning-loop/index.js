#!/usr/bin/env node
/**
 * P4-8 LearningLoop - 学习闭环增强版
 * 增强版: 强化学习 + 模式识别 + 自适应学习率
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
      autoApplyThreshold: 85
    };
    
    // 强化学习状态
    this.qTable = new Map(); // state -> { action: qValue }
    this.learningRate = 0.1;
    this.discountFactor = 0.9;
    this.explorationRate = 0.2;
    
    // 模式识别
    this.patternRecognizer = new PatternRecognizer();
    
    // 自适应学习率
    this.adaptiveLearning = {
      enabled: true,
      baseLR: 0.1,
      currentLR: 0.1,
      decayRate: 0.99,
      minLR: 0.01
    };
    
    this.Confidence = {
      CRITICAL: 95,
      HIGH: 80,
      MEDIUM: 60,
      LOW: 40,
      EXPERIMENTAL: 20
    };
    
    this.Phase = {
      OBSERVE: 'observe',
      ANALYZE: 'analyze',
      LEARN: 'learn',
      EVALUATE: 'evaluate',
      APPLY: 'apply',
      REFINE: 'refine'
    };
    
    ['sessions', 'instincts', 'feedback', 'applied', 'models'].forEach(d => {
      const p = path.join(this.configDir, d);
      if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
    });
    
    this._load();
  }
  
  _id() {
    return Math.random().toString(36).substring(2, 10);
  }
  
  _ts() {
    return new Date().toISOString();
  }
  
  _load() {
    try {
      const qPath = path.join(this.configDir, 'models', 'q_table.json');
      if (fs.existsSync(qPath)) {
        const qData = JSON.parse(fs.readFileSync(qPath, 'utf8'));
        this.qTable = new Map(Object.entries(qData));
      }
      
      const statePath = path.join(this.configDir, 'feedback', 'state.json');
      if (fs.existsSync(statePath)) {
        const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
        Object.assign(this.adaptiveLearning, state.adaptiveLearning || {});
      }
    } catch (e) {}
  }
  
  _save() {
    try {
      // 保存 Q 表
      fs.writeFileSync(
        path.join(this.configDir, 'models', 'q_table.json'),
        JSON.stringify(Object.fromEntries(this.qTable))
      );
      
      // 保存状态
      fs.writeFileSync(
        path.join(this.configDir, 'feedback', 'state.json'),
        JSON.stringify({ adaptiveLearning: this.adaptiveLearning, updated: this._ts() })
      );
    } catch (e) {}
  }
  
  // ==================== 强化学习 ====================
  
  /**
   * 获取状态的 Q 值
   */
  getQValues(state) {
    if (!this.qTable.has(state)) {
      this.qTable.set(state, {});
    }
    return this.qTable.get(state);
  }
  
  /**
   * Q-Learning 更新
   */
  updateQ(state, action, reward, nextState) {
    const qValues = this.getQValues(state);
    const currentQ = qValues[action] || 50; // 初始 Q 值 50
    
    // 获取下一个状态的最大 Q 值
    const nextQValues = this.getQValues(nextState);
    const maxNextQ = Math.max(...Object.values(nextQValues), 50);
    
    // Q-Learning 公式
    const newQ = currentQ + this.adaptiveLearning.currentLR * (
      reward + this.discountFactor * maxNextQ - currentQ
    );
    
    qValues[action] = Math.max(0, Math.min(100, newQ));
    
    // 更新自适应学习率
    this._updateAdaptiveLearningRate(reward);
    
    return { oldQ: currentQ, newQ: qValues[action] };
  }
  
  /**
   * 选择动作 (ε-greedy)
   */
  selectAction(state, availableActions) {
    if (Math.random() < this.explorationRate) {
      // 探索：随机选择
      return {
        action: availableActions[Math.floor(Math.random() * availableActions.length)],
        type: 'explore'
      };
    } else {
      // 利用：选择 Q 值最高的动作
      const qValues = this.getQValues(state);
      let bestAction = availableActions[0];
      let bestQ = qValues[bestAction] || 0;
      
      for (const action of availableActions) {
        const q = qValues[action] || 0;
        if (q > bestQ) {
          bestQ = q;
          bestAction = action;
        }
      }
      
      return { action: bestAction, type: 'exploit', qValue: bestQ };
    }
  }
  
  /**
   * 更新自适应学习率
   */
  _updateAdaptiveLearningRate(reward) {
    if (!this.adaptiveLearning.enabled) return;
    
    if (reward > 0) {
      // 正反馈：降低学习率（稳定）
      this.adaptiveLearning.currentLR *= this.adaptiveLearning.decayRate;
    } else {
      // 负反馈：提高学习率（探索）
      this.adaptiveLearning.currentLR = Math.min(
        0.5,
        this.adaptiveLearning.currentLR * 1.5
      );
    }
    
    this.adaptiveLearning.currentLR = Math.max(
      this.adaptiveLearning.minLR,
      this.adaptiveLearning.currentLR
    );
  }
  
  /**
   * 获取最佳策略建议
   */
  getBestStrategy(state) {
    const qValues = this.getQValues(state);
    const entries = Object.entries(qValues);
    
    if (entries.length === 0) {
      return { action: null, qValue: 0, confidence: 0 };
    }
    
    entries.sort((a, b) => b[1] - a[1]);
    const [action, qValue] = entries[0];
    const confidence = Math.min(100, qValue);
    
    return { action, qValue, confidence };
  }
  
  // ==================== 模式识别 ====================
  
  /**
   * 识别任务模式
   */
  recognizePatterns(data) {
    const patterns = this.patternRecognizer.recognize(data);
    
    // 添加基于 Q-Learning 的模式
    const state = this._getStateKey(data);
    const qPatterns = this.getBestStrategy(state);
    
    if (qPatterns.action) {
      patterns.push({
        type: 'q_learned',
        action: qPatterns.action,
        confidence: qPatterns.confidence,
        source: 'reinforcement'
      });
    }
    
    return patterns;
  }
  
  _getStateKey(data) {
    const complexity = Math.floor((data.complexity || 5) / 3);
    const toolCalls = Math.floor((data.toolCalls || 0) / 5);
    return `c${complexity}_t${toolCalls}`;
  }
  
  // ==================== O - Observe ====================
  
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
    
    // 模式识别
    analysis.patterns = this.recognizePatterns(data);
    
    // 强化学习反馈
    if (data.reward !== undefined) {
      analysis.qLearningResult = this._processQLearning(data);
    }
    
    this.sessions.push(analysis);
    if (this.sessions.length > 100) {
      this.sessions = this.sessions.slice(-100);
    }
    
    return analysis;
  }
  
  _processQLearning(data) {
    const state = this._getStateKey(data);
    const action = data.action || data.taskType;
    const reward = data.reward || (data.success ? 10 : -5);
    const nextState = this._getStateKey({ ...data, success: true });
    
    return this.updateQ(state, action, reward, nextState);
  }
  
  // ==================== A - Analyze ====================
  
  extractInstincts(analysis) {
    const extracted = [];
    
    for (const pattern of analysis.patterns) {
      if (pattern.confidence >= this.Confidence.MEDIUM) {
        const exist = [...this.instincts.values()].find(i => i.type === pattern.type);
        
        if (exist) {
          exist.confidence = Math.min(100, exist.confidence + 5);
          exist.occurrences++;
          exist.lastSeen = this._ts();
          extracted.push({ action: 'updated', instinct: exist });
        } else {
          const newInstinct = {
            id: 'inst_' + this._id(),
            type: pattern.type,
            confidence: pattern.confidence,
            source: pattern.source || 'session_pattern',
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
  
  // ==================== L - Learn ====================
  
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
    
    // Q-Learning 更新
    const state = this._getStateKey({ complexity: 5, toolCalls: 5, taskType: fb.taskType });
    const action = fb.taskType;
    this.updateQ(state, action, fb.reward, state);
    
    // 调整本能
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
    
    this._save();
    return fb;
  }
  
  // ==================== E - Evaluate ====================
  
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
    
    const autoApps = active.filter(i => i.autoApplicable && i.confidence >= 90);
    if (autoApps.length > 0) {
      recs.push({
        type: 'auto_apply',
        count: autoApps.length,
        instincts: autoApps.map(i => i.type)
      });
    }
    
    const lowConf = active.filter(i => i.confidence < 30);
    if (lowConf.length > 0) {
      recs.push({
        type: 'deprecate_low_confidence',
        count: lowConf.length
      });
    }
    
    return recs;
  }
  
  // ==================== A - Apply ====================
  
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
      suggestions: this._generateSuggestions(applicable),
      qLearningAdvice: this.getBestStrategy(this._getStateKey({ taskType }))
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
      'error_recovery': '已掌握错误恢复，可增加挑战性',
      'q_learned': '基于强化学习推荐的最佳策略'
    };
    return map[inst.type] || '继续观察此模式';
  }
  
  // ==================== R - Refine ====================
  
  refineInstincts() {
    const refined = [];
    
    for (const [id, inst] of this.instincts) {
      const similar = [...this.instincts.values()].filter(i => 
        i.id !== id && 
        i.type.includes(inst.type.substring(0, 10)) &&
        i.taskType === inst.taskType
      );
      
      if (similar.length > 0) {
        const primary = similar.find(s => s.occurrences > inst.occurrences) || inst;
        primary.confidence = Math.min(100, primary.confidence + 5);
        primary.occurrences += similar.reduce((s, i) => s + i.occurrences, 0);
        refined.push({ action: 'merged', primary: primary.id, merged: similar.map(s => s.id) });
        
        similar.forEach(s => this.instincts.delete(s.id));
      }
    }
    
    // 清理低质量 Q 值
    this._pruneQTable();
    
    return refined;
  }
  
  _pruneQTable() {
    // 保留高 Q 值条目
    const threshold = 30;
    for (const [state, qValues] of this.qTable) {
      let hasHighValue = false;
      for (const q of Object.values(qValues)) {
        if (q > threshold) {
          hasHighValue = true;
          break;
        }
      }
      if (!hasHighValue) {
        this.qTable.delete(state);
      }
    }
  }
  
  // ==================== 完整周期 ====================
  
  runLearningCycle(data) {
    this.feedbackLoop.lastRun = this._ts();
    
    const analysis = this.analyzeSession(data);
    const instincts = this.extractInstincts(analysis);
    const evaluation = this.evaluateInstincts();
    const application = this.applyInstincts(data.taskType);
    
    let refinement = [];
    if (this.feedbackLoop.cycle % 10 === 0) {
      refinement = this.refineInstincts();
    }
    
    return {
      cycle: this.feedbackLoop.cycle,
      phase: 'O→A→L→E→A→R+QL',
      analysis,
      instinctsExtracted: instincts.length,
      instincts,
      evaluation,
      application,
      refinement,
      totalInstincts: this.instincts.size,
      qLearning: {
        states: this.qTable.size,
        learningRate: this.adaptiveLearning.currentLR
      }
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
      recommendations: evaluation.recommendations,
      qLearning: {
        states: this.qTable.size,
        learningRate: this.adaptiveLearning.currentLR,
        explorationRate: this.explorationRate
      }
    };
  }
  
  reset() {
    this.sessions = [];
    this.instincts.clear();
    this.qTable.clear();
    this.feedbackLoop = {
      cycle: 0,
      totalLearned: 0,
      lastRun: null,
      autoApplyThreshold: 85
    };
    this.adaptiveLearning.currentLR = this.adaptiveLearning.baseLR;
    return { reset: true };
  }
}

/**
 * 模式识别器
 */
class PatternRecognizer {
  recognize(data) {
    const patterns = [];
    
    if (data.toolCalls > 10 && data.success) {
      patterns.push({ type: 'high_tool_usage_success', confidence: 70 });
    }
    if (data.errorCount === 0 && data.complexity > 5) {
      patterns.push({ type: 'complex_task_flawless', confidence: 85 });
    }
    if (data.toolCalls > 3 && data.toolCalls < 8 && data.success) {
      patterns.push({ type: 'efficient_execution', confidence: 75 });
    }
    if (data.duration < 5000 && data.success) {
      patterns.push({ type: 'quick_resolution', confidence: 80 });
    }
    if (data.errorCount > 0 && data.success) {
      patterns.push({ type: 'error_recovery', confidence: 90 });
    }
    
    // 新模式识别
    if (data.complexity > 7 && data.success && data.errorCount === 0) {
      patterns.push({ type: 'expert_level', confidence: 88 });
    }
    if (data.duration > 30000 && data.success) {
      patterns.push({ type: 'deep_analysis', confidence: 82 });
    }
    
    return patterns;
  }
}

// CLI
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
      console.log('Q-Learning:', result.qLearning);
      console.log('提取本能:', result.instinctsExtracted);
      console.log('活跃本能:', result.evaluation.active);
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
        console.log('  [' + i.confidence + '%]' + auto + ' ' + i.type);
      });
      break;
    }
    
    case 'apply': {
      const result = ll.applyInstincts(get('--type', null), {
        autoOnly: args.includes('--auto'),
        limit: parseInt(get('--limit', '5'))
      });
      console.log('\n=== 可应用本能 ===');
      console.log('Q-Learning建议:', result.qLearningAdvice);
      result.suggestions.forEach(s => {
        console.log('  [' + s.confidence + '%] ' + s.type + ': ' + s.suggestion);
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
      console.log('\nLearningLoop P4-8 - 学习闭环(O→A→L→E→A→R+QL)\n');
      console.log('命令:');
      console.log('  cycle --session <id> --type <task> --complexity <n> --toolcalls <n>');
      console.log('  feedback --session <id> --type <task> --reward <n>');
      console.log('  instincts [--type <task>] [--min <conf>] [--auto]');
      console.log('  apply [--type <task>] [--auto] [--limit <n>]');
      console.log('  stats');
      console.log('  reset');
      console.log('  help\n');
      break;
  }
}

module.exports = LearningLoop;
console.log('[LearningLoop] 加载成功 - P4-8 学习闭环(强化学习版)');
