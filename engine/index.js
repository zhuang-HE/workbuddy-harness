#!/usr/bin/env node

const path = require('path');

// ============================================================================
// Module-level Singleton Cache
// ============================================================================
const _singletons = new Map();
const DEFAULT_CONFIG_DIR = path.join(require('os').homedir(), '.workbuddy', 'harness-coordinator');

function getSingleton(ClassFn, key, options = {}) {
  const cacheKey = key || ClassFn.name;
  const clearCache = process.argv.includes('--clear-cache');

  if (clearCache) {
    _singletons.delete(cacheKey);
  }

  if (!_singletons.has(cacheKey)) {
    const instance = new ClassFn(options);
    _singletons.set(cacheKey, instance);
  }
  return _singletons.get(cacheKey);
}

function getHookRunner() {
  const HookRunner = require('./hook-runner');
  return getSingleton(HookRunner, 'HookRunner', {
    verbose: process.argv.includes('--verbose'),
    configDir: DEFAULT_CONFIG_DIR
  });
}

function getEvalRunner() {
  const EvalRunner = require('./eval-runner');
  return getSingleton(EvalRunner, 'EvalRunner', {
    verbose: process.argv.includes('--verbose'),
    configDir: DEFAULT_CONFIG_DIR
  });
}

function getHarnessDaemon() {
  const HarnessDaemon = require('./daemon');
  return getSingleton(HarnessDaemon, 'HarnessDaemon', {
    verbose: process.argv.includes('--verbose'),
    configDir: DEFAULT_CONFIG_DIR
  });
}

function getRuntimeGuardian() {
  const GuardianPath = path.join(__dirname, '..', 'plugins', 'runtime-guardian', 'index.js');
  const RG = require(GuardianPath);
  return getSingleton(RG, 'RuntimeGuardian', { configDir: path.join(require('os').homedir(), '.workbuddy', 'runtime-guardian') });
}

function getConfigManager() {
  const { ConfigManager } = require('./utils');
  return getSingleton(ConfigManager, 'ConfigManager', DEFAULT_CONFIG_DIR);
}

function listCache() {
  const entries = [];
  for (const [key] of _singletons) {
    entries.push({ key, cached: true });
  }
  return entries;
}

const COMMANDS = {
  hook:    { desc: 'Hook engine - trigger events, list hooks, view stats',     usage: 'harness hook <trigger|list|reload|stats|history|plugins> [args...]' },
  eval:    { desc: 'Eval engine - run benchmarks, generate reports',           usage: 'harness eval <suites|run|report|score|regression|stats> [args...]' },
  daemon:  { desc: 'Daemon - file watcher that auto-triggers hooks',           usage: 'harness daemon <start|stop|status>' },
  guardian:{ desc: 'Security guardian - scan commands, manage alerts',         usage: 'harness guardian <scan|alerts|mode|report|stats> [args...]' },
  health:  { desc: 'Generate health report across all dimensions',             usage: 'harness health' },
  cache:   { desc: 'Manage engine singleton cache',                            usage: 'harness cache [list|clear]' },
  help:    { desc: 'Show this help',                                           usage: 'harness help [command]' }
};

function showHelp(cmd) {
  if (cmd && COMMANDS[cmd]) {
    console.log(`\n${COMMANDS[cmd].desc}\nUsage: ${COMMANDS[cmd].usage}\n`);
    return;
  }
  console.log('\nWorkBuddy Harness Engine v2.1\n');
  console.log('Commands:');
  for (const [name, info] of Object.entries(COMMANDS)) {
    console.log(`  ${name.padEnd(12)} ${info.desc}`);
  }
  console.log('\n  --clear-cache   Force fresh instances (skip singleton cache)');
  console.log('\nRun "harness help <command>" for detailed usage.\n');
}

