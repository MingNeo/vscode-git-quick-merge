import * as assert from 'assert';
import * as vscode from 'vscode';
import { logger } from '../logger';

// Logger 级别过滤（Q3）
// 通过 mock outputChannel.appendLine 来观察真实写入
// 注意 threshold 是 getter，每次调用都会重新读 workspace 配置，所以动态更新配置即可
suite('logger', () => {
  let appendLineSpy: string[];
  let originalAppendLine: (value: string) => void;

  setup(() => {
    appendLineSpy = [];
    const channel = (logger as any).outputChannel as vscode.OutputChannel;
    originalAppendLine = channel.appendLine.bind(channel);
    channel.appendLine = (v: string) => { appendLineSpy.push(v); };
  });

  teardown(async () => {
    const channel = (logger as any).outputChannel as vscode.OutputChannel;
    channel.appendLine = originalAppendLine;
    // 恢复默认级别，避免影响其他 suite
    await vscode.workspace.getConfiguration('gitQuickMerge').update(
      'logLevel', undefined, vscode.ConfigurationTarget.Global
    );
  });

  async function setLevel(level: 'debug' | 'info' | 'warn' | 'error') {
    await vscode.workspace.getConfiguration('gitQuickMerge').update(
      'logLevel', level, vscode.ConfigurationTarget.Global
    );
  }

  test('默认 info 级别：debug 不写入', async () => {
    await setLevel('info');
    logger.debug('should-be-filtered');
    logger.info('should-appear');
    assert.ok(!appendLineSpy.some(l => l.includes('should-be-filtered')));
    assert.ok(appendLineSpy.some(l => l.includes('should-appear')));
  });

  test('debug 级别：debug 写入', async () => {
    await setLevel('debug');
    logger.debug('now-visible');
    assert.ok(appendLineSpy.some(l => l.includes('now-visible')));
  });

  test('warn 级别：info 不写入，warn/error 写入', async () => {
    await setLevel('warn');
    logger.info('info-msg');
    logger.warn('warn-msg');
    logger.error('error-msg');
    assert.ok(!appendLineSpy.some(l => l.includes('info-msg')));
    assert.ok(appendLineSpy.some(l => l.includes('warn-msg')));
    assert.ok(appendLineSpy.some(l => l.includes('error-msg')));
  });

  test('error 级别：只有 error 写入', async () => {
    await setLevel('error');
    logger.info('x');
    logger.warn('y');
    logger.error('z');
    assert.strictEqual(appendLineSpy.filter(l => l.includes('x')).length, 0);
    assert.strictEqual(appendLineSpy.filter(l => l.includes('y')).length, 0);
    assert.strictEqual(appendLineSpy.filter(l => l.includes('z')).length, 1);
  });

  test('输出包含级别标识和时间戳', async () => {
    await setLevel('info');
    logger.info('hello');
    const line = appendLineSpy.find(l => l.includes('hello'));
    assert.ok(line, '未找到 hello 日志');
    assert.ok(/\[\d+:\d+:\d+.*\]/.test(line!), '缺少时间戳');
    assert.ok(line!.includes('[INFO]'), '缺少 [INFO] 级别标识');
  });

  test('Error 对象输出 message 而不是 {}', async () => {
    await setLevel('info');
    logger.error('failed', new Error('kaboom'));
    const line = appendLineSpy.find(l => l.includes('failed'));
    assert.ok(line, '未找到 failed 日志');
    assert.ok(line!.includes('kaboom'), 'Error message 丢失');
  });
});
