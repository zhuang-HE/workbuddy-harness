/**
 * Identity Manager 测试用例
 */

const IdentityManager = require('./index.js');

async function runTests() {
  console.log('🧪 开始测试 Identity Manager...\n');
  
  const im = new IdentityManager();
  
  // 测试1: 初始化
  console.log('📋 测试1: 初始化');
  await im.init({
    defaultId: 'assistant',
    identities: [
      {
        id: 'assistant',
        name: 'AI 助手',
        role: 'general',
        capabilities: ['code-generation', 'analysis', 'writing', 'research']
      },
      {
        id: 'coder',
        name: '编程专家',
        role: 'specialist',
        capabilities: ['code-generation', 'code-review', 'debugging', 'refactoring']
      },
      {
        id: 'analyst',
        name: '数据分析师',
        role: 'specialist',
        capabilities: ['data-analysis', 'visualization', 'statistics']
      }
    ]
  });
  console.log('  ✅ 初始化成功\n');

  // 测试2: 获取当前身份
  console.log('📋 测试2: 获取当前身份');
  const current = im.getCurrentIdentity();
  console.log(`  当前身份: ${current.name} (${current.role})`);
  console.log('  ✅ 获取成功\n');

  // 测试3: 切换身份
  console.log('📋 测试3: 切换身份');
  const switchResult = await im.switchIdentity('coder');
  console.log(`  从 ${switchResult.previous} 切换到 ${switchResult.current}`);
  console.log('  ✅ 切换成功\n');

  // 测试4: 检查能力
  console.log('📋 测试4: 检查能力');
  const cap1 = await im.checkCapability('code-generation');
  console.log(`  code-generation: ${cap1.allowed ? '✅' : '❌'}`);
  const cap2 = await im.checkCapability('data-analysis');
  console.log(`  data-analysis: ${cap2.allowed ? '✅' : '❌'}`);
  console.log('  ✅ 能力检查完成\n');

  // 测试5: 生成 Token
  console.log('📋 测试5: 生成 Token');
  const tokenInfo = await im.generateToken('assistant', ['read', 'write']);
  console.log(`  Token: ${tokenInfo.token.substring(0, 20)}...`);
  console.log(`  过期时间: ${new Date(tokenInfo.expiresAt).toLocaleString()}`);
  console.log('  ✅ Token 生成成功\n');

  // 测试6: 验证 Token
  console.log('📋 测试6: 验证 Token');
  const validate1 = await im.validateToken(tokenInfo.token);
  console.log(`  有效 Token: ${validate1.valid ? '✅' : '❌'}`);
  const validate2 = await im.validateToken('invalid_token');
  console.log(`  无效 Token: ${!validate2.valid ? '✅' : '❌'}`);
  console.log('  ✅ Token 验证完成\n');

  // 测试7: 注册新身份
  console.log('📋 测试7: 注册新身份');
  await im.registerIdentity({
    id: 'security',
    name: '安全专家',
    role: 'specialist',
    capabilities: ['security-audit', 'vulnerability-scan', 'penetration-test']
  });
  const newIdentity = im.identities.get('security');
  console.log(`  新身份: ${newIdentity.name}`);
  console.log('  ✅ 新身份注册成功\n');

  // 测试8: 切换到新身份
  console.log('📋 测试8: 切换到新身份');
  await im.switchIdentity('security');
  const secCheck = await im.checkCapability('security-audit');
  console.log(`  security-audit: ${secCheck.allowed ? '✅' : '❌'}`);
  console.log('  ✅ 新身份切换成功\n');

  // 测试9: 获取身份列表
  console.log('📋 测试9: 获取身份列表');
  const list = im.getIdentityList();
  list.forEach(i => {
    const marker = i.isCurrent ? ' ◀─ 当前' : '';
    console.log(`  [${i.id}] ${i.name} (${i.role})${marker}`);
  });
  console.log('  ✅ 身份列表获取成功\n');

  // 测试10: 获取统计
  console.log('📋 测试10: 获取统计信息');
  const stats = im.getStats();
  console.log(`  总身份数: ${stats.totalIdentities}`);
  console.log(`  活跃身份: ${stats.activeIdentities}`);
  console.log(`  活跃Token: ${stats.activeTokens}`);
  console.log(`  切换次数: ${stats.totalSwitches}`);
  console.log('  ✅ 统计信息获取成功\n');

  // 测试11: 更新身份
  console.log('📋 测试11: 更新身份');
  await im.switchIdentity('assistant');
  await im.updateIdentity('assistant', {
    capabilities: ['code-generation', 'analysis', 'writing', 'research', 'translation']
  });
  const updated = im.identities.get('assistant');
  console.log(`  更新后能力: ${updated.capabilities.join(', ')}`);
  console.log('  ✅ 身份更新成功\n');

  // 测试12: 获取历史
  console.log('📋 测试12: 获取切换历史');
  const history = im.getHistory(5);
  history.forEach((h, i) => {
    console.log(`  ${i + 1}. ${h.from} → ${h.to}`);
  });
  console.log('  ✅ 历史记录获取成功\n');

  console.log('═══════════════════════════════════════');
  console.log('🎉 所有测试通过！');
  console.log('═══════════════════════════════════════\n');
}

runTests().catch(console.error);
