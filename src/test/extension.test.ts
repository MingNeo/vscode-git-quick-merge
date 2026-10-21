import * as assert from 'assert';
import * as vscode from 'vscode';

// B1：两个命令都必须真实注册到 VS Code
suite('Extension activation', () => {
  test('扩展存在且能被激活', async () => {
    const ext = vscode.extensions.getExtension('MingNeo.vscode-git-quick-merge');
    assert.ok(ext, '未找到扩展');
    if (!ext!.isActive) {
      await ext!.activate();
    }
    assert.strictEqual(ext!.isActive, true);
  });

  test('gitQuickMerge.quick-merge-to 命令已注册', async () => {
    const all = await vscode.commands.getCommands(true);
    assert.ok(
      all.includes('gitQuickMerge.quick-merge-to'),
      '快速合并命令未注册'
    );
  });

  test('gitQuickMerge.cleanup-stale-worktrees 命令已注册（B1）', async () => {
    const all = await vscode.commands.getCommands(true);
    assert.ok(
      all.includes('gitQuickMerge.cleanup-stale-worktrees'),
      '清理历史残留 worktrees 命令未注册 —— 这是本轮 B1 修的主要 bug，出现说明回归了'
    );
  });

  test('配置项 gitQuickMerge.logLevel 存在（Q3）', () => {
    const cfg = vscode.workspace.getConfiguration('gitQuickMerge');
    // inspect 返回 undefined 说明 package.json 里没定义该配置
    const info = cfg.inspect('logLevel');
    assert.ok(info, 'gitQuickMerge.logLevel 配置项未在 package.json 中声明');
    assert.strictEqual(info!.defaultValue, 'info');
  });
});
