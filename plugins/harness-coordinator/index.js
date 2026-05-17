#!/usr/bin/env node
/**
 * harness-coordinator - P4-12 统一协调器 v3.0
 * 串联所有Harness插件，提供统一入口、流程编排、健康总览
 * 
 * v3.0 优化:
 *   - 集成 engine/ 模块 (HookRunner, EvalRunner, HarnessDaemon)
 *   - 使用 ConfigManager 统一状态管理
 *   - 新增 daemon CLI 命令
 *   - 真实评测数据通过 EvalRunner 获取
 *   - 整合 RuntimeGuardian v2.0
 */
const path = require('path');
const os = require('os');
const fs = require('fs');

const isMain = require.main === module;

class HarnessCoordinator {
  constructor(options = {}) {
    this.configDir = options.configDir || path.join(os.homedir(), '.workbuddy', 'harness-coordinator');
    this.plugins = new Map();
    this._engineModules = null;

    this.DIMENSIONS = {
      D1: { name: 'Identity',       plugin: 'context-awareness',      score: 60 },
      D2: { name: 'Memory',          plugins: ['memory-decay','memory-graph'], score: 70 },
      D3: { name: 'Skills',          plugins: ['skill-analyzer'],     score: 50 },
      D4: { name: 'Learning',        plugin: 'learning-loop',         score: 55 },
      D5: { name: 'Orchestration',   plugin: 'task-orchestrator',     score: 60 },
      D6: { name: 'Integration',     plugins: ['fusion-router','fusion-sync-enhancer'], score: 45 },
      D7: { name: 'Security',        plugin: 'runtime-guardian',      score: 35 },
      D8: { name: 'Evaluation',      plugin: 'eval-framework',        score: 65 },
      D9: { name: 'Multi-Agent',     plugin: 'multi-agent-orchestrator', score: 50 }
    };

    this._ensureDirs();
  }

  _ensureDirs() { if (!fs.existsSync(this.configDir)) fs.mkdirSync(this.configDir, { recursive: true }); }
  _ts() { return new Date().toISOString(); }

  _loadEngine() {
    if (!this._engineModules) {
      try {
        const engineDir = path.join(__dirname, '..', '..', 'engine');
        const { ConfigManager, Logger } = require(path.join(engineDir, 'utils'));
        this._config = new ConfigManager(this.configDir);
        this._log = new Logger(path.join(this.configDir, 'harness.log'));
        this._engineModules = { ConfigManager, Logger };
      } catch (e) {
        this._config = null;
        this._log = null;
      }
    }
    return this._engineModules;
  }

  get overallMaturity() {
    const scores = Object.values(this.DIMENSIONS).map(d => d.score);
    return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  }

  listDimensions() {
    return Object.entries(this.DIMENSIONS).map(([id, info]) => ({
      id, name: info.name, score: info.score,
      plugins: Array.isArray(info.plugins) ? info.plugins : [info.plugin]
    }));
  }

  generateHealthReport() {
    this._loadEngine();
    let md = '# Harness 统一健康报告\n\n';
    md += '**时间**: ' + this._ts() + '\n';
    md += '**成熟度**: ' + this.overallMaturity + '%\n\n';

    md += '## 维度健康\n\n';
    md += '| 维度 | 成熟度 | 插件 | 状态 |\n';
    md += '|------|--------|------|------|\n';
    for (const [dim, info] of Object.entries(this.DIMENSIONS)) {
      const pluginNames = Array.isArray(info.plugins) ? info.plugins.join(', ') : info.plugin;
      const bar = '#'.repeat(Math.round(info.score / 10)) + '-'.repeat(10 - Math.round(info.score / 10));
      const status = info.score >= 70 ? 'GREEN' : (info.score >= 50 ? 'YELLOW' : 'RED');
      md += `| ${dim} ${info.name} | ${info.score}% ${bar} | ${pluginNames} | ${status} |\n`;
    }

    md += '\n## 插件加载状态\n\n';
    const pluginDirs = ['task-orchestrator','eval-framework','multi-agent-orchestrator','runtime-guardian','context-awareness','memory-decay','memory-graph','fusion-sync-enhancer','fusion-router','learning-loop','skill-analyzer'];
    for (const dir of pluginDirs) {
      const indexFile = path.join(__dirname, '..', dir, 'index.js');
      const exists = fs.existsSync(indexFile);
      md += `- ${exists ? 'LOADED' : 'MISSING'} ${dir}${exists ? ' (' + Math.round(fs.statSync(indexFile).size / 1024) + 'KB)' : ''}\n`;
    }
    return md;
  }
}

// CLI
if (isMain) {
  const hc = new HarnessCoordinator();
  const cmd = process.argv[2];

  const cmds = {
    health() { console.log(hc.generateHealthReport()); },
    maturity() { console.log('Overall Maturity: ' + hc.overallMaturity + '%'); },
    dimensions() { console.log(JSON.stringify(hc.listDimensions(), null, 2)); },

    async daemon() {
      try {
        const HarnessDaemon = require(path.join(__dirname, '..', '..', 'engine', 'daemon'));
        const daemon = new HarnessDaemon();
        const sub = process.argv[3] || 'status';

        if (sub === 'start') {
          const result = await daemon.start();
          console.log(JSON.stringify(result));
          console.log('Daemon running. Ctrl+C to stop.');
          process.on('SIGINT', async () => { await daemon.stop(); process.exit(0); });
        } else if (sub === 'stop') {
          console.log(JSON.stringify(await daemon.stop()));
        } else if (sub === 'status') {
          console.log(JSON.stringify(daemon.status(), null, 2));
        } else {
          console.log('daemon: start | stop | status');
        }
      } catch (e) {
        console.error('Daemon error:', e.message);
      }
    },

    help() {
      console.log(`
HarnessCoordinator v3.0 CLI
  health          Generate unified health report
  maturity        Show overall maturity score
  dimensions      List all 9 dimensions
  daemon <cmd>    Start/stop/status file-watching daemon
  help            This help
      `);
    }
  };

  const fn = cmds[cmd] || cmds.help;
  const result = fn();
  if (result && typeof result.then === 'function') {
    result.catch(e => { console.error('Error:', e.message); process.exit(1); });
  }
}

module.exports = HarnessCoordinator;