async function main() {
  const cmd = process.argv[2];

  if (!cmd || cmd === 'help') { showHelp(process.argv[3]); return; }

  if (cmd === 'cache') {
    const sub = process.argv[3];
    if (sub === 'clear') { _singletons.clear(); console.log('Cache cleared'); }
    else { console.log(JSON.stringify(listCache(), null, 2)); }
    return;
  }

  if (cmd === 'health') {
    const config = getConfigManager();
    const state = config.loadConfig();
    console.log('# Harness Health Report\n');
    console.log(`**Version**: ${state.version}`);
    console.log(`**Last Run**: ${state.lastRun || 'never'}\n`);
    console.log('## Dimension Scores\n| Dim | Name | Score | Bar |\n|-----|------|-------|-----|');
    for (const [dim, info] of Object.entries(state.dimensions)) {
      const bar = '#'.repeat(Math.round(info.score / 10)) + '-'.repeat(10 - Math.round(info.score / 10));
      console.log(`| ${dim} | ${info.name} | ${info.score}% | ${bar} |`);
    }
    console.log('\n## Metrics\n| Metric | Value |\n|--------|-------|');
    for (const [key, val] of Object.entries(state.metrics)) {
      console.log(`| ${key} | ${val} |`);
    }
    const avg = Object.values(state.dimensions).reduce((s, d) => s + d.score, 0) / 9;
    console.log(`\n**Overall Maturity**: ${Math.round(avg)}%\n`);
    return;
  }

  if (cmd === 'guardian') {
    try {
      const rg = getRuntimeGuardian();
      const sub = process.argv[3];
      if (sub === 'scan') {
        const target = process.argv[4] || '';
        const type = process.argv[5] || 'command';
        if (type === 'command') {
          const r = rg.scanCommand(target);
          console.log(r.safe ? 'SAFE' : 'DANGER');
          r.matches.forEach(m => console.log(`  [${m.level}] ${m.desc} (${m.category})`));
        } else if (type === 'file') {
          const r = rg.checkFilePath(target, process.argv[6] || 'read');
          console.log(r.allowed ? 'ALLOWED' : `BLOCKED: ${r.reason}`);
        }
      } else if (sub === 'alerts') {
        const act = process.argv[4];
        if (act === 'resolve') { rg.resolveAlert(process.argv[5]); console.log('Resolved'); }
        else {
          const active = rg.getActiveAlerts();
          console.log(`Active: ${active.length} / Total: ${rg.alerts.length}`);
          active.forEach(a => console.log(`  [${a.level}] ${a.id}: ${a.message}`));
        }
      } else if (sub === 'mode') {
        const m = process.argv[4]; if (m) rg.setMode(m);
        console.log('Mode:', rg.getMode());
      } else if (sub === 'report') {
        console.log(rg.generateSecurityReport());
      } else if (sub === 'stats') {
        console.log(JSON.stringify(rg.getOverallStats(), null, 2));
      } else {
        console.log('guardian: scan <cmd> [command|file], alerts [resolve <id>], mode, report, stats');
      }
    } catch (e) {
      console.error('Guardian error:', e.message);
    }
    return;
  }

  if (cmd === 'eval') {
    const runner = getEvalRunner();
    const sub = process.argv[3];
    if (sub === 'suites') {
      runner.listSuites().forEach(s => console.log(`  ${s.id}: ${s.name} (${s.cases} cases, ${s.weight})`));
    } else if (sub === 'run') {
      const result = runner.runSuite(process.argv[4] || 'all');
      if (result.error) { console.log(result.error); }
      else { console.log(`Score: ${result.aggregate.overallScore}/100 (${result.aggregate.grade}) | Pass: ${result.aggregate.passRate}%`); }
    } else if (sub === 'report') {
      console.log(runner.generateReport(process.argv[4] || 'markdown'));
    } else if (sub === 'score') {
      const score = runner.autoScore(process.argv[4] || '', { expected: process.argv.slice(5) });
      console.log(JSON.stringify(score, null, 2));
    } else if (sub === 'stats') {
      const last = runner.getLastResult();
      console.log(last ? JSON.stringify(last.aggregate, null, 2) : 'No results');
    } else if (sub === 'regression') {
      const prev = runner.getLastResult();
      console.log(prev ? JSON.stringify(runner.detectRegression(prev.aggregate), null, 2) : 'No data');
    } else {
      console.log('eval commands: suites, run [suite], report, score, stats, regression');
    }
    return;
  }

  if (cmd === 'hook') {
    const runner = getHookRunner();
    const sub = process.argv[3] || 'list';
    if (sub === 'trigger') {
      const event = process.argv[4];
      if (!event) { console.log('Usage: harness hook trigger <event> [key=value ...]'); return; }
      const data = {};
      for (let i = 5; i < process.argv.length; i++) {
        const part = process.argv[i];
        if (part.includes('=') && !part.startsWith('--')) {
          const [k, v] = part.split('=', 2);
          const num = Number(v);
          data[k] = isNaN(num) ? v : num;
        }
      }
      const result = await runner.triggerEvent(event, data);
      console.log(JSON.stringify(result, null, 2));
    } else if (sub === 'list') {
      runner.listHooks().forEach(h => console.log(`  [${h.enabled ? '✓' : '✗'}] ${h.id} (${h.type}) - ${h.name}`));
    } else if (sub === 'reload') {
      console.log('Reloaded:', runner.reload().count, 'hooks');
    } else if (sub === 'stats') {
      console.log(JSON.stringify(runner.getStats(), null, 2));
    } else if (sub === 'history') {
      runner.getHistory().forEach(r => console.log(`  ${r.timestamp} [${r.event}]`));
    } else if (sub === 'plugins') {
      console.log(JSON.stringify(runner.getPluginStatus(), null, 2));
    } else {
      console.log('hook commands: trigger, list, reload, stats, history, plugins');
    }
    return;
  }

  if (cmd === 'daemon') {
    const daemon = getHarnessDaemon();
    const sub = process.argv[3] || 'status';
    if (sub === 'start') {
      const result = await daemon.start();
      console.log(JSON.stringify(result, null, 2));
      console.log('Daemon running. Ctrl+C to stop.');
      process.on('SIGINT', async () => { await daemon.stop(); process.exit(0); });
    } else if (sub === 'stop') {
      console.log(JSON.stringify(await daemon.stop()));
    } else if (sub === 'status') {
      console.log(JSON.stringify(daemon.status(), null, 2));
    }
    return;
  }

  showHelp();
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
