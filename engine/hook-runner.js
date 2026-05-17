#!/usr/bin/env node

const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn } = require('child_process');
const { ConfigManager, TemplateResolver, Logger, ExecutionHistory } = require('./utils');

class HookRunner {
  constructor(options = {}) {
    this.hooksPath = options.hooksPath || path.join(__dirname, '..', 'hooks', 'hooks.json');
    this.configDir = options.configDir || path.join(os.homedir(), '.workbuddy', 'harness-coordinator');
    this.config = new ConfigManager(this.configDir);
    this.log = new Logger(options.logPath || path.join(this.configDir, 'harness.log'), options);
    this.history = new ExecutionHistory(path.join(this.configDir, 'execution-history.json'));
    this.hooks = [];
    this.pluginCache = new Map();
    this._loadHooks();
  }

  _loadHooks() {
    try {
      if (fs.existsSync(this.hooksPath)) {
        const data = JSON.parse(fs.readFileSync(this.hooksPath, 'utf8'));
        this.hooks = data.hooks || [];
        this.log.info('Hooks loaded', { count: this.hooks.length });
      }
    } catch (e) {
      this.log.warn('Failed to load hooks', { error: e.message });
      this.hooks = [];
    }
  }

  reload() { this._loadHooks(); return { count: this.hooks.length }; }

  listHooks(filter = {}) {
    let result = this.hooks;
    if (filter.type) result = result.filter(h => h.type === filter.type);
    if (filter.enabled !== undefined) result = result.filter(h => h.enabled === filter.enabled);
    return result.map(h => ({
      id: h.id, type: h.type, name: h.name, enabled: h.enabled,
      actions: h.actions?.length || 0, condition: h.condition || null
    }));
  }

  /**
   * Main entry point: trigger an event by type with context data.
   * Returns execution results for all matching hooks.
   */
  async triggerEvent(eventType, contextData = {}) {
    const startTime = Date.now();
    const resolver = new TemplateResolver(contextData);
    const matches = this.hooks.filter(h => h.type === eventType && h.enabled !== false);

    this.log.debug(`Event triggered: ${eventType}`, { matches: matches.length });

    const results = [];
    for (const hook of matches) {
      const result = await this._executeHook(hook, resolver, contextData);
      results.push(result);
    }

    const duration = Date.now() - startTime;
    this.history.record(eventType, { matches: matches.length, executed: results.filter(r => r.success).length, failed: results.filter(r => !r.success).length }, duration);
    this.config.updateMetrics('hooksTriggered', matches.length);

    return {
      event: eventType,
      matches: matches.length,
      executed: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      duration,
      results: results.filter(r => !r.success || r.output).slice(0, 10)
    };
  }

  async _executeHook(hook, resolver, contextData) {
    const result = { hookId: hook.id, success: true, actions: [] };

    if (hook.condition && !this._evaluateCondition(hook.condition, contextData)) {
      result.skipped = true;
      result.reason = `Condition not met: ${hook.condition}`;
      return result;
    }

    for (const action of (hook.actions || [])) {
      const actionResult = await this._executeAction(action, resolver);
      result.actions.push(actionResult);
      if (!actionResult.success) {
        result.success = false;
        if (actionResult.critical) break;
      }
    }

    return result;
  }

  _evaluateCondition(condition, contextData) {
    if (!condition) return true;

    try {
      const expr = condition.trim();
      if (expr === 'true') return true;
      if (expr === 'false') return false;

      const matchOp = expr.match(/^(\w+)\s*(>=|<=|>|<|==|!=)\s*([\d.]+|true|false|"[^"]*"|'[^']*')$/);
      if (matchOp) {
        const [, key, op, rawVal] = matchOp;
        let val = rawVal;
        if (val === 'true') val = true;
        else if (val === 'false') val = false;
        else if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        } else if (!isNaN(Number(val))) {
          val = Number(val);
        }

        const actual = contextData[key];
        switch (op) {
          case '==': return actual == val;
          case '!=': return actual != val;
          case '>': return Number(actual) > Number(val);
          case '<': return Number(actual) < Number(val);
          case '>=': return Number(actual) >= Number(val);
          case '<=': return Number(actual) <= Number(val);
        }
      }

      if (expr === 'hasChanges == true') return !!contextData.hasChanges;
      if (expr === 'isDangerous == true') return !!contextData.isDangerous;
      if (expr === 'containsKeyword == true') return !!contextData.keyword;

      const andParts = expr.split(/\s*&&\s*/);
      return andParts.every(part => this._evaluateSimpleCondition(part.trim(), contextData));
    } catch (e) {
      this.log.warn('Condition evaluation failed', { condition, error: e.message });
      return true;
    }
  }

  _evaluateSimpleCondition(expr, contextData) {
    if (expr === 'true') return true;
    return true;
  }

  async _executeAction(action, resolver) {
    const resolved = resolver.resolveObject(action);
    const actionResult = { type: resolved.type, success: false };

    try {
      switch (resolved.type) {
        case 'harness': {
          actionResult.success = await this._executeHarnessAction(resolved);
          break;
        }
        case 'execute': {
          actionResult.success = await this._executeProcessAction(resolved);
          break;
        }
        case 'log': {
          this.log.info(resolved.message || 'Hook action');
          actionResult.success = true;
          break;
        }
        case 'notify': {
          console.log(`[Hook:${resolved.channel || 'console'}] ${resolved.message || ''}`);
          actionResult.success = true;
          break;
        }
        case 'sync': {
          this.log.info('Sync action', { target: resolved.target, direction: resolved.direction });
          actionResult.success = true;
          break;
        }
        case 'compress': {
          this.log.info('Compress action', { target_ratio: resolved.target_ratio });
          actionResult.success = true;
          break;
        }
        default: {
          this.log.warn('Unknown action type', { type: resolved.type });
          actionResult.success = true;
        }
      }
    } catch (e) {
      actionResult.success = false;
      actionResult.error = e.message;
      this.log.error('Action failed', { type: resolved.type, error: e.message });
    }

    return actionResult;
  }

