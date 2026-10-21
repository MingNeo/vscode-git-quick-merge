import vscode from "vscode";
import path from "path";
import fs from "fs";
import os from "os";
import { execFileSync, execSync } from "child_process";
import { logger } from "./logger";

/**
 * 获取当前Git分支名
 */
export function getCurrentBranchName(): string | null {
  try {
    // 首先尝试使用VSCode Git扩展API
    const gitExtension = vscode.extensions.getExtension("vscode.git")?.exports;
    if (gitExtension) {
      const gitApi = gitExtension.getAPI(1);
      const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

      const repository = gitApi.repositories.find((repo: any) =>
        repo.rootUri.fsPath === workspacePath
      );

      const branchName = repository?.state?.HEAD?.name;
      if (branchName) {
        logger.debug('通过VSCode Git API获取分支名成功', { branchName });
        return branchName;
      }
    }

    // 备用方案：使用命令行获取分支名
    logger.debug('VSCode Git API未能获取分支名，尝试命令行方式');
    const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (workspacePath) {
      const branchName = execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: workspacePath,
        encoding: 'utf8'
      }).trim();
      logger.debug('通过命令行获取分支名成功', { branchName, workspacePath });
      return branchName;
    }

    logger.warn('无法获取工作区路径');
    return null;
  } catch (error) {
    logger.error('获取当前分支名失败', error);
    return null;
  }
}

/**
 * 获取 worktrees 基础目录
 */
export function getWorktreesBaseDir(): string {
  return path.join(os.tmpdir(), 'vscode-git-auto-merge');
}

/**
 * 清理 git 中目录已不存在的 worktree 登记（否则分支会一直被视为"已被 worktree 占用"）
 */
export function pruneWorktrees(repoPath: string): void {
  try {
    execSync('git worktree prune', { cwd: repoPath, stdio: "pipe" });
  } catch (error) {
    logger.warn('git worktree prune 失败:', error);
  }
}

/**
 * 只接受扩展临时根目录的直接子目录，使用真实路径兼容系统目录别名。
 * 拒绝符号链接；目录已不存在时仍可清理 git 登记。
 */
function resolveMergeWorktreePath(worktreePath: string): string | undefined {
  try {
    const baseDir = getWorktreesBaseDir();
    if (!fs.lstatSync(baseDir).isDirectory()) {
      return undefined;
    }

    const realBaseDir = fs.realpathSync(baseDir);
    const candidate = path.resolve(worktreePath);
    if (!path.basename(candidate).startsWith('merge-') ||
        fs.realpathSync(path.dirname(candidate)) !== realBaseDir) {
      return undefined;
    }

    const entry = fs.lstatSync(candidate, { throwIfNoEntry: false });
    if (entry && !entry.isDirectory()) {
      return undefined;
    }

    return entry ? fs.realpathSync(candidate) : path.join(realBaseDir, path.basename(candidate));
  } catch {
    return undefined;
  }
}

/**
 * 列出 git 中登记的、由本扩展创建的 worktree 路径
 */
function listRegisteredMergeWorktrees(repoPath: string): string[] {
  try {
    const output = execFileSync('git', ['worktree', 'list', '--porcelain', '-z'], {
      cwd: repoPath,
      encoding: 'utf8'
    });
    return output
      .split('\0')
      .filter(line => line.startsWith('worktree '))
      .flatMap(line => {
        const worktreePath = resolveMergeWorktreePath(line.slice('worktree '.length));
        return worktreePath ? [worktreePath] : [];
      });
  } catch (error) {
    logger.warn('git worktree list 失败:', error);
    return [];
  }
}

/**
 * 检查历史残留的 worktrees
 * 同时检查临时目录中的残留目录和 git 中登记的 worktree（传入 repoPath 时）
 */
export function checkStaleWorktrees(repoPath?: string): string[] {
  // 使用真实完整路径去重，避免目录别名或同名目录导致误判。
  const staleWorktrees = new Set<string>();

  if (repoPath) {
    pruneWorktrees(repoPath);
    for (const worktreePath of listRegisteredMergeWorktrees(repoPath)) {
      staleWorktrees.add(worktreePath);
    }
  }

  const baseDir = getWorktreesBaseDir();
  if (fs.existsSync(baseDir)) {
    try {
      const entries = fs.readdirSync(baseDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const worktreePath = resolveMergeWorktreePath(path.join(baseDir, entry.name));
          if (worktreePath) {
            staleWorktrees.add(worktreePath);
          }
        }
      }
    } catch (error) {
      logger.error('检查历史 worktrees 失败:', error);
    }
  }

  return [...staleWorktrees];
}

/**
 * 清理历史残留的 worktrees
 */
