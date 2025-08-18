import vscode from "vscode";
import path from "path";
import fs from "fs";
import { execSync } from "child_process";
import {
  getCurrentBranchName,
  getWorktreesBaseDir,
  checkStaleWorktrees,
  cleanupStaleWorktrees,
  getWorkspacePath,
  getRemoteRepoName,
  getCurrentCommitId,
  checkUnpushedCommits,
  pushCurrentBranch
} from "./utils";
import { t } from "./i18n";

interface WorktreeConfig {
  repoPath: string;
  worktreePath: string;
  targetBranch: string;
  sourceBranch: string;
}

/**
 * 生成worktree配置
 */
function createWorktreeConfig(repoPath: string, targetBranch: string, sourceBranch: string): WorktreeConfig {
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
 * 执行worktree工作流
 */
function executeWorkTreeFlow(config: WorktreeConfig): void {
  vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: t('progress.processing'),
      cancellable: false,
    },
    async (progress) => {
      const { repoPath, worktreePath, targetBranch, sourceBranch } = config;

      try {
        progress.report({ message: t('progress.checkingStaleWorktrees') });
        await checkAndPromptStaleWorktrees();

        progress.report({ message: t('progress.creatingWorktree') });
        await createWorktree(repoPath, worktreePath, targetBranch);

        // progress.report({ message: "检查远程分支..." });
        // const [isRemoteTargetBranchExists, isRemoteSourceBranchExists] = await Promise.all([
        //   checkRemoteBranchExists(worktreePath, targetBranch),
        //   checkRemoteBranchExists(worktreePath, sourceBranch)
        // ]);

        // if (!isRemoteTargetBranchExists) {
        //   throw new Error(`远程目标分支 ${targetBranch} 不存在，请先创建目标分支`);
        // }

        // if (!isRemoteSourceBranchExists) {
        //   throw new Error(`远程源分支 ${sourceBranch} 不存在，请先推送源分支到远程仓库`);
        // }

        progress.report({ message: t('progress.switchingBranch') });
        await switchToTargetBranch(worktreePath, targetBranch);

        progress.report({ message: t('progress.pullingCode') });
        await pullLatestCode(worktreePath, targetBranch);

        // 获取合并前的 commit id
        const beforeMergeCommitId = getCurrentCommitId(worktreePath);

        progress.report({ message: t('progress.mergingBranch') });
        await mergeBranch(worktreePath, sourceBranch, targetBranch);

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

        // 询问是否触发部署
        // await askForDeployment();

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
 * 创建worktree
 */
async function createWorktree(repoPath: string, worktreePath: string, targetBranch: string): Promise<void> {
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
async function switchToTargetBranch(worktreePath: string, targetBranch: string): Promise<void> {
  try {
    execSync(`git switch "${targetBranch}"`, { cwd: worktreePath, stdio: "pipe" });
  } catch (error) {
    throw handleError(error, t('error.switchBranchFailed'));
  }
}

/**
 * 拉取最新代码
 */
async function pullLatestCode(worktreePath: string, targetBranch: string): Promise<void> {
  try {
    const remoteRepo = getRemoteRepoName();
    execSync(`git pull ${remoteRepo} "${targetBranch}"`, { cwd: worktreePath, stdio: "pipe" });
  } catch (error) {
    throw handleError(error, t('error.pullCodeFailed', targetBranch));
  }
}

/**
 * 合并分支
 */
async function mergeBranch(worktreePath: string, sourceBranch: string, targetBranch: string): Promise<void> {
  try {
    const remoteRepo = getRemoteRepoName();
    execSync(`git merge "${remoteRepo}/${sourceBranch}"`, { cwd: worktreePath, stdio: "pipe" });
  } catch (error) {
    throw handleError(error, t('error.mergeBranchFailed'));
  }
}

/**
 * 推送到远程
 */
async function pushToRemote(worktreePath: string, targetBranch: string): Promise<void> {
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
async function cleanupWorktree(config: WorktreeConfig): Promise<void> {
  const { repoPath, worktreePath } = config;

  try {
    if (fs.existsSync(worktreePath)) {
      const worktreeName = path.basename(worktreePath);
      execSync(`git worktree remove "${worktreeName}" --force`, {
        cwd: repoPath,
        stdio: "pipe"
      });
      fs.rmSync(worktreePath, { recursive: true, force: true });
    }
  } catch (error) {
    console.warn(t('cleanup.warning'), error);
  }
}

/**
 * 检查远程分支是否存在
 */
async function checkRemoteBranchExists(workspacePath: string, branchName: string): Promise<boolean> {
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



/**
 * 检查并处理未推送的提交
 */
async function checkAndHandleUnpushedCommits(repoPath: string, branchName: string): Promise<boolean> {
  const { hasUnpushed, commitCount, commits } = checkUnpushedCommits(repoPath, branchName);
  
  if (!hasUnpushed) {
    return true; // 没有未推送的提交，可以继续
  }

  // 构建提示消息
  const commitList = commits.length > 0 
    ? t('commits.recent', commits.map(commit => `• ${commit}`).join('\n'), commitCount > 5 ? t('commits.andMore', (commitCount - 5).toString()) : '')
    : '';
    
  const message = t('warning.unpushedCommits', branchName, commitCount.toString(), commitList);

  const PUSH_AND_CONTINUE = t('button.pushAndContinue');
  const CONTINUE_WITHOUT_PUSH = t('button.continueWithoutPush');
  const CANCEL = t('button.cancel');

  const choice = await vscode.window.showWarningMessage(
    message,
    { modal: true },
    PUSH_AND_CONTINUE,
    CONTINUE_WITHOUT_PUSH,
    CANCEL
  );

  switch (choice) {
    case PUSH_AND_CONTINUE:
      try {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: t('progress.pushingBranch', branchName),
            cancellable: false,
          },
          async (progress) => {
            progress.report({ 
              increment: 0, 
              message: t('progress.preparingPush')
            });
            
            await new Promise(resolve => setTimeout(resolve, 200)); // 短暂延迟以显示进度
            
            progress.report({ 
              increment: 30, 
              message: t('progress.connectingRemote')
            });
            
            await pushCurrentBranch(repoPath, branchName);
            
            progress.report({ 
              increment: 70, 
              message: t('progress.pushComplete')
            });
            
            await new Promise(resolve => setTimeout(resolve, 300)); // 短暂延迟以显示完成状态
          }
        );
        
        // vscode.window.showInformationMessage(`✅ 分支 "${branchName}" 推送成功`);
        return true;
      } catch (error) {
        vscode.window.showErrorMessage(t('error.pushFailed', error instanceof Error ? error.message : String(error)));
        return false;
      }
      
    case CONTINUE_WITHOUT_PUSH:
      // vscode.window.showWarningMessage(`⚠️ 将在有未推送提交的情况下继续合并`);
      return true;
      
    case CANCEL:
    default:
      return false;
  }
}

/**
 * 执行合并流程
 */
async function executeFlow(targetBranch: string): Promise<void> {
  const sourceBranch = getCurrentBranchName();
  const workspacePath = getWorkspacePath();

  if (!sourceBranch || !workspacePath) {
    vscode.window.showErrorMessage(t('error.cannotGetBranchInfo'));
    return;
  }

  // 检查未推送的提交
  const shouldContinue = await checkAndHandleUnpushedCommits(workspacePath, sourceBranch);
  if (!shouldContinue) {
    return;
  }

  const config = createWorktreeConfig(workspacePath, targetBranch, sourceBranch);
  executeWorkTreeFlow(config);
}

/**
 * 检查并提示清理历史残留的 worktrees
 */
async function checkAndPromptStaleWorktrees(): Promise<void> {
  const staleWorktrees = checkStaleWorktrees();

  if (staleWorktrees.length === 0) {
    return;
  }

  const workspacePath = getWorkspacePath();
  await cleanupStaleWorktrees(staleWorktrees, workspacePath);
}

/**
 * 主入口函数
 */
function manageWorktrees(statusBarItem?: vscode.StatusBarItem): void {
  // 立即隐藏tooltip
  if (statusBarItem) {
    statusBarItem.tooltip = "";
  }

  const config = vscode.workspace.getConfiguration("gitQuickMerge");
  const branches = new Set(['develop', 'release', 'master', ...(config.get<string[]>("branches") || [])].filter(v => v !== config.get<string>("currentBranch")));

  const CANCEL = t('button.exit');
  vscode.window
    .showQuickPick([CANCEL, ...branches], {
      canPickMany: false,
      placeHolder: t('prompt.selectTargetBranch'),
    })
    .then((targetBranch) => {
      // 恢复tooltip
      // if (statusBarItem) {
      //   statusBarItem.tooltip = "合并当前分支到指定分支";
      // }
      
      if (!targetBranch || targetBranch === CANCEL) {
        return;
      }
      executeFlow(targetBranch);
    });
}

/**
 * 手动清理历史残留的 worktrees
 */
// async function manualCleanupStaleWorktrees(): Promise<void> {
//   try {
//     const staleWorktrees = checkStaleWorktrees();
    
//     if (staleWorktrees.length === 0) {
//       vscode.window.showInformationMessage(
//         t('success.noStaleWorktrees')
//       );
//       return;
//     }

//     const workspacePath = getWorkspacePath();
//     if (!workspacePath) {
//       vscode.window.showErrorMessage(t('error.cannotGetBranchInfo'));
//       return;
//     }

//     await vscode.window.withProgress(
//       {
//         location: vscode.ProgressLocation.Notification,
//         title: t('progress.cleanupStaleWorktrees'),
//         cancellable: false,
//       },
//       async (progress) => {
//         await cleanupStaleWorktrees(staleWorktrees, workspacePath);
//         progress.report({ message: t('progress.cleanupComplete') });
//       }
//     );

//     vscode.window.showInformationMessage(
//       t('success.cleanupComplete', staleWorktrees.length.toString())
//     );
//   } catch (error) {
//     vscode.window.showErrorMessage(
//       t('error.cleanupFailed', error instanceof Error ? error.message : String(error))
//     );
//   }
// }

export function activate(context: vscode.ExtensionContext): void {
  // 添加状态栏项
  const statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    10000
  );
  statusBarItem.command = "gitQuickMerge.quick-merge-to";
  statusBarItem.text = "$(git-branch) " + t('statusBar.title');
  // statusBarItem.tooltip = "合并当前分支到指定分支";
  statusBarItem.show();

  const quickMergeDisposable = vscode.commands.registerCommand(
    "gitQuickMerge.quick-merge-to",
    () => manageWorktrees(statusBarItem)
  );

  // const cleanupDisposable = vscode.commands.registerCommand(
  //   "gitQuickMerge.cleanup-stale-worktrees",
  //   () => manualCleanupStaleWorktrees()
  // );

  context.subscriptions.push(quickMergeDisposable);
  // context.subscriptions.push(cleanupDisposable);
  context.subscriptions.push(statusBarItem);

  // 延迟检查历史残留的 worktrees（避免影响扩展启动速度）
  setTimeout(async () => {
    const config = vscode.workspace.getConfiguration("gitQuickMerge");
    const skipCheck = config.get<boolean>("skipStaleWorktreeCheck", false);

    if (!skipCheck) {
      await checkAndPromptStaleWorktrees();
    }
  }, 2000); // 2秒后检查
}

export function deactivate(): void {}
