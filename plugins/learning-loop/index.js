#!/usr/bin/env node
/**
 * learning-loop - WorkBuddy P4-8 (P2→P1) 学习闭环桥接器 v1.1
 * 维度: D4-Learning | OBSERVE→ANALYZE→LEARN→EVOLVE→APPLY 五阶段自动闭环
 * 增强: v1.1 新增与skill-analyzer联动、D4+D3联合闭环、自动化触发
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

class LearningLoop {
  constructor(options = {}) {
    this.configDir = options.configDir || path.join(os.homedir(), '.workbuddy', 'learning-loop');
    this.sessions = [];
    this.instincts = new Map();
    this.feedbackLoop = { cycle: 0, totalLearned: 0, lastRun: null };
    this.phase = {
      OBSERVE: 'observe',      // 观察用户行为
      ANALYZE: 'analyze',      // 分析模式
      LEARN: 'learn',          // 学习新知识
      EVOLVE: 'evolve',        // 进化本能
      APPLY: 'apply'           // 应用优化
    };
    this.confidence = {
      HIGH: 80,      // 确信 → 自动应用
      MEDIUM: 60,    // 中等 → 建议应用
      LOW: 40,       // 低确信 → 仅记录
      EXP: 20        // 实验性 → 待验证
    };
    // 模式类型定义（用于D4+D3联动）
    this.patternTypes = {
      HIGH_TOOL_SUCCESS: { name: '高工具调用成功率', weight: 85, threshold: { toolCalls: 10, success: true } },
      COMPLEX_FLAWLESS: { name: '复杂任务零错误', weight: 90, threshold: { complexity: 7, errors: 0 } },
      EFFICIENT_EXEC: { name: '高效执行', weight: 75, threshold: { toolCalls: [3, 8], success: true } },
      SKILL_ROUTING: { name: '技能路由准确', weight: 80, threshold: { skillUsed: true, success: true } },
      CONTEXT_REUSE: { name: '上下文复用', weight: 70, threshold: { contextHits: 3 } },
      SELF_CORRECT: { name: '自我修正', weight: 88, threshold: { errorThenSuccess: true } }
    };
    this.Phase = this.phase;
    this.Confidence = this.confidence;
    this._ensureDirs();
    this._loadState();
  }

  _ensureDirs() {
    const dirs = ['sessions', 'instincts', 'feedback', 'patterns'];
    dirs.forEach(d => {
      const p = path.join(this.configDir, d);
      if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
    });
  }

  _id() { return Math.random().toString(36).substring(2, 10); }
  _ts() { return new Date().toISOString(); }
  _day() { return this._ts().split('T')[0]; }

  _loadState() {
    try {
      const p = path.join(this.configDir, 'state.json');
      if (fs.existsSync(p)) {
        const d = JSON.parse(fs.readFileSync(p, 'utf8'));
        this.sessions = d.sessions || [];
        this.instincts = new Map(d.instincts || []);
        this.feedbackLoop = d.feedbackLoop || { cycle: 0, totalLearned: 0, lastRun: null };
      }
    } catch (e) { /* ignore */ }
  }

  _saveState() {
    fs.writeFileSync(path.join(this.configDir, 'state.json'), JSON.stringify({
      sessions: this.sessions.slice(-100),
      instincts: [...this.instincts.entries()],
      feedbackLoop: this.feedbackLoop,
      updated: this._ts()
    }, null, 2));
  }

  // ==================== D4+D3 联合闭环 ====================

  /**
   * D4+D3联合分析：基于会话分析结果，生成技能优化建议
   * 输出可以直接用于skill-analyzer热更新
   */
  jointAnalysisWithSkillAnalyzer(sessionData) {
    // Step 1: 分析会话
    const analysis = this.analyzeSession(sessionData);

    // Step 2: 生成技能优化建议
    const skillSuggestions = [];

    // 如果成功使用了技能
    if (sessionData.skillUsed && sessionData.success) {
      skillSuggestions.push({
        action: 'BOOST_USAGE',
        skillId: sessionData.skillUsed,
        reason: '成功使用的技能，值得强化触发词',
        confidence: analysis.patterns.length > 0 ? 75 : 50
      });
    }

    // 如果某类任务多次成功
    const taskPattern = this._detectTaskPattern(sessionData);
    if (taskPattern) {
      skillSuggestions.push({
        action: 'SUGGEST_SKILL',
        suggestedSkill: {
          name: `${taskPattern.type}任务处理`,
          triggers: [taskPattern.keyword],
          description: `自动化处理${taskPattern.type}类型任务`,
          pattern: taskPattern
        },
        reason: `识别到${taskPattern.count}次相似任务模式`,
        confidence: Math.min(90, 50 + taskPattern.count * 10)
      });
    }

    // 如果检测到上下文复用
    if (analysis.patterns.some(p => p.type === 'context_reuse')) {
      skillSuggestions.push({
        action: 'ENHANCE_MEMORY',
        reason: '检测到上下文复用模式',
        suggestion: '建议强化memory-decay的contextHints功能'
      });
    }

    return {
      sessionId: sessionData.id,
      analysis,
      skillSuggestions,
      actionable: skillSuggestions.filter(s => s.confidence >= this.confidence.MEDIUM).length > 0
    };
  }

  _detectTaskPattern(session) {
    // 从会话历史中检测相似任务模式
    const similar = this.sessions.filter(s =>
      s.taskType === session.taskType &&
      s.success === session.success &&
      Math.abs((s.complexity || 5) - (session.complexity || 5)) <= 2
    );

    if (similar.length >= 2) {
      // 提取关键词
      const keywords = this._extractKeywords(session);
      return {
        type: session.taskType || 'general',
        count: similar.length + 1,
        keyword: keywords[0] || session.taskType,
        tools: session.tools || []
      };
    }
    return null;
  }

  _extractKeywords(session) {
    // 简单关键词提取
    const text = `${session.taskType || ''} ${session.context || ''}`;
    const words = text.split(/\s+/)
      .filter(w => w.length > 2)
      .filter(w => !['的', '了', '和', '与', '在', '是', 'the', 'and', 'for'].includes(w.toLowerCase()));
    return [...new Set(words)].slice(0, 5);
  }

  // ==================== OBSERVE阶段 ====================

  analyzeSession(data) {
    const a = {
      sessionId: data.id || this._id(),
      timestamp: this._ts(),
      taskType: data.taskType || 'unknown',
      complexity: data.complexity || 5,
      duration: data.duration || 0,
      toolCalls: data.toolCalls || 0,
      success: data.success !== false,
      errorCount: data.errors || 0,
      skillUsed: data.skillUsed || null,
      contextHits: data.contextHits || 0,
      patterns: [],
      extractedInstincts: [],
      recommendations: []
    };

    // 模式检测
    if (data.toolCalls > 10 && data.success) {
      a.patterns.push({ type: 'high_tool_success', confidence: 70, source: 'tool_usage' });
    }
    if (data.errorCount === 0 && (data.complexity || 5) > 5) {
      a.patterns.push({ type: 'complex_flawless', confidence: 85, source: 'error_rate' });
    }
    if ((data.toolCalls || 0) >= 3 && (data.toolCalls || 0) <= 8 && data.success) {
      a.patterns.push({ type: 'efficient_exec', confidence: 75, source: 'tool_usage' });
    }
    if (data.skillUsed && data.success) {
      a.patterns.push({ type: 'skill_routing', confidence: 80, source: 'skill_usage' });
    }
    if (data.contextHits > 2) {
      a.patterns.push({ type: 'context_reuse', confidence: 70, source: 'memory' });
    }
    if (data.errorCount > 0 && !data.success) {
      // 检查是否有修正
      if (this._checkSelfCorrection(data)) {
        a.patterns.push({ type: 'self_correct', confidence: 88, source: 'error_recovery' });
      }
    }

    this.sessions.push(a);
    if (this.sessions.length > 100) this.sessions = this.sessions.slice(-100);

    return a;
  }

  _checkSelfCorrection(data) {
    // 检查是否有从错误中恢复的模式
    const recent = this.sessions.slice(-5);
    return recent.some(s => s.errorCount > 0 && s.success === false);
  }

  // ==================== ANALYZE阶段 ====================

  extractInstincts(analysis) {
    const extracted = [];

    for (const p of analysis.patterns) {
      // 置信度达到HIGH阈值才创建本能
      if (p.confidence >= this.confidence.HIGH) {
        const patternDef = Object.values(this.patternTypes).find(pt => pt.name === p.name);

        // 检查是否已存在
        const existing = [...this.instincts.values()].find(i => i.type === p.type);
        if (existing) {
          existing.confidence = Math.min(100, existing.confidence + 5);
          existing.occurrences++;
          existing.lastSeen = this._ts();
          extracted.push({ action: 'updated', instinct: existing });
        } else {
          const ni = {
            id: 'inst_' + this._id(),
            type: p.type,
            name: patternDef?.name || p.type,
            confidence: p.confidence,
            source: p.source || 'session_pattern',
            occurrences: 1,
            firstSeen: this._ts(),
            lastSeen: this._ts(),
            taskType: analysis.taskType,
            status: p.confidence >= 90 ? 'active' : 'experimental',
            autoApply: p.confidence >= this.confidence.HIGH,
            pattern: patternDef || null
          };
          this.instincts.set(ni.id, ni);
          extracted.push({ action: 'created', instinct: ni });
        }
      }
    }

    analysis.extractedInstincts = extracted;
    return extracted;
  }

  // ==================== LEARN阶段 ====================

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

    // 根据反馈调整本能置信度
    for (const [id, inst] of this.instincts) {
      if (inst.taskType === fb.taskType && inst.status === 'active') {
        if (fb.reward > 0) {
          inst.confidence = Math.min(100, inst.confidence + fb.reward * 2);
        } else {
          inst.confidence = Math.max(10, inst.confidence - Math.abs(fb.reward) * 3);
          if (inst.confidence < 20) {
            inst.status = 'deprecated';
          }
        }
      }
    }

    this._saveState();
    return fb;
  }

  // ==================== EVOLVE阶段 ====================

  evolveInstincts() {
    const evolved = [];

    for (const [id, inst] of this.instincts) {
      // 检查是否应该升级
      if (inst.status === 'experimental' && inst.confidence >= this.confidence.HIGH) {
        inst.status = 'active';
        inst.autoApply = true;
        evolved.push({ instinct: inst, action: 'promoted' });
      }

      // 检查是否应该降级
      if (inst.status === 'active' && inst.confidence < this.confidence.MEDIUM) {
        inst.status = 'experimental';
        inst.autoApply = false;
        evolved.push({ instinct: inst, action: 'demoted' });
      }

      // 检查是否应该废弃
      const daysSinceLastSeen = (Date.now() - new Date(inst.lastSeen).getTime()) / 86400000;
      if (daysSinceLastSeen > 30 && inst.status !== 'deprecated') {
        inst.confidence = Math.max(10, inst.confidence - 10);
        if (inst.confidence < 30) {
          inst.status = 'deprecated';
          evolved.push({ instinct: inst, action: 'deprecated' });
        }
      }
    }

    if (evolved.length > 0) this._saveState();
    return evolved;
  }

  // ==================== APPLY阶段 ====================

  /**
   * 获取应该自动应用的本能
   */
  getApplicableInstincts(context = {}) {
    const applicable = [];

    for (const [id, inst] of this.instincts) {
      if (inst.status !== 'active' || !inst.autoApply) continue;

      // 检查上下文匹配
      if (context.taskType && inst.taskType === context.taskType) {
        applicable.push({ ...inst, matchScore: 100 });
      } else if (!context.taskType) {
        applicable.push({ ...inst, matchScore: inst.confidence });
      }
    }

    return applicable.sort((a, b) => b.matchScore - a.matchScore);
  }

  // ==================== 完整闭环运行 ====================

  /**
   * 运行完整五阶段闭环
   * 整合D4(learning-loop)和D3(skill-analyzer)联合分析
   */
  runFullCycle(sessionData) {
    // Phase 1: OBSERVE - 观察
    const analysis = this.analyzeSession(sessionData);

    // Phase 2: ANALYZE - 分析
    const instincts = this.extractInstincts(analysis);

    // Phase 3: LEARN - 学习（记录反馈）
    // 如果有传入反馈，一并记录
    if (sessionData.feedback !== undefined) {
      this.recordFeedback({
        sessionId: sessionData.id,
        taskType: sessionData.taskType,
        reward: sessionData.feedback
      });
    }

    // Phase 4: EVOLVE - 进化
    const evolved = this.evolveInstincts();

    // Phase 5: D4+D3联合分析 - 生成技能优化建议
    const jointResult = this.jointAnalysisWithSkillAnalyzer(sessionData);

    // 更新状态
    this.feedbackLoop.lastRun = this._ts();
    this._saveState();

    return {
      cycle: this.feedbackLoop.cycle,
      analysis,
      instinctsExtracted: instincts.length,
      instincts,
      evolved: evolved.length,
      jointAnalysis: jointResult,
      totalInstincts: this.instincts.size,
      applicable: this.getApplicableInstincts({ taskType: sessionData.taskType }),
      recommendations: this._generateRecommendations(analysis, instincts, jointResult)
    };
  }

  // v2.0 alias for backward compat
  runLearningCycle(sessionData) { return this.runFullCycle(sessionData); }

  _generateRecommendations(analysis, instincts, jointResult) {
    const recs = [];

    // 基于分析生成建议
    if (instincts.length === 0 && analysis.patterns.length > 0) {
      recs.push({
        type: 'skill_creation',
        priority: 'medium',
        message: '检测到新模式，建议创建技能',
        details: analysis.patterns
      });
    }

    // 基于联合分析生成建议
    for (const suggestion of jointResult.skillSuggestions) {
      if (suggestion.confidence >= this.confidence.MEDIUM) {
        recs.push({
          type: suggestion.action,
          priority: suggestion.confidence >= this.confidence.HIGH ? 'high' : 'medium',
          message: suggestion.reason,
          details: suggestion
        });
      }
    }

    return recs;
  }

  // ==================== 查询接口 ====================

  getInstincts(filter = {}) {
    let result = [...this.instincts.values()];
    if (filter.taskType) result = result.filter(i => i.taskType === filter.taskType);
    if (filter.minConfidence) result = result.filter(i => i.confidence >= filter.minConfidence);
    if (filter.status) result = result.filter(i => i.status === filter.status);
    return result.sort((a, b) => b.confidence - a.confidence);
  }

  getTopInstincts(n = 5) {
    return this.getInstincts({ status: 'active' }).slice(0, n);
  }

  getLoopStats() {
    const all = [...this.instincts.values()];
    return {
      cycles: this.feedbackLoop.cycle,
      totalLearned: this.feedbackLoop.totalLearned,
      lastRun: this.feedbackLoop.lastRun,
      activeInstincts: all.filter(i => i.status === 'active').length,
      experimentalInstincts: all.filter(i => i.status === 'experimental').length,
      deprecatedInstincts: all.filter(i => i.status === 'deprecated').length,
      sessions: this.sessions.length,
      avgConfidence: all.length > 0 ? Math.round(all.reduce((s, i) => s + i.confidence, 0) / all.length) : 0,
      jointCycles: this.feedbackLoop.totalLearned
    };
  }

  // ==================== 导出技能建议（供skill-analyzer使用）= ====================

  exportSkillSuggestions() {
    const suggestions = [];

    for (const [id, inst] of this.instincts) {
      if (inst.status === 'active' && inst.confidence >= this.confidence.HIGH) {
        suggestions.push({
          instinctId: id,
          instinctType: inst.type,
          instinctName: inst.name,
          suggestedTriggers: this._generateTriggers(inst),
          reason: `基于${inst.occurrences}次成功经验`,
          confidence: inst.confidence,
          priority: inst.confidence >= 90 ? 'high' : 'medium'
        });
      }
    }

    return suggestions;
  }

  _generateTriggers(inst) {
    // 基于本能类型生成触发词建议
    const triggerMap = {
      'high_tool_success': ['高复杂度任务', 'long task', 'complex job'],
      'complex_flawless': ['精准执行', '零错误', 'perfect execution'],
      'efficient_exec': ['快速完成', 'efficient', '简洁方案'],
      'skill_routing': ['专业任务', 'specialized'],
      'context_reuse': ['延续任务', 'continue'],
      'self_correct': ['修复问题', 'debug', 'fix error']
    };
    return triggerMap[inst.type] || [inst.taskType, inst.name];
  }

  // ==================== 重置 ====================

  reset() {
    this.sessions = [];
    this.instincts.clear();
    this.feedbackLoop = { cycle: 0, totalLearned: 0, lastRun: null };
    this._saveState();
    return { reset: true };
  }
}

