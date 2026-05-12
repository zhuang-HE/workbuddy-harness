/**
 * Identity Manager (D1 身份层)
 * WorkBuddy Agent 身份管理系统
 */

class IdentityManager {
  constructor() {
    this.identities = new Map();
    this.currentId = null;
    this.tokens = new Map();
    this.capabilities = new Map();
    this.config = null;
    this.history = [];
  }

  /**
   * 初始化身份管理器
   * @param {Object} config - 配置对象
   */
  async init(config = {}) {
    this.config = {
      defaultId: 'assistant',
      tokenExpiry: 3600000, // 1小时
      maxIdentities: 20,
      ...config
    };

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
   * @param {Object} identity - 身份配置
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

    // 缓存能力列表
    this.capabilities.set(identity.id, new Set(identity.capabilities || []));

    return identity.id;
  }

  /**
   * 验证身份配置
   */
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

  /**
   * 获取当前激活身份
   */
  getCurrentIdentity() {
    if (!this.currentId) return null;
    return this.identities.get(this.currentId) || null;
  }

  /**
   * 获取当前身份快照（用于日志）
   */
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

  /**
   * 切换身份
   * @param {string} id - 目标身份ID
   */
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

    // 记录切换历史
    this.history.push({
      type: 'switch',
      from: oldId,
      to: id,
      timestamp: Date.now()
    });

    // 限制历史记录长度
    if (this.history.length > 100) {
      this.history = this.history.slice(-100);
    }

    return {
      success: true,
      previous: oldId,
      current: id,
      identity: this.getCurrentIdentitySnapshot()
    };
  }

  /**
   * 检查当前身份是否具备某能力
   * @param {string} capability - 能力标识
   */
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

  /**
   * 检查批量能力
   */
  async checkCapabilities(capabilities) {
    const results = await Promise.all(
      capabilities.map(cap => this.checkCapability(cap))
    );
    
    return {
      allAllowed: results.every(r => r.allowed),
      results
    };
  }

  /**
   * 生成认证 Token
   * @param {string} identityId - 身份ID
   * @param {string[]} scopes - 权限范围
   */
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
    
    // 清理过期 Token
    this.cleanExpiredTokens();

    return tokenInfo;
  }

  /**
   * 生成安全 Token
   */
  generateSecureToken() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let token = '';
    for (let i = 0; i < 32; i++) {
      token += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return `wb_${token}_${Date.now().toString(36)}`;
  }

  /**
   * 验证 Token
   * @param {string} token - Token 字符串
   */
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

  /**
   * 撤销 Token
   */
  async revokeToken(token) {
    if (!this.tokens.has(token)) {
      return { success: false, reason: 'Token 不存在' };
    }

    this.tokens.get(token).active = false;
    return { success: true };
  }

  /**
   * 清理过期 Token
   */
  cleanExpiredTokens() {
    const now = Date.now();
    for (const [token, info] of this.tokens) {
      if (!info.active || now > info.expiresAt) {
        this.tokens.delete(token);
      }
    }
  }

  /**
   * 更新身份信息
   * @param {string} id - 身份ID
   * @param {Object} updates - 更新内容
   */
  async updateIdentity(id, updates) {
    if (!this.identities.has(id)) {
      throw new Error(`身份不存在: ${id}`);
    }

    const identity = this.identities.get(id);
    
    // 不允许更新 id
    delete updates.id;
    
    // 更新能力缓存
    if (updates.capabilities) {
      this.capabilities.set(id, new Set(updates.capabilities));
    }

    Object.assign(identity, updates, { updatedAt: Date.now() });

    return { success: true, identity };
  }

  /**
   * 停用身份
   */
  async deactivateIdentity(id) {
    if (!this.identities.has(id)) {
      throw new Error(`身份不存在: ${id}`);
    }

    // 如果停用当前身份，切换到默认
    if (this.currentId === id) {
      const defaultId = Object.keys(this.identities).find(
        i => i !== id && this.identities.get(i).active
      );
      if (defaultId) {
        await this.switchIdentity(defaultId);
      }
    }

    this.identities.get(id).active = false;
    return { success: true };
  }

  /**
   * 获取身份列表
   */
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

  /**
   * 获取切换历史
   */
  getHistory(limit = 20) {
    return this.history.slice(-limit);
  }

  /**
   * 导出配置
   */
  exportConfig() {
    return {
      currentId: this.currentId,
      identities: Array.from(this.identities.values()),
      history: this.history.slice(-50)
    };
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      totalIdentities: this.identities.size,
      activeIdentities: Array.from(this.identities.values()).filter(i => i.active).length,
      activeTokens: Array.from(this.tokens.values()).filter(t => t.active).length,
      totalSwitches: this.history.filter(h => h.type === 'switch').length,
      currentIdentity: this.currentId
    };
  }
}

module.exports = IdentityManager;
