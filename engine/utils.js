#!/usr/bin/env node

const path = require('path');
const os = require('os');
const fs = require('fs');

class ConfigManager {
  constructor(basePath) {
    this.basePath = basePath || path.join(os.homedir(), '.workbuddy', 'harness-coordinator');
    this.statePath = path.join(this.basePath, 'state.json');
  }

  _defaultState() {
    return {
      version: '2.0.0', lastRun: null,
      metrics: { hooksTriggered: 0, alertsRaised: 0, benchmarksRun: 0, errorsTotal: 0 },
      settings: { logLevel: 'info', historyLimit: 1000, daemonPollMs: 2000 },
      dimensions: {
        D1: { name: 'Identity', score: 60 }, D2: { name: 'Memory', score: 70 },
        D3: { name: 'Skills', score: 50 }, D4: { name: 'Learning', score: 55 },
        D5: { name: 'Orchestration', score: 60 }, D6: { name: 'Integration', score: 45 },
        D7: { name: 'Security', score: 35 }, D8: { name: 'Evaluation', score: 65 },
        D9: { name: 'MultiAgent', score: 50 }
      }
    };
  }

  loadConfig() {
    try { if (fs.existsSync(this.statePath)) return JSON.parse(fs.readFileSync(this.statePath, 'utf8')); }
    catch (e) {}
    return this._defaultState();
  }

  saveConfig(config) {
    this._ensureDir(path.dirname(this.statePath));
    const tmp = this.statePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ ...config, updated: new Date().toISOString() }, null, 2));
    fs.renameSync(tmp, this.statePath);
  }

  updateMetrics(key, delta = 1) {
    const config = this.loadConfig();
    config.metrics[key] = (config.metrics[key] || 0) + delta;
    config.lastRun = new Date().toISOString();
    this.saveConfig(config);
  }

  getDataDir(pluginName) { const d = path.join(os.homedir(), '.workbuddy', pluginName); this._ensureDir(d); return d; }
  ensureDataDir(pluginName) { return this.getDataDir(pluginName); }
  getStatePath() { return this.statePath; }
  _ensureDir(dir) { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); }
}

class TemplateResolver {
  constructor(context = {}) {
    this.context = {
      session_id: 'unknown', task_id: 'unknown', task_description: '',
      complexity: 0, tool_name: '', args: '', error: '', context_usage: 0,
      turn_count: 0, success: true, duration: 0, tool_calls: 0,
      timestamp: new Date().toISOString(), ...context
    };
  }

  resolve(template) {
    if (typeof template !== 'string') return template;
    return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      if (this.context[key] !== undefined && this.context[key] !== null) return String(this.context[key]);
      return `{{UNRESOLVED:${key}}}`;
    });
  }

  resolveObject(obj) {
    if (typeof obj === 'string') return this.resolve(obj);
    if (Array.isArray(obj)) return obj.map(item => this.resolveObject(item));
    if (obj && typeof obj === 'object') {
      const result = {};
      for (const [key, value] of Object.entries(obj)) result[key] = this.resolveObject(value);
      return result;
    }
    return obj;
  }
}

class Logger {
  constructor(logPath, options = {}) {
    this.logPath = logPath || path.join(os.homedir(), '.workbuddy', 'harness-coordinator', 'harness.log');
    this.verbose = options.verbose || false;
    this._ensureLogDir();
  }

  _ensureLogDir() { const d = path.dirname(this.logPath); if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }
  _format(level, msg, data) {
    const ts = new Date().toISOString();
    const base = `[${ts}] [${level}] ${msg}`;
    if (data !== undefined) { try { return base + ' ' + JSON.stringify(data); } catch (e) { return base + ' [unserializable]'; } }
    return base;
  }
  _write(line) { try { fs.appendFileSync(this.logPath, line + '\n'); } catch (e) {} }
  info(msg, data)  { const l = this._format('INFO', msg, data); console.log(l); this._write(l); }
  warn(msg, data)  { const l = this._format('WARN', msg, data); console.warn(l); this._write(l); }
  error(msg, data) { const l = this._format('ERROR', msg, data); console.error(l); this._write(l); }
  debug(msg, data) { if (this.verbose) { const l = this._format('DEBUG', msg, data); console.log(l); this._write(l); } }
}

class ExecutionHistory {
  constructor(historyPath) {
    this.path = historyPath || path.join(os.homedir(), '.workbuddy', 'harness-coordinator', 'execution-history.json');
    const d = path.dirname(this.path); if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  }

  _read() { try { if (fs.existsSync(this.path)) return JSON.parse(fs.readFileSync(this.path, 'utf8')); } catch (e) {} return []; }
  _write(records) { fs.writeFileSync(this.path, JSON.stringify(records, null, 2)); }

  record(event, data = {}, duration = 0) {
    const records = this._read();
    records.push({ timestamp: new Date().toISOString(), event, data, duration: Math.round(duration) });
    this._write(records);
    return records.length;
  }

  query(filter = {}, limit = 20) {
    let records = this._read();
    if (filter.event) records = records.filter(r => r.event === filter.event);
    if (filter.since) { const since = new Date(filter.since).getTime(); records = records.filter(r => new Date(r.timestamp).getTime() >= since); }
    return records.slice(-limit);
  }

  getStats() {
    const records = this._read();
    if (records.length === 0) return { total: 0 };
    const events = {}; let totalDuration = 0;
    for (const r of records) { events[r.event] = (events[r.event] || 0) + 1; totalDuration += r.duration || 0; }
    return { total: records.length, byEvent: events, totalDuration, avgDuration: Math.round(totalDuration / records.length),
      firstRecord: records[0]?.timestamp, lastRecord: records[records.length - 1]?.timestamp };
  }
}

module.exports = { ConfigManager, TemplateResolver, Logger, ExecutionHistory };