// ============================================================================
// CLI
// ============================================================================

if (require.main === module) {
  const ll = new LearningLoop();
  const cmd = process.argv[2];
  const args = process.argv;

  const get = (k, d) => {
    const i = args.indexOf(k);
    return i > -1 ? args[i + 1] : d;
  };

  const has = (k) => args.includes(k);

  switch (cmd) {
    case 'cycle': {
      const r = ll.runFullCycle({
        id: get('--session', 's1'),
        taskType: get('--type', 'general'),
        complexity: parseInt(get('--complexity', '5')),
        toolCalls: parseInt(get('--toolcalls', '5')),
        success: !has('--fail'),
        skillUsed: get('--skill', null),
        feedback: has('--reward') ? parseInt(get('--reward', '5')) : undefined
      });
      console.log(`Cycle #${r.cycle}:`);
      console.log(`  本能提取: ${r.instinctsExtracted}`);
      console.log(`  进化数: ${r.evolved}`);
      console.log(`  联合分析可执行: ${r.jointAnalysis.actionable}`);
      console.log(`  推荐: ${r.recommendations.length}`);
      break;
    }
    case 'joint': {
      // D4+D3联合分析测试
      const r = ll.runFullCycle({
        id: ll._id(),
        taskType: 'code_review',
        complexity: 7,
        toolCalls: 12,
        success: true,
        skillUsed: 'code-review',
        contextHits: 4
      });
      console.log('D4+D3联合分析结果:');
      console.log(JSON.stringify(r.jointAnalysis, null, 2));
      break;
    }
    case 'feedback':
      console.log(ll.recordFeedback({
        sessionId: get('--session', 's1'),
        taskType: get('--type', 'general'),
        reward: parseInt(get('--reward', '5'))
      }));
      break;
    case 'instincts': {
      const f = {};
      if (has('--type')) f.taskType = get('--type');
      if (has('--min')) f.minConfidence = parseInt(get('--min'));
      ll.getInstincts(f).forEach(i => console.log(` [${i.confidence}%] ${i.type} (${i.status})`));
      break;
    }
    case 'top':
      ll.getTopInstincts(parseInt(args[3]) || 5).forEach((i, n) => console.log(` #${n + 1} [${i.confidence}%] ${i.type}`));
      break;
    case 'export':
      console.log(JSON.stringify(ll.exportSkillSuggestions(), null, 2));
      break;
    case 'stats':
      console.log(JSON.stringify(ll.getLoopStats(), null, 2));
      break;
    case 'evolve':
      console.log(ll.evolveInstincts());
      break;
    case 'reset':
      ll.reset();
      console.log('Reset');
      break;
    case 'help':
    default:
      console.log(`
LearningLoop v1.1 - D4+D3联合闭环

命令:
  cycle [--session <id>] [--type <type>] [--complexity <n>] [--toolcalls <n>] [--skill <name>] [--reward <n>] [--fail]
    运行完整五阶段闭环

  joint
    D4+D3联合分析测试

  feedback --session <id> --type <type> --reward <n>
    记录反馈

  instincts [--type <type>] [--min <confidence>]
    查询本能列表

  top [count]
    Top N本能

  export
    导出技能建议(供skill-analyzer使用)

  stats
    统计信息

  evolve
    进化本能

  reset
    重置

  help
`);
  }
}

module.exports = LearningLoop;
console.log('[LearningLoop] 加载成功 - P4-8 v1.1 D4+D3联合闭环');
