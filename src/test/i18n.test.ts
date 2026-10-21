import * as assert from 'assert';
import { t } from '../i18n';

// i18n 的关键行为：
// 1. 未知 key 返回原 key（fallback）
// 2. 占位符 {0}, {1} 替换
// 3. 本轮新增的 key 都有值（防止跟 multiMerge/extension 的使用点失联）
suite('i18n', () => {
  test('未知 key 回退为 key 本身', () => {
    assert.strictEqual(t('this.key.does.not.exist'), 'this.key.does.not.exist');
  });

  test('占位符替换（单个）', () => {
    // success.mergeComplete 含两个占位符，传两个参数应全部替换
    const result = t('success.mergeComplete', 'feature/a', 'develop');
    assert.ok(result.includes('feature/a'));
    assert.ok(result.includes('develop'));
    assert.ok(!result.includes('{0}'));
    assert.ok(!result.includes('{1}'));
  });

  test('占位符替换（多个相同索引被全部替换）', () => {
    // 人为构造一个可能出现多次 {0} 的场景：借助 warning.unpushedCommits 模板
    const result = t('warning.unpushedCommits', 'branchX', '3', '');
    assert.ok(result.includes('branchX'));
    assert.ok(result.includes('3'));
    assert.ok(!/\{\d+\}/.test(result));
  });

  test('本轮新增 keys 都存在且非 fallback', () => {
    const newKeys = [
      'button.confirm',
      'button.mergeLocalLatest',
      'error.noWorkspace',
      'error.presetAllFailed',
      'error.pushSourceFailed',
      'error.fetchSourceFailed',
      'error.failedOperationsList',
      'warning.operationsCanceled',
      'warning.presetCanceled',
    ];
    for (const key of newKeys) {
      const value = t(key);
      assert.notStrictEqual(value, key, `i18n key "${key}" 未定义（fallback 回原 key）`);
    }
  });

  test('error.pushSourceFailed 占位符被替换', () => {
    const result = t('error.pushSourceFailed', 'feature/x');
    assert.ok(result.includes('feature/x'));
    assert.ok(!/\{\d+\}/.test(result));
  });

  test('error.presetAllFailed 占位符全部被替换', () => {
    const result = t('error.presetAllFailed', 'release-preset', '2');
    assert.ok(result.includes('release-preset'));
    assert.ok(result.includes('2'));
    assert.ok(!/\{\d+\}/.test(result));
  });

  test('预设结果摘要是单行（普通通知不支持换行）', () => {
    const summaries = [
      t('success.presetMergeComplete', 'p', '2'),
      t('success.presetMergePartial', 'p', '1', '1'),
      t('error.presetAllFailed', 'p', '2'),
      t('warning.presetCanceled', 'p', '1', '0', '2'),
    ];
    for (const s of summaries) {
      assert.ok(!s.includes('\n'), `摘要不应包含换行: ${s}`);
      assert.ok(!/\{\d+\}/.test(s), `占位符未替换: ${s}`);
    }
  });
});
