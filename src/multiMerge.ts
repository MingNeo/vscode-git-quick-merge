import vscode from "vscode";
import { getCurrentCommitId, getCurrentBranchName, getWorkspacePath } from "./utils";
import { t } from "./i18n";
import {
  createWorktree,
  switchToTargetBranch,
  pullLatestCode,
  mergeBranch,
  pushToRemote,
  cleanupWorktree,
  checkAndPromptStaleWorktrees,
  checkAndHandleUnpushedCommits,
  createWorktreeConfig,
  WorktreeConfig
} from "./singleMerge";

export interface MergePreset {
  name: string;
  branches: string[];
}

export interface MultipleMergeResult {
  targetBranch: string;
  success: boolean;
  error?: string;
  hasNewCommits?: boolean;
}

/**
 * 执行单个分支的合并流程（用于多分支合并）
 */
async function executeSingleMergeFlow(targetBranch: string, sourceBranch: string, workspacePath: string): Promise<MultipleMergeResult> {
  const config = createWorktreeConfig(workspacePath, targetBranch, sourceBranch);

  try {
    // 只在第一次合并时检查历史残留的 worktrees
    // await checkAndPromptStaleWorktrees();

    await createWorktree(config.repoPath, config.worktreePath, targetBranch);
    await switchToTargetBranch(config.worktreePath, targetBranch);
    await pullLatestCode(config.worktreePath, targetBranch);

    // 获取合并前的 commit id
    const beforeMergeCommitId = getCurrentCommitId(config.worktreePath);

    await mergeBranch(config.worktreePath, sourceBranch, targetBranch);

    // 获取合并后的 commit id
    const afterMergeCommitId = getCurrentCommitId(config.worktreePath);

    // 检查是否有新的提交
    const hasNewCommits = beforeMergeCommitId !== afterMergeCommitId;

    await pushToRemote(config.worktreePath, targetBranch);
    await cleanupWorktree(config);

    return {
      targetBranch,
      success: true,
      hasNewCommits
    };

  } catch (error) {
    await cleanupWorktree(config);
    return {
      targetBranch,
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * 显示多分支合并结果
 */
function showMultipleMergeResults(
  results: MultipleMergeResult[],
  sourceBranch: string,
  preset?: MergePreset,
  targetBranches?: string[]
): void {
  const successResults = results.filter(r => r.success);
  const failedResults = results.filter(r => !r.success);

  if (failedResults.length === 0) {
    // 全部成功
    const successBranches = successResults.map(r => r.targetBranch).join(', ');
    if (preset) {
      vscode.window.showInformationMessage(
        t('success.presetMergeComplete', preset.name, sourceBranch, successBranches)
      );
    } else {
      vscode.window.showInformationMessage(
        t('success.multipleMergeComplete', sourceBranch, successBranches)
      );
    }
  } else if (successResults.length === 0) {
    // 全部失败
    const failedBranches = failedResults.map(r => `${r.targetBranch}: ${r.error}`).join('\n');
    const branches = preset ? preset.branches.join(', ') : (targetBranches || []).join(', ');
    vscode.window.showErrorMessage(
      t('error.mergeFailedGeneral', sourceBranch, branches, failedBranches)
    );
  } else {
    // 部分成功
    const successBranches = successResults.map(r => r.targetBranch).join(', ');
    const failedBranches = failedResults.map(r => r.targetBranch).join(', ');
    if (preset) {
      vscode.window.showWarningMessage(
        t('success.presetMergePartial', preset.name, sourceBranch, successBranches, failedBranches)
      );
    } else {
      vscode.window.showWarningMessage(
        t('success.multipleMergePartial', sourceBranch, successBranches, failedBranches)
      );
    }
  }
}

/**
 * 执行多分支合并的核心逻辑
 */
async function executeMultipleMergeCore(
  targetBranches: string[],
  sourceBranch: string,
  workspacePath: string,
  title: string
): Promise<MultipleMergeResult[]> {
  return new Promise((resolve) => {
    vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: title,
        cancellable: false,
      },
      async (progress) => {
        // 在开始多分支合并前检查历史残留的 worktrees
        progress.report({ message: t('progress.checkingStaleWorktrees') });
        await checkAndPromptStaleWorktrees();

        const results: MultipleMergeResult[] = [];

        for (let i = 0; i < targetBranches.length; i++) {
          const targetBranch = targetBranches[i];
          progress.report({
            message: t('progress.processingMultiple', (i + 1).toString(), targetBranches.length.toString()) + ` - ${targetBranch}`,
            increment: (i / targetBranches.length) * 100
          });

          const result = await executeSingleMergeFlow(targetBranch, sourceBranch, workspacePath);
          results.push(result);
        }

        resolve(results);
      }
    );
  });
}

/**
 * 执行多分支合并的通用函数
 */
async function executeMultipleMergeGeneric(
  targetBranches: string[],
  preset?: MergePreset
): Promise<void> {
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

  const title = preset
    ? t('progress.processingMultiple', '0', targetBranches.length.toString()) + ` - ${preset.name}`
    : t('progress.processingMultiple', '0', targetBranches.length.toString());

  const results = await executeMultipleMergeCore(targetBranches, sourceBranch, workspacePath, title);

  showMultipleMergeResults(results, sourceBranch, preset, targetBranches);
}

/**
 * 执行预设合并流程
 */
export async function executePresetMergeFlow(preset: MergePreset): Promise<void> {
  await executeMultipleMergeGeneric(preset.branches, preset);
}

/**
 * 执行多分支合并流程（兼容旧版本）
 */
export async function executeMultipleMergeFlow(targetBranches: string[]): Promise<void> {
  await executeMultipleMergeGeneric(targetBranches);
}
