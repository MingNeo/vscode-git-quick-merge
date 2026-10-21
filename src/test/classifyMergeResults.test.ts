import * as assert from 'assert';
import { classifyMergeResults, MultipleMergeResult } from '../multiMerge';

// B4：用户取消不能被误判成 abort
const ok = (to: string): MultipleMergeResult => ({ targetBranch: to, success: true });
const fail = (to: string, err = 'boom'): MultipleMergeResult => ({ targetBranch: to, success: false, error: err });
const cancel = (to: string): MultipleMergeResult => ({ targetBranch: to, success: false, canceled: true });

suite('classifyMergeResults', () => {
  test('全部成功 → allSuccess', () => {
    const r = classifyMergeResults([ok('a'), ok('b')], 2);
    assert.strictEqual(r.kind, 'allSuccess');
    assert.strictEqual(r.wasAborted, false);
    assert.strictEqual(r.wasUserCanceled, false);
    assert.strictEqual(r.success.length, 2);
  });

  test('第一步就失败、没继续 → abortedByError（因为未执行完）', () => {
    // 用户场景：3 个操作，第一个失败，后续两个未执行
    const r = classifyMergeResults([fail('a')], 3);
    assert.strictEqual(r.kind, 'abortedByError');
    assert.strictEqual(r.wasAborted, true);
  });

  test('全部失败（continueOnError=true, 全执行完）→ allFailed', () => {
    const r = classifyMergeResults([fail('a'), fail('b')], 2);
    assert.strictEqual(r.kind, 'allFailed');
    assert.strictEqual(r.wasAborted, false);
  });

  test('先成功再失败（abort）→ abortedByError', () => {
    const r = classifyMergeResults([ok('a'), fail('b')], 3);
    assert.strictEqual(r.kind, 'abortedByError');
    assert.strictEqual(r.wasAborted, true);
  });

  test('部分成功 + 部分失败，全部执行完 → partialSuccess', () => {
    const r = classifyMergeResults([ok('a'), fail('b'), ok('c')], 3);
    assert.strictEqual(r.kind, 'partialSuccess');
    assert.strictEqual(r.wasAborted, false);
  });

  test('B4 关键：用户在第 2 步取消 → userCanceled，不是 abortedByError', () => {
    // 3 个操作，第 1 成功，第 2 取消
    const r = classifyMergeResults([ok('a'), cancel('b')], 3);
    assert.strictEqual(r.kind, 'userCanceled');
    assert.strictEqual(r.wasUserCanceled, true);
    assert.strictEqual(r.wasAborted, false, '用户取消不应被当成异常中断');
    assert.strictEqual(r.success.length, 1);
    assert.strictEqual(r.canceled.length, 1);
    assert.strictEqual(r.failed.length, 0);
  });

  test('第 1 步就取消 → userCanceled，success 为空', () => {
    const r = classifyMergeResults([cancel('a')], 3);
    assert.strictEqual(r.kind, 'userCanceled');
    assert.strictEqual(r.success.length, 0);
  });

  test('失败后再取消（continueOnError=true）→ canceledWithFailures，不是 abortedByError', () => {
    const r = classifyMergeResults([fail('a'), cancel('b')], 3);
    assert.strictEqual(r.wasUserCanceled, true);
    assert.strictEqual(r.wasAborted, false, '用户取消不应被当成异常中断');
    assert.strictEqual(r.kind, 'canceledWithFailures');
  });

  test('失败后在最后一步取消 → canceledWithFailures，不是 allFailed', () => {
    const r = classifyMergeResults([fail('a'), cancel('b')], 2);
    assert.strictEqual(r.kind, 'canceledWithFailures');
    assert.strictEqual(r.failed.length, 1);
    assert.strictEqual(r.canceled.length, 1);
  });

  test('成功 + 失败后再取消 → canceledWithFailures，不是 partialSuccess', () => {
    const r = classifyMergeResults([ok('a'), fail('b'), cancel('c')], 3);
    assert.strictEqual(r.kind, 'canceledWithFailures');
    assert.strictEqual(r.success.length, 1);
  });

  test('push 失败的 result（success=false, canceled=undefined）应进入 failed 桶', () => {
    // 模拟 executeMergeOperationsCore 在 pushFailed 分支推入的形状
    const pushFailedResult: MultipleMergeResult = {
      targetBranch: 'a',
      success: false,
      error: '推送源分支失败',
    };
    const r = classifyMergeResults([pushFailedResult], 3);
    assert.strictEqual(r.failed.length, 1, 'push 失败应被算作真实失败');
    assert.strictEqual(r.canceled.length, 0, 'push 失败不应被误算成用户取消');
    assert.strictEqual(r.wasUserCanceled, false);
    assert.strictEqual(r.kind, 'abortedByError');
  });
});
