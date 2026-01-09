// worker.js - 整合 Telegram Bot 和诈骗数据库管理界面

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // 从 env 参数获取环境变量
    const TOKEN = env.BOT_TOKEN || '';
    const SECRET = env.BOT_SECRET || '';
    const ADMIN_UID = env.ADMIN_UID || '';
    const WEBHOOK = '/endpoint';
    const ADMIN_PASSWORD = env.ADMIN_PASSWORD || 'admin123'; // 管理界面密码
    
    console.log('=== 收到请求 ===');
    console.log('路径:', url.pathname);
    
    // 处理不同路径
    if (url.pathname === WEBHOOK) {
      return await handleWebhook(request, { 
        TOKEN, 
        SECRET, 
        ADMIN_UID, 
        DB: env.DB,
        ADMIN_PASSWORD // 添加这个到配置中
      });
    } else if (url.pathname === '/registerWebhook') {
      return await registerWebhook(request, url, WEBHOOK, { TOKEN, SECRET });
    } else if (url.pathname === '/health') {
      return new Response('OK', { status: 200 });
    } else if (url.pathname === '/init-db') {
      return await initDatabaseRoute(env.DB);
    } else if (url.pathname === '/test-delete') {
      return await testDeleteFunctions(env.DB);
    } else if (url.pathname === '/db-stats') {
      return await getDatabaseStats(env.DB);
    } else if (url.pathname === '/force-delete-user') {
      const params = new URLSearchParams(url.search);
      const userId = params.get('user_id');
      if (userId && env.DB) {
        return await forceDeleteUser(userId, env.DB);
      }
      return new Response('需要 user_id 参数', { status: 400 });
    } else if (url.pathname === '/admin') {
      return await handleAdminRequest(request, env.DB, ADMIN_PASSWORD);
    } else if (url.pathname === '/admin-api/fraud-users') {
      return await handleFraudUsersAPI(request, env.DB, ADMIN_PASSWORD);
    } else if (url.pathname === '/admin-api/add-user') {
      return await handleAddUserAPI(request, env.DB, ADMIN_PASSWORD);
    } else if (url.pathname === '/admin-api/add-users-batch') {
      return await handleAddUsersBatchAPI(request, env.DB, ADMIN_PASSWORD);
    } else if (url.pathname === '/admin-api/delete-user') {
      return await handleDeleteUserAPI(request, env.DB, ADMIN_PASSWORD);
    } else if (url.pathname === '/admin-api/toggle-block') {
      return await handleToggleBlockAPI(request, env.DB, ADMIN_PASSWORD);
    } else if (url.pathname === '/admin-api/cleanup') {
      return await handleCleanupAPI(request, env.DB, ADMIN_PASSWORD);
    } else if (url.pathname === '/admin-api/export-ids') {
      return await handleExportIdsAPI(request, env.DB, ADMIN_PASSWORD);
    } else if (url.pathname === '/cleanup') {
      // 公开清理接口（需密码验证）
      const params = new URLSearchParams(url.search);
      const password = params.get('password');
      if (password === ADMIN_PASSWORD) {
        return await cleanupDatabase(env.DB);
      }
      return new Response('未授权', { status: 401 });
    } else {
      return new Response('Telegram Bot 运行中', { 
        status: 200,
        headers: { 'Content-Type': 'text/plain' }
      });
    }
  }
};

/******************** Telegram Bot 功能 ********************/

/**
 * Handle requests to WEBHOOK
 */
async function handleWebhook(request, config) {
  console.log('=== 处理 Webhook ===');
  
  // Check secret
  const secretToken = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
  console.log('收到的密钥:', secretToken ? '有' : '无');
  
  if (secretToken !== config.SECRET) {
    console.log('密钥不匹配!');
    return new Response('Unauthorized', { status: 403 });
  }

  try {
    // Read request body
    const update = await request.json();
    console.log('收到的更新类型:', Object.keys(update)[0]);
    
    // 在处理消息前，随机清理旧消息（1%概率）
    if (config.DB && Math.random() < 0.01) {
      console.log('触发随机清理机制');
      await cleanupOldMessages(config.DB);
    }
    
    // Process update
    await onUpdate(update, config);
    
    return new Response('Ok');
  } catch (error) {
    console.error('处理 Webhook 错误:', error);
    return new Response('Bad Request', { status: 400 });
  }
}

/**
 * Handle incoming Update
 */
async function onUpdate(update, config) {
  console.log('=== 处理更新 ===');
  
  if ('message' in update) {
    console.log('处理消息更新');
    await onMessage(update.message, config);
  } else {
    console.log('更新中无消息，类型:', Object.keys(update));
  }
}

/**
 * Handle incoming Message
 */
async function onMessage(message, config) {
  console.log('=== 处理消息 ===');
  console.log('消息来自:', message.from?.username || message.from?.id, '文本:', message.text?.substring(0, 50));
  
  // 检查是否是管理员
  const isAdmin = message.chat.id.toString() === config.ADMIN_UID;
  
  if (message.text === '/start') {
    console.log('处理 /start 命令');
    return await sendMessage({
      chat_id: message.chat.id,
      text: '🎉欢迎使用本小秘🎉\n\n1.戒除贪婪，勿信"天上掉馅饼"\n2.信息保密，勿泄个人家人密\n3.提高警惕，勿信不明证件物\n4.及时沟通，勿让骗子钻空子\n5.消息通畅，勿使联络有盲区\n',
      parse_mode: 'Markdown'
    }, config.TOKEN);
  }
  
  // 管理员消息处理
  if (isAdmin) {
    console.log('这是管理员消息');
    
    if (message.text === '/admin') {
      console.log('处理 /admin 命令');
      // 注意：我们无法直接获取主机名，所以使用一个默认值
      // 在实际部署中，可以通过环境变量或配置获取
      const hostname = 'your-domain.com'; // 需要替换为实际域名
      const adminUrl = `https://${hostname}/admin`;
      return await sendMessage({
        chat_id: message.chat.id,
        text: `管理界面: ${adminUrl}\n密码: ${config.ADMIN_PASSWORD || 'admin123'}`
      }, config.TOKEN);
    }
    
    if (message.text === '/cleanup') {
      console.log('处理 /cleanup 命令');
      return await handleCleanupCommand(message, config);
    }
    
    if (!message?.reply_to_message) {
      console.log('管理员消息没有回复');
      return await sendMessage({
        chat_id: config.ADMIN_UID,
        text: '请回复转发的消息来回复用户，或使用命令：\n/block - 屏蔽用户\n/unblock - 解除屏蔽\n/checkblock - 检查屏蔽状态\n/admin - 获取管理界面链接\n/cleanup - 清理旧数据'
      }, config.TOKEN);
    }
    
    console.log('管理员正在回复消息ID:', message.reply_to_message.message_id);
    
    // 处理命令
    if (/^\/block$/.exec(message.text)) {
      console.log('处理 /block 命令');
      return handleBlock(message, config);
    }
    
    if (/^\/unblock$/.exec(message.text)) {
      console.log('处理 /unblock 命令');
      return handleUnBlock(message, config);
    }
    
    if (/^\/checkblock$/.exec(message.text)) {
      console.log('处理 /checkblock 命令');
      return checkBlock(message, config);
    }
    
    // 管理员回复消息给用户（回声功能）
    console.log('管理员正在发送回复给用户');
    
    // 获取被回复的转发消息的ID
    const repliedMessageId = message.reply_to_message.message_id;
    console.log('查找回复的消息ID对应的聊天ID:', repliedMessageId);
    
    // 从数据库获取用户的chat_id
    let guestChatId = await getMsgMap(repliedMessageId, config.DB);
    console.log('找到的用户聊天ID:', guestChatId);
    
    if (!guestChatId) {
      console.log('数据库中未找到对应的用户聊天ID');
      return await sendMessage({
        chat_id: config.ADMIN_UID,
        text: '错误：找不到对应的用户。'
      }, config.TOKEN);
    }
    
    console.log('发送消息给用户:', guestChatId);
    
    // 发送消息给用户
    const result = await sendMessage({
      chat_id: guestChatId,
      text: message.text || '（管理员发送了一条消息）'
    }, config.TOKEN);
    
    console.log('发送消息结果:', result.ok ? '成功' : '失败');
    
    return result;
  }
  
  // 普通用户消息处理
  console.log('这是用户消息，用户ID:', message.chat.id);
  return handleGuestMessage(message, config);
}

// 清理命令处理
async function handleCleanupCommand(message, config) {
  console.log('=== 处理清理命令 ===');
  
  if (!config.DB) {
    return await sendMessage({
      chat_id: config.ADMIN_UID,
      text: '❌ 数据库未连接，无法清理'
    }, config.TOKEN);
  }
  
  // 发送清理开始消息
  await sendMessage({
    chat_id: config.ADMIN_UID,
    text: '🧹 开始清理旧数据...'
  }, config.TOKEN);
  
  try {
    // 执行清理
    const cleanupResults = await cleanupOldMessages(config.DB);
    
    // 获取清理后的数据库统计
    const stats = await getDatabaseStatsForCleanup(config.DB);
    
    // 发送清理结果
    const resultText = '✅ 清理完成！\n\n' +
                      '📊 清理结果：\n' +
                      '• 删除的消息记录：' + (cleanupResults?.msg_deleted || 0) + ' 条\n' +
                      '• 当前消息总数：' + (stats.msg_map_count || 0) + ' 条\n' +
                      '• 欺诈用户数：' + (stats.fraud_users_count || 0) + ' 人\n' +
                      '• 屏蔽用户数：' + (stats.blocked_users_count || 0) + ' 人\n\n' +
                      '下次清理将在消息处理时自动触发。';
    
    return await sendMessage({
      chat_id: config.ADMIN_UID,
      text: resultText
    }, config.TOKEN);
    
  } catch (error) {
    console.error('清理命令处理错误:', error);
    return await sendMessage({
      chat_id: config.ADMIN_UID,
      text: '❌ 清理过程中出错：' + error.message
    }, config.TOKEN);
  }
}

async function handleGuestMessage(message, config) {
  let chatId = message.chat.id;
  console.log('处理用户消息，用户ID:', chatId);
  
  // 检查是否被屏蔽
  let isblocked = false;
  if (config.DB) {
    isblocked = await getIsBlocked(chatId, config.DB);
  }
  console.log('用户是否被屏蔽?', isblocked);
  
  if (isblocked) {
    console.log('用户被屏蔽，不转发');
    return await sendMessage({
      chat_id: chatId,
      text: '善惡終有報，天道好輪迴。不信抬頭看，蒼天饒過誰。'
    }, config.TOKEN);
  }

  console.log('转发消息给管理员');
  
  // 转发消息给管理员
  let forwardReq = await forwardMessage({
    chat_id: config.ADMIN_UID,
    from_chat_id: message.chat.id,
    message_id: message.message_id
  }, config.TOKEN);
  
  console.log('转发请求结果:', forwardReq.ok ? '成功' : '失败');
  
  if (forwardReq.ok) {
    const forwardedMessageId = forwardReq.result.message_id;
    console.log('转发的消息ID:', forwardedMessageId, '-> 用户ID:', chatId);
    
    // 保存消息映射到数据库
    if (config.DB) {
      console.log('保存消息映射到数据库');
      await setMsgMap(forwardedMessageId, chatId, config.DB);
    }
  }
  
  return forwardReq;
}

