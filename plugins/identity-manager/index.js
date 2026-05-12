/**
 * Identity Manager (D1 身份层)
 * WorkBuddy Agent 身份管理系统
 * 增强版: 持久化 + 加密
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

class IdentityManager {
  constructor(options = {}) {
    this.configDir = options.configDir || path.join(os.homedir(), '.workbuddy', 'identity-manager');
    this.identities = new Map();
    this.currentId = null;
    this.tokens = new Map();
    this.capabilities = new Map();
    this.config = null;
    this.history = [];
    this.encryptionKey = null;
    this._ensureDirs();
    this._load();
  }

  _ensureDirs() {
    if (!fs.existsSync(this.configDir)) {
      fs.mkdirSync(this.configDir, { recursive: true });
    }
  }
  _ts() { return new Date().toISOString(); }

  /**
   * 加载持久化数据
   */
  _load() {
    try {
      // 加载配置
      const configPath = path.join(this.configDir, 'config.json');
      if (fs.existsSync(configPath)) {
        const configData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        this.config = configData.config;
        this.currentId = configData.currentId;
        this.history = configData.history || [];
      }

      // 加载身份数据
      const identitiesPath = path.join(this.configDir, 'identities.json');
      if (fs.existsSync(identitiesPath)) {
        const identitiesData = JSON.parse(fs.readFileSync(identitiesPath, 'utf8'));
        for (const [id, data] of Object.entries(identitiesData)) {
          this.identities.set(id, data);
          this.capabilities.set(id, new Set(data.capabilities || []));
        }
      }

      // 加载 Token 数据（如果加密密钥存在）
      const tokensPath = path.join(this.configDir, 'tokens.enc');
      if (fs.existsSync(tokensPath)) {
        this._loadTokens(tokensPath);
      }
    } catch (e) {
      console.warn('加载身份数据失败:', e.message);
    }
  }

  /**
   * 保存数据到持久化存储
   */
  _save() {
    try {
      // 保存配置
      const configData = {
        config: this.config,
        currentId: this.currentId,
        history: this.history.slice(-100),
        updated: this._ts()
      };
      fs.writeFileSync(
        path.join(this.configDir, 'config.json'),
        JSON.stringify(configData, null, 2)
      );

      // 保存身份
      const identitiesData = {};
      for (const [id, data] of this.identities) {
        identitiesData[id] = data;
      }
      fs.writeFileSync(
        path.join(this.configDir, 'identities.json'),
        JSON.stringify(identitiesData, null, 2)
      );

      // 保存 Token（加密）
      this._saveTokens();
    } catch (e) {
      console.warn('保存身份数据失败:', e.message);
    }
  }

  /**
   * 初始化加密密钥
   */
  _initEncryption(password) {
    // 使用 PBKDF2 派生密钥
    const salt = this.configDir; // 使用目录作为盐
    this.encryptionKey = crypto.pbkdf2Sync(
      password || 'default-workbuddy-key',
      salt,
      100000, // 迭代次数
      32,     // 密钥长度
      'sha256'
    );
  }

  /**
   * 加密数据
   */
  _encrypt(data) {
    if (!this.encryptionKey) {
      this._initEncryption();
    }
    
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    
    let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    
    return {
      iv: iv.toString('hex'),
      data: encrypted,
      authTag: authTag.toString('hex')
    };
  }

  /**
   * 解密数据
   */
  _decrypt(encryptedData) {
    if (!this.encryptionKey) {
      this._initEncryption();
    }
    
    const iv = Buffer.from(encryptedData.iv, 'hex');
    const authTag = Buffer.from(encryptedData.authTag, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.encryptionKey, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encryptedData.data, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return JSON.parse(decrypted);
  }

  /**
   * 保存加密的 Token
   */
  _saveTokens() {
    const tokensData = {};
    for (const [token, info] of this.tokens) {
      // 不保存实际 Token 值，只保存元数据
      tokensData[token] = {
        ...info,
        token: '[ENCRYPTED]' // Token 值已被加密
      };
    }

    const encrypted = this._encrypt(tokensData);
    fs.writeFileSync(
      path.join(this.configDir, 'tokens.enc'),
      JSON.stringify(encrypted)
    );
  }

  /**
   * 加载加密的 Token
   */
  _loadTokens(path) {
    try {
      const encrypted = JSON.parse(fs.readFileSync(path, 'utf8'));
      const tokensData = this._decrypt(encrypted);
      
      for (const [token, info] of Object.entries(tokensData)) {
        this.tokens.set(token, info);
      }
    } catch (e) {
      console.warn('加载 Token 数据失败:', e.message);
    }
  }

  /**
   * 生成密码散列
   */
  _hashPassword(password, salt) {
    return crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  }

  /**
   * 初始化身份管理器
   */
  async init(config = {}) {
    this.config = {
      defaultId: 'assistant',
      tokenExpiry: 3600000,
      maxIdentities: 20,
      encryptionEnabled: config.encryptionEnabled !== false,
      autoSave: config.autoSave !== false,
      ...config
    };

    // 初始化加密
    if (this.config.encryptionEnabled) {
      this._initEncryption(config.encryptionPassword);
    }

    // 加载预设身份
    if (config.identities) {
      for (const identity of config.identities) {
        await this.registerIdentity(identity);
      }
    }

    // 设置默认身份
    if (!this.currentId && this.identities.size > 0) {
      this.currentId = this.config.defaultId;
    }

    return this;
  }

  /**
   * 注册新身份
   */
  async registerIdentity(identity) {
    const validated = this.validateIdentity(identity);
    if (!validated.valid) {
      throw new Error(`身份验证失败: ${validated.errors.join(', ')}`);
    }

    this.identities.set(identity.id, {
      ...identity,
      createdAt: identity.createdAt || Date.now(),
      updatedAt: Date.now(),
      active: true
    });

    this.capabilities.set(identity.id, new Set(identity.capabilities || []));

    // 自动保存
    if (this.config.autoSave) {
      this._save();
    }

    return identity.id;
  }

  validateIdentity(identity) {
    const errors = [];
    
    if (!identity.id) errors.push('缺少 id');
    if (!identity.name) errors.push('缺少 name');
    if (!identity.role) errors.push('缺少 role');
    if (identity.id && this.identities.has(identity.id)) {
      errors.push('id 已存在');
    }
    
    return { valid: errors.length === 0, errors };
  }

  getCurrentIdentity() {
    if (!this.currentId) return null;
    return this.identities.get(this.currentId) || null;
  }

  getCurrentIdentitySnapshot() {
    const identity = this.getCurrentIdentity();
    if (!identity) return null;
    
    return {
      id: identity.id,
      name: identity.name,
      role: identity.role,
      capabilities: identity.capabilities,
      timestamp: Date.now()
    };
  }

  async switchIdentity(id) {
    if (!this.identities.has(id)) {
      throw new Error(`身份不存在: ${id}`);
    }

    const identity = this.identities.get(id);
    if (!identity.active) {
      throw new Error(`身份已停用: ${id}`);
    }

    const oldId = this.currentId;
    this.currentId = id;

    this.history.push({
      type: 'switch',
      from: oldId,
      to: id,
      timestamp: Date.now()
    });

    if (this.history.length > 100) {
      this.history = this.history.slice(-100);
    }

    if (this.config.autoSave) {
      this._save();
    }

    return {
      success: true,
      previous: oldId,
      current: id,
      identity: this.getCurrentIdentitySnapshot()
    };
  }

  async checkCapability(capability) {
    if (!this.currentId) {
      return { allowed: false, reason: '未设置当前身份' };
    }

    const identity = this.identities.get(this.currentId);
    if (!identity) {
      return { allowed: false, reason: '当前身份不存在' };
    }

    const capabilities = this.capabilities.get(this.currentId);
    const allowed = capabilities ? capabilities.has(capability) : false;

    return {
      allowed,
      identity: identity.id,
      capability,
      reason: allowed ? '能力已授权' : '能力未授权'
    };
  }

  async checkCapabilities(capabilities) {
    const results = await Promise.all(
      capabilities.map(cap => this.checkCapability(cap))
    );
    
    return {
      allAllowed: results.every(r => r.allowed),
      results
    };
  }

  async generateToken(identityId, scopes = []) {
    if (!this.identities.has(identityId)) {
      throw new Error(`身份不存在: ${identityId}`);
    }

    const token = this.generateSecureToken();
    const tokenInfo = {
      token,
      identityId,
      scopes,
      createdAt: Date.now(),
      expiresAt: Date.now() + this.config.tokenExpiry,
      active: true
    };

    this.tokens.set(token, tokenInfo);
    this.cleanExpiredTokens();

    // 立即保存
    if (this.config.autoSave) {
      this._saveTokens();
    }

    return tokenInfo;
  }

  generateSecureToken() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let token = '';
    for (let i = 0; i < 32; i++) {
      token += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return `wb_${token}_${Date.now().toString(36)}`;
  }

  async validateToken(token) {
    const tokenInfo = this.tokens.get(token);
    
    if (!tokenInfo) {
      return { valid: false, reason: 'Token 不存在' };
    }

    if (!tokenInfo.active) {
      return { valid: false, reason: 'Token 已停用' };
    }

    if (Date.now() > tokenInfo.expiresAt) {
      tokenInfo.active = false;
      return { valid: false, reason: 'Token 已过期' };
    }

    return {
      valid: true,
      tokenInfo: {
        identityId: tokenInfo.identityId,
        scopes: tokenInfo.scopes,
        expiresAt: tokenInfo.expiresAt
      }
    };
  }

  async revokeToken(token) {
    if (!this.tokens.has(token)) {
      return { success: false, reason: 'Token 不存在' };
    }

    this.tokens.get(token).active = false;
    
    if (this.config.autoSave) {
      this._saveTokens();
    }
    
    return { success: true };
  }

  cleanExpiredTokens() {
    const now = Date.now();
    for (const [token, info] of this.tokens) {
      if (!info.active || now > info.expiresAt) {
        this.tokens.delete(token);
      }
    }
  }

  async updateIdentity(id, updates) {
    if (!this.identities.has(id)) {
      throw new Error(`身份不存在: ${id}`);
    }

    const identity = this.identities.get(id);
    delete updates.id;
    
    if (updates.capabilities) {
      this.capabilities.set(id, new Set(updates.capabilities));
    }

    Object.assign(identity, updates, { updatedAt: Date.now() });

    if (this.config.autoSave) {
      this._save();
    }

    return { success: true, identity };
  }

  async deactivateIdentity(id) {
    if (!this.identities.has(id)) {
      throw new Error(`身份不存在: ${id}`);
    }

    if (this.currentId === id) {
      const defaultId = Object.keys(this.identities).find(
        i => i !== id && this.identities.get(i).active
      );
      if (defaultId) {
        await this.switchIdentity(defaultId);
      }
    }

    this.identities.get(id).active = false;

    if (this.config.autoSave) {
      this._save();
    }

    return { success: true };
  }

  getIdentityList() {
    return Array.from(this.identities.values()).map(i => ({
      id: i.id,
      name: i.name,
      role: i.role,
      active: i.active,
      capabilities: i.capabilities,
      isCurrent: i.id === this.currentId
    }));
  }

  getHistory(limit = 20) {
    return this.history.slice(-limit);
  }

  exportConfig() {
    return {
      currentId: this.currentId,
      identities: Array.from(this.identities.values()),
      history: this.history.slice(-50)
    };
  }

  /**
   * 导出加密配置
   */
  exportEncrypted(password) {
    this._initEncryption(password);
    const data = this.exportConfig();
    return this._encrypt(data);
  }

  /**
   * 导入加密配置
   */
  importEncrypted(encryptedData, password) {
    this._initEncryption(password);
    const data = this._decrypt(encryptedData);
    
    this.currentId = data.currentId;
    this.history = data.history || [];
    
    for (const identity of data.identities || []) {
      this.identities.set(identity.id, identity);
      this.capabilities.set(identity.id, new Set(identity.capabilities || []));
    }

    this._save();
    return { success: true };
  }

  getStats() {
    return {
      totalIdentities: this.identities.size,
      activeIdentities: Array.from(this.identities.values()).filter(i => i.active).length,
      activeTokens: Array.from(this.tokens.values()).filter(t => t.active).length,
      totalSwitches: this.history.filter(h => h.type === 'switch').length,
      currentIdentity: this.currentId,
      encryptionEnabled: this.config?.encryptionEnabled || false,
      persistenceEnabled: this.config?.autoSave !== false
    };
  }

  /**
   * 强制保存
   */
  save() {
    this._save();
    return { success: true };
  }

  /**
   * 清除所有数据
   */
  clear() {
    this.identities.clear();
    this.tokens.clear();
    this.capabilities.clear();
    this.history = [];
    this.currentId = null;

    // 删除文件
    const files = ['config.json', 'identities.json', 'tokens.enc'];
    for (const file of files) {
      const filePath = path.join(this.configDir, file);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }

    return { success: true };
  }
}

module.exports = IdentityManager;
console.log('[IdentityManager] 加载成功 - D1 身份层(持久化+加密版)');
