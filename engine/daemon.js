#!/usr/bin/env node

const path = require('path');
const os = require('os');
const fs = require('fs');
const HookRunner = require('./hook-runner');
const { ConfigManager, Logger } = require('./utils');

class HarnessDaemon {
  constructor(options = {}) {
    this.configDir = options.configDir || path.join(os.homedir(), '.workbuddy', 'harness-coordinator');
    this.config = new ConfigManager(this.configDir);
    this.log = new Logger(options.logPath || path.join(this.configDir, 'harness.log'), options);
    this.runner = new HookRunner(options);

    this.pollInterval = options.pollInterval || 2000;
    this.watchDirs = options.watchDirs || [
      path.join(os.homedir(), '.workbuddy', 'memory'),
      path.join(os.homedir(), '.workbuddy', 'harness-coordinator')
    ];

    this.running = false;
    this.timer = null;
    this.snapshots = new Map();
    this.debounceMap = new Map();
    this.debounceMs = 5000;
    this.sessionActive = false;
    this.sessionStartTime = null;
    this.turnCount = 0;
    this.lastActivity = null;
    this.errorsSinceLastCheck = 0;
  }

  async start() {
    if (this.running) return { status: 'already_running' };

    this.running = true;
    this.log.info('Daemon started', { watchDirs: this.watchDirs, pollInterval: this.pollInterval });

    for (const dir of this.watchDirs) {
      this._takeSnapshot(dir);
    }

    await this.runner.triggerEvent('session_start', {
      session_id: `sess_${Date.now()}`,
      timestamp: new Date().toISOString()
    });
    this.sessionActive = true;
    this.sessionStartTime = Date.now();

    this._poll();

    return { status: 'started', watchDirs: this.watchDirs, pollInterval: this.pollInterval };
  }

  async stop() {
    if (!this.running) return { status: 'not_running' };

    this.running = false;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }

    if (this.sessionActive) {
      await this.runner.triggerEvent('session_end', {
        session_id: `sess_${this.sessionStartTime}`,
        hasChanges: true,
        complexity: 5,
        turn_count: this.turnCount,
        duration: Date.now() - (this.sessionStartTime || Date.now()),
        success: this.errorsSinceLastCheck === 0
      });
      this.sessionActive = false;
    }