  async _executeHarnessAction(action) {
    const { plugin, method, args } = action;
    if (!plugin || !method) {
      this.log.warn('Harness action missing plugin/method', { plugin, method });
      return false;
    }

    try {
      const instance = this._getPluginInstance(plugin);
      if (!instance) {
        this.log.warn('Plugin not found', { plugin });
        return false;
      }

      if (typeof instance[method] === 'function') {
        const result = instance[method](...(args || []));
        if (result && typeof result.then === 'function') {
          await result;
        }
        return true;
      }

      this.log.warn('Method not found on plugin', { plugin, method });
      return false;
    } catch (e) {
      this.log.error('Harness action error', { plugin, method, error: e.message });
      return false;
    }
  }

  _getPluginInstance(pluginName) {
    if (this.pluginCache.has(pluginName)) {
      return this.pluginCache.get(pluginName);
    }

    try {
      const pluginPath = path.join(__dirname, '..', 'plugins', pluginName, 'index.js');
      if (!fs.existsSync(pluginPath)) {
        this.log.warn('Plugin file not found', { plugin: pluginName });
        return null;
      }
      const PluginClass = require(pluginPath);
      const instance = new PluginClass();
      this.pluginCache.set(pluginName, instance);
      this.log.debug('Plugin loaded', { plugin: pluginName });
      return instance;
    } catch (e) {
      this.log.error('Plugin load failed', { plugin: pluginName, error: e.message });
      return null;
    }
  }

  async _executeProcessAction(action) {
    return new Promise((resolve) => {
      const { command, args = [], timeout = 30000 } = action;
      const child = spawn(command, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout,
        shell: process.platform === 'win32'
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (d) => { stdout += d.toString(); });
      child.stderr.on('data', (d) => { stderr += d.toString(); });

      child.on('close', (code) => {
        const success = code === 0;
        if (stdout.trim()) this.log.debug('Process stdout', { command, output: stdout.trim().substring(0, 200) });
        if (!success) this.log.warn('Process failed', { command, code, stderr: stderr.trim().substring(0, 200) });
        resolve(success);
      });

      child.on('error', (err) => {
        this.log.error('Process spawn error', { command, error: err.message });
        resolve(false);
      });
    });
  }

  getPluginStatus() {
    const status = {};
    for (const [name] of this.pluginCache) {
      status[name] = 'loaded';
    }
    return status;
  }

  getHistory(limit = 20) {
    return this.history.query({}, limit);
  }

  getStats() {
    return {
      hooksLoaded: this.hooks.length,
      hooksEnabled: this.hooks.filter(h => h.enabled).length,
      pluginsLoaded: this.pluginCache.size,
      history: this.history.getStats(),
      config: this.config.loadConfig().metrics
    };
  }
}

if (require.main === module) {
  const cmd = process.argv[2];
  const runner = new HookRunner({ verbose: process.argv.includes('--verbose') });

  const cmds = {
    async trigger() {
      const event = process.argv[3];
      if (!event) { console.log('Usage: hook-runner trigger <event> [--data key=value ...]'); return; }

      const data = {};
      for (let i = 4; i < process.argv.length; i++) {
        const arg = process.argv[i];
        if (arg.startsWith('--data')) {
          try { Object.assign(data, JSON.parse(process.argv[i + 1])); i++; }
          catch (e) { console.warn('Invalid JSON data'); }
        } else if (arg.includes('=') && !arg.startsWith('--')) {
          const [k, v] = arg.split('=', 2);
          const num = Number(v);
          data[k] = isNaN(num) ? v : num;
        }
      }

      const result = await runner.triggerEvent(event, data);
      console.log(JSON.stringify(result, null, 2));
    },

    list() {
      const type = process.argv[3];
      const hooks = runner.listHooks(type ? { type } : {});
      console.log(`Hooks (${hooks.length}):`);
      hooks.forEach(h => {
        const flag = h.enabled ? '✓' : '✗';
        console.log(`  [${flag}] ${h.id} (${h.type}) - ${h.name} [${h.actions} actions]`);
      });
    },

    reload() {
      const r = runner.reload();
      console.log(`Reloaded: ${r.count} hooks`);
    },

    stats() {
      console.log(JSON.stringify(runner.getStats(), null, 2));
    },

    history() {
      const h = runner.getHistory();
      h.forEach(r => console.log(`  ${r.timestamp} [${r.event}] ${r.data.matches || 0} hooks, ${r.duration}ms`));
    },

    plugins() {
      console.log(JSON.stringify(runner.getPluginStatus(), null, 2));
    },

    help() {
      console.log(`
HookRunner CLI
==============
  trigger <event> [key=value...]  Trigger an event (session_start, task_start, etc.)
  list [type]                     List hooks (optionally filter by type)
  reload                          Reload hooks.json
  stats                           Show execution stats
  history                         Show recent execution history
  plugins                         Show loaded plugin cache
  help                            This help
      `);
    }
  };

  const fn = cmds[cmd] || (cmd ? cmds.trigger : cmds.help);
  if (typeof fn === 'function') {
    const result = fn();
    if (result && typeof result.then === 'function') {
      result.catch(e => { console.error('Error:', e.message); process.exit(1); });
    }
  }
}

module.exports = HookRunner;
