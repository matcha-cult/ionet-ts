#!/usr/bin/env tsx
/**
 * MMORPG Demo 测试脚本
 * 测试登录、用户、道具、生产队列的完整流程
 */

const BASE_URL = 'http://localhost:8080/api';

async function request(cmd: number, subCmd: number, data: any, token?: string) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${BASE_URL}/${cmd}/${subCmd}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ data }),
  });

  return response.json();
}

async function main() {
  console.log('=== MMORPG Demo Test ===\n');

  // 1. 登录
  console.log('1. Login...');
  const loginResult = await request(10, 1, { account: 'alice', password: '123' });
  console.log('   Login result:', loginResult);
  const token = loginResult.data.token;
  const userId = loginResult.data.userId;
  console.log(`   Token: ${token.substring(0, 20)}...`);
  console.log(`   User ID: ${userId}\n`);

  // 2. 获取用户信息
  console.log('2. Get user info...');
  const userInfo = await request(20, 1, {}, token);
  console.log('   User info:', userInfo.data, '\n');

  // 3. 修改昵称
  console.log('3. Update nickname...');
  const updateNick = await request(20, 2, { nickname: 'Alice the Great' }, token);
  console.log('   Update result:', updateNick, '\n');

  // 4. 增加经验
  console.log('4. Add exp...');
  const addExp = await request(20, 3, { exp: 150 }, token);
  console.log('   Add exp result:', addExp.data, '\n');

  // 5. 开始生产任务（wood，3.3秒）
  console.log('5. Start production task (wood, 3.3s)...');
  const startTask = await request(40, 1, { taskType: 'wood' }, token);
  console.log('   Start task result:', startTask.data, '\n');

  // 6. 加入候选队列
  console.log('6. Add to queue (cake, iron)...');
  const addQueue1 = await request(40, 4, { taskType: 'cake' }, token);
  console.log('   Add cake:', addQueue1.data);
  const addQueue2 = await request(40, 4, { taskType: 'iron' }, token);
  console.log('   Add iron:', addQueue2.data, '\n');

  // 7. 获取生产状态
  console.log('7. Get production state...');
  const state1 = await request(40, 3, {}, token);
  console.log('   State:', state1.data, '\n');

  // 8. 等待 4 秒（wood 完成，cake 开始）
  console.log('8. Wait 4 seconds for wood to complete...');
  await new Promise(resolve => setTimeout(resolve, 4000));

  const state2 = await request(40, 3, {}, token);
  console.log('   State after 4s:', state2.data, '\n');

  // 9. 查看背包
  console.log('9. Get bag...');
  const bag = await request(30, 1, {}, token);
  console.log('   Bag:', bag.data, '\n');

  // 10. 等待 5 秒（cake 完成，iron 开始）
  console.log('10. Wait 5 seconds for cake to complete...');
  await new Promise(resolve => setTimeout(resolve, 5000));

  const state3 = await request(40, 3, {}, token);
  console.log('   State after 5s:', state3.data, '\n');

  // 11. 再查看背包
  console.log('11. Get bag again...');
  const bag2 = await request(30, 1, {}, token);
  console.log('   Bag:', bag2.data, '\n');

  console.log('=== Test Complete ===');
}

main().catch(console.error);
