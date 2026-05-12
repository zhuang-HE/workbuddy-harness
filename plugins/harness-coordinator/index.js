#!/usr/bin/env node
/**
 * harness-coordinator - P4-12 统一协调器
 * 串联所有Harness插件，提供统一入口、流程编排、健康总览
 */
const path = require('path');
const os = require('os');
const fs = require('fs');

class HarnessCoordinator {
  constructor(options = {}) {
    this.configDir = options.configDir || path.join(os.homedir(), '.workbuddy', 'harness-coordinator');
    this.plugins = new Map();
    this.state = { sessions: 0, tasks: 0, errors: 0, lastActivity: null };
    this.DIMENSIONS = {
      D1: { name: 'Identity',       plugin: 'context-awareness',      score: 90 },
      D2: { name: 'Memory',          plugins: ['memory-decay','memory-graph'], score: 93 },
      D3: { name: 'Skills',          plugins: ['skill-analyzer'],     score: 93 },
      D4: { name: 'Learning',        plugin: 'learning-loop',         score: 90 },
      D5: { name: 'Orchestration',   plugin: 'task-orchestrator',     score: 90 },
      D6: { name: 'Integration',     plugins: ['fusion-router','fusion-sync-enhancer'], score: 85 },
      D7: { name: 'Security',        plugin: 'runtime-guardian',      score: 87 },
      D8: { name: 'Evaluation',      plugin: 'eval-framework',        score: 88 },
      D9: { name: 'Multi-Agent',     plugin: 'multi-agent-orchestrator', score: 85 }
    };
    this._ensureDirs();
    this._loadState();
  }

  _ensureDirs() { if (!fs.existsSync(this.configDir)) fs.mkdirSync(this.configDir, { recursive: true }); }
  _ts() { return new Date().toISOString(); }

