import * as assert from 'assert';
import { normalizeBranchConfig } from '../extension';

// B3 + Q2：normalizeBranchConfig 应当兼容
//   - 字符串：当成 to，from 取当前分支
//   - 对象 { to }：from 取当前分支
//   - 对象 { from, to }：原样
//   - 对象 { to, name }：保留 name
// 并且绝对不能 mutate 传入对象
suite('normalizeBranchConfig', () => {
  const CURRENT = 'feature/x';

  test('字符串 → 当前分支合并到目标', () => {
    assert.deepStrictEqual(
      normalizeBranchConfig('develop', CURRENT),
      { to: 'develop', from: CURRENT }
    );
  });

  test('对象 { to } → from 默认当前分支', () => {
    assert.deepStrictEqual(
      normalizeBranchConfig({ to: 'develop' }, CURRENT),
      { to: 'develop', from: CURRENT, name: undefined }
    );
  });

  test('对象 { from, to } → 原样', () => {
    assert.deepStrictEqual(
      normalizeBranchConfig({ from: 'release', to: 'master' }, CURRENT),
      { from: 'release', to: 'master', name: undefined }
    );
  });

  test('对象 { to, name } → 保留 name（B3）', () => {
    assert.deepStrictEqual(
      normalizeBranchConfig({ to: 'develop', name: '主线' }, CURRENT),
      { from: CURRENT, to: 'develop', name: '主线' }
    );
  });

  test('对象 { from: "" } 空字符串 → 回退到当前分支', () => {
    // 实现使用 || 运算符，空串会被视为 falsy
    const result = normalizeBranchConfig({ from: '', to: 'develop' }, CURRENT);
    assert.strictEqual(result.from, CURRENT);
  });

  test('不会 mutate 原对象（Q2）', () => {
    const input = { to: 'develop' };
    const snapshot = { ...input };
    normalizeBranchConfig(input, CURRENT);
    assert.deepStrictEqual(input, snapshot);
  });
});
