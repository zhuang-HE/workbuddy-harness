/**
 * API Gateway - API 安全与限流系统
 * 
 * 请求限流、API 认证、插件沙箱隔离
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// 默认配置目录
const DEFAULT_CONFIG_DIR = path.join(process.env.HOME || process.env.USERPROFILE, '.workbuddy', 'api-gateway');

class APIGateway {
  constructor(options = {}) {
    this.configDir = options.configDir || DEFAULT_CONFIG_DIR;
    this.rateLimitFile = path.join(this.configDir, 'rate-limits.json');
    this.apiKeysFile = path.join(this.configDir, 'api-keys.json');
    this.accessLogFile = path.join(this.configDir, 'access.log');
    this.configFile = path.join(this.configDir, 'config.json');
    
    this._ensureConfigDir();
    
    // 加载配置
    this.config = this._loadConfig();
    
    // 内置中间件
    this.middlewares = {
      rateLimit: this._rateLimitMiddleware.bind(this),
      auth: this._authMiddleware.bind(this),
      log: this._logMiddleware.bind(this),
      sanitize: this._sanitizeMiddleware.bind(this)
    };
  }

  /**
   * 确保配置目录存在
   */
  _ensureConfigDir() {
    if (!fs.existsSync(this.configDir)) {
      fs.mkdirSync(this.configDir, { recursive: true });
    }
  }

  /**
   * 加载配置
   */
  _loadConfig() {
    if (!fs.existsSync(this.configFile)) {
      return this._getDefaultConfig();
    }
    
    try {
      return JSON.parse(fs.readFileSync(this.configFile, 'utf-8'));
    } catch (e) {
      return this._getDefaultConfig();
    }
  }

  /**
   * 获取默认配置
   */
  _getDefaultConfig() {
    return {
      rateLimit: {
        enabled: true,
        defaultLimit: 100,      // 默认 100 请求
        defaultWindow: 60000,    // 60 秒窗口
        perIP: true,            // 按 IP 限流
        perUser: true,          // 按用户限流
        perAPIKey: true,        // 按 API Key 限流
        whitelist: [],          // 白名单 IP
        blacklist: []           // 黑名单 IP
      },
      auth: {
        enabled: false,
        requireAPIKey: false,   // 是否要求 API Key
        allowAnonymous: true,   // 允许匿名访问
        tokenExpiry: 3600000    // 1 小时过期
      },
      security: {
        sanitizeInput: true,    // 清理输入
        maxRequestSize: 1048576, // 1MB
        allowedMethods: ['GET', 'POST', 'PUT', 'DELETE'],
        corsEnabled: false
      },
      logging: {
        enabled: true,
        logAccess: true,
        logErrors: true,
        logLevel: 'info'        // debug, info, warn, error
      }
    };
  }

  /**
   * 生成唯一 ID
   */
  _generateId() {
    return crypto.randomBytes(8).toString('hex');
  }

  /**
   * 获取时间戳
   */
  _timestamp() {
    return new Date().toISOString();
  }

  // ==================== API Key 管理 ====================

  /**
   * 创建 API Key
   */
  createAPIKey(options = {}) {
    const keyId = this._generateId();
    const secret = crypto.randomBytes(32).toString('hex');
    const apiKey = `${keyId}.${secret}`;
    
    const keyData = {
      id: keyId,
      key: apiKey,
      name: options.name || 'Unnamed API Key',
      permissions: options.permissions || ['read'],
      limits: options.limits || {
        rate: this.config.rateLimit.defaultLimit,
        window: this.config.rateLimit.defaultWindow
      },
      createdAt: this._timestamp(),
      lastUsed: null,
      expiresAt: options.expiresIn 
        ? new Date(Date.now() + options.expiresIn).toISOString() 
        : null,
      active: true,
      metadata: options.metadata || {}
    };
    
    // 保存
    const keys = this._loadAPIKeys();
    keys[keyId] = keyData;
    this._saveAPIKeys(keys);
    
    // 返回密钥（仅返回一次）
    return {
      id: keyId,
      key: apiKey,
      name: keyData.name,
      createdAt: keyData.createdAt
    };
  }

  /**
   * 加载 API Keys
   */
  _loadAPIKeys() {
    if (!fs.existsSync(this.apiKeysFile)) {
      return {};
    }
    
    try {
      return JSON.parse(fs.readFileSync(this.apiKeysFile, 'utf-8'));
    } catch (e) {
      return {};
    }
  }

  /**
   * 保存 API Keys
   */
  _saveAPIKeys(keys) {
    // 保存时不包含完整密钥
    const safeKeys = {};
    for (const [id, key] of Object.entries(keys)) {
      safeKeys[id] = { ...key, key: `[REDACTED]` };
    }
    fs.writeFileSync(this.apiKeysFile, JSON.stringify(safeKeys, null, 2));
  }

  /**
   * 验证 API Key
   */
  validateAPIKey(apiKey) {
    if (!apiKey) {
      return { valid: false, error: 'API Key 未提供' };
    }
    
    const [keyId, secret] = apiKey.split('.');
    
    if (!keyId || !secret) {
      return { valid: false, error: '无效的 API Key 格式' };
    }
    
    // 重新加载以获取完整数据
    const keysFile = this.apiKeysFile.replace('.json', '.keys.json');
    let keys = {};
    
    if (fs.existsSync(keysFile)) {
      try {
        keys = JSON.parse(fs.readFileSync(keysFile, 'utf-8'));
      } catch (e) {
        // ignore
      }
    }
    
    const keyData = keys[keyId];
    
    if (!keyData) {
      return { valid: false, error: 'API Key 不存在' };
    }
    
    if (!keyData.active) {
      return { valid: false, error: 'API Key 已禁用' };
    }
    
    if (keyData.expiresAt && new Date(keyData.expiresAt) < new Date()) {
      return { valid: false, error: 'API Key 已过期' };
    }
    
    // 验证密钥
    if (keyData.key !== apiKey) {
      return { valid: false, error: '密钥验证失败' };
    }
    
    // 更新最后使用时间
    keyData.lastUsed = this._timestamp();
    fs.writeFileSync(keysFile, JSON.stringify(keys, null, 2));
    
    return {
      valid: true,
      keyId,
      permissions: keyData.permissions,
      limits: keyData.limits
    };
  }

  /**
   * 撤销 API Key
   */
  revokeAPIKey(keyId) {
    const keysFile = this.apiKeysFile.replace('.json', '.keys.json');
    let keys = {};
    
    if (fs.existsSync(keysFile)) {
      try {
        keys = JSON.parse(fs.readFileSync(keysFile, 'utf-8'));
      } catch (e) {
        return { success: false, error: e.message };
      }
    }
    
    if (!keys[keyId]) {
      return { success: false, error: 'API Key 不存在' };
    }
    
    keys[keyId].active = false;
    fs.writeFileSync(keysFile, JSON.stringify(keys, null, 2));
    
    return { success: true };
  }

  /**
   * 列出 API Keys
   */
  listAPIKeys() {
    const keys = this._loadAPIKeys();
    
    return Object.entries(keys).map(([id, key]) => ({
      id,
      name: key.name,
      permissions: key.permissions,
      createdAt: key.createdAt,
      lastUsed: key.lastUsed,
      expiresAt: key.expiresAt,
      active: key.active
    }));
  }

  // ==================== 限流管理 ====================

  /**
   * 检查限流
   */
  checkRateLimit(identifier, limit, window) {
    const limits = this._loadRateLimits();
    
    const entry = limits[identifier] || {
      count: 0,
      resetAt: Date.now() + window
    };
    
    // 检查是否需要重置
    if (Date.now() > entry.resetAt) {
      entry.count = 0;
      entry.resetAt = Date.now() + window;
    }
    
    entry.count++;
    
    const allowed = entry.count <= limit;
    const remaining = Math.max(0, limit - entry.count);
    const retryAfter = Math.ceil((entry.resetAt - Date.now()) / 1000);
    
    limits[identifier] = entry;
    this._saveRateLimits(limits);
    
    return {
      allowed,
      limit,
      remaining,
      resetAt: entry.resetAt,
      retryAfter: allowed ? 0 : retryAfter
    };
  }

  /**
   * 加载限流记录
   */
  _loadRateLimits() {
    if (!fs.existsSync(this.rateLimitFile)) {
      return {};
    }
    
    try {
      return JSON.parse(fs.readFileSync(this.rateLimitFile, 'utf-8'));
    } catch (e) {
      return {};
    }
  }

  /**
   * 保存限流记录
   */
  _saveRateLimits(limits) {
    // 清理过期记录
    const now = Date.now();
    const active = {};
    
    for (const [id, entry] of Object.entries(limits)) {
      if (entry.resetAt > now) {
        active[id] = entry;
      }
    }
    
    fs.writeFileSync(this.rateLimitFile, JSON.stringify(active, null, 2));
  }

  /**
   * 获取限流状态
   */
  getRateLimitStatus(identifier) {
    const limits = this._loadRateLimits();
    const entry = limits[identifier];
    
    if (!entry) {
      return {
        identifier,
        count: 0,
        resetAt: null,
        remaining: this.config.rateLimit.defaultLimit
      };
    }
    
    return {
      identifier,
      count: entry.count,
      resetAt: entry.resetAt,
      remaining: Math.max(0, this.config.rateLimit.defaultLimit - entry.count)
    };
  }

  /**
   * 重置限流
   */
  resetRateLimit(identifier) {
    const limits = this._loadRateLimits();
    delete limits[identifier];
    this._saveRateLimits(limits);
    return { success: true };
  }

  // ==================== 中间件 ====================

  /**
   * 限流中间件
   */
  _rateLimitMiddleware(request) {
    if (!this.config.rateLimit.enabled) {
      return { allowed: true };
    }
    
    const identifier = this._getIdentifier(request);
    const limit = request.limits?.rate || this.config.rateLimit.defaultLimit;
    const window = request.limits?.window || this.config.rateLimit.defaultWindow;
    
    return this.checkRateLimit(identifier, limit, window);
  }

  /**
   * 获取请求标识符
   */
  _getIdentifier(request) {
    if (request.apiKey && this.config.rateLimit.perAPIKey) {
      return `apikey:${request.apiKey.split('.')[0]}`;
    }
    if (request.userId && this.config.rateLimit.perUser) {
      return `user:${request.userId}`;
    }
    if (request.ip && this.config.rateLimit.perIP) {
      return `ip:${request.ip}`;
    }
    return `default:${this._generateId()}`;
  }

  /**
   * 认证中间件
   */
  _authMiddleware(request) {
    if (!this.config.auth.enabled) {
      return { authenticated: true };
    }
    
    if (this.config.auth.allowAnonymous && !request.apiKey) {
      return { authenticated: true, anonymous: true };
    }
    
    if (!request.apiKey) {
      return { authenticated: false, error: '需要 API Key' };
    }
    
    return this.validateAPIKey(request.apiKey);
  }

  /**
   * 日志中间件
   */
  _logMiddleware(request, response) {
    if (!this.config.logging.enabled || !this.config.logging.logAccess) {
      return;
    }
    
    const logEntry = {
      timestamp: this._timestamp(),
      method: request.method,
      path: request.path,
      ip: request.ip,
      userAgent: request.userAgent,
      status: response.status,
      duration: response.duration,
      apiKeyId: request.apiKey?.split('.')[0]
    };
    
    const logLine = JSON.stringify(logEntry) + '\n';
    fs.appendFileSync(this.accessLogFile, logLine);
  }

  /**
   * 清理输入中间件
   */
  _sanitizeMiddleware(request) {
    if (!this.config.security.sanitizeInput) {
      return { sanitized: false };
    }
    
    const issues = [];
    
    // 检查请求大小
    if (request.body && request.body.length > this.config.security.maxRequestSize) {
      issues.push(`请求体过大: ${request.body.length} > ${this.config.security.maxRequestSize}`);
    }
    
    // 检查方法
    if (!this.config.security.allowedMethods.includes(request.method)) {
      issues.push(`不允许的方法: ${request.method}`);
    }
    
    // 简单 XSS 检查
    if (request.body && typeof request.body === 'string') {
      const dangerous = ['<script', 'javascript:', 'onerror=', 'onclick='];
      for (const pattern of dangerous) {
        if (request.body.toLowerCase().includes(pattern)) {
          issues.push(`检测到潜在 XSS: ${pattern}`);
        }
      }
    }
    
    return {
      sanitized: true,
      issues,
      safe: issues.length === 0
    };
  }

  /**
   * 处理请求（完整流程）
   */
  processRequest(request, handler) {
    const startTime = Date.now();
    
    // 1. 认证
    const auth = this._authMiddleware(request);
    if (!auth.authenticated) {
      return {
        status: 401,
        error: auth.error
      };
    }
    
    // 2. 限流
    const rateLimit = this._rateLimitMiddleware({
      ...request,
      limits: auth.limits
    });
    
    if (!rateLimit.allowed) {
      return {
        status: 429,
        error: '请求过于频繁',
        headers: {
          'X-RateLimit-Limit': rateLimit.limit,
          'X-RateLimit-Remaining': rateLimit.remaining,
          'X-RateLimit-Reset': rateLimit.resetAt,
          'Retry-After': rateLimit.retryAfter
        }
      };
    }
    
    // 3. 清理
    const sanitize = this._sanitizeMiddleware(request);
    if (!sanitize.safe) {
      return {
        status: 400,
        error: '请求包含不安全内容',
        details: sanitize.issues
      };
    }
    
    // 4. 执行处理
    try {
      const result = handler(request);
      
      // 5. 记录日志
      this._logMiddleware(request, {
        status: 200,
        duration: Date.now() - startTime
      });
      
      return {
        status: 200,
        data: result,
        headers: {
          'X-RateLimit-Limit': rateLimit.limit,
          'X-RateLimit-Remaining': rateLimit.remaining,
          'X-RateLimit-Reset': rateLimit.resetAt
        }
      };
      
    } catch (e) {
      this._logMiddleware(request, {
        status: 500,
        duration: Date.now() - startTime
      });
      
      return {
        status: 500,
        error: e.message
      };
    }
  }

  // ==================== 配置 ====================

  /**
   * 更新配置
   */
  updateConfig(config) {
    this.config = { ...this.config, ...config };
    fs.writeFileSync(this.configFile, JSON.stringify(this.config, null, 2));
    return { success: true, config: this.config };
  }

  /**
   * 获取配置
   */
  getConfig() {
    return this.config;
  }

  /**
   * 获取统计
   */
  getStats() {
    const keys = this.listAPIKeys();
    const limits = this._loadRateLimits();
    
    return {
      apiKeys: {
        total: keys.length,
        active: keys.filter(k => k.active).length
      },
      rateLimits: {
        active: Object.keys(limits).length
      },
      config: {
        rateLimitEnabled: this.config.rateLimit.enabled,
        authEnabled: this.config.auth.enabled
      }
    };
  }

  // ==================== CLI 入口 ====================
}

