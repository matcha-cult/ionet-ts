import 'reflect-metadata';
import {
  ActionController,
  ActionMethod,
  BarSkeletonBuilder,
  DebugInOut,
  StatActionInOut,
} from '@ionet/core-framework';

const HALL_CMD = {
  cmd: 1,
  loginVerify: 1,
  hello: 2,
} as const;

@ActionController(HALL_CMD.cmd)
class HallAction {
  @ActionMethod(HALL_CMD.loginVerify)
  login(jwt: string): { id: number; nickname: string } {
    const id = jwt.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
    return { id, nickname: jwt };
  }

  @ActionMethod(HALL_CMD.hello)
  hello(userId: number): string {
    return `hello ${userId}`;
  }
}

async function main() {
  const debugInOut = new DebugInOut();
  const statInOut = new StatActionInOut();

  const skeleton = new BarSkeletonBuilder()
    .addAction(HallAction)
    .addInOut(debugInOut)
    .addInOut(statInOut)
    .build();

  console.log('=== ionet demo starting ===\n');

  // Test login
  console.log('--- Test 1: login ---');
  const loginResult = await skeleton.execute({
    cmd: HALL_CMD.cmd,
    subCmd: HALL_CMD.loginVerify,
    data: 'Alice',
  });
  console.log('Result:', loginResult);
  console.log();

  // Test hello
  console.log('--- Test 2: hello ---');
  const helloResult = await skeleton.execute({
    cmd: HALL_CMD.cmd,
    subCmd: HALL_CMD.hello,
    data: 12345,
  });
  console.log('Result:', helloResult);
  console.log();

  // Test unknown action
  console.log('--- Test 3: unknown action ---');
  const unknownResult = await skeleton.execute({
    cmd: 999,
    subCmd: 999,
    data: null,
  });
  console.log('Result:', unknownResult);
  console.log();

  // Print statistics
  console.log('=== Statistics ===');
  for (const stat of statInOut.getStats()) {
    const cmd = stat.cmdMerge >> 16;
    const subCmd = stat.cmdMerge & 0xFFFF;
    console.log(
      `cmd=${cmd}-${subCmd}: calls=${stat.count}, errors=${stat.errorCount}, avgTime=${(stat.totalMs / stat.count).toFixed(2)}ms`,
    );
  }

  console.log('\n=== ionet demo finished ===');
}

main().catch(console.error);