async function handleBlock(message, config) {
  console.log('=== 处理屏蔽 ===');
  const repliedMessageId = message.reply_to_message.message_id;
  console.log('回复的消息ID:', repliedMessageId);
  
  let guestChatId = await getMsgMap(repliedMessageId, config.DB);
  console.log('找到的用户ID:', guestChatId);
  
  if (!guestChatId) {
    return await sendMessage({
      chat_id: config.ADMIN_UID,
      text: '错误：找不到对应的用户。'
    }, config.TOKEN);
  }
  
  if (guestChatId === config.ADMIN_UID) {
    return await sendMessage({
      chat_id: config.ADMIN_UID,
      text: '不能屏蔽自己'
    }, config.TOKEN);
  }
  
  // 屏蔽用户
  let resultText = '';
  if (config.DB) {
    // 1. 在blocked_users表中设置屏蔽状态
    const blockResult = await setIsBlocked(guestChatId, true, config.DB);
    console.log('设置屏蔽状态结果:', blockResult);
    
    // 2. 添加到欺诈数据库
    const fraudResult = await addToFraudDb(guestChatId, config.DB);
    console.log('添加到欺诈数据库结果:', fraudResult);
    
    // 检查数据库操作结果
    resultText = '✅ 用户 ' + guestChatId + ' 已屏蔽\n';
    if (blockResult) resultText += '📝 屏蔽状态: 设置成功\n';
    if (fraudResult) resultText += '📋 已添加到欺诈数据库';
  } else {
    resultText = '✅ 用户 ' + guestChatId + ' 已屏蔽（无数据库连接）';
  }

  return await sendMessage({
    chat_id: config.ADMIN_UID,
    text: resultText
  }, config.TOKEN);
}

async function handleUnBlock(message, config) {
  console.log('=== 处理解除屏蔽 ===');
  const repliedMessageId = message.reply_to_message.message_id;
  console.log('回复的消息ID:', repliedMessageId);
  
  let guestChatId = await getMsgMap(repliedMessageId, config.DB);
  console.log('找到的用户ID:', guestChatId);

  if (!guestChatId) {
    return await sendMessage({
      chat_id: config.ADMIN_UID,
      text: '错误：找不到对应的用户。'
    }, config.TOKEN);
  }

  console.log('开始完全解除屏蔽用户 ' + guestChatId);
  
  // 解除屏蔽 - 完全删除所有相关数据
  let resultText = '';
  let operations = [];
  
  if (config.DB) {
    try {
      console.log('=== 开始完全删除用户数据 ===');
      
      // 1. 完全删除屏蔽记录（不是设置false，而是完全删除）
      console.log('1. 完全删除屏蔽记录');
      const deleteBlockResult = await deleteBlockedUser(guestChatId, config.DB);
      operations.push('屏蔽记录: ' + (deleteBlockResult ? '✅ 完全删除' : '❌ 删除失败'));
      console.log('屏蔽记录删除结果: ' + deleteBlockResult);
      
      // 2. 完全删除欺诈数据库记录
      console.log('2. 完全删除欺诈数据库记录');
      const deleteFraudResult = await deleteFromFraudDb(guestChatId, config.DB);
      operations.push('欺诈数据库: ' + (deleteFraudResult ? '✅ 完全删除' : '❌ 删除失败'));
      console.log('欺诈数据库删除结果: ' + deleteFraudResult);
      
      // 3. 验证删除结果
      console.log('3. 验证删除结果');
      const stillInBlockedDb = await checkInBlockedDb(guestChatId, config.DB);
      const stillInFraudDb = await checkInFraudDb(guestChatId, config.DB);
      
      console.log('验证结果 - 仍在屏蔽表: ' + stillInBlockedDb + ', 仍在欺诈表: ' + stillInFraudDb);
      
      if (stillInBlockedDb || stillInFraudDb) {
        console.log('警告: 用户数据未完全删除，尝试使用事务强制删除');
        
        // 使用事务强制删除
        const forceDeleteResult = await forceDeleteAllUserData(guestChatId, config.DB);
        operations.push('强制删除: ' + (forceDeleteResult ? '✅ 成功' : '❌ 失败'));
        
        // 再次验证
        const verifyAfterForce = await checkInBlockedDb(guestChatId, config.DB);
        const verifyAfterForceFraud = await checkInFraudDb(guestChatId, config.DB);
        console.log('强制删除后验证 - 仍在屏蔽表: ' + verifyAfterForce + ', 仍在欺诈表: ' + verifyAfterForceFraud);
      }
      
      // 最终验证
      const finalInBlocked = await checkInBlockedDb(guestChatId, config.DB);
      const finalInFraud = await checkInFraudDb(guestChatId, config.DB);
      
      operations.push('最终验证: ' + (!finalInBlocked && !finalInFraud ? '✅ 验证通过' : '❌ 验证失败'));
      
      if (!finalInBlocked && !finalInFraud) {
        resultText = '✅ 用户 ' + guestChatId + ' 已完全解除屏蔽\n数据已从所有相关表中删除\n' + operations.join('\n');
      } else {
        resultText = '⚠️ 用户 ' + guestChatId + ' 解除屏蔽部分完成\n仍有数据未完全删除\n' + operations.join('\n');
      }
      
    } catch (error) {
      console.error('解除屏蔽过程中出错:', error);
      resultText = '❌ 解除屏蔽过程中出错: ' + error.message;
    }
  } else {
    resultText = '✅ 用户 ' + guestChatId + ' 已解除屏蔽（无数据库连接）';
  }

  return await sendMessage({
    chat_id: config.ADMIN_UID,
    text: resultText
  }, config.TOKEN);
}

async function checkBlock(message, config) {
  console.log('=== 检查屏蔽状态 ===');
  const repliedMessageId = message.reply_to_message.message_id;
  let guestChatId = await getMsgMap(repliedMessageId, config.DB);
  
  if (!guestChatId) {
    return await sendMessage({
      chat_id: config.ADMIN_UID,
      text: '错误：找不到对应的用户。'
    }, config.TOKEN);
  }
  
  let inBlockedDb = false;
  let inFraudDb = false;
  let isBlocked = false;
  
  if (config.DB) {
    inBlockedDb = await checkInBlockedDb(guestChatId, config.DB);
    inFraudDb = await checkInFraudDb(guestChatId, config.DB);
    
    if (inBlockedDb) {
      isBlocked = await getIsBlocked(guestChatId, config.DB);
    }
  }

  return await sendMessage({
    chat_id: config.ADMIN_UID,
    text: '👤 用户 ' + guestChatId + '\n' +
          '📋 屏蔽表存在: ' + (inBlockedDb ? '是' : '否') + '\n' +
          '📊 屏蔽状态: ' + (isBlocked ? '🔴 已被屏蔽' : '🟢 未被屏蔽') + '\n' +
          '🚫 欺诈数据库: ' + (inFraudDb ? '存在' : '不存在')
  }, config.TOKEN);
}

/******************** 自动清理机制 ********************/

/**
 * 清理旧消息记录
 * @param {object} DB - 数据库实例
 * @returns {object} 清理结果
 */
async function cleanupOldMessages(DB) {
  try {
    console.log('=== 开始自动清理旧消息 ===');
    if (!DB) {
      console.log('数据库未连接，跳过清理');
      return null;
    }
    
    // 设置清理阈值：30天前
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    console.log('清理阈值：' + new Date(thirtyDaysAgo).toLocaleString('zh-CN'));
    
    // 1. 先统计清理前的数据量
    const beforeCount = await DB.prepare(
      'SELECT COUNT(*) as count FROM msg_map'
    ).first();
    
    console.log('清理前消息总数：' + (beforeCount?.count || 0) + ' 条');
    
    // 2. 删除30天前的消息记录
    const deleteResult = await DB.prepare(
      'DELETE FROM msg_map WHERE created_at < ?'
    ).bind(thirtyDaysAgo).run();
    
    const deletedCount = deleteResult?.meta?.rows_written || 0;
    console.log('删除了 ' + deletedCount + ' 条旧消息记录');
    
    // 3. 如果有大量数据被删除，也清理无效的屏蔽记录
    if (deletedCount > 100) {
      console.log('删除数量较多，同时清理无效屏蔽记录');
      
      // 清理已解除屏蔽但记录未删除的数据
      const cleanupBlockedResult = await DB.prepare(
        'DELETE FROM blocked_users WHERE is_blocked = 0 AND updated_at < ?'
      ).bind(Date.now() - (7 * 24 * 60 * 60 * 1000)).run();
      
      console.log('清理了 ' + (cleanupBlockedResult?.meta?.rows_written || 0) + ' 条无效屏蔽记录');
    }
    
    // 4. 执行数据库优化（VACUUM）
    try {
      await DB.prepare('VACUUM').run();
      console.log('数据库优化完成');
    } catch (vacuumError) {
      console.log('数据库优化跳过（某些环境下不可用）');
    }
    
    // 5. 获取清理后的统计
    const afterCount = await DB.prepare(
      'SELECT COUNT(*) as count FROM msg_map'
    ).first();
    
    console.log('清理后消息总数：' + (afterCount?.count || 0) + ' 条');
    console.log('=== 自动清理完成 ===');
    
    return {
      msg_deleted: deletedCount,
      before_count: beforeCount?.count || 0,
      after_count: afterCount?.count || 0,
      cleanup_time: new Date().toISOString()
    };
    
  } catch (error) {
    console.error('清理旧消息错误:', error);
    return {
      error: error.message,
      msg_deleted: 0
    };
  }
}

/**
 * 清理数据库端点
 */
