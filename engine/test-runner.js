#!/usr/bin/env node

const path = require('path');
const fs = require('fs');

const PLUGIN_DIR = path.join(__dirname, '..', 'plugins');

function runTestFile(pluginName) {
  const testPath = path.join(PLUGIN_DIR, pluginName, 'test.js');
  if (!fs.existsSync(testPath)) return { plugin: pluginName, error: 'No test.js found', passed: 0, failed: 0 };

  try {
    const tests = require(testPath);
    if (!Array.isArray(tests)) return { plugin: pluginName, error: 'test.js must export array', passed: 0, failed: 0 };

    let passed = 0, failed = 0;
    const failures = [];

    for (const test of tests) {
      try {
        test.fn({
          assert: {
            truthy(condition, msg) { if (!condition) throw new Error('Assertion failed: ' + (msg || 'expected truthy')); },
            equal(a, b, msg) { if (a !== b) throw new Error(`Assertion failed: ${msg || ''} expected ${b}, got ${a}`); }
          },
          require: (name) => require(path.join(PLUGIN_DIR, pluginName, 'index.js'))
        });
        passed++;
      } catch (e) {
        failed++;
        failures.push({ test: test.name || test.id, error: e.message });
      }
    }

    return { plugin: pluginName, passed, failed, total: tests.length, failures: failures.slice(0, 5) };
  } catch (e) {
    return { plugin: pluginName, error: e.message, passed: 0, failed: 0 };
  }
}

function main() {
  const target = process.argv[2];
  const plugins = ['task-orchestrator','eval-framework','context-awareness','memory-decay','memory-graph',
    'learning-loop','runtime-guardian','fusion-router','fusion-sync-enhancer','skill-analyzer','multi-agent-orchestrator'];

  const toRun = target ? plugins.filter(p => p === target) : plugins;
  if (toRun.length === 0) { console.log('Plugin not found:', target); return; }

  console.log(`\nTest Runner — ${toRun.length} plugin(s)\n`);
  let totalPassed = 0, totalFailed = 0;

  for (const plugin of toRun) {
    const result = runTestFile(plugin);
    if (result.error && !result.passed && !result.failed) {
      console.log(`  SKIP  ${plugin}: ${result.error}`);
      continue;
    }
    const passed = result.passed || 0;
    const failed = result.failed || 0;
    totalPassed += passed;
    totalFailed += failed;
    const icon = failed === 0 ? 'PASS' : 'FAIL';
    console.log(`  ${icon}  ${plugin}: ${passed}/${result.total || passed + failed} passed${failed > 0 ? ', ' + failed + ' failed' : ''}`);
    if (result.failures && result.failures.length > 0) {
      result.failures.forEach(f => console.log(`         - ${f.test}: ${f.error}`));
    }
  }

  console.log(`\nTotal: ${totalPassed} passed, ${totalFailed} failed\n`);
  process.exit(totalFailed > 0 ? 1 : 0);
}

main();