export async function cleanupStaleWorktrees(worktreePaths: string[], repoPath?: string): Promise<{ success: number; failed: number }> {
  let success = 0;
  let failed = 0;

  for (const worktreePath of worktreePaths) {
    const safePath = resolveMergeWorktreePath(worktreePath);
    if (!safePath) {
      logger.warn(`拒绝清理扩展临时目录以外的路径或符号链接: ${worktreePath}`);
      failed++;
      continue;
    }

    try {
      // 尝试从 git 中移除 worktree
      if (repoPath) {
        try {
          execFileSync('git', ['worktree', 'remove', safePath, '--force'], {
            cwd: repoPath,
            stdio: "pipe"
          });
        } catch (error) {
          // 忽略 git worktree remove 的错误，继续清理文件系统
          logger.warn(`Git worktree remove 失败 (${safePath}):`, error);
        }
      }

      // git 操作后再次校验，不能让文件系统兜底绕过清理边界。
      if (resolveMergeWorktreePath(safePath) !== safePath) {
        throw new Error(`worktree 路径已变化，拒绝清理: ${safePath}`);
      }
      fs.rmSync(safePath, { recursive: true, force: true });

      success++;
    } catch (error) {
      logger.error(`清理 worktree 失败 (${worktreePath}):`, error);
      failed++;
    }
  }

  // git worktree remove 失败但目录已被删除时，登记仍残留，这里兜底清掉
  if (repoPath) {
    pruneWorktrees(repoPath);
  }

  return { success, failed };
}

/**
 * 获取工作区路径
 */
export function getWorkspacePath(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

/**
 * 获取配置的远程仓库名称
 */
export function getRemoteRepoName(): string {
  const config = vscode.workspace.getConfiguration("gitQuickMerge");
  return config.get<string>("remoteRepoName", "origin");
}

/**
 * 获取当前分支的 commit id
 */
export function getCurrentCommitId(repoPath: string): string | null {
  try {
    const result = execSync('git rev-parse HEAD', {
      cwd: repoPath,
      encoding: 'utf8'
    });
    return result.trim();
  } catch (error) {
    logger.error('获取 commit id 失败:', error);
    return null;
  }
}

/**
 * 检查指定源分支是否有未推送到远程的提交
 */
export function checkUnpushedCommits(repoPath: string, branchName: string): { hasUnpushed: boolean; commitCount: number; commits: string[] } {
  const remoteRepo = getRemoteRepoName();
  const localRef = `refs/heads/${branchName}`;
  const remoteRef = `refs/remotes/${remoteRepo}/${branchName}`;

  try {
    // 源分支仅存在于远程时，调用方直接合并远程版本，不提供本地选项。
    try {
      execFileSync('git', ['rev-parse', '--verify', localRef], {
        cwd: repoPath,
        stdio: 'pipe'
      });
    } catch {
      return { hasUnpushed: false, commitCount: 0, commits: [] };
    }

    let revision = localRef;
    try {
      execFileSync('git', ['rev-parse', '--verify', remoteRef], {
        cwd: repoPath,
        stdio: 'pipe'
      });
      revision = `${remoteRef}..${localRef}`;
    } catch {
      // 没有对应远程引用时，统计指定本地源分支的全部提交。
    }

    const countResult = execFileSync('git', ['rev-list', '--count', revision, '--'], {
      cwd: repoPath,
      encoding: 'utf8'
    });
    const commitCount = parseInt(countResult.trim(), 10);
    const commits = commitCount > 0
      ? execFileSync('git', ['log', '--oneline', '-n', '5', revision, '--'], {
        cwd: repoPath,
        encoding: 'utf8'
      }).trim().split('\n').filter(line => line.trim())
      : [];

    return {
      hasUnpushed: commitCount > 0,
      commitCount,
      commits
    };
  } catch (error) {
    logger.error('检查未推送提交失败:', error);
    return { hasUnpushed: false, commitCount: 0, commits: [] };
  }
}

/**
 * 推送当前分支到远程
 */
export async function pushCurrentBranch(repoPath: string, branchName: string): Promise<void> {
  const remoteRepo = getRemoteRepoName();

  try {
    // 使用 stdio: 'inherit' 可以看到推送进度，但在这里我们使用 pipe 来捕获错误
    const result = execSync(`git push ${remoteRepo} ${branchName}`, {
      cwd: repoPath,
      stdio: 'pipe',
      encoding: 'utf8'
    });

    // 如果推送成功，result 包含推送信息
    logger.debug('推送结果:', result);
  } catch (error: any) {
    // 提供更详细的错误信息
    const errorMessage = error.stderr || error.message || String(error);

    if (errorMessage.includes('Permission denied')) {
      throw new Error('推送失败: 权限被拒绝，请检查 SSH 密钥或访问令牌');
    } else if (errorMessage.includes('Could not resolve hostname')) {
      throw new Error('推送失败: 无法连接到远程仓库，请检查网络连接');
    } else if (errorMessage.includes('rejected')) {
      throw new Error('推送失败: 推送被拒绝，可能需要先拉取远程更新');
    } else if (errorMessage.includes('non-fast-forward')) {
      throw new Error('推送失败: 非快进更新，请先拉取并合并远程更改');
    } else {
      throw new Error(`推送分支失败: ${errorMessage}`);
    }
  }
}