async function cleanupDatabase(DB) {
  try {
    console.log('=== 执行手动数据库清理 ===');
    
    if (!DB) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: '数据库未连接' 
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // 执行清理
    const cleanupResults = await cleanupOldMessages(DB);
    
    // 获取数据库统计
    const stats = await getDatabaseStatsForCleanup(DB);
    
    const response = {
      success: true,
      cleanup_results: cleanupResults,
      database_stats: stats,
      message: '数据库清理完成。删除了 ' + (cleanupResults?.msg_deleted || 0) + ' 条旧消息记录。'
    };
    
    return new Response(JSON.stringify(response, null, 2), {
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
    
  } catch (error) {
    console.error('清理数据库错误:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: error.message 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

/**
 * 获取清理用的数据库统计
 */
async function getDatabaseStatsForCleanup(DB) {
  try {
    if (!DB) return {};
    
    // 获取今日新增
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayTimestamp = Math.floor(todayStart.getTime());
    
    const todayAddedResult = await DB.prepare(
      'SELECT COUNT(*) as count FROM fraud_users WHERE created_at >= ?'
    ).bind(todayTimestamp).first();
    
    // 获取消息记录的时间范围
    const msgAgeStats = await DB.prepare(
      'SELECT MIN(created_at) as oldest, MAX(created_at) as newest, COUNT(*) as total FROM msg_map'
    ).first();
    
    // 格式化时间
    const formatDate = (timestamp) => {
      if (!timestamp) return '无数据';
      return new Date(timestamp).toLocaleString('zh-CN');
    };
    
    return {
      fraud_users_count: await DB.prepare('SELECT COUNT(*) as count FROM fraud_users').first().then(r => r.count || 0),
      blocked_users_count: await DB.prepare('SELECT COUNT(*) as count FROM blocked_users WHERE is_blocked = 1').first().then(r => r.count || 0),
      blocked_users_total: await DB.prepare('SELECT COUNT(*) as count FROM blocked_users').first().then(r => r.count || 0),
      msg_map_count: msgAgeStats?.total || 0,
      today_added: todayAddedResult ? todayAddedResult.count : 0,
      msg_oldest: formatDate(msgAgeStats?.oldest),
      msg_newest: formatDate(msgAgeStats?.newest),
      cleanup_recommended: msgAgeStats?.oldest ? 
        (Date.now() - msgAgeStats.oldest > 30 * 24 * 60 * 60 * 1000) : false
    };
  } catch (error) {
    console.error('获取清理统计错误:', error);
    return {};
  }
}

/******************** D1 数据库操作函数 ********************/

// 完全删除屏蔽用户记录
async function deleteBlockedUser(chatId, DB) {
  try {
    console.log('数据库操作: 完全删除屏蔽用户记录 ' + chatId);
    if (!DB) return false;
    
    const existing = await DB.prepare(
      'SELECT chat_id FROM blocked_users WHERE chat_id = ?'
    ).bind(chatId).first();
    
    if (!existing) {
      console.log('用户 ' + chatId + ' 不在屏蔽表中');
      return true;
    }
    
    const result = await DB.prepare(
      'DELETE FROM blocked_users WHERE chat_id = ?'
    ).bind(chatId).run();
    
    console.log('屏蔽记录删除结果:', {
      成功: result.success,
      删除行数: result.meta.rows_written
    });
    
    const verify = await DB.prepare(
      'SELECT chat_id FROM blocked_users WHERE chat_id = ?'
    ).bind(chatId).first();
    
    return !verify;
    
  } catch (error) {
    console.error('删除屏蔽用户记录错误:', error);
    return false;
  }
}

// 完全删除欺诈数据库记录
async function deleteFromFraudDb(id, DB) {
  try {
    console.log('数据库操作: 完全删除欺诈数据库记录 ' + id);
    if (!DB) return false;
    
    id = id.toString();
    
    const existing = await DB.prepare(
      'SELECT user_id FROM fraud_users WHERE user_id = ?'
    ).bind(id).first();
    
    if (!existing) {
      console.log('用户 ' + id + ' 不在欺诈数据库中');
      return true;
    }
    
    const result = await DB.prepare(
      'DELETE FROM fraud_users WHERE user_id = ?'
    ).bind(id).run();
    
    console.log('欺诈数据库删除结果:', {
      成功: result.success,
      删除行数: result.meta.rows_written
    });
    
    const verify = await DB.prepare(
      'SELECT user_id FROM fraud_users WHERE user_id = ?'
    ).bind(id).first();
    
    return !verify;
    
  } catch (error) {
    console.error('删除欺诈数据库记录错误:', error);
    return false;
  }
}

// 强制删除所有用户数据
async function forceDeleteAllUserData(userId, DB) {
  try {
    console.log('数据库操作: 强制删除所有用户数据 ' + userId);
    if (!DB) return false;
    
    userId = userId.toString();
    
    const statements = [
      DB.prepare('DELETE FROM blocked_users WHERE chat_id = ?').bind(userId),
      DB.prepare('DELETE FROM fraud_users WHERE user_id = ?').bind(userId)
    ];
    
    const result = await DB.batch(statements);
    console.log('批量删除结果:', result);
    
    const verifyBlocked = await DB.prepare(
      'SELECT chat_id FROM blocked_users WHERE chat_id = ?'
    ).bind(userId).first();
    
    const verifyFraud = await DB.prepare(
      'SELECT user_id FROM fraud_users WHERE user_id = ?'
    ).bind(userId).first();
    
    return !verifyBlocked && !verifyFraud;
    
  } catch (error) {
    console.error('强制删除所有用户数据错误:', error);
    return false;
  }
}

// 检查是否在屏蔽表中
async function checkInBlockedDb(chatId, DB) {
  try {
    if (!DB) return false;
    
    const result = await DB.prepare(
      'SELECT chat_id FROM blocked_users WHERE chat_id = ?'
    ).bind(chatId).first();
    
    return !!result;
  } catch (error) {
    console.error('检查屏蔽表错误:', error);
    return false;
  }
}

// 检查是否在欺诈数据库中
async function checkInFraudDb(id, DB) {
  try {
    if (!DB) return false;
    id = id.toString();
    
    const result = await DB.prepare(
      'SELECT user_id FROM fraud_users WHERE user_id = ?'
    ).bind(id).first();
    
    return !!result;
  } catch (error) {
    console.error('检查欺诈数据库错误:', error);
    return false;
  }
}

// 设置屏蔽状态
async function setIsBlocked(chatId, isBlocked, DB) {
  try {
    console.log('数据库操作: 设置屏蔽状态 ' + chatId + ' = ' + isBlocked);
    if (!DB) return false;
    
    if (isBlocked) {
      const result = await DB.prepare(
        'INSERT OR REPLACE INTO blocked_users (chat_id, is_blocked, updated_at) VALUES (?, ?, ?)'
      ).bind(chatId, 1, Date.now()).run();
      
      return result.success;
    } else {
      return await deleteBlockedUser(chatId, DB);
    }
  } catch (error) {
    console.error('设置屏蔽状态错误:', error);
    return false;
  }
}

// 获取屏蔽状态
async function getIsBlocked(chatId, DB) {
  try {
    if (!DB) return false;
    
    const result = await DB.prepare(
      'SELECT is_blocked FROM blocked_users WHERE chat_id = ?'
    ).bind(chatId).first();
    
    return result ? result.is_blocked === 1 : false;
  } catch (error) {
    console.error('获取屏蔽状态错误:', error);
    return false;
  }
}

// 添加到欺诈数据库
async function addToFraudDb(id, DB) {
  try {
    if (!DB) return false;
    id = id.toString();
    
    const existing = await DB.prepare(
      'SELECT id FROM fraud_users WHERE user_id = ?'
    ).bind(id).first();
    
    if (!existing) {
      await DB.prepare(
        'INSERT INTO fraud_users (user_id, created_at) VALUES (?, ?)'
      ).bind(id, Date.now()).run();
      return true;
    }
    return false;
  } catch (error) {
    console.error('添加到欺诈数据库错误:', error);
    return false;
  }
}

// 批量添加用户到欺诈数据库
async function addUsersToFraudDb(userIds, DB) {
  try {
    if (!DB) return { success: 0, failed: userIds.length, details: [] };
    
    const results = [];
    let successCount = 0;
    let failedCount = 0;
    
    for (const userId of userIds) {
      const id = userId.toString().trim();
      if (!id) continue;
      
      try {
        const existing = await DB.prepare(
          'SELECT id FROM fraud_users WHERE user_id = ?'
        ).bind(id).first();
        
        if (!existing) {
          await DB.prepare(
            'INSERT INTO fraud_users (user_id, created_at) VALUES (?, ?)'
          ).bind(id, Date.now()).run();
          
          // 同时屏蔽用户
          await setIsBlocked(id, true, DB);
          
          results.push({ user_id: id, status: 'success', message: '添加成功并屏蔽' });
          successCount++;
        } else {
          // 用户已存在，确保屏蔽状态
          await setIsBlocked(id, true, DB);
          results.push({ user_id: id, status: 'exists', message: '用户已存在，已确保屏蔽状态' });
          successCount++;
        }
      } catch (error) {
        results.push({ user_id: id, status: 'failed', message: error.message });
        failedCount++;
      }
    }
    
    return {
      total: userIds.length,
      success: successCount,
      failed: failedCount,
      details: results
    };
  } catch (error) {
    console.error('批量添加到欺诈数据库错误:', error);
    return { success: 0, failed: userIds.length, details: [], error: error.message };
  }
}

// 获取所有用户ID（用于导出）
async function getAllUserIds(DB) {
  try {
    if (!DB) return [];
    
    const result = await DB.prepare(
      'SELECT user_id FROM fraud_users ORDER BY created_at DESC'
    ).all();
    
    return result.results.map(row => row.user_id);
  } catch (error) {
    console.error('获取用户ID列表错误:', error);
    return [];
  }
}

// 新函数：获取所有欺诈用户
async function getAllFraudUsers(DB, page = 1, limit = 100) {
  try {
    if (!DB) return { users: [], total: 0 };
    
    const offset = (page - 1) * limit;
    
    // 获取用户列表
    const usersResult = await DB.prepare(
      `SELECT f.user_id, f.created_at, b.is_blocked 
       FROM fraud_users f
       LEFT JOIN blocked_users b ON f.user_id = b.chat_id
       ORDER BY f.created_at DESC
       LIMIT ? OFFSET ?`
    ).bind(limit, offset).all();
    
    // 获取总数
    const countResult = await DB.prepare(
      'SELECT COUNT(*) as total FROM fraud_users'
    ).first();
    
    return {
      users: usersResult.results.map(user => ({
        user_id: user.user_id,
        created_at: user.created_at,
        is_blocked: user.is_blocked === 1,
        formatted_date: formatTimestamp(user.created_at)
      })),
      total: countResult ? countResult.total : 0
    };
  } catch (error) {
    console.error('获取欺诈用户列表错误:', error);
    return { users: [], total: 0 };
  }
}

// 新函数：格式化时间戳
function formatTimestamp(timestamp) {
  if (!timestamp) return '未知';
  const date = new Date(timestamp);
  return date.toLocaleString('zh-CN');
}

// 获取消息映射
async function getMsgMap(messageId, DB) {
  try {
    if (!DB) return null;
    const result = await DB.prepare(
      'SELECT chat_id FROM msg_map WHERE message_id = ?'
    ).bind(messageId).first();
    return result ? result.chat_id : null;
  } catch (error) {
    console.error('获取消息映射错误:', error);
    return null;
  }
}

// 设置消息映射
async function setMsgMap(messageId, chatId, DB) {
  try {
    if (!DB) return false;
    await DB.prepare(
      'INSERT OR REPLACE INTO msg_map (message_id, chat_id) VALUES (?, ?)'
    ).bind(messageId, chatId).run();
    return true;
  } catch (error) {
    console.error('保存消息映射错误:', error);
    return false;
  }
}

/******************** 数据库管理和调试函数 ********************/

async function initDatabase(DB) {
  try {
    console.log('初始化数据库...');
    if (!DB) return false;
    
    await DB.prepare(`
      CREATE TABLE IF NOT EXISTS msg_map (
        message_id INTEGER PRIMARY KEY,
        chat_id TEXT NOT NULL,
        created_at INTEGER DEFAULT (unixepoch())
      )
    `).run();
    
    await DB.prepare(`
      CREATE TABLE IF NOT EXISTS blocked_users (
        chat_id TEXT PRIMARY KEY,
        is_blocked INTEGER DEFAULT 0,
        updated_at INTEGER DEFAULT (unixepoch())
      )
    `).run();
    
    await DB.prepare(`
      CREATE TABLE IF NOT EXISTS fraud_users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT UNIQUE NOT NULL,
        created_at INTEGER DEFAULT (unixepoch())
      )
    `).run();
    
    console.log('数据库表初始化成功');
    return true;
  } catch (error) {
    console.error('初始化数据库错误:', error);
    return false;
  }
}

async function getDatabaseStats(DB) {
  try {
    if (!DB) {
      return new Response('数据库未连接', { status: 500 });
    }
    
    // 获取今日新增
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayTimestamp = Math.floor(todayStart.getTime());
    
    const todayAddedResult = await DB.prepare(
      'SELECT COUNT(*) as count FROM fraud_users WHERE created_at >= ?'
    ).bind(todayTimestamp).first();
    
    // 获取消息记录的时间范围
    const msgAgeStats = await DB.prepare(
      'SELECT MIN(created_at) as oldest, MAX(created_at) as newest, COUNT(*) as total FROM msg_map'
    ).first();
    
    const stats = {
      fraud_users_count: await DB.prepare('SELECT COUNT(*) as count FROM fraud_users').first().then(r => r.count),
      blocked_users_count: await DB.prepare('SELECT COUNT(*) as count FROM blocked_users WHERE is_blocked = 1').first().then(r => r.count),
      blocked_users_total: await DB.prepare('SELECT COUNT(*) as count FROM blocked_users').first().then(r => r.count),
      msg_map_count: msgAgeStats?.total || 0,
      today_added: todayAddedResult ? todayAddedResult.count : 0,
      msg_oldest: msgAgeStats?.oldest ? new Date(msgAgeStats.oldest).toLocaleString('zh-CN') : '无数据',
      msg_newest: msgAgeStats?.newest ? new Date(msgAgeStats.newest).toLocaleString('zh-CN') : '无数据',
      recent_blocked_users: await DB.prepare('SELECT chat_id, is_blocked, datetime(updated_at, "unixepoch") as updated_at FROM blocked_users ORDER BY updated_at DESC LIMIT 10').all().then(r => r.results),
      recent_fraud_users: await DB.prepare('SELECT user_id, datetime(created_at, "unixepoch") as created_at FROM fraud_users ORDER BY created_at DESC LIMIT 10').all().then(r => r.results),
      last_cleanup_recommended: msgAgeStats?.oldest ? 
        (Date.now() - msgAgeStats.oldest > 30 * 24 * 60 * 60 * 1000) : false
    };
    
    return new Response(JSON.stringify(stats, null, 2), {
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (error) {
    return new Response('获取数据库统计错误: ' + error.message, { status: 500 });
  }
}

// 测试删除功能
async function testDeleteFunctions(DB) {
  try {
    if (!DB) {
      return new Response('数据库未连接', { status: 500 });
    }
    
    const testUserId = 'test_' + Date.now();
    
    await DB.prepare('INSERT OR IGNORE INTO blocked_users (chat_id, is_blocked, updated_at) VALUES (?, ?, ?)')
      .bind(testUserId, 1, Date.now()).run();
    
    await DB.prepare('INSERT OR IGNORE INTO fraud_users (user_id, created_at) VALUES (?, ?)')
      .bind(testUserId, Date.now()).run();
    
    const deleteBlocked = await deleteBlockedUser(testUserId, DB);
    const deleteFraud = await deleteFromFraudDb(testUserId, DB);
    
    const verifyBlocked = await checkInBlockedDb(testUserId, DB);
    const verifyFraud = await checkInFraudDb(testUserId, DB);
    
    const response = {
      test_user_id: testUserId,
      delete_functions: {
        deleteBlockedUser: deleteBlocked,
        deleteFromFraudDb: deleteFraud
      },
      verification: {
        still_in_blocked_db: verifyBlocked,
        still_in_fraud_db: verifyFraud,
        all_deleted: !verifyBlocked && !verifyFraud
      }
    };
    
    return new Response(JSON.stringify(response, null, 2), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response('测试删除功能错误: ' + error.message, { status: 500 });
  }
}

// 强制删除用户端点
async function forceDeleteUser(userId, DB) {
  try {
    if (!DB) {
      return new Response('数据库未连接', { status: 500 });
    }
    
    console.log('手动强制删除用户 ' + userId);
    
    const results = {
      delete_blocked: await deleteBlockedUser(userId, DB),
      delete_fraud: await deleteFromFraudDb(userId, DB),
      force_delete_all: await forceDeleteAllUserData(userId, DB)
    };
    
    const finalCheck = {
      in_blocked_db: await checkInBlockedDb(userId, DB),
      in_fraud_db: await checkInFraudDb(userId, DB)
    };
    
    const response = {
      message: '用户 ' + userId + ' 强制删除完成',
      operations: results,
      final_status: finalCheck,
      completely_deleted: !finalCheck.in_blocked_db && !finalCheck.in_fraud_db
    };
    
    return new Response(JSON.stringify(response, null, 2), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response('强制删除用户错误: ' + error.message, { status: 500 });
  }
}

async function initDatabaseRoute(DB) {
  try {
    const success = await initDatabase(DB);
    return new Response(success ? '数据库初始化成功' : '数据库初始化失败', {
      status: success ? 200 : 500
    });
  } catch (error) {
    return new Response('初始化数据库错误: ' + error.message, { status: 500 });
  }
}

/******************** 管理界面相关函数 ********************/

// 处理管理界面请求
async function handleAdminRequest(request, DB, password) {
  const url = new URL(request.url);
  const auth = request.headers.get('Authorization');
  
  // 检查密码（简单验证）
  if (auth !== 'Bearer ' + password && url.searchParams.get('password') !== password) {
    // 返回登录页面
    return new Response(getLoginPage(), {
      headers: { 'Content-Type': 'text/html' }
    });
  }
  
  // 返回管理界面
  return new Response(getAdminPage(), {
    headers: { 'Content-Type': 'text/html' }
  });
}

// 处理欺诈用户API - 修改为一次性返回所有数据
async function handleFraudUsersAPI(request, DB, password) {
  // 验证密码
  if (!await verifyAdminAuth(request, password)) {
    return new Response(JSON.stringify({ error: '未授权' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  const url = new URL(request.url);
  const search = url.searchParams.get('search') || '';
  // 移除分页参数，一次性获取所有数据
  const limit = 10000; // 设置为一个很大的数字，实际获取所有数据
  const page = 1;
  
  try {
    if (!DB) {
      return new Response(JSON.stringify({ error: '数据库未连接' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    let query = 'SELECT f.user_id, f.created_at, b.is_blocked FROM fraud_users f LEFT JOIN blocked_users b ON f.user_id = b.chat_id';
    let countQuery = 'SELECT COUNT(*) as total FROM fraud_users f';
    
    if (search) {
      query += " WHERE f.user_id LIKE '%" + search + "%'";
      countQuery += " WHERE f.user_id LIKE '%" + search + "%'";
    }
    
    query += ' ORDER BY f.created_at DESC LIMIT ?';
    
    const usersResult = await DB.prepare(query).bind(limit).all();
    const countResult = await DB.prepare(countQuery).first();
    
    const response = {
      success: true,
      page,
      limit,
      total: countResult ? countResult.total : 0,
      users: usersResult.results.map(user => ({
        user_id: user.user_id,
        created_at: user.created_at,
        is_blocked: user.is_blocked === 1,
        formatted_date: formatTimestamp(user.created_at),
        time_ago: getTimeAgoText(user.created_at)
      }))
    };
    
    return new Response(JSON.stringify(response, null, 2), {
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
    
  } catch (error) {
    console.error('获取欺诈用户列表错误:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// 处理添加用户API
async function handleAddUserAPI(request, DB, password) {
  // 验证密码
  if (!await verifyAdminAuth(request, password)) {
    return new Response(JSON.stringify({ error: '未授权' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  try {
    const data = await request.json();
    const { user_id, reason } = data;
    
    if (!user_id) {
      return new Response(JSON.stringify({ error: '需要用户ID' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    if (!DB) {
      return new Response(JSON.stringify({ error: '数据库未连接' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // 添加到欺诈数据库
    const fraudResult = await addToFraudDb(user_id, DB);
    
    // 屏蔽用户
    const blockResult = await setIsBlocked(user_id, true, DB);
    
    const response = {
      success: fraudResult && blockResult,
      user_id,
      added_to_fraud: fraudResult,
      blocked: blockResult,
      message: fraudResult && blockResult ? 
        '用户已成功添加到欺诈数据库并屏蔽' : 
        '操作部分成功'
    };
    
    return new Response(JSON.stringify(response, null, 2), {
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
    
  } catch (error) {
    console.error('添加用户错误:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// 处理批量添加用户API
async function handleAddUsersBatchAPI(request, DB, password) {
  // 验证密码
  if (!await verifyAdminAuth(request, password)) {
    return new Response(JSON.stringify({ error: '未授权' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  try {
    const data = await request.json();
    const { user_ids, reason } = data;
    
    if (!user_ids || !Array.isArray(user_ids) || user_ids.length === 0) {
      return new Response(JSON.stringify({ error: '需要用户ID数组' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    if (!DB) {
      return new Response(JSON.stringify({ error: '数据库未连接' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // 批量添加用户
    const result = await addUsersToFraudDb(user_ids, DB);
    
    const response = {
      success: result.success > 0,
      total: result.total,
      success_count: result.success,
      failed_count: result.failed,
      details: result.details,
      message: '批量添加完成。成功: ' + result.success + ' 个，失败: ' + result.failed + ' 个'
    };
    
    return new Response(JSON.stringify(response, null, 2), {
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
    
  } catch (error) {
    console.error('批量添加用户错误:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// 处理导出ID API
async function handleExportIdsAPI(request, DB, password) {
  // 验证密码
  if (!await verifyAdminAuth(request, password)) {
    return new Response(JSON.stringify({ error: '未授权' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  try {
    if (!DB) {
      return new Response(JSON.stringify({ error: '数据库未连接' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // 获取所有用户ID
    const userIds = await getAllUserIds(DB);
    
    // 生成纯ID列表，每行一个
    const idList = userIds.join('\n');
    
    // 创建文件名，包含当前日期
    const fileName = 'fraud_user_ids_' + new Date().toISOString().slice(0, 10) + '.txt';
    
    return new Response(idList, {
      headers: {
        'Content-Type': 'text/plain',
        'Content-Disposition': 'attachment; filename="' + fileName + '"',
        'Access-Control-Allow-Origin': '*'
      }
    });
    
  } catch (error) {
    console.error('导出ID错误:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// 处理删除用户API
async function handleDeleteUserAPI(request, DB, password) {
  // 验证密码
  if (!await verifyAdminAuth(request, password)) {
    return new Response(JSON.stringify({ error: '未授权' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  try {
    const data = await request.json();
    const { user_id } = data;
    
    if (!user_id) {
      return new Response(JSON.stringify({ error: '需要用户ID' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    if (!DB) {
      return new Response(JSON.stringify({ error: '数据库未连接' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // 删除用户数据
    const deleteBlocked = await deleteBlockedUser(user_id, DB);
    const deleteFraud = await deleteFromFraudDb(user_id, DB);
    
    // 验证删除
    const stillInBlocked = await checkInBlockedDb(user_id, DB);
    const stillInFraud = await checkInFraudDb(user_id, DB);
    
    const response = {
      success: deleteBlocked && deleteFraud,
      user_id,
      delete_blocked: deleteBlocked,
      delete_fraud: deleteFraud,
      completely_deleted: !stillInBlocked && !stillInFraud,
      message: deleteBlocked && deleteFraud ? 
        '用户已从所有数据库中删除' : 
        '删除操作部分成功'
    };
    
    return new Response(JSON.stringify(response, null, 2), {
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
    
  } catch (error) {
    console.error('删除用户错误:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// 处理切换屏蔽状态API
async function handleToggleBlockAPI(request, DB, password) {
  // 验证密码
  if (!await verifyAdminAuth(request, password)) {
    return new Response(JSON.stringify({ error: '未授权' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  try {
    const data = await request.json();
    const { user_id, block } = data;
    
    if (!user_id || typeof block !== 'boolean') {
      return new Response(JSON.stringify({ error: '需要用户ID和block参数' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    if (!DB) {
      return new Response(JSON.stringify({ error: '数据库未连接' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // 切换屏蔽状态
    const result = await setIsBlocked(user_id, block, DB);
    
    const response = {
      success: result,
      user_id,
      blocked: block,
      message: result ? 
        '用户已' + (block ? '屏蔽' : '解除屏蔽') : 
        '操作失败'
    };
    
    return new Response(JSON.stringify(response, null, 2), {
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
    
  } catch (error) {
    console.error('切换屏蔽状态错误:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// 处理清理API
async function handleCleanupAPI(request, DB, password) {
  // 验证密码
  if (!await verifyAdminAuth(request, password)) {
    return new Response(JSON.stringify({ error: '未授权' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  try {
    const data = await request.json();
    const { cleanup_type = 'messages', days = 30 } = data;
    
    if (!DB) {
      return new Response(JSON.stringify({ error: '数据库未连接' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    const threshold = Date.now() - (days * 24 * 60 * 60 * 1000);
    let cleanupResult = null;
    
    if (cleanup_type === 'messages') {
      // 清理旧消息记录
      cleanupResult = await DB.prepare(
        'DELETE FROM msg_map WHERE created_at < ?'
      ).bind(threshold).run();
    } else if (cleanup_type === 'unblocked_users') {
      // 清理已解除屏蔽的用户记录
      cleanupResult = await DB.prepare(
        'DELETE FROM blocked_users WHERE is_blocked = 0 AND updated_at < ?'
      ).bind(threshold).run();
    } else if (cleanup_type === 'all') {
      // 清理所有旧数据
      const msgResult = await DB.prepare(
        'DELETE FROM msg_map WHERE created_at < ?'
      ).bind(threshold).run();
      
      const blockedResult = await DB.prepare(
        'DELETE FROM blocked_users WHERE is_blocked = 0 AND updated_at < ?'
      ).bind(threshold).run();
      
      cleanupResult = {
        msg_deleted: msgResult?.meta?.rows_written || 0,
        blocked_deleted: blockedResult?.meta?.rows_written || 0,
        total_deleted: (msgResult?.meta?.rows_written || 0) + (blockedResult?.meta?.rows_written || 0)
      };
    }
    
    const response = {
      success: true,
      cleanup_type,
      days_threshold: days,
      rows_deleted: cleanupResult?.meta?.rows_written || cleanupResult?.total_deleted || 0,
      details: cleanupResult,
      message: '成功清理了 ' + (cleanupResult?.meta?.rows_written || cleanupResult?.total_deleted || 0) + ' 条旧数据'
    };
    
    return new Response(JSON.stringify(response, null, 2), {
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
    
  } catch (error) {
    console.error('清理API错误:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// 验证管理员身份
async function verifyAdminAuth(request, password) {
  try {
    const auth = request.headers.get('Authorization');
    if (auth && auth.startsWith('Bearer ')) {
      const token = auth.substring(7);
      return token === password;
    }
    
    // 也支持URL参数
    const url = new URL(request.url);
    const urlPassword = url.searchParams.get('password');
    return urlPassword === password;
  } catch (error) {
    return false;
  }
}

// 获取时间差文本
function getTimeAgoText(timestamp) {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / (1000 * 60));
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  
  if (days > 0) return days + ' 天前';
  if (hours > 0) return hours + ' 小时前';
  if (minutes > 0) return minutes + ' 分钟前';
  return '刚刚';
}

/******************** Telegram API 函数 ********************/

function apiUrl(methodName, token, params = null) {
  let query = '';
  if (params) {
    query = '?' + new URLSearchParams(params).toString();
  }
  return 'https://api.telegram.org/bot' + token + '/' + methodName + query;
}

async function requestTelegram(methodName, token, body, params = null) {
  try {
    const response = await fetch(apiUrl(methodName, token, params), body);
    return response.json();
  } catch (error) {
    console.error('Telegram API 错误:', error);
    return { ok: false, error: error.message };
  }
}

function makeReqBody(body) {
  return {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify(body)
  };
}

async function sendMessage(msg, token) {
  return requestTelegram('sendMessage', token, makeReqBody(msg));
}

async function forwardMessage(msg, token) {
  return requestTelegram('forwardMessage', token, makeReqBody(msg));
}

/******************** Webhook 管理函数 ********************/

async function registerWebhook(request, url, webhookPath, config) {
  const webhookUrl = url.protocol + '//' + url.hostname + webhookPath;
  console.log('注册 Webhook: ' + webhookUrl);
  
  const response = await fetch(apiUrl('setWebhook', config.TOKEN, { 
    url: webhookUrl, 
    secret_token: config.SECRET 
  }));
  const r = await response.json();
  
  return new Response(JSON.stringify(r, null, 2), {
    headers: { 'Content-Type': 'application/json' }
  });
}

/******************** HTML 页面生成函数 ********************/

function getLoginPage() {
  return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>诈骗数据库管理 - 登录</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <style>
        body {
            background-color: #f5f5f5;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
        }
        .login-card {
            width: 100%;
            max-width: 400px;
            padding: 30px;
            border-radius: 10px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.1);
            background-color: white;
        }
        .login-header {
            text-align: center;
            margin-bottom: 30px;
        }
        .login-header i {
            font-size: 3rem;
            color: #dc3545;
            margin-bottom: 15px;
        }
    </style>
</head>
<body>
    <div class="login-card">
        <div class="login-header">
            <i class="bi bi-shield-exclamation"></i>
            <h2>诈骗数据库管理</h2>
            <p class="text-muted">请输入密码以继续</p>
        </div>
        <form id="loginForm">
            <div class="mb-3">
                <label for="password" class="form-label">密码</label>
                <input type="password" class="form-control" id="password" required>
            </div>
            <div class="d-grid">
                <button type="submit" class="btn btn-primary">
                    <i class="bi bi-box-arrow-in-right"></i> 登录
                </button>
            </div>
        </form>
        <div class="alert alert-warning mt-3" role="alert">
            <i class="bi bi-exclamation-triangle"></i>
            这是一个受保护的管理界面。请确保您有访问权限。
        </div>
    </div>
    
    <script>
        document.getElementById('loginForm').addEventListener('submit', function(e) {
            e.preventDefault();
            const password = document.getElementById('password').value;
            if (password) {
                // 将密码添加到URL参数中
                window.location.href = '/admin?password=' + encodeURIComponent(password);
            }
        });
        
        // 检查URL中是否已经有密码
        const urlParams = new URLSearchParams(window.location.search);
        const passwordParam = urlParams.get('password');
        if (passwordParam) {
            document.getElementById('password').value = passwordParam;
            document.getElementById('loginForm').submit();
        }
    </script>
</body>
</html>
  `;
}

function getAdminPage() {
  return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>诈骗数据库管理</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.10.0/font/bootstrap-icons.css">
    <style>
        :root {
            --primary-color: #dc3545;
            --secondary-color: #6c757d;
            --success-color: #198754;
            --light-bg: #f8f9fa;
            --dark-bg: #343a40;
        }
        
        body {
            background-color: #f5f5f5;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            padding-top: 20px;
        }
        
        .navbar {
            box-shadow: 0 2px 4px rgba(0,0,0,.1);
        }
        
        .card {
            border-radius: 10px;
            box-shadow: 0 4px 6px rgba(0,0,0,.05);
            border: none;
            margin-bottom: 20px;
        }
        
        .card-header {
            border-radius: 10px 10px 0 0 !important;
            font-weight: 600;
            background-color: #f8f9fa;
            border-bottom: 1px solid rgba(0,0,0,.125);
        }
        
        .table th {
            font-weight: 600;
            border-top: none;
            background-color: #f8f9fa;
        }
        
        .table-responsive {
            border-radius: 8px;
            overflow: hidden;
        }
        
        .badge {
            font-weight: 500;
            padding: 5px 10px;
        }
        
        .status-badge {
            display: inline-block;
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 0.85rem;
        }
        
        .btn-action {
            margin: 2px;
            padding: 5px 12px;
            font-size: 0.875rem;
        }
        
        .alert {
            border-radius: 8px;
            border: none;
        }
        
        .loading {
            text-align: center;
            padding: 40px 20px;
        }
        
        .loading-spinner {
            width: 3rem;
            height: 3rem;
        }
        
        .search-box {
            position: relative;
        }
        
        .search-box .form-control {
            padding-left: 40px;
        }
        
        .search-box i {
            position: absolute;
            left: 15px;
            top: 12px;
            color: #6c757d;
        }
        
        .empty-state {
            text-align: center;
            padding: 40px 20px;
            color: #6c757d;
        }
        
        .empty-state i {
            font-size: 3rem;
            margin-bottom: 15px;
            opacity: 0.5;
        }
        
        .user-id-cell {
            font-family: 'Courier New', monospace;
            font-weight: 500;
        }
        
        .modal-header {
            background-color: var(--light-bg);
        }
        
        .timestamp {
            font-size: 0.85rem;
            color: #6c757d;
        }
        
        .action-buttons {
            white-space: nowrap;
        }
        
        .pagination-container {
            display: flex;
            justify-content: center;
            margin-top: 20px;
        }
        
        .stat-card {
            transition: transform 0.3s ease;
        }
        
        .stat-card:hover {
            transform: translateY(-5px);
        }
        
        .export-buttons {
            display: flex;
            gap: 5px;
            flex-wrap: wrap;
        }
        
        .tab-content {
            padding: 20px 0;
        }
        
        .tab-pane {
            min-height: 200px;
        }
        
        .preview-area {
            max-height: 300px;
            overflow-y: auto;
            border: 1px solid #dee2e6;
            border-radius: 5px;
            padding: 15px;
            background-color: #f8f9fa;
            font-family: monospace;
            font-size: 0.9rem;
        }
        
        @media (max-width: 768px) {
            .btn-action {
                display: block;
                width: 100%;
                margin-bottom: 5px;
            }
            
            .action-buttons {
                white-space: normal;
            }
            
            .export-buttons {
                flex-direction: column;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <!-- 标题和操作栏 -->
        <div class="row mb-4">
            <div class="col-md-12">
                <div class="d-flex justify-content-between align-items-center mb-3">
                    <h1 class="mb-0">
                        <i class="bi bi-shield-exclamation text-danger"></i> 诈骗数据库管理
                    </h1>
                    <div class="export-buttons">
                        <button class="btn btn-outline-secondary" onclick="refreshData()">
                            <i class="bi bi-arrow-clockwise"></i> 刷新
                        </button>
                        <button class="btn btn-warning" onclick="cleanupDatabase()">
                            <i class="bi bi-trash"></i> 清理
                        </button>
                        <button class="btn btn-success" onclick="exportUserIds()">
                            <i class="bi bi-download"></i> 导出ID列表
                        </button>
                        <button class="btn btn-primary" data-bs-toggle="modal" data-bs-target="#addUserModal">
                            <i class="bi bi-person-plus"></i> 添加用户
                        </button>
                    </div>
                </div>
                <p class="text-muted">管理被标记为诈骗的用户列表，支持批量添加、搜索和导出ID</p>
            </div>
        </div>

        <!-- 统计卡片 -->
        <div class="row mb-4" id="stats-container">
            <div class="col-md-3">
                <div class="card bg-primary text-white stat-card">
                    <div class="card-body">
                        <div class="d-flex justify-content-between align-items-center">
                            <div>
                                <h6 class="card-subtitle mb-2">欺诈用户总数</h6>
                                <h2 class="card-title mb-0" id="total-fraud-users">0</h2>
                            </div>
                            <i class="bi bi-person-x" style="font-size: 2.5rem; opacity: 0.8;"></i>
                        </div>
                        <div class="mt-2">
                            <small><i class="bi bi-clock"></i> 最后更新: <span id="last-updated">刚刚</span></small>
                        </div>
                    </div>
                </div>
            </div>
            <div class="col-md-3">
                <div class="card bg-warning text-dark stat-card">
                    <div class="card-body">
                        <div class="d-flex justify-content-between align-items-center">
                            <div>
                                <h6 class="card-subtitle mb-2">今日新增</h6>
                                <h2 class="card-title mb-0" id="today-added">0</h2>
                            </div>
                            <i class="bi bi-calendar-plus" style="font-size: 2.5rem; opacity: 0.8;"></i>
                        </div>
                        <div class="mt-2">
                            <small><i class="bi bi-calendar"></i> 今日日期: <span id="today-date">-</span></small>
                        </div>
                    </div>
                </div>
            </div>
            <div class="col-md-3">
                <div class="card bg-success text-white stat-card">
                    <div class="card-body">
                        <div class="d-flex justify-content-between align-items-center">
                            <div>
                                <h6 class="card-subtitle mb-2">已屏蔽用户</h6>
                                <h2 class="card-title mb-0" id="blocked-users">0</h2>
                            </div>
                            <i class="bi bi-shield-check" style="font-size: 2.5rem; opacity: 0.8;"></i>
                        </div>
                        <div class="mt-2">
                            <small><i class="bi bi-check-circle"></i> 屏蔽状态正常</small>
                        </div>
                    </div>
                </div>
            </div>
            <div class="col-md-3">
                <div class="card bg-info text-white stat-card">
                    <div class="card-body">
                        <div class="d-flex justify-content-between align-items-center">
                            <div>
                                <h6 class="card-subtitle mb-2">消息记录</h6>
                                <h2 class="card-title mb-0" id="msg-map-count">0</h2>
                            </div>
                            <i class="bi bi-chat-left-text" style="font-size: 2.5rem; opacity: 0.8;"></i>
                        </div>
                        <div class="mt-2">
                            <small><i class="bi bi-clock-history"></i> 保留30天</small>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- 数据库状态提醒 -->
        <div class="row mb-4" id="cleanup-alert" style="display: none;">
            <div class="col-md-12">
                <div class="alert alert-warning d-flex justify-content-between align-items-center">
                    <div>
                        <i class="bi bi-exclamation-triangle me-2"></i>
                        <span id="cleanup-alert-text">数据库中有旧数据需要清理</span>
                    </div>
                    <button class="btn btn-sm btn-warning" onclick="cleanupDatabase()">
                        <i class="bi bi-trash"></i> 立即清理
                    </button>
                </div>
            </div>
        </div>

        <!-- 搜索和筛选 -->
        <div class="row mb-4">
            <div class="col-md-8">
                <div class="search-box">
                    <i class="bi bi-search"></i>
                    <input type="text" class="form-control" id="search-input" 
                           placeholder="搜索用户ID... 输入关键字进行筛选（前端实时筛选）" 
                           onkeyup="filterUsers()">
                </div>
            </div>
            <div class="col-md-4">
                <div class="input-group">
                    <span class="input-group-text"><i class="bi bi-filter"></i></span>
                    <select class="form-select" id="sort-select" onchange="sortUsers()">
                        <option value="newest">最新添加</option>
                        <option value="oldest">最早添加</option>
                        <option value="id_asc">ID升序</option>
                        <option value="id_desc">ID降序</option>
                    </select>
                </div>
            </div>
        </div>

        <!-- 用户列表 -->
        <div class="row">
            <div class="col-md-12">
                <div class="card">
                    <div class="card-header d-flex justify-content-between align-items-center">
                        <span><i class="bi bi-list-ul"></i> 欺诈用户列表</span>
                        <div>
                            <span class="badge bg-secondary me-2" id="list-count">0 个用户</span>
                            <span class="badge bg-light text-dark me-2" id="filtered-count">0 个可见</span>
                            <div class="btn-group btn-group-sm">
                                <button class="btn btn-outline-secondary" onclick="setItemsPerPage(10)">
                                    每页10条
                                </button>
                                <button class="btn btn-outline-secondary" onclick="setItemsPerPage(25)">
                                    每页25条
                                </button>
                                <button class="btn btn-outline-secondary" onclick="setItemsPerPage(50)">
                                    每页50条
                                </button>
                                <button class="btn btn-outline-secondary" onclick="setItemsPerPage(0)" title="显示所有数据（可能会影响性能）">
                                    显示全部
                                </button>
                            </div>
                        </div>
                    </div>
                    <div class="card-body p-0">
                        <!-- 加载动画 -->
                        <div class="loading" id="loading">
                            <div class="spinner-border text-primary loading-spinner" role="status">
                                <span class="visually-hidden">加载中...</span>
                            </div>
                            <p class="mt-3">正在加载数据...</p>
                        </div>
                        
                        <!-- 空状态 -->
                        <div class="empty-state" id="empty-state" style="display: none;">
                            <i class="bi bi-person-x"></i>
                            <h5>暂无欺诈用户记录</h5>
                            <p class="text-muted">还没有用户被标记为诈骗，或者搜索结果为空</p>
                            <button class="btn btn-primary" data-bs-toggle="modal" data-bs-target="#addUserModal">
                                <i class="bi bi-person-plus"></i> 添加第一个用户
                            </button>
                        </div>
                        
                        <!-- 表格 -->
                        <div class="table-responsive" id="table-container" style="display: none;">
                            <table class="table table-hover mb-0">
                                <thead>
                                    <tr>
                                        <th width="5%">#</th>
                                        <th width="20%">用户ID</th>
                                        <th width="25%">添加时间</th>
                                        <th width="20%">状态</th>
                                        <th width="30%">操作</th>
                                    </tr>
                                </thead>
                                <tbody id="user-table-body">
                                    <!-- 数据将通过JavaScript动态加载 -->
                                </tbody>
                            </table>
                        </div>
                    </div>
                    <!-- 分页 -->
                    <div class="card-footer">
                        <div class="d-flex justify-content-between align-items-center">
                            <div>
                                <span id="page-info">第 1 页，共 1 页，每页 10 条</span>
                            </div>
                            <div>
                                <nav>
                                    <ul class="pagination mb-0" id="pagination">
                                        <!-- 分页将通过JavaScript动态生成 -->
                                    </ul>
                                </nav>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- 系统信息 -->
        <div class="row mt-4">
            <div class="col-md-12">
                <div class="card">
                    <div class="card-header">
                        <i class="bi bi-info-circle"></i> 系统信息
                    </div>
                    <div class="card-body">
                        <div class="row">
                            <div class="col-md-6">
                                <p><strong>数据库连接:</strong> <span id="db-status" class="badge bg-success">正常</span></p>
                                <p><strong>消息保留时间:</strong> <span id="msg-retention">30 天</span></p>
                                <p><strong>自动清理:</strong> <span id="auto-cleanup">启用 (1%概率触发)</span></p>
                            </div>
                            <div class="col-md-6">
                                <p><strong>当前时间:</strong> <span id="current-time">-</span></p>
                                <p><strong>最早消息:</strong> <span id="oldest-msg">-</span></p>
                                <p><strong>最新消息:</strong> <span id="newest-msg">-</span></p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <!-- 添加用户模态框 -->
    <div class="modal fade" id="addUserModal" tabindex="-1" aria-labelledby="addUserModalLabel" aria-hidden="true">
        <div class="modal-dialog modal-lg">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title" id="addUserModalLabel">
                        <i class="bi bi-person-plus"></i> 添加欺诈用户
                    </h5>
                    <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                </div>
                <div class="modal-body">
                    <ul class="nav nav-tabs" id="addUserTabs" role="tablist">
                        <li class="nav-item" role="presentation">
                            <button class="nav-link active" id="single-tab" data-bs-toggle="tab" data-bs-target="#single-tab-pane" type="button" role="tab">
                                <i class="bi bi-person-fill"></i> 单个添加
                            </button>
                        </li>
                        <li class="nav-item" role="presentation">
                            <button class="nav-link" id="batch-tab" data-bs-toggle="tab" data-bs-target="#batch-tab-pane" type="button" role="tab">
                                <i class="bi bi-people-fill"></i> 批量添加
                            </button>
                        </li>
                    </ul>
                    
                    <div class="tab-content" id="addUserTabsContent">
                        <!-- 单个添加标签页 -->
                        <div class="tab-pane fade show active" id="single-tab-pane" role="tabpanel">
                            <div class="mt-3">
                                <div class="mb-3">
                                    <label for="user-id-input" class="form-label">用户ID</label>
                                    <input type="text" class="form-control" id="user-id-input" 
                                           placeholder="输入要标记为欺诈的用户ID" required>
                                    <div class="form-text">用户ID必须是有效的数字或字符串</div>
                                </div>
                                <div class="mb-3">
                                    <label for="reason-input" class="form-label">原因（可选）</label>
                                    <textarea class="form-control" id="reason-input" rows="3" 
                                              placeholder="输入标记该用户为欺诈的原因..."></textarea>
                                </div>
                                <div class="alert alert-warning">
                                    <i class="bi bi-exclamation-triangle"></i>
                                    <strong>警告:</strong> 添加用户到欺诈数据库后，该用户将被自动屏蔽并无法发送消息。
                                </div>
                            </div>
                        </div>
                        
                        <!-- 批量添加标签页 -->
                        <div class="tab-pane fade" id="batch-tab-pane" role="tabpanel">
                            <div class="mt-3">
                                <div class="mb-3">
                                    <label for="batch-user-ids" class="form-label">用户ID列表（每行一个）</label>
                                    <textarea class="form-control" id="batch-user-ids" rows="10" 
                                              placeholder="请输入要添加的用户ID，每行一个：
123456789
987654321
111222333"></textarea>
                                    <div class="form-text">每行输入一个用户ID，支持数字和字符串格式</div>
                                </div>
                                <div class="mb-3">
                                    <label for="batch-reason" class="form-label">批量添加原因（可选）</label>
                                    <input type="text" class="form-control" id="batch-reason" 
                                           placeholder="输入批量添加这些用户的原因...">
                                </div>
                                <div class="alert alert-info">
                                    <i class="bi bi-info-circle"></i>
                                    <strong>批量操作说明:</strong> 
                                    <ul class="mb-0 mt-2">
                                        <li>每行一个用户ID，支持数字和字符串</li>
                                        <li>会自动去重和过滤空行</li>
                                        <li>已存在的用户会被更新屏蔽状态</li>
                                        <li>新用户会被添加到数据库并屏蔽</li>
                                    </ul>
                                </div>
                                <div id="batch-preview" class="mt-3" style="display: none;">
                                    <h6>预览（共 <span id="preview-count">0</span> 个用户）:</h6>
                                    <div class="preview-area" id="preview-content">
                                        <!-- 预览内容将通过JavaScript动态生成 -->
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">取消</button>
                    <button type="button" class="btn btn-primary" onclick="addUser()" id="add-single-btn">
                        <i class="bi bi-save"></i> 确认添加
                    </button>
                    <button type="button" class="btn btn-success" onclick="addUsersBatch()" id="add-batch-btn" style="display: none;">
                        <i class="bi bi-save"></i> 批量添加
                    </button>
                </div>
            </div>
        </div>
    </div>

    <!-- 清理确认模态框 -->
    <div class="modal fade" id="cleanupConfirmModal" tabindex="-1" aria-labelledby="cleanupConfirmModalLabel" aria-hidden="true">
        <div class="modal-dialog">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title text-warning" id="cleanupConfirmModalLabel">
                        <i class="bi bi-exclamation-triangle"></i> 确认清理
                    </h5>
                    <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                </div>
                <div class="modal-body">
                    <p>您确定要清理旧数据吗？</p>
                    <div class="alert alert-info">
                        <i class="bi bi-info-circle"></i>
                        <strong>清理内容:</strong>
                        <ul class="mb-0 mt-2">
                            <li>删除30天前的消息记录</li>
                            <li>清理已解除屏蔽的用户记录</li>
                            <li>优化数据库性能</li>
                        </ul>
                    </div>
                    <p class="text-warning">此操作可能会删除大量数据，请确认！</p>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">取消</button>
                    <button type="button" class="btn btn-warning" id="confirm-cleanup-btn">
                        <i class="bi bi-trash"></i> 确认清理
                    </button>
                </div>
            </div>
        </div>
    </div>

    <!-- 删除确认模态框 -->
    <div class="modal fade" id="deleteConfirmModal" tabindex="-1" aria-labelledby="deleteConfirmModalLabel" aria-hidden="true">
        <div class="modal-dialog">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title text-danger" id="deleteConfirmModalLabel">
                        <i class="bi bi-exclamation-triangle"></i> 确认删除
                    </h5>
                    <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                </div>
                <div class="modal-body">
                    <p>您确定要删除用户 <strong id="delete-user-id">-</strong> 吗？</p>
                    <p class="text-danger">此操作将:</p>
                    <ul class="text-danger">
                        <li>从欺诈数据库中移除该用户</li>
                        <li>从屏蔽列表中移除该用户</li>
                        <li>该用户将能够再次发送消息</li>
                    </ul>
                    <p>此操作不可撤销！</p>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">取消</button>
                    <button type="button" class="btn btn-danger" id="confirm-delete-btn">
                        <i class="bi bi-trash"></i> 确认删除
                    </button>
                </div>
            </div>
        </div>
    </div>

    <!-- 批量添加结果模态框 -->
    <div class="modal fade" id="batchResultModal" tabindex="-1" aria-labelledby="batchResultModalLabel" aria-hidden="true">
        <div class="modal-dialog modal-lg">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title" id="batchResultModalLabel">
                        <i class="bi bi-clipboard-check"></i> 批量添加结果
                    </h5>
                    <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                </div>
                <div class="modal-body">
                    <div id="batch-result-summary"></div>
                    <div class="mt-3">
                        <h6>详细结果:</h6>
                        <div class="preview-area" id="batch-result-details">
                            <!-- 结果详情将通过JavaScript动态生成 -->
                        </div>
                    </div>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-primary" data-bs-dismiss="modal">关闭</button>
                </div>
            </div>
        </div>
    </div>

    <!-- 成功提示 -->
    <div class="toast-container position-fixed top-0 end-0 p-3">
        <div id="successToast" class="toast" role="alert" aria-live="assertive" aria-atomic="true">
            <div class="toast-header bg-success text-white">
                <i class="bi bi-check-circle me-2"></i>
                <strong class="me-auto">操作成功</strong>
                <button type="button" class="btn-close btn-close-white" data-bs-dismiss="toast" aria-label="Close"></button>
            </div>
            <div class="toast-body" id="success-message">
                操作已成功完成
            </div>
        </div>
    </div>

    <!-- 错误提示 -->
    <div class="toast-container position-fixed top-0 end-0 p-3">
        <div id="errorToast" class="toast" role="alert" aria-live="assertive" aria-atomic="true">
            <div class="toast-header bg-danger text-white">
                <i class="bi bi-x-circle me-2"></i>
                <strong class="me-auto">操作失败</strong>
                <button type="button" class="btn-close btn-close-white" data-bs-dismiss="toast" aria-label="Close"></button>
            </div>
            <div class="toast-body" id="error-message">
                操作过程中发生错误
            </div>
        </div>
    </div>

    <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
    <script>
        // 全局变量
        let currentPage = 1;
        let itemsPerPage = 10; // 修改为变量，默认每页10条
        let allUsers = [];
        let filteredUsers = [];
        let currentUserIdToDelete = null;
        let adminPassword = '';
        
        // 从URL获取密码
        function getPasswordFromUrl() {
            const urlParams = new URLSearchParams(window.location.search);
            return urlParams.get('password') || '';
        }
        
        // 获取API请求头
        function getApiHeaders() {
            return {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + adminPassword
            };
        }
        
        // DOM加载完成后初始化
        document.addEventListener('DOMContentLoaded', function() {
            adminPassword = getPasswordFromUrl();
            if (!adminPassword) {
                window.location.href = '/admin';
                return;
            }
            
            updateCurrentTime();
            setInterval(updateCurrentTime, 1000);
            loadStats();
            loadUsers();
            
            // 设置今天日期
            const today = new Date();
            document.getElementById('today-date').textContent = 
                today.getFullYear() + '-' + 
                String(today.getMonth() + 1).padStart(2, '0') + '-' + 
                String(today.getDate()).padStart(2, '0');
            
            // 监听批量添加文本框的变化
            const batchTextarea = document.getElementById('batch-user-ids');
            if (batchTextarea) {
                batchTextarea.addEventListener('input', updateBatchPreview);
            }
            
            // 监听标签页切换
            const tabTriggers = document.querySelectorAll('#addUserTabs button[data-bs-toggle="tab"]');
            tabTriggers.forEach(tab => {
                tab.addEventListener('shown.bs.tab', function(event) {
                    if (event.target.id === 'batch-tab') {
                        document.getElementById('add-single-btn').style.display = 'none';
                        document.getElementById('add-batch-btn').style.display = 'block';
                        updateBatchPreview();
                    } else {
                        document.getElementById('add-single-btn').style.display = 'block';
                        document.getElementById('add-batch-btn').style.display = 'none';
                    }
                });
            });
        });
        
        // 更新当前时间
        function updateCurrentTime() {
            const now = new Date();
            const options = { 
                year: 'numeric', 
                month: '2-digit', 
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false
            };
            document.getElementById('current-time').textContent = now.toLocaleString('zh-CN', options);
        }
        
        // 更新批量添加预览
        function updateBatchPreview() {
            const textarea = document.getElementById('batch-user-ids');
            if (!textarea) return;
            
            const text = textarea.value.trim();
            const lines = text.split('\\n').filter(line => line.trim() !== '');
            const uniqueLines = [...new Set(lines.map(line => line.trim()))];
            
            const previewArea = document.getElementById('batch-preview');
            const previewCount = document.getElementById('preview-count');
            const previewContent = document.getElementById('preview-content');
            
            if (uniqueLines.length === 0) {
                previewArea.style.display = 'none';
                return;
            }
            
            previewArea.style.display = 'block';
            previewCount.textContent = uniqueLines.length;
            
            previewContent.innerHTML = uniqueLines.slice(0, 50).map(line => 
                '<div>' + line + '</div>'
            ).join('');
            
            if (uniqueLines.length > 50) {
                previewContent.innerHTML += '<div class="text-muted">... 还有 ' + (uniqueLines.length - 50) + ' 个用户</div>';
            }
        }
        
        // 加载统计数据
        async function loadStats() {
            try {
                const response = await fetch('/db-stats');
                if (!response.ok) {
                    throw new Error('获取统计数据失败: ' + response.status);
                }
                
                const stats = await response.json();
                
                // 更新统计卡片
                document.getElementById('total-fraud-users').textContent = stats.fraud_users_count || 0;
                document.getElementById('blocked-users').textContent = stats.blocked_users_count || 0;
                document.getElementById('msg-map-count').textContent = stats.msg_map_count || 0;
                document.getElementById('today-added').textContent = stats.today_added || 0;
                
                // 更新消息时间信息
                document.getElementById('oldest-msg').textContent = stats.msg_oldest || '无数据';
                document.getElementById('newest-msg').textContent = stats.msg_newest || '无数据';
                
                // 显示或隐藏清理提醒
                const cleanupAlert = document.getElementById('cleanup-alert');
                const cleanupAlertText = document.getElementById('cleanup-alert-text');
                
                if (stats.last_cleanup_recommended) {
                    cleanupAlert.style.display = 'block';
                    cleanupAlertText.textContent = '数据库中有 ' + (stats.msg_map_count || 0) + ' 条消息记录，最早记录于 ' + stats.msg_oldest + '，建议清理30天前的数据';
                } else {
                    cleanupAlert.style.display = 'none';
                }
                
                // 更新最后更新时间
                const now = new Date();
                document.getElementById('last-updated').textContent = 
                    now.getHours().toString().padStart(2, '0') + ':' + 
                    now.getMinutes().toString().padStart(2, '0') + ':' + 
                    now.getSeconds().toString().padStart(2, '0');
                    
            } catch (error) {
                console.error('加载统计数据失败:', error);
                showError('无法加载统计数据: ' + error.message);
                document.getElementById('db-status').className = 'badge bg-danger';
                document.getElementById('db-status').textContent = '异常';
            }
        }
        
        // 加载用户列表
        async function loadUsers() {
          showLoading(true);
          
          try {
            const search = document.getElementById('search-input').value;
            let url = '/admin-api/fraud-users?password=' + encodeURIComponent(adminPassword);
            if (search) {
                url += '&search=' + encodeURIComponent(search);
            }
            
            const response = await fetch(url);
            if (!response.ok) {
                if (response.status === 401) {
                    window.location.href = '/admin';
                    return;
                }
                throw new Error('获取用户列表失败: ' + response.status);
            }
            
            const data = await response.json();
            
            if (data.success) {
                allUsers = data.users;
                filteredUsers = [...allUsers];
                updateTable(); // 使用前端分页
            } else {
                throw new Error(data.error || '未知错误');
            }
            
          } catch (error) {
            console.error('加载用户列表失败:', error);
            showError('无法加载用户列表: ' + error.message);
          } finally {
            showLoading(false);
          }
        }
        
        // 显示/隐藏加载状态
        function showLoading(show) {
            const loadingEl = document.getElementById('loading');
            const tableEl = document.getElementById('table-container');
            const emptyEl = document.getElementById('empty-state');
            
            if (show) {
                loadingEl.style.display = 'block';
                tableEl.style.display = 'none';
                emptyEl.style.display = 'none';
            } else {
                loadingEl.style.display = 'none';
            }
        }
        
        // 更新表格
        function updateTable() {
            const tableBody = document.getElementById('user-table-body');
            const emptyEl = document.getElementById('empty-state');
            const tableEl = document.getElementById('table-container');
            
            // 计算前端分页
            const startIndex = (currentPage - 1) * itemsPerPage;
            const endIndex = startIndex + itemsPerPage;
            const pageUsers = filteredUsers.slice(startIndex, endIndex);
            
            // 更新计数
            const totalPages = Math.ceil(filteredUsers.length / itemsPerPage);
            document.getElementById('list-count').textContent = filteredUsers.length + ' 个用户';
            document.getElementById('filtered-count').textContent = pageUsers.length + ' 个可见';
            
            let pageInfoText = '第 ' + currentPage + ' 页，共 ' + totalPages + ' 页';
            if (itemsPerPage > 0) {
                pageInfoText += '，每页 ' + itemsPerPage + ' 条';
            } else {
                pageInfoText += '，显示全部数据';
            }
            document.getElementById('page-info').textContent = pageInfoText;
            
            if (filteredUsers.length === 0) {
                tableEl.style.display = 'none';
                emptyEl.style.display = 'block';
                updatePagination();
                return;
            }
            
            tableEl.style.display = 'block';
            emptyEl.style.display = 'none';
            
            // 清空表格
            tableBody.innerHTML = '';
            
            // 填充表格数据
            pageUsers.forEach((user, index) => {
                const row = document.createElement('tr');
                row.innerHTML = '\
                    <td>' + (startIndex + index + 1) + '</td>\
                    <td class="user-id-cell">' + user.user_id + '</td>\
                    <td>\
                        <div>' + user.formatted_date + '</div>\
                        <small class="timestamp">' + user.time_ago + '</small>\
                    </td>\
                    <td>\
                        ' + (user.is_blocked ? 
                            '<span class="badge bg-danger">已屏蔽</span>' : 
                            '<span class="badge bg-success">活跃</span>') + '\
                    </td>\
                    <td class="action-buttons">\
                        <button class="btn btn-sm btn-outline-warning" onclick="toggleBlockUser(\\'' + user.user_id + '\\', ' + user.is_blocked + ')">\
                            <i class="bi bi-shield-' + (user.is_blocked ? 'check' : 'slash') + '"></i> ' + (user.is_blocked ? '解除屏蔽' : '屏蔽') + '\
                        </button>\
                        <button class="btn btn-sm btn-outline-danger" onclick="confirmDelete(\\'' + user.user_id + '\\')">\
                            <i class="bi bi-trash"></i> 删除\
                        </button>\
                    </td>\
                ';
                tableBody.appendChild(row);
            });
            
            updatePagination();
        }
        
        // 更新分页
        function updatePagination() {
            const totalPages = Math.ceil(filteredUsers.length / itemsPerPage);
            const paginationEl = document.getElementById('pagination');
            
            paginationEl.innerHTML = '';
            
            // 上一页按钮
            const prevLi = document.createElement('li');
            prevLi.className = 'page-item ' + (currentPage === 1 ? 'disabled' : '');
            prevLi.innerHTML = '<a class="page-link" href="#" onclick="changePage(' + (currentPage - 1) + ')">上一页</a>';
            paginationEl.appendChild(prevLi);
            
            // 页码按钮
            const maxVisiblePages = 5;
            let startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
            let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);
            
            if (endPage - startPage + 1 < maxVisiblePages) {
                startPage = Math.max(1, endPage - maxVisiblePages + 1);
            }
            
            for (let i = startPage; i <= endPage; i++) {
                const pageLi = document.createElement('li');
                pageLi.className = 'page-item ' + (i === currentPage ? 'active' : '');
                pageLi.innerHTML = '<a class="page-link" href="#" onclick="changePage(' + i + ')">' + i + '</a>';
                paginationEl.appendChild(pageLi);
            }
            
            // 下一页按钮
            const nextLi = document.createElement('li');
            nextLi.className = 'page-item ' + (currentPage === totalPages ? 'disabled' : '');
            nextLi.innerHTML = '<a class="page-link" href="#" onclick="changePage(' + (currentPage + 1) + ')">下一页</a>';
            paginationEl.appendChild(nextLi);
        }
        
        // 更改页面
        function changePage(page) {
            if (page < 1 || page > Math.ceil(filteredUsers.length / itemsPerPage)) return;
            currentPage = page;
            updateTable();
        }
        
        // 筛选用户
        function filterUsers() {
            const searchValue = document.getElementById('search-input').value.toLowerCase();
            
            if (searchValue === '') {
                filteredUsers = [...allUsers];
            } else {
                filteredUsers = allUsers.filter(user => 
                    user.user_id.toLowerCase().includes(searchValue)
                );
            }
            
            currentPage = 1; // 重置到第一页
            updateTable();
        }
        
        // 排序用户
        function sortUsers() {
            const sortBy = document.getElementById('sort-select').value;
            
            filteredUsers.sort((a, b) => {
                switch (sortBy) {
                    case 'newest':
                        return b.created_at - a.created_at;
                    case 'oldest':
                        return a.created_at - b.created_at;
                    case 'id_asc':
                        return String(a.user_id).localeCompare(String(b.user_id));
                    case 'id_desc':
                        return String(b.user_id).localeCompare(String(a.user_id));
                    default:
                        return 0;
                }
            });
            
            currentPage = 1; // 重置到第一页
            updateTable();
        }
        
        // 刷新数据
        function refreshData() {
            loadStats();
            loadUsers();
            showSuccess('数据已刷新');
        }
        
        // 导出用户ID
        async function exportUserIds() {
            try {
                const url = '/admin-api/export-ids?password=' + encodeURIComponent(adminPassword);
                window.open(url, '_blank');
                showSuccess('正在导出用户ID列表...');
            } catch (error) {
                console.error('导出用户ID失败:', error);
                showError('导出失败: ' + error.message);
            }
        }
        
        // 清理数据库
        async function cleanupDatabase() {
            const modal = new bootstrap.Modal(document.getElementById('cleanupConfirmModal'));
            modal.show();
            
            // 设置确认按钮事件
            const confirmBtn = document.getElementById('confirm-cleanup-btn');
            confirmBtn.onclick = async function() {
                modal.hide();
                
                try {
                    showLoading(true);
                    
                    const response = await fetch('/admin-api/cleanup?password=' + encodeURIComponent(adminPassword), {
                        method: 'POST',
                        headers: getApiHeaders(),
                        body: JSON.stringify({ 
                            cleanup_type: 'all',
                            days: 30 
                        })
                    });
                    
                    const result = await response.json();
                    
                    if (result.success) {
                        // 更新UI
                        refreshData();
                        showSuccess('成功清理了 ' + result.rows_deleted + ' 条旧数据');
                    } else {
                        showError('清理失败: ' + (result.error || '未知错误'));
                    }
                    
                } catch (error) {
                    console.error('清理数据库失败:', error);
                    showError('清理失败: ' + error.message);
                } finally {
                    showLoading(false);
                }
            };
        }
        
        // 添加单个用户
        async function addUser() {
            const userId = document.getElementById('user-id-input').value.trim();
            const reason = document.getElementById('reason-input').value.trim();
            
            if (!userId) {
                showError('请输入用户ID');
                return;
            }
            
            try {
                const response = await fetch('/admin-api/add-user?password=' + encodeURIComponent(adminPassword), {
                    method: 'POST',
                    headers: getApiHeaders(),
                    body: JSON.stringify({ user_id: userId, reason: reason })
                });
                
                const result = await response.json();
                
                if (result.success) {
                    // 重置表单
                    document.getElementById('user-id-input').value = '';
                    document.getElementById('reason-input').value = '';
                    
                    // 关闭模态框
                    const modal = bootstrap.Modal.getInstance(document.getElementById('addUserModal'));
                    modal.hide();
                    
                    // 更新UI
                    refreshData();
                    showSuccess('用户已成功添加到欺诈数据库');
                } else {
                    showError('添加用户失败: ' + (result.message || '未知错误'));
                }
                
            } catch (error) {
                console.error('添加用户失败:', error);
                showError('添加用户失败: ' + error.message);
            }
        }
        
        // 批量添加用户
        async function addUsersBatch() {
            const textarea = document.getElementById('batch-user-ids');
            const reason = document.getElementById('batch-reason').value.trim();
            
            if (!textarea) {
                showError('批量添加功能未正确加载');
                return;
            }
            
            const text = textarea.value.trim();
            if (!text) {
                showError('请输入要添加的用户ID列表');
                return;
            }
            
            const lines = text.split('\\n').filter(line => line.trim() !== '');
            if (lines.length === 0) {
                showError('没有有效的用户ID');
                return;
            }
            
            // 去重
            const userIds = [...new Set(lines.map(line => line.trim()))];
            
            if (userIds.length > 1000) {
                showError('一次最多只能添加1000个用户');
                return;
            }
            
            try {
                const response = await fetch('/admin-api/add-users-batch?password=' + encodeURIComponent(adminPassword), {
                    method: 'POST',
                    headers: getApiHeaders(),
                    body: JSON.stringify({ 
                        user_ids: userIds, 
                        reason: reason 
                    })
                });
                
                const result = await response.json();
                
                if (result.success) {
                    // 清空表单
                    textarea.value = '';
                    document.getElementById('batch-reason').value = '';
                    
                    // 显示结果模态框
                    showBatchResult(result);
                    
                    // 更新UI
                    refreshData();
                } else {
                    showError('批量添加失败: ' + (result.message || '未知错误'));
                }
                
            } catch (error) {
                console.error('批量添加用户失败:', error);
                showError('批量添加失败: ' + error.message);
            }
        }
        
        // 显示批量添加结果
        function showBatchResult(result) {
            const summaryEl = document.getElementById('batch-result-summary');
            const detailsEl = document.getElementById('batch-result-details');
            
            // 更新摘要
            summaryEl.innerHTML = '\
                <div class="alert alert-success">\
                    <i class="bi bi-check-circle"></i>\
                    <strong>批量添加完成</strong>\
                    <div class="mt-2">\
                        <p>总计: ' + result.total + ' 个用户</p>\
                        <p>成功: <span class="text-success">' + result.success_count + ' 个</span></p>\
                        <p>失败: <span class="text-danger">' + result.failed_count + ' 个</span></p>\
                    </div>\
                </div>\
            ';
            
            // 更新详情
            let detailsHtml = '';
            result.details.forEach(detail => {
                const statusClass = detail.status === 'success' ? 'text-success' : 
                                  detail.status === 'exists' ? 'text-warning' : 'text-danger';
                detailsHtml += '\
                    <div class="mb-2">\
                        <strong>' + detail.user_id + '</strong>\
                        <span class="' + statusClass + '"> (' + detail.status + ')</span>\
                        <div class="text-muted small">' + detail.message + '</div>\
                    </div>\
                ';
            });
            
            detailsEl.innerHTML = detailsHtml;
            
            // 显示模态框
            const modal = new bootstrap.Modal(document.getElementById('batchResultModal'));
            modal.show();
        }
        
        // 切换屏蔽状态
        async function toggleBlockUser(userId, currentlyBlocked) {
            try {
                const response = await fetch('/admin-api/toggle-block?password=' + encodeURIComponent(adminPassword), {
                    method: 'POST',
                    headers: getApiHeaders(),
                    body: JSON.stringify({ 
                        user_id: userId, 
                        block: !currentlyBlocked 
                    })
                });
                
                const result = await response.json();
                
                if (result.success) {
                    // 更新UI
                    refreshData();
                    showSuccess('用户 ' + userId + ' 已' + (!currentlyBlocked ? '屏蔽' : '解除屏蔽'));
                } else {
                    showError('操作失败: ' + (result.message || '未知错误'));
                }
                
            } catch (error) {
                console.error('切换屏蔽状态失败:', error);
                showError('操作失败: ' + error.message);
            }
        }
        
        // 确认删除
        function confirmDelete(userId) {
            currentUserIdToDelete = userId;
            document.getElementById('delete-user-id').textContent = userId;
            const modal = new bootstrap.Modal(document.getElementById('deleteConfirmModal'));
            modal.show();
            
            // 设置确认按钮事件
            const confirmBtn = document.getElementById('confirm-delete-btn');
            confirmBtn.onclick = deleteUser;
        }
        
        // 删除用户
        async function deleteUser() {
            if (!currentUserIdToDelete) return;
            
            try {
                const response = await fetch('/admin-api/delete-user?password=' + encodeURIComponent(adminPassword), {
                    method: 'POST',
                    headers: getApiHeaders(),
                    body: JSON.stringify({ user_id: currentUserIdToDelete })
                });
                
                const result = await response.json();
                
                if (result.success && result.completely_deleted) {
                    // 关闭模态框
                    const modal = bootstrap.Modal.getInstance(document.getElementById('deleteConfirmModal'));
                    modal.hide();
                    
                    // 更新UI
                    refreshData();
                    showSuccess('用户 ' + currentUserIdToDelete + ' 已成功删除');
                } else {
                    showError('删除失败: 用户数据未完全删除');
                }
                
            } catch (error) {
                console.error('删除用户失败:', error);
                showError('删除用户失败: ' + error.message);
            } finally {
                currentUserIdToDelete = null;
            }
        }
        
        // 设置每页显示数量
        function setItemsPerPage(count) {
            if (count === 0) {
                itemsPerPage = filteredUsers.length;
            } else {
                itemsPerPage = count;
            }
            currentPage = 1;
            updateTable();
            
            // 显示提示
            if (count === 0) {
                showSuccess('已显示全部数据，共 ' + filteredUsers.length + ' 条记录');
            } else {
                showSuccess('已设置为每页显示 ' + count + ' 条记录');
            }
        }
        
        // 显示成功提示
        function showSuccess(message) {
            const toastEl = document.getElementById('successToast');
            const toastBody = toastEl.querySelector('#success-message');
            toastBody.textContent = message;
            
            const toast = new bootstrap.Toast(toastEl);
            toast.show();
        }
        
        // 显示错误提示
        function showError(message) {
            const toastEl = document.getElementById('errorToast');
            const toastBody = toastEl.querySelector('#error-message');
            toastBody.textContent = message;
            
            const toast = new bootstrap.Toast(toastEl);
            toast.show();
        }
    </script>
</body>
</html>
  `;
}