// CLI 入口
if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];
  const gateway = new APIGateway();
  
  switch (command) {
    case 'create-key':
      const name = args[1] || 'CLI Key';
      const key = gateway.createAPIKey({ name });
      console.log('✅ API Key 创建成功:');
      console.log('ID:', key.id);
      console.log('Key:', key.key);
      console.log('请妥善保管 Key，仅显示一次！');
      break;
      
    case 'list-keys':
      const keys = gateway.listAPIKeys();
      console.log(JSON.stringify(keys, null, 2));
      break;
      
    case 'revoke':
      const keyId = args[1];
      if (!keyId) {
        console.log('用法: api-gateway.js revoke <keyId>');
        process.exit(1);
      }
      console.log(gateway.revokeAPIKey(keyId));
      break;
      
    case 'check-limit':
      const identifier = args[1];
      if (!identifier) {
        console.log('用法: api-gateway.js check-limit <identifier>');
        process.exit(1);
      }
      console.log(JSON.stringify(gateway.getRateLimitStatus(identifier), null, 2));
      break;
      
    case 'reset-limit':
      const resetId = args[1];
      if (!resetId) {
        console.log('用法: api-gateway.js reset-limit <identifier>');
        process.exit(1);
      }
      console.log(gateway.resetRateLimit(resetId));
      break;
      
    case 'stats':
      console.log(JSON.stringify(gateway.getStats(), null, 2));
      break;
      
    case 'config':
      if (args[1] === 'show') {
        console.log(JSON.stringify(gateway.getConfig(), null, 2));
      } else {
        console.log('用法: api-gateway.js config show');
      }
      break;
      
    default:
      console.log(`
API Gateway CLI
==============
用法: api-gateway.js <command> [options]

API Key 管理:
  create-key [name]         创建 API Key
  list-keys                  列出所有 Key
  revoke <keyId>             撤销 Key

限流管理:
  check-limit <identifier>   检查限流状态
  reset-limit <identifier>    重置限流

其他:
  stats                       查看统计
  config show                 显示配置

示例:
  node api-gateway.js create-key "My App"
  node api-gateway.js check-limit ip:192.168.1.1
      `);
  }
}

module.exports = APIGateway;
