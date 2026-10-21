import * as assert from 'assert';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  checkStaleWorktrees,
  cleanupStaleWorktrees,
  checkUnpushedCommits,
  getRemoteRepoName,
  getWorktreesBaseDir,
} from '../utils';

suite('utils 回归测试', function () {
  this.timeout(10000);

  let sandbox: string;
  let repoPath: string;
  let baseCommit: string;
  let remoteRef: string;
  const originalTmpdir = os.tmpdir;

  function git(...args: string[]): string {
    return execFileSync('git', args, {
      cwd: repoPath,
      encoding: 'utf8',
      stdio: 'pipe',
      env: {
        ...process.env,
        GIT_CONFIG_GLOBAL: os.devNull,
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_AUTHOR_NAME: 'Test',
        GIT_AUTHOR_EMAIL: 'test@example.invalid',
        GIT_COMMITTER_NAME: 'Test',
        GIT_COMMITTER_EMAIL: 'test@example.invalid',
      },
    }).trim();
  }

  function addWorktree(worktreePath: string): string {
    git('worktree', 'add', '--detach', worktreePath, 'HEAD');
    const savedFile = path.join(worktreePath, 'uncommitted.txt');
    fs.writeFileSync(savedFile, '必须保留的未提交内容');
    return savedFile;
  }

  setup(() => {
    sandbox = fs.realpathSync(fs.mkdtempSync(path.join(originalTmpdir(), 'quick-merge-test-')));
    // 所有检测与删除均限定在测试目录，不访问真实扩展临时目录。
    os.tmpdir = () => sandbox;
    fs.mkdirSync(getWorktreesBaseDir());
    repoPath = path.join(sandbox, 'repo');
    fs.mkdirSync(repoPath);
    git('init', '-q');
    git('symbolic-ref', 'HEAD', 'refs/heads/feature');
    git('config', 'commit.gpgSign', 'false');
    git('config', 'core.hooksPath', path.join(sandbox, 'hooks'));
    git('commit', '-q', '--allow-empty', '-m', 'base');
    baseCommit = git('rev-parse', 'HEAD');
    remoteRef = `refs/remotes/${getRemoteRepoName()}/release`;
  });

  teardown(() => {
    os.tmpdir = originalTmpdir;
    fs.rmSync(sandbox, { recursive: true, force: true });
  });

  test('不检测或删除扩展根目录以外的同名前缀 worktree', async () => {
    const external = path.join(sandbox, 'vscode-git-auto-merge-backup', 'merge-customer');
    const savedFile = addWorktree(external);

    assert.deepStrictEqual(checkStaleWorktrees(repoPath), []);
    assert.deepStrictEqual(await cleanupStaleWorktrees([external], repoPath), { success: 0, failed: 1 });
    assert.strictEqual(fs.readFileSync(savedFile, 'utf8'), '必须保留的未提交内容');
    assert.ok(git('worktree', 'list', '--porcelain').includes('merge-customer'));
  });

  test('合法 worktree 正常清理，不影响外部同名目录', async () => {
    const managed = path.join(getWorktreesBaseDir(), 'merge-release-123456');
    addWorktree(managed);
    const external = path.join(sandbox, 'vscode-git-auto-merge-backup', path.basename(managed));
    const savedFile = addWorktree(external);

    assert.deepStrictEqual(checkStaleWorktrees(repoPath), [fs.realpathSync(managed)]);
    assert.deepStrictEqual(await cleanupStaleWorktrees([managed], repoPath), { success: 1, failed: 0 });
    assert.strictEqual(fs.existsSync(managed), false);
    assert.ok(fs.existsSync(savedFile));
  });

  test('根目录内未登记的残留目录仍可清理', async () => {
    const orphan = path.join(getWorktreesBaseDir(), 'merge-orphan-123456');
    fs.mkdirSync(orphan);
    fs.writeFileSync(path.join(orphan, 'leftover.txt'), '残留');

    assert.deepStrictEqual(checkStaleWorktrees(repoPath), [fs.realpathSync(orphan)]);
    assert.deepStrictEqual(await cleanupStaleWorktrees([orphan], repoPath), { success: 1, failed: 0 });
    assert.strictEqual(fs.existsSync(orphan), false);
  });

  test('拒绝扩展根目录中的嵌套 worktree', async () => {
    const nested = path.join(getWorktreesBaseDir(), 'archive', 'merge-nested');
    const savedFile = addWorktree(nested);

    assert.deepStrictEqual(checkStaleWorktrees(repoPath), []);
    assert.deepStrictEqual(await cleanupStaleWorktrees([nested], repoPath), { success: 0, failed: 1 });
    assert.ok(fs.existsSync(savedFile));
  });

  test('拒绝指向外部目录的符号链接', async () => {
    const external = path.join(sandbox, 'kept');
    fs.mkdirSync(external);
    const savedFile = path.join(external, 'important.txt');
    fs.writeFileSync(savedFile, '保留');
    const link = path.join(getWorktreesBaseDir(), 'merge-link');
    fs.symlinkSync(external, link, 'junction');

    assert.deepStrictEqual(checkStaleWorktrees(repoPath), []);
    assert.deepStrictEqual(await cleanupStaleWorktrees([link], repoPath), { success: 0, failed: 1 });
    assert.ok(fs.lstatSync(link).isSymbolicLink());
    assert.strictEqual(fs.readFileSync(savedFile, 'utf8'), '保留');
  });

  test('扩展根目录本身被符号链接替换时拒绝清理', async () => {
    const baseDir = getWorktreesBaseDir();
    fs.rmdirSync(baseDir);
    const external = path.join(sandbox, 'external');
    const candidate = path.join(external, 'merge-kept');
    fs.mkdirSync(candidate, { recursive: true });
    fs.symlinkSync(external, baseDir, 'junction');

    assert.deepStrictEqual(checkStaleWorktrees(repoPath), []);
    assert.deepStrictEqual(await cleanupStaleWorktrees([candidate], repoPath), { success: 0, failed: 1 });
    assert.ok(fs.existsSync(candidate));
  });

  test('临时目录路径别名按真实路径去重且可以正常清理', async () => {
    const managed = path.join(getWorktreesBaseDir(), 'merge-alias-123456');
    addWorktree(managed);
    const canonicalPath = fs.realpathSync(managed);
    const alias = path.join(sandbox, 'tmp-alias');
    fs.symlinkSync(sandbox, alias, 'junction');
    os.tmpdir = () => alias;
    const aliasedPath = path.join(getWorktreesBaseDir(), path.basename(managed));

    assert.deepStrictEqual(checkStaleWorktrees(repoPath), [canonicalPath]);
    assert.deepStrictEqual(await cleanupStaleWorktrees([aliasedPath], repoPath), { success: 1, failed: 0 });
    assert.strictEqual(fs.existsSync(managed), false);
  });

  test('检测后被替换成符号链接的目录不能被清理', async () => {
    const managed = path.join(getWorktreesBaseDir(), 'merge-replaced');
    fs.mkdirSync(managed);
    const stale = checkStaleWorktrees(repoPath);
    fs.rmdirSync(managed);
    const external = path.join(sandbox, 'kept');
    fs.mkdirSync(external);
    fs.symlinkSync(external, managed, 'junction');

    assert.deepStrictEqual(await cleanupStaleWorktrees(stale, repoPath), { success: 0, failed: 1 });
    assert.ok(fs.existsSync(external));
    assert.ok(fs.lstatSync(managed).isSymbolicLink());
  });

  test('临时根目录不存在时拒绝清理外部目录', async () => {
    fs.rmdirSync(getWorktreesBaseDir());
    const external = path.join(sandbox, 'vscode-git-auto-merge-backup', 'merge-kept');
    const savedFile = addWorktree(external);

    assert.deepStrictEqual(checkStaleWorktrees(repoPath), []);
    assert.deepStrictEqual(await cleanupStaleWorktrees([external], repoPath), { success: 0, failed: 1 });
    assert.ok(fs.existsSync(savedFile));
  });

  test('已消失的合法 worktree 仍可清理登记', async () => {
    const managed = path.join(getWorktreesBaseDir(), 'merge-missing');
    addWorktree(managed);
    fs.rmSync(managed, { recursive: true, force: true });

    assert.deepStrictEqual(await cleanupStaleWorktrees([managed], repoPath), { success: 1, failed: 0 });
    assert.ok(!git('worktree', 'list', '--porcelain').includes('merge-missing'));
  });

  test('源分支仅存在于远程时，不把当前 HEAD 的提交误报为未推送', () => {
    git('update-ref', remoteRef, baseCommit);
    git('commit', '-q', '--allow-empty', '-m', 'feature-only');

    assert.deepStrictEqual(checkUnpushedCommits(repoPath, 'release'), {
      hasUnpushed: false, commitCount: 0, commits: [],
    });
  });

  test('非当前源分支领先远程时，只统计该源分支的提交', () => {
    git('update-ref', remoteRef, baseCommit);
    git('switch', '-c', 'release');
    git('commit', '-q', '--allow-empty', '-m', 'release-only');
    git('switch', 'feature');
    git('commit', '-q', '--allow-empty', '-m', 'feature-only');
    git('commit', '-q', '--allow-empty', '-m', 'feature-second');

    const result = checkUnpushedCommits(repoPath, 'release');
    assert.strictEqual(result.hasUnpushed, true);
    assert.strictEqual(result.commitCount, 1);
    assert.ok(result.commits[0].includes('release-only'));
    assert.ok(!result.commits.some(commit => commit.includes('feature-')));
    assert.strictEqual(git('branch', '--show-current'), 'feature');
  });

  test('源分支没有远程引用时，统计指定本地源而非 HEAD', () => {
    git('switch', '-c', 'release');
    git('commit', '-q', '--allow-empty', '-m', 'release-first');
    git('commit', '-q', '--allow-empty', '-m', 'release-second');
    git('switch', 'feature');
    git('commit', '-q', '--allow-empty', '-m', 'feature-only');

    const result = checkUnpushedCommits(repoPath, 'release');
    assert.strictEqual(result.hasUnpushed, true);
    assert.strictEqual(result.commitCount, 3);
    assert.strictEqual(result.commits.length, 3);
    assert.ok(!result.commits.some(commit => commit.includes('feature-only')));
  });

  test('本地源与远程一致时，不受当前分支未推送提交影响', () => {
    git('branch', 'release');
    git('update-ref', remoteRef, baseCommit);
    git('commit', '-q', '--allow-empty', '-m', 'feature-only');

    assert.deepStrictEqual(checkUnpushedCommits(repoPath, 'release'), {
      hasUnpushed: false, commitCount: 0, commits: [],
    });
  });

  test('本地源落后远程时，不误报未推送提交', () => {
    git('branch', 'release');
    git('commit', '-q', '--allow-empty', '-m', 'remote-release');
    git('update-ref', remoteRef, 'HEAD');
    git('commit', '-q', '--allow-empty', '-m', 'feature-only');

    assert.deepStrictEqual(checkUnpushedCommits(repoPath, 'release'), {
      hasUnpushed: false, commitCount: 0, commits: [],
    });
  });

  test('返回完整提交数量，但仅展示最近五条提交', () => {
    git('update-ref', remoteRef, baseCommit);
    git('switch', '-c', 'release');
    for (let i = 0; i < 6; i++) {
      git('commit', '-q', '--allow-empty', '-m', `release-${i}`);
    }
    git('switch', 'feature');

    const result = checkUnpushedCommits(repoPath, 'release');
    assert.strictEqual(result.commitCount, 6);
    assert.strictEqual(result.commits.length, 5);
  });
});
