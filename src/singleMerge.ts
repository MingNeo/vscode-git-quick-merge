import vscode from "vscode";
import path from "path";
import fs from "fs";
import { execSync } from "child_process";
import {
  getWorktreesBaseDir,
  checkStaleWorktrees,
  cleanupStaleWorktrees,
  pruneWorktrees,
  getWorkspacePath,
  getRemoteRepoName,
  getCurrentCommitId,
  checkUnpushedCommits,
  pushCurrentBranch,
  getCurrentBranchName
} from "./utils";
import { t } from "./i18n";
import { logger } from "./logger";

export interface WorktreeConfig {
  repoPath: string;
  worktreePath: string;
  targetBranch: string;
  sourceBranch: string;
  mergeRef?: 'remote' | 'local';
}

/**
 * 生成worktree配置
 */
export function createWorktreeConfig(repoPath: string, targetBranch: string, sourceBranch: string): WorktreeConfig {
  const timestamp = Date.now().toString().slice(-6);
  const safeBranchName = targetBranch.replace(/[^a-zA-Z0-9]/g, '-');
  const worktreeName = `merge-${safeBranchName}-${timestamp}`;
  const worktreePath = path.join(getWorktreesBaseDir(), worktreeName);

  return {
    repoPath,
    worktreePath,
    targetBranch,
    sourceBranch
  };
}

/**
 * 统一错误处理
 */
function handleError(error: unknown, context: string): Error {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(`${context}: ${message}`);
}

/**
 * 创建worktree
 */
export async function createWorktree(repoPath: string, worktreePath: string, targetBranch: string): Promise<void> {
  try {
    const parentDir = path.dirname(worktreePath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    execSync(`git worktree add "${worktreePath}" "${targetBranch}"`, {
      cwd: repoPath,
      stdio: "pipe"
    });
  } catch (error) {
    throw handleError(error, t('error.createWorktreeFailed'));
  }
}

/**
 * 切换到目标分支
 */
export async function switchToTargetBranch(worktreePath: string, targetBranch: string): Promise<void> {
  try {
    execSync(`git switch "${targetBranch}"`, { cwd: worktreePath, stdio: "pipe" });
  } catch (error) {
    throw handleError(error, t('error.switchBranchFailed'));
  }
}

/**
 * 拉取最新代码
 */
export async function pullLatestCode(worktreePath: string, targetBranch: string): Promise<void> {
  try {
    const remoteRepo = getRemoteRepoName();
    execSync(`git pull ${remoteRepo} "${targetBranch}"`, { cwd: worktreePath, stdio: "pipe" });
  } catch (error) {
    throw handleError(error, t('error.pullCodeFailed', targetBranch));
  }
}

/**
 * 合并分支
 *
 * @param mergeRef 'remote' 表示合并 `origin/<source>`（默认，合并前先 fetch 保证远程 ref 最新），'local' 表示合并本地 ref `<source>`
 */
export async function mergeBranch(
  worktreePath: string,
  sourceBranch: string,
  mergeRef: 'remote' | 'local' = 'remote'
): Promise<void> {
  const remoteRepo = getRemoteRepoName();

  if (mergeRef === 'remote') {
    try {
      execSync(`git fetch ${remoteRepo} "${sourceBranch}"`, { cwd: worktreePath, stdio: "pipe" });
    } catch (error) {
      throw handleError(error, t('error.fetchSourceFailed', sourceBranch));
    }
  }

  try {
    const refToMerge = mergeRef === 'local'
      ? sourceBranch
      : `${remoteRepo}/${sourceBranch}`;
    execSync(`git merge "${refToMerge}"`, { cwd: worktreePath, stdio: "pipe" });
  } catch (error) {
    throw handleError(error, t('error.mergeBranchFailed'));
  }
}

/**
 * 推送到远程
 */
export async function pushToRemote(worktreePath: string, targetBranch: string): Promise<void> {
  try {
    const remoteRepo = getRemoteRepoName();
    execSync(`git push ${remoteRepo} "${targetBranch}"`, { cwd: worktreePath, stdio: "pipe" });
  } catch (error) {
    throw handleError(error, t('error.pushToRemoteFailed'));
  }
}

/**
 * 清理worktree
 */
export async function cleanupWorktree(config: WorktreeConfig): Promise<void> {
  const { repoPath, worktreePath } = config;

  try {
    // 不依赖目录是否存在：目录可能已被系统清理，但 git 登记仍在
    try {
      execSync(`git worktree remove "${worktreePath}" --force`, {
        cwd: repoPath,
        stdio: "pipe"
      });
    } catch (error) {
      logger.warn(t('cleanup.warning'), error);
    }
    if (fs.existsSync(worktreePath)) {
      fs.rmSync(worktreePath, { recursive: true, force: true });
    }
    pruneWorktrees(repoPath);
  } catch (error) {
    logger.warn(t('cleanup.warning'), error);
  }
}

/**
 * 检查远程分支是否存在
 */
export async function checkRemoteBranchExists(workspacePath: string, branchName: string): Promise<boolean> {
  try {
    const remoteRepo = getRemoteRepoName();
    const result = execSync(`git ls-remote --heads ${remoteRepo} "${branchName}"`, {
      cwd: workspacePath,
      encoding: 'utf8'
    });
    return !!result.trim();
  } catch (error) {
    return false;
  }
}

export type UnpushedDecision = 'remote' | 'local' | 'cancel' | 'pushFailed';

/**
 * 检查并处理未推送的提交
 *
 * 返回用户的合并决策：
 * - 'remote'     → 合并远程 ref（默认、历史行为；若用户选择"推送并继续"会先 push）
 * - 'local'      → 合并本地 ref（包含未推送提交）
 * - 'cancel'     → 用户主动取消（点取消 / Esc）
 * - 'pushFailed' → 用户选了"推送并继续"但 push 失败（错误已经通过 showErrorMessage 弹出）
 */
export async function checkAndHandleUnpushedCommits(
  repoPath: string,
  branchName: string
): Promise<UnpushedDecision> {
  const { hasUnpushed, commitCount, commits } = checkUnpushedCommits(repoPath, branchName);

  if (!hasUnpushed) {
    return 'remote';
  }

  // 构建提示消息
  const commitList = commits.length > 0
    ? t('commits.recent', commits.map(commit => `• ${commit}`).join('\n'), commitCount > 5 ? t('commits.andMore', (commitCount - 5).toString()) : '')
    : '';

  const message = t('warning.unpushedCommits', branchName, commitCount.toString(), commitList);

  const PUSH_AND_CONTINUE = t('button.pushAndContinue');
  const MERGE_LOCAL = t('button.mergeLocalLatest');

  // 注意：modal 对话框会自动提供"取消"按钮（点取消或按 Esc 时 choice 为 undefined）
  // 所以这里不手动传 CANCEL，否则会出现两个取消按钮
  const choice = await vscode.window.showWarningMessage(
    message,
    { modal: true },
    PUSH_AND_CONTINUE,
    MERGE_LOCAL
  );

  if (choice === PUSH_AND_CONTINUE) {
    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: t('progress.pushingBranch', branchName),
          cancellable: false,
        },
        async (progress) => {
          progress.report({ increment: 0, message: t('progress.preparingPush') });
          await new Promise(resolve => setTimeout(resolve, 200));
          progress.report({ increment: 30, message: t('progress.connectingRemote') });
          await pushCurrentBranch(repoPath, branchName);
          progress.report({ increment: 70, message: t('progress.pushComplete') });
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      );
      return 'remote';
    } catch (error) {
      vscode.window.showErrorMessage(t('error.pushFailed', error instanceof Error ? error.message : String(error)));
      return 'pushFailed';
    }
  }

  if (choice === MERGE_LOCAL) {
    return 'local';
  }

  // undefined（点取消或按 Esc）
  return 'cancel';
}

