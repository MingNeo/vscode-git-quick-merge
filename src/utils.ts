import vscode from "vscode";
import path from "path";
import fs from "fs";
import os from "os";
import { execSync } from "child_process";
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
 * 检查历史残留的 worktrees
 */
export function checkStaleWorktrees(): string[] {
  const baseDir = getWorktreesBaseDir();

  if (!fs.existsSync(baseDir)) {
    return [];
  }

  try {
    const entries = fs.readdirSync(baseDir, { withFileTypes: true });
    const staleWorktrees: string[] = [];

    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith('merge-')) {
        staleWorktrees.push(path.join(baseDir, entry.name));
      }
    }

    return staleWorktrees;
  } catch (error) {
    console.error('检查历史 worktrees 失败:', error);
    return [];
  }
}

/**
 * 清理历史残留的 worktrees
 */
export async function cleanupStaleWorktrees(worktreePaths: string[], repoPath?: string): Promise<{ success: number; failed: number }> {
  let success = 0;
  let failed = 0;

  for (const worktreePath of worktreePaths) {
    if (!worktreePath.includes('vscode-git-auto-merge')) {
      continue;
    }

    try {
      const worktreeName = path.basename(worktreePath);

      // 尝试从 git 中移除 worktree
      if (repoPath) {
        try {
          execSync(`git worktree remove "${worktreeName}" --force`, {
            cwd: repoPath,
            stdio: "pipe"
          });
        } catch (error) {
          // 忽略 git worktree remove 的错误，继续清理文件系统
          console.warn(`Git worktree remove 失败 (${worktreeName}):`, error);
        }
      }

      // 直接删除文件系统中的目录
      if (fs.existsSync(worktreePath)) {
        fs.rmSync(worktreePath, { recursive: true, force: true });
      }

      success++;
    } catch (error) {
      console.error(`清理 worktree 失败 (${worktreePath}):`, error);
      failed++;
    }

    // vscode.window.showInformationMessage(`✅ 清理 worktree (${worktreePath}) 成功`);
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
    console.error('获取 commit id 失败:', error);
    return null;
  }
}

/**
 * 检查当前分支是否有未推送到远程的提交
 */
export function checkUnpushedCommits(repoPath: string, branchName: string): { hasUnpushed: boolean; commitCount: number; commits: string[] } {
  const remoteRepo = getRemoteRepoName();

  try {
    // 首先检查远程分支是否存在
    try {
      execSync(`git rev-parse --verify ${remoteRepo}/${branchName}`, {
        cwd: repoPath,
        stdio: 'pipe'
      });
    } catch (error) {
      // 远程分支不存在，说明这个分支从未推送过
      const localCommitsResult = execSync(`git rev-list --count HEAD`, {
        cwd: repoPath,
        encoding: 'utf8'
      });
      const commitCount = parseInt(localCommitsResult.trim(), 10);

      if (commitCount > 0) {
        const commitsResult = execSync(`git log --oneline -n 5 HEAD`, {
          cwd: repoPath,
          encoding: 'utf8'
        });
        const commits = commitsResult.trim().split('\n').filter(line => line.trim());

        return {
          hasUnpushed: true,
          commitCount,
          commits
        };
      }

      return { hasUnpushed: false, commitCount: 0, commits: [] };
    }

    // 检查本地分支相对于远程分支的未推送提交
    const result = execSync(`git log --oneline ${remoteRepo}/${branchName}..HEAD`, {
      cwd: repoPath,
      encoding: 'utf8'
    });

    const commits = result.trim().split('\n').filter(line => line.trim());
    const commitCount = commits.length;
    const hasUnpushed = commitCount > 0;

    return {
      hasUnpushed,
      commitCount,
      commits: commits.slice(0, 5) // 只返回前5个提交用于显示
    };
  } catch (error) {
    console.error('检查未推送提交失败:', error);
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
    console.log('推送结果:', result);
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