  _loadState() {
    try {
      const p = path.join(this.configDir, 'state.json');
      if (fs.existsSync(p)) this.state = JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch (e) {}
  }
  _saveState() {
    fs.writeFileSync(path.join(this.configDir, 'state.json'), JSON.stringify({ ...this.state, updated: this._ts() }, null, 2));
  }

  /**
   * Main entry point: process a task through all harness layers
   */
  processTask(goal, options = {}) {
    const trace = { goal, startTime: this._ts(), phases: [] };
    const context = {};

    // Phase 1: Context Awareness (D1)
    try {
      const CA = require('../context-awareness/index.js');
      const ca = new CA();
      const ctx = ca.scanAll();
      const strategy = ca.getRecommendedStrategy();
      const skills = ca.suggestSkills();
      context.env = ctx; context.strategy = strategy; context.suggestedSkills = skills;
      trace.phases.push({ phase: 'D1-Context', project: ctx.project.name, time: ctx.time.timeOfDay, skills: skills.length });
    } catch (e) { trace.phases.push({ phase: 'D1-Context', error: e.message }); }

    // Phase 2: Fusion Routing (D6)
    try {
      const FR = require('../fusion-router/index.js');
      const fr = new FR();
      const route = fr.route({ description: goal });
      context.route = route;
      trace.phases.push({ phase: 'D6-Route', target: route.winner, confidence: route.confidence });
    } catch (e) { trace.phases.push({ phase: 'D6-Route', error: e.message }); }

    // Phase 3: Task Decomposition (D5)
    try {
      const TO = require('../task-orchestrator/index.js');
      const to = new TO();
      const plan = to.decomposeGoal(goal);
      context.plan = plan;
      trace.phases.push({ phase: 'D5-Decompose', tasks: plan.tasks.length, complexity: plan.complexity });
    } catch (e) { trace.phases.push({ phase: 'D5-Decompose', error: e.message }); }

    // Phase 4: Security Pre-check (D7)
    try {
      const RG = require('../runtime-guardian/index.js');
      const rg = new RG();
      const safety = rg.checkCommand(goal); // Check if goal itself is safe
      context.safety = { safe: safety.safe };
      trace.phases.push({ phase: 'D7-Security', safe: safety.safe });
    } catch (e) { trace.phases.push({ phase: 'D7-Security', error: e.message }); }

    // Phase 5: Skill Matching (D3)
    try {
      const matchedSkills = context.suggestedSkills || [];
      trace.phases.push({ phase: 'D3-Skills', matched: matchedSkills.join(',') || 'none' });
    } catch (e) { trace.phases.push({ phase: 'D3-Skills', error: e.message }); }

    // Phase 6: Multi-Agent Check (D9)
    try {
      const complexity = context.plan?.complexity || 5;
      context.useMultiAgent = complexity >= 8;
      if (context.useMultiAgent) {
        const MAO = require('../multi-agent-orchestrator/index.js');
        const mao = new MAO();
        const teamType = mao._classifyGoal(goal);
        context.team = teamType;
        trace.phases.push({ phase: 'D9-MultiAgent', team: teamType, triggered: true });
      } else {
        trace.phases.push({ phase: 'D9-MultiAgent', triggered: false, reason: 'complexity < 8' });
      }
    } catch (e) { trace.phases.push({ phase: 'D9-MultiAgent', error: e.message }); }

    // Phase 7: Memory Registration (D2)
    try {
      const MD = require('../memory-decay/index.js');
      const md = new MD();
      md.registerMemory({ id: 'task_' + Date.now(), content: goal, type: 'task_state', importance: 3, created: Date.now(), tags: ['harness-task'] });
      trace.phases.push({ phase: 'D2-Memory', registered: true });
    } catch (e) { trace.phases.push({ phase: 'D2-Memory', error: e.message }); }

    // Phase 8: Evaluation Start (D8)
    try {
      const EF = require('../eval-framework/index.js');
      const ef = new EF();
      const sessionId = 'sess_' + Date.now();
      if (ef.startTracking) ef.startTracking(sessionId);
      context.sessionId = sessionId;
      trace.phases.push({ phase: 'D8-Eval', tracking: true, sessionId });
    } catch (e) { trace.phases.push({ phase: 'D8-Eval', error: e.message }); }

    trace.phases.push({ phase: 'READY', message: 'All layers processed. Task ready for AI execution.' });

    this.state.sessions++;
    this.state.tasks++;
    this.state.lastActivity = this._ts();
    this._saveState();

    return {
      goal, trace,
      ready: trace.phases.filter(p => !p.error).length,
      errors: trace.phases.filter(p => p.error).length,
      context
    };
  }

  /**
   * Generate unified health report across all dimensions
   */
  generateHealthReport() {
    let md = '# Harness 统一健康报告\n\n';
    md += '**时间**: ' + this._ts() + '\n';
    md += '**会话数**: ' + this.state.sessions + ' | ';
    md += '**任务数**: ' + this.state.tasks + '\n\n';

    md += '## 维度健康\n\n';
    md += '| 维度 | 成熟度 | 插件 | 状态 |\n';
    md += '|------|--------|------|------|\n';

    for (const [dim, info] of Object.entries(this.DIMENSIONS)) {
      const pluginNames = Array.isArray(info.plugins) ? info.plugins.join(', ') : info.plugin;
      const bar = '█'.repeat(Math.round(info.score / 10)) + '░'.repeat(10 - Math.round(info.score / 10));
      const status = info.score >= 90 ? '🟢' : (info.score >= 80 ? '🟡' : '🔴');
      md += `| ${dim} ${info.name} | ${info.score}% ${bar} | ${pluginNames} | ${status} |\n`;
    }

    md += '\n## 插件加载状态\n\n';
    const pluginDirs = ['task-orchestrator','eval-framework','multi-agent-orchestrator','runtime-guardian','context-awareness','memory-decay','memory-graph','fusion-sync-enhancer','fusion-router','learning-loop','skill-analyzer','harness-coordinator'];
    for (const dir of pluginDirs) {
      const indexFile = path.join(__dirname, '..', dir, 'index.js');
      const exists = fs.existsSync(indexFile);
      md += `- ${exists ? '✅' : '❌'} ${dir} ${exists ? '(' + Math.round(fs.statSync(indexFile).size / 1024) + 'KB)' : ''}\n`;
    }

    return md;
  }

  getOverallMaturity() {
    const scores = Object.values(this.DIMENSIONS).map(d => d.score);
    return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  }

  listDimensions() {
    return Object.entries(this.DIMENSIONS).map(([id, info]) => ({
      id, name: info.name, score: info.score,
      plugins: Array.isArray(info.plugins) ? info.plugins : [info.plugin]
    }));
  }
}

if (require.main === module) {
  const hc = new HarnessCoordinator(); const cmd = process.argv[2];
  const cmds = {
    async process() {
      const goal = process.argv.slice(3).join(' ') || '分析股票走势';
      console.log('Processing: ' + goal + '\n');
      const result = await hc.processTask(goal);
      console.log('Phases:');
      const phases = (result.trace && result.trace.phases) || [];
      phases.forEach(p => {
        const status = p.error ? '❌' : '✅';
        const info = {};
        for (const [k, v] of Object.entries(p)) { if (k !== 'phase' && k !== 'error') info[k] = v; }
        console.log('  ' + status + ' ' + p.phase + ': ' + (p.error || JSON.stringify(info)));
      });
      console.log('\nReady: ' + result.ready + '/' + phases.length + ' phases OK');
    },
    health() { console.log(hc.generateHealthReport()); },
    maturity() { console.log('Overall Maturity: ' + hc.getOverallMaturity() + '%'); },
    dimensions() { console.log(JSON.stringify(hc.listDimensions(), null, 2)); },
    help() { console.log('HarnessCoordinator CLI\n命令: process, health, maturity, dimensions, help'); }
  };
  const fn = cmds[cmd] || cmds.help;
  const result = fn();
  if (result && typeof result.then === 'function') {
    result.catch(err => { console.error('Error:', err.message); process.exit(1); });
  }
}

module.exports = HarnessCoordinator;
console.log('[HarnessCoordinator] 加载成功 - P4-12 统一协调器');