/**
 * 检查并提示清理历史残留的 worktrees
 */
export async function checkAndPromptStaleWorktrees(): Promise<void> {
  const workspacePath = getWorkspacePath();
  const staleWorktrees = checkStaleWorktrees(workspacePath);

  if (staleWorktrees.length === 0) {
    return;
  }

  await cleanupStaleWorktrees(staleWorktrees, workspacePath);
}

/**
 * 执行worktree工作流
 */
export function executeWorkTreeFlow(config: WorktreeConfig): void {
  vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: t('progress.processing'),
      cancellable: false,
    },
    async (progress) => {
      const { repoPath, worktreePath, targetBranch, sourceBranch, mergeRef = 'remote' } = config;

      try {
        progress.report({ message: t('progress.checkingStaleWorktrees') });
        await checkAndPromptStaleWorktrees();

        progress.report({ message: t('progress.creatingWorktree') });
        await createWorktree(repoPath, worktreePath, targetBranch);

        progress.report({ message: t('progress.switchingBranch') });
        await switchToTargetBranch(worktreePath, targetBranch);

        progress.report({ message: t('progress.pullingCode') });
        await pullLatestCode(worktreePath, targetBranch);

        // 获取合并前的 commit id
        const beforeMergeCommitId = getCurrentCommitId(worktreePath);

        progress.report({ message: t('progress.mergingBranch') });
        await mergeBranch(worktreePath, sourceBranch, mergeRef);

        // 获取合并后的 commit id
        const afterMergeCommitId = getCurrentCommitId(worktreePath);

        // 检查是否有新的提交
        const hasNewCommits = beforeMergeCommitId !== afterMergeCommitId;

        progress.report({ message: t('progress.pushingToRemote') });
        await pushToRemote(worktreePath, targetBranch);

        await cleanupWorktree(config);

        // 根据是否有新提交显示不同的消息
        if (hasNewCommits) {
          vscode.window.showInformationMessage(
            t('success.mergeComplete', sourceBranch, targetBranch)
          );
        } else {
          vscode.window.showWarningMessage(
            t('warning.noNewCommits', sourceBranch, targetBranch)
          );
        }

        progress.report({ message: t('progress.mergeComplete') });
      } catch (error) {
        await cleanupWorktree(config);
        vscode.window.showErrorMessage(
          t('error.mergeFailedGeneral', sourceBranch, targetBranch, handleError(error, '合并过程').message)
        );
      }
    }
  );
}

/**
 * 执行合并流程
 */
export async function executeFlow(targetBranch: string, sourceBranch?: string): Promise<void> {
  const currentBranch = getCurrentBranchName();
  const workspacePath = getWorkspacePath();

  if (!workspacePath) {
    vscode.window.showErrorMessage(t('error.noWorkspace'));
    return;
  }

  // 如果未指定源分支，使用当前分支
  const actualSourceBranch = sourceBranch || currentBranch;

  if (!actualSourceBranch) {
    vscode.window.showErrorMessage(t('error.cannotGetBranchInfo'));
    return;
  }

  // 检查未推送的提交，并由用户决定合并 local 还是 remote
  const decision = await checkAndHandleUnpushedCommits(workspacePath, actualSourceBranch);
  // 用户主动取消 / 推送失败（错误已弹），均直接结束流程
  if (decision === 'cancel' || decision === 'pushFailed') {
    return;
  }

  const config: WorktreeConfig = {
    ...createWorktreeConfig(workspacePath, targetBranch, actualSourceBranch),
    mergeRef: decision,
  };
  executeWorkTreeFlow(config);
}