    this.log.info('Daemon stopped');
    return { status: 'stopped' };
  }

  async status() {
    return {
      running: this.running,
      sessionActive: this.sessionActive,
      watchDirs: this.watchDirs,
      pollInterval: this.pollInterval,
      turnCount: this.turnCount,
      sessionDuration: this.sessionActive ? Math.round((Date.now() - this.sessionStartTime) / 1000) : 0,
      hooksLoaded: this.runner.hooks.length,
      pluginsLoaded: this.runner.pluginCache.size,
      lastActivity: this.lastActivity,
      uptime: this.sessionStartTime ? Math.round((Date.now() - this.sessionStartTime) / 1000) : 0
    };
  }

  _poll() {
    this.timer = setInterval(() => {
      if (!this.running) return;

      try {
        for (const dir of this.watchDirs) {
          this._checkDirectory(dir);
        }
      } catch (e) {
        this.log.error('Poll error', { error: e.message });
      }
    }, this.pollInterval);
  }

  _takeSnapshot(dir) {
    try {
      if (!fs.existsSync(dir)) return;
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.md') || f.endsWith('.json'));
      const snapshot = {};
      for (const file of files) {
        const fullPath = path.join(dir, file);
        try {
          const stat = fs.statSync(fullPath);
          snapshot[file] = { mtime: stat.mtimeMs, size: stat.size };
        } catch (e) { /* file may have been deleted between readdir and stat */ }
      }
      this.snapshots.set(dir, snapshot);
    } catch (e) {
      this.log.debug('Snapshot skipped', { dir, error: e.message });
    }
  }

  _checkDirectory(dir) {
    try {
      if (!fs.existsSync(dir)) return;
      const prev = this.snapshots.get(dir) || {};
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.md') || f.endsWith('.json'));
      const current = {};

      let changes = 0;
      for (const file of files) {
        const fullPath = path.join(dir, file);
        try {
          const stat = fs.statSync(fullPath);
          current[file] = { mtime: stat.mtimeMs, size: stat.size };

          const prevFile = prev[file];
          if (!prevFile || prevFile.mtime !== stat.mtimeMs || prevFile.size !== stat.size) {
            changes++;
          }
        } catch (e) { /* continue */ }
      }

      for (const file of Object.keys(prev)) {
        if (!current[file]) changes++;
      }

      if (changes > 0) {
        this._onDirectoryChange(dir, changes);
        this.snapshots.set(dir, current);
        this.turnCount++;
        this.lastActivity = new Date().toISOString();
      }
    } catch (e) {
      this.log.debug('Directory check failed', { dir, error: e.message });
    }
  }

  async _onDirectoryChange(dir, changes) {
    const dirName = path.basename(dir);
    const now = Date.now();

    const lastDebounce = this.debounceMap.get(dirName) || 0;
    if (now - lastDebounce < this.debounceMs) return;
    this.debounceMap.set(dirName, now);

    this.log.debug('Directory changed', { dir: dirName, changes });

    if (dirName === 'memory') {
      await this.runner.triggerEvent('turn_end', {
        turn_count: this.turnCount,
        context_usage: Math.min(80, this.turnCount * 5),
        hasChanges: true
      });

      if (this.turnCount >= 15 && this.turnCount % 5 === 0) {
        await this.runner.triggerEvent('turn_end', {
          turn_count: this.turnCount,
          context_usage: Math.min(90, this.turnCount * 3)
        });
      }
    }
  }

  async notifyTaskStart(taskDescription, complexity = 5) {
    this.turnCount++;
    this.lastActivity = new Date().toISOString();
    return this.runner.triggerEvent('task_start', {
      task_id: `task_${Date.now()}`,
      task_description: taskDescription,
      complexity
    });
  }

  async notifyTaskComplete(taskId, success = true, complexity = 5) {
    this.turnCount++;
    this.lastActivity = new Date().toISOString();
    return this.runner.triggerEvent('task_complete', {
      task_id: taskId,
      task_description: '',
      complexity,
      success
    });
  }

  async notifyToolUse(toolName, args = '') {
    this.turnCount++;
    this.lastActivity = new Date().toISOString();
    return this.runner.triggerEvent('pre_tool_use', {
      tool_name: toolName,
      args,
      isDangerous: this._isDangerousTool(toolName, args)
    });
  }

  _isDangerousTool(toolName, args) {
    if (toolName === 'Bash' || toolName === 'PowerShell') {
      const cmd = typeof args === 'string' ? args : '';
      return /rm\s+-rf|del\s+\/F|DROP\s+TABLE|format\s+[A-Z]:/.test(cmd);
    }
    return false;
  }
}

if (require.main === module) {
  const cmd = process.argv[2];
  const daemon = new HarnessDaemon({ verbose: process.argv.includes('--verbose') });

  const cmds = {
    async start() {
      const result = await daemon.start();
      console.log(JSON.stringify(result, null, 2));
      console.log('Daemon running. Press Ctrl+C to stop.');

      process.on('SIGINT', async () => {
        console.log('\nShutting down...');
        await daemon.stop();
        process.exit(0);
      });
      process.on('SIGTERM', async () => {
        await daemon.stop();
        process.exit(0);
      });
    },

    async stop() {
      const result = await daemon.stop();
      console.log(JSON.stringify(result, null, 2));
    },

    status() {
      console.log(JSON.stringify(daemon.status(), null, 2));
    },

    async task() {
      const sub = process.argv[3];
      if (sub === 'start') {
        const task = process.argv.slice(4).join(' ') || 'unknown task';
        const result = await daemon.notifyTaskStart(task);
        console.log(JSON.stringify(result, null, 2));
      } else if (sub === 'complete') {
        const taskId = process.argv[4] || `task_${Date.now()}`;
        const result = await daemon.notifyTaskComplete(taskId);
        console.log(JSON.stringify(result, null, 2));
      }
    },

    async tool() {
      const toolName = process.argv[3] || 'Bash';
      const args = process.argv.slice(4).join(' ') || '';
      const result = await daemon.notifyToolUse(toolName, args);
      console.log(JSON.stringify(result, null, 2));
    },

    help() {
      console.log(`
HarnessDaemon CLI
=================
  start     Start the daemon (watches directories, triggers events)
  stop      Stop the daemon
  status    Show daemon status
  task start <description>  Notify task start
  task complete [taskId]    Notify task complete
  tool <name> <args>        Notify tool use
  help      This help
      `);
    }
  };

  const fn = cmds[cmd] || cmds.help;
  if (fn) {
    const result = fn();
    if (result && typeof result.then === 'function') {
      result.catch(e => { console.error('Error:', e.message); process.exit(1); });
    }
  }
}

module.exports = HarnessDaemon;
